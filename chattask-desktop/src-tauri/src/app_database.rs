use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{collections::HashMap, fs, path::{Component, Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub file_name: String,
    pub path: String,
    pub created_at: u64,
    pub size: u64,
    pub complete: bool,
}

const COMPLETE_BACKUP_EXTENSION: &str = "chattask-backup";

fn safe_component(value: &str) -> Option<String> {
    let path = Path::new(value);
    let mut components = path.components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(component)), None) => {
            let safe = component.to_string_lossy().chars()
                .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
                .collect::<String>();
            (!safe.is_empty()).then_some(safe)
        }
        _ => None,
    }
}

fn copy_directory(source: &Path, destination: &Path) -> Result<u64, String> {
    if !source.exists() { return Ok(0); }
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    let mut total = 0_u64;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() { continue; }
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            total = total.saturating_add(copy_directory(&entry.path(), &target)?);
        } else if file_type.is_file() {
            total = total.saturating_add(fs::copy(entry.path(), target).map_err(|error| error.to_string())?);
        }
    }
    Ok(total)
}

fn path_size(path: &Path) -> Result<u64, String> {
    if path.is_file() { return Ok(path.metadata().map_err(|error| error.to_string())?.len()); }
    if !path.is_dir() { return Ok(0); }
    let mut total = 0_u64;
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_type().map_err(|error| error.to_string())?.is_symlink() { continue; }
        total = total.saturating_add(path_size(&entry.path())?);
    }
    Ok(total)
}

fn prune_automatic_backups(root: &Path, keep: usize) -> Result<(), String> {
    let mut backups = fs::read_dir(root).map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("automatic-"))
        .collect::<Vec<_>>();
    backups.sort_by_key(|entry| std::cmp::Reverse(entry.metadata().and_then(|metadata| metadata.modified()).ok()));
    for entry in backups.into_iter().skip(keep) {
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_dir() { fs::remove_dir_all(entry.path()).map_err(|error| error.to_string())?; }
        else if file_type.is_file() { fs::remove_file(entry.path()).map_err(|error| error.to_string())?; }
    }
    Ok(())
}

fn normalized_environment(environment: &str) -> &'static str {
    if environment == "test" { "test" } else { "production" }
}

fn database_path(app: &AppHandle, environment: &str) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(if normalized_environment(environment) == "test" { "app-data-test.sqlite3" } else { "app-data.sqlite3" }))
}

#[tauri::command]
pub fn get_app_database_path(app: AppHandle, environment: String) -> Result<String, String> {
    Ok(database_path(&app, &environment)?.to_string_lossy().into_owned())
}

fn backup_root(app: &AppHandle, environment: &str) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?
        .join("backups").join(normalized_environment(environment));
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn now_epoch() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn database(app: &AppHandle, environment: &str) -> Result<Connection, String> {
    let connection = Connection::open(database_path(app, environment)?).map_err(|error| error.to_string())?;
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;
         PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT '');
         CREATE TABLE IF NOT EXISTS task_history (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, sort_order INTEGER NOT NULL, data_json TEXT NOT NULL);
         CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_history(task_id, sort_order);
         CREATE TABLE IF NOT EXISTS task_planned_ranges (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, sort_order INTEGER NOT NULL, data_json TEXT NOT NULL);
         CREATE INDEX IF NOT EXISTS idx_task_ranges_task ON task_planned_ranges(task_id, sort_order);
         CREATE TABLE IF NOT EXISTS task_daily_plans (task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, plan_date TEXT NOT NULL, plan_text TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, actual_hours REAL NOT NULL DEFAULT 0, PRIMARY KEY(task_id, plan_date));
         CREATE TABLE IF NOT EXISTS task_recurrence_records (task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, occurrence_date TEXT NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY(task_id, occurrence_date));
         CREATE TABLE IF NOT EXISTS task_documents (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, sort_order INTEGER NOT NULL, data_json TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS project_tags (id TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, data_json TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, data_json TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS project_milestones (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, sort_order INTEGER NOT NULL, data_json TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS project_work_items (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, sort_order INTEGER NOT NULL, data_json TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS activity_log (id TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, data_json TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS daily_notes (note_date TEXT PRIMARY KEY, note_text TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS non_working_periods (id TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, data_json TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS issues (id TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, data_json TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, data_json TEXT NOT NULL);
         INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, strftime('%s','now'));",
    ).map_err(|error| error.to_string())?;
    Ok(connection)
}

fn value_string(value: &Value) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| error.to_string())
}

fn take_array(object: &mut Map<String, Value>, key: &str) -> Vec<Value> {
    object.remove(key).and_then(|value| value.as_array().cloned()).unwrap_or_default()
}

fn take_object(object: &mut Map<String, Value>, key: &str) -> Map<String, Value> {
    object.remove(key).and_then(|value| value.as_object().cloned()).unwrap_or_default()
}

fn id_of(value: &Value) -> Result<String, String> {
    value.get("id").and_then(Value::as_str).map(str::to_owned).ok_or_else(|| "保存データにIDがありません。".to_string())
}

fn scoped_child(
    value: &Value,
    parent_id: &str,
    kind: &str,
    index: usize,
) -> Result<(String, String), String> {
    let mut object = value.as_object().cloned().ok_or_else(|| format!("{kind}の形式が不正です。"))?;
    let item_id = object
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.trim().is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("{kind}-{index}"));
    object.insert("id".into(), Value::String(item_id.clone()));
    Ok((
        format!("{parent_id}:{kind}:{index}:{item_id}"),
        value_string(&Value::Object(object))?,
    ))
}

fn insert_ordered(tx: &Transaction<'_>, table: &str, values: &[Value]) -> Result<(), String> {
    let sql = format!("INSERT INTO {table}(id, sort_order, data_json) VALUES (?1, ?2, ?3)");
    for (index, value) in values.iter().enumerate() {
        tx.execute(&sql, params![id_of(value)?, index as i64, value_string(value)?]).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn save_in_transaction(tx: &Transaction<'_>, data: &Value) -> Result<(), String> {
    let root = data.as_object().ok_or_else(|| "アプリデータの形式が不正です。".to_string())?;
    tx.execute_batch(
        "DELETE FROM task_history; DELETE FROM task_planned_ranges; DELETE FROM task_daily_plans;
         DELETE FROM task_recurrence_records; DELETE FROM task_documents; DELETE FROM tasks;
         DELETE FROM project_milestones; DELETE FROM project_work_items; DELETE FROM projects;
         DELETE FROM project_tags; DELETE FROM activity_log; DELETE FROM daily_notes;
         DELETE FROM non_working_periods; DELETE FROM issues; DELETE FROM app_settings;",
    ).map_err(|error| error.to_string())?;

    for task_value in root.get("tasks").and_then(Value::as_array).cloned().unwrap_or_default() {
        let mut task = task_value.as_object().cloned().ok_or_else(|| "タスク形式が不正です。".to_string())?;
        let task_id = task.get("id").and_then(Value::as_str).ok_or_else(|| "タスクIDがありません。".to_string())?.to_owned();
        let history = take_array(&mut task, "history");
        let ranges = take_array(&mut task, "plannedRanges");
        let recurrence_records = take_array(&mut task, "recurrenceRecords");
        let documents = take_array(&mut task, "documents");
        let daily_plans = take_object(&mut task, "dailyPlans");
        let daily_completed = take_object(&mut task, "dailyPlanCompleted");
        let daily_actual = take_object(&mut task, "dailyActualHours");
        let updated_at = task.get("updatedAt").and_then(Value::as_str).unwrap_or_default().to_owned();
        tx.execute("INSERT INTO tasks(id, data_json, updated_at) VALUES (?1, ?2, ?3)", params![&task_id, value_string(&Value::Object(task))?, updated_at]).map_err(|error| error.to_string())?;
        for (index, entry) in history.iter().enumerate() {
            let (storage_id, data_json) = scoped_child(entry, &task_id, "history", index)?;
            tx.execute("INSERT INTO task_history(id, task_id, sort_order, data_json) VALUES (?1, ?2, ?3, ?4)", params![storage_id, &task_id, index as i64, data_json]).map_err(|error| error.to_string())?;
        }
        for (index, range) in ranges.iter().enumerate() {
            let (storage_id, data_json) = scoped_child(range, &task_id, "range", index)?;
            tx.execute("INSERT INTO task_planned_ranges(id, task_id, sort_order, data_json) VALUES (?1, ?2, ?3, ?4)", params![storage_id, &task_id, index as i64, data_json]).map_err(|error| error.to_string())?;
        }
        for record in recurrence_records {
            let date = record.get("date").and_then(Value::as_str).ok_or_else(|| "定期タスク記録の日付がありません。".to_string())?;
            tx.execute("INSERT INTO task_recurrence_records(task_id, occurrence_date, data_json) VALUES (?1, ?2, ?3)", params![&task_id, date, value_string(&record)?]).map_err(|error| error.to_string())?;
        }
        for (index, document) in documents.iter().enumerate() {
            let (storage_id, data_json) = scoped_child(document, &task_id, "document", index)?;
            tx.execute("INSERT INTO task_documents(id, task_id, sort_order, data_json) VALUES (?1, ?2, ?3, ?4)", params![storage_id, &task_id, index as i64, data_json]).map_err(|error| error.to_string())?;
        }
        let dates = daily_plans.keys().chain(daily_completed.keys()).chain(daily_actual.keys()).cloned().collect::<std::collections::BTreeSet<_>>();
        for date in dates {
            let text = daily_plans.get(&date).and_then(Value::as_str).unwrap_or_default();
            let completed = daily_completed.get(&date).and_then(Value::as_bool).unwrap_or(false);
            let actual = daily_actual.get(&date).and_then(Value::as_f64).unwrap_or(0.0);
            tx.execute("INSERT INTO task_daily_plans(task_id, plan_date, plan_text, completed, actual_hours) VALUES (?1, ?2, ?3, ?4, ?5)", params![&task_id, date, text, completed as i64, actual]).map_err(|error| error.to_string())?;
        }
    }

    insert_ordered(tx, "project_tags", root.get("projectTags").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]))?;
    for (project_index, project_value) in root.get("goals").and_then(Value::as_array).cloned().unwrap_or_default().into_iter().enumerate() {
        let mut project = project_value.as_object().cloned().ok_or_else(|| "プロジェクト形式が不正です。".to_string())?;
        let project_id = project.get("id").and_then(Value::as_str).ok_or_else(|| "プロジェクトIDがありません。".to_string())?.to_owned();
        let milestones = take_array(&mut project, "milestones");
        let works = take_array(&mut project, "workItems");
        tx.execute("INSERT INTO projects(id, sort_order, data_json) VALUES (?1, ?2, ?3)", params![&project_id, project_index as i64, value_string(&Value::Object(project))?]).map_err(|error| error.to_string())?;
        for (index, milestone) in milestones.iter().enumerate() {
            let (storage_id, data_json) = scoped_child(milestone, &project_id, "milestone", index)?;
            tx.execute("INSERT INTO project_milestones(id, project_id, sort_order, data_json) VALUES (?1, ?2, ?3, ?4)", params![storage_id, &project_id, index as i64, data_json]).map_err(|error| error.to_string())?;
        }
        for (index, work) in works.iter().enumerate() {
            let (storage_id, data_json) = scoped_child(work, &project_id, "work", index)?;
            tx.execute("INSERT INTO project_work_items(id, project_id, sort_order, data_json) VALUES (?1, ?2, ?3, ?4)", params![storage_id, &project_id, index as i64, data_json]).map_err(|error| error.to_string())?;
        }
    }
    insert_ordered(tx, "activity_log", root.get("activityLog").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]))?;
    insert_ordered(tx, "non_working_periods", root.get("nonWorkingPeriods").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]))?;
    insert_ordered(tx, "issues", root.get("issues").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]))?;
    if let Some(notes) = root.get("dailyNotes").and_then(Value::as_object) {
        for (date, text) in notes {
            tx.execute("INSERT INTO daily_notes(note_date, note_text) VALUES (?1, ?2)", params![date, text.as_str().unwrap_or_default()]).map_err(|error| error.to_string())?;
        }
    }
    for (key, value) in [
        ("user_profile", root.get("userProfile").cloned().unwrap_or_else(|| json!({}))),
        ("daily_finalized_at", root.get("dailyFinalizedAt").cloned().unwrap_or_else(|| json!({}))),
        ("organization_seed", root.get("organizationSeed").cloned().unwrap_or_else(|| json!(0))),
        ("inbox_items", root.get("inboxItems").cloned().unwrap_or_else(|| json!([]))),
        ("today_task_orders", root.get("todayTaskOrders").cloned().unwrap_or_else(|| json!({}))),
        ("local_tools", root.get("localTools").cloned().unwrap_or_else(|| json!([]))),
        ("local_tools_storage_path", root.get("localToolsStoragePath").cloned().unwrap_or_else(|| json!(""))),
        ("habits", root.get("habits").cloned().unwrap_or_else(|| json!([]))),
        ("workspace_mode", root.get("workspaceMode").cloned().unwrap_or_else(|| json!("work"))),
        ("version", root.get("version").cloned().unwrap_or(json!(1))),
    ] {
        tx.execute("INSERT INTO app_settings(key, data_json) VALUES (?1, ?2)", params![key, value_string(&value)?]).map_err(|error| error.to_string())?;
    }
    tx.execute("INSERT INTO app_meta(key, value) VALUES ('storage_initialized', 'true') ON CONFLICT(key) DO UPDATE SET value='true'", []).map_err(|error| error.to_string())?;
    tx.execute("INSERT INTO app_meta(key, value) VALUES ('updated_at', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![now_epoch().to_string()]).map_err(|error| error.to_string())?;
    Ok(())
}

fn query_values(connection: &Connection, sql: &str) -> Result<Vec<Value>, String> {
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    let values = statement.query_map([], |row| row.get::<_, String>(0)).map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    values.into_iter().map(|text| serde_json::from_str(&text).map_err(|error| error.to_string())).collect()
}

fn load_from_connection(connection: &Connection) -> Result<Option<Value>, String> {
    let initialized = connection.query_row("SELECT value FROM app_meta WHERE key='storage_initialized'", [], |row| row.get::<_, String>(0)).optional().map_err(|error| error.to_string())?;
    if initialized.as_deref() != Some("true") { return Ok(None); }
    let mut tasks = query_values(connection, "SELECT data_json FROM tasks ORDER BY rowid")?;
    let mut task_indexes = HashMap::new();
    for (index, task) in tasks.iter_mut().enumerate() {
        if let Some(object) = task.as_object_mut() {
            let id = object.get("id").and_then(Value::as_str).unwrap_or_default().to_owned();
            task_indexes.insert(id, index);
            object.insert("history".into(), json!([]));
            object.insert("plannedRanges".into(), json!([]));
            object.insert("recurrenceRecords".into(), json!([]));
            object.insert("documents".into(), json!([]));
            object.insert("dailyPlans".into(), json!({}));
            object.insert("dailyPlanCompleted".into(), json!({}));
            object.insert("dailyActualHours".into(), json!({}));
        }
    }
    for (table, field) in [("task_history", "history"), ("task_planned_ranges", "plannedRanges"), ("task_recurrence_records", "recurrenceRecords"), ("task_documents", "documents")] {
        let sql = format!("SELECT task_id, data_json FROM {table} ORDER BY task_id, {}", if table == "task_recurrence_records" { "occurrence_date" } else { "sort_order" });
        let mut statement = connection.prepare(&sql).map_err(|error| error.to_string())?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
        for (task_id, text) in rows {
            if let Some(index) = task_indexes.get(&task_id).copied() {
                if let Some(array) = tasks[index].get_mut(field).and_then(Value::as_array_mut) {
                    array.push(serde_json::from_str(&text).map_err(|error| error.to_string())?);
                }
            }
        }
    }
    {
        let mut statement = connection.prepare("SELECT task_id, plan_date, plan_text, completed, actual_hours FROM task_daily_plans ORDER BY task_id, plan_date").map_err(|error| error.to_string())?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, i64>(3)?, row.get::<_, f64>(4)?))).map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
        for (task_id, date, text, completed, actual) in rows {
            if let Some(index) = task_indexes.get(&task_id).copied() {
                if !text.is_empty() { tasks[index]["dailyPlans"][&date] = Value::String(text); }
                if completed != 0 { tasks[index]["dailyPlanCompleted"][&date] = Value::Bool(true); }
                if actual > 0.0 { tasks[index]["dailyActualHours"][&date] = json!(actual); }
            }
        }
    }
    let mut projects = query_values(connection, "SELECT data_json FROM projects ORDER BY sort_order")?;
    let mut project_indexes = HashMap::new();
    for (index, project) in projects.iter_mut().enumerate() {
        if let Some(object) = project.as_object_mut() {
            let id = object.get("id").and_then(Value::as_str).unwrap_or_default().to_owned();
            project_indexes.insert(id, index);
            object.insert("milestones".into(), json!([]));
            object.insert("workItems".into(), json!([]));
        }
    }
    for (table, field) in [("project_milestones", "milestones"), ("project_work_items", "workItems")] {
        let sql = format!("SELECT project_id, data_json FROM {table} ORDER BY project_id, sort_order");
        let mut statement = connection.prepare(&sql).map_err(|error| error.to_string())?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
        for (project_id, text) in rows {
            if let Some(index) = project_indexes.get(&project_id).copied() {
                if let Some(array) = projects[index].get_mut(field).and_then(Value::as_array_mut) {
                    array.push(serde_json::from_str(&text).map_err(|error| error.to_string())?);
                }
            }
        }
    }
    let daily_notes = {
        let mut result = Map::new();
        let mut statement = connection.prepare("SELECT note_date, note_text FROM daily_notes ORDER BY note_date").map_err(|error| error.to_string())?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
        for (date, text) in rows { result.insert(date, Value::String(text)); }
        Value::Object(result)
    };
    let setting = |key: &str, fallback: Value| -> Result<Value, String> {
        let text = connection.query_row("SELECT data_json FROM app_settings WHERE key=?1", params![key], |row| row.get::<_, String>(0)).optional().map_err(|error| error.to_string())?;
        text.map(|value| serde_json::from_str(&value).map_err(|error| error.to_string())).unwrap_or(Ok(fallback))
    };
    Ok(Some(json!({
        "version": setting("version", json!(1))?,
        "tasks": tasks,
        "projectTags": query_values(connection, "SELECT data_json FROM project_tags ORDER BY sort_order")?,
        "activityLog": query_values(connection, "SELECT data_json FROM activity_log ORDER BY sort_order")?,
        "dailyNotes": daily_notes,
        "dailyFinalizedAt": setting("daily_finalized_at", json!({}))?,
        "organizationSeed": setting("organization_seed", json!(0))?,
        "nonWorkingPeriods": query_values(connection, "SELECT data_json FROM non_working_periods ORDER BY sort_order")?,
        "userProfile": setting("user_profile", json!({"displayName":"あなた","avatarUpdatedAt":""}))?,
        "goals": projects,
        "issues": query_values(connection, "SELECT data_json FROM issues ORDER BY sort_order")?
        ,"inboxItems": setting("inbox_items", json!([]))?
        ,"todayTaskOrders": setting("today_task_orders", json!({}))?
        ,"localTools": setting("local_tools", json!([]))?
        ,"localToolsStoragePath": setting("local_tools_storage_path", json!(""))?
        ,"habits": setting("habits", json!([]))?
        ,"workspaceMode": setting("workspace_mode", json!("work"))?
    })))
}

fn backup_destination(root: &Path, prefix: &str, created_at: u64) -> PathBuf {
    let mut path = root.join(format!("{prefix}-{created_at}.{COMPLETE_BACKUP_EXTENSION}"));
    let mut suffix = 2;
    while path.exists() {
        path = root.join(format!("{prefix}-{created_at}-{suffix}.{COMPLETE_BACKUP_EXTENSION}"));
        suffix += 1;
    }
    path
}

fn copy_file_if_exists(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.is_file() { return Ok(()); }
    if let Some(parent) = destination.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
    fs::copy(source, destination).map_err(|error| error.to_string())?;
    Ok(())
}

fn backup_managed_tools(data: &Value, destination: &Path) -> Result<(), String> {
    let Some(tools) = data.get("localTools").and_then(Value::as_array) else { return Ok(()); };
    for tool in tools {
        if tool.get("managedCopy").and_then(Value::as_bool) != Some(true) { continue; }
        let id = tool.get("id").and_then(Value::as_str).and_then(safe_component)
            .ok_or_else(|| "管理ツールのIDが不正です。".to_string())?;
        let folder = tool.get("folderPath").and_then(Value::as_str).map(PathBuf::from)
            .ok_or_else(|| format!("管理ツール {id} の保存先がありません。"))?;
        if !folder.is_dir() { return Err(format!("管理ツール {id} の保存先が見つかりません。")); }
        let marker = fs::read_to_string(folder.join(".chattask-tool")).map_err(|_| format!("管理ツール {id} の管理情報を確認できません。"))?;
        if marker != id { return Err(format!("管理ツール {id} の管理情報が一致しません。")); }
        copy_directory(&folder, &destination.join(id))?;
    }
    Ok(())
}

fn write_backup(app: &AppHandle, environment: &str, data: &Value, prefix: &str) -> Result<BackupInfo, String> {
    let created_at = now_epoch();
    let root = backup_root(app, environment)?;
    let path = backup_destination(&root, prefix, created_at);
    let temporary = root.join(format!(".creating-{prefix}-{created_at}-{}", std::process::id()));
    if temporary.exists() { fs::remove_dir_all(&temporary).map_err(|error| error.to_string())?; }
    fs::create_dir(&temporary).map_err(|error| error.to_string())?;
    let result = (|| {
        let bytes = serde_json::to_vec_pretty(data).map_err(|error| error.to_string())?;
        fs::write(temporary.join("data.json"), bytes).map_err(|error| error.to_string())?;
        let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
        copy_file_if_exists(&app_data.join("attachments.sqlite3"), &temporary.join("attachments.sqlite3"))?;
        copy_directory(&app_data.join("attachments"), &temporary.join("attachments"))?;
        copy_directory(&app_data.join("profile"), &temporary.join("profile"))?;
        backup_managed_tools(data, &temporary.join("local-tools"))?;
        fs::write(temporary.join("backup-format.json"), br#"{"version":1,"kind":"complete"}"#).map_err(|error| error.to_string())?;
        fs::rename(&temporary, &path).map_err(|error| error.to_string())?;
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&temporary);
        return Err(error);
    }
    let size = path_size(&path)?;
    let file_name = path.file_name().and_then(|value| value.to_str()).unwrap_or_default().to_string();
    if prefix == "automatic" { prune_automatic_backups(&root, 7)?; }
    Ok(BackupInfo { file_name, path: path.to_string_lossy().into_owned(), created_at, size, complete: true })
}

fn maybe_automatic_backup(app: &AppHandle, environment: &str, connection: &Connection) -> Result<(), String> {
    let last = connection.query_row("SELECT value FROM app_meta WHERE key='last_backup_at'", [], |row| row.get::<_, String>(0)).optional().map_err(|error| error.to_string())?
        .and_then(|value| value.parse::<u64>().ok()).unwrap_or(0);
    if now_epoch().saturating_sub(last) < 86_400 { return Ok(()); }
    if let Some(data) = load_from_connection(connection)? {
        match write_backup(app, environment, &data, "automatic") {
            Ok(_) => {
                connection.execute("INSERT INTO app_meta(key,value) VALUES ('last_backup_at',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![now_epoch().to_string()]).map_err(|error| error.to_string())?;
            }
            Err(error) => eprintln!("完全バックアップの自動作成に失敗しました: {error}"),
        }
    }
    Ok(())
}

#[tauri::command]
pub fn initialize_app_database(app: AppHandle, legacy_data: Value, environment: String) -> Result<Value, String> {
    let mut connection = database(&app, &environment)?;
    if let Some(data) = load_from_connection(&connection)? { return Ok(data); }
    write_backup(&app, &environment, &legacy_data, "pre-sqlite-migration")?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    save_in_transaction(&transaction, &legacy_data)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(legacy_data)
}

#[tauri::command]
pub fn load_app_data_sqlite(app: AppHandle, environment: String) -> Result<Option<Value>, String> {
    load_from_connection(&database(&app, &environment)?)
}

#[tauri::command]
pub fn save_app_data_sqlite(app: AppHandle, data: Value, environment: String) -> Result<(), String> {
    let mut connection = database(&app, &environment)?;
    maybe_automatic_backup(&app, &environment, &connection)?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    save_in_transaction(&transaction, &data)?;
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_app_backup(app: AppHandle, data: Value, environment: String) -> Result<BackupInfo, String> {
    write_backup(&app, &environment, &data, "manual")
}

#[tauri::command]
pub fn list_app_backups(app: AppHandle, environment: String) -> Result<Vec<BackupInfo>, String> {
    let mut backups = Vec::new();
    for entry in fs::read_dir(backup_root(&app, &environment)?).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        let complete = metadata.is_dir() && entry.path().extension().and_then(|value| value.to_str()) == Some(COMPLETE_BACKUP_EXTENSION);
        let legacy = metadata.is_file() && entry.path().extension().and_then(|value| value.to_str()) == Some("json");
        if !complete && !legacy { continue; }
        let created_at = metadata.modified().ok().and_then(|value| value.duration_since(UNIX_EPOCH).ok()).map(|value| value.as_secs()).unwrap_or(0);
        backups.push(BackupInfo { file_name: entry.file_name().to_string_lossy().into_owned(), path: entry.path().to_string_lossy().into_owned(), created_at, size: path_size(&entry.path())?, complete });
    }
    backups.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(backups)
}

fn replace_directory_from_backup(source: &Path, destination: &Path) -> Result<(), String> {
    let parent = destination.parent().ok_or_else(|| "復元先を確認できません。".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let name = destination.file_name().and_then(|value| value.to_str()).unwrap_or("resource");
    let staging = parent.join(format!(".{name}-restore-{}", now_epoch()));
    if staging.exists() { fs::remove_dir_all(&staging).map_err(|error| error.to_string())?; }
    if source.is_dir() { copy_directory(source, &staging)?; }
    if destination.exists() { fs::remove_dir_all(destination).map_err(|error| error.to_string())?; }
    if staging.exists() { fs::rename(staging, destination).map_err(|error| error.to_string())?; }
    Ok(())
}

fn replace_file_from_backup(source: &Path, destination: &Path) -> Result<(), String> {
    if source.is_file() {
        let temporary = destination.with_extension(format!("restore-{}", now_epoch()));
        fs::copy(source, &temporary).map_err(|error| error.to_string())?;
        if destination.exists() { fs::remove_file(destination).map_err(|error| error.to_string())?; }
        fs::rename(temporary, destination).map_err(|error| error.to_string())?;
    } else if destination.exists() {
        fs::remove_file(destination).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn restore_managed_tools(app: &AppHandle, environment: &str, backup: &Path, data: &mut Value) -> Result<(), String> {
    let configured = data.get("localToolsStoragePath").and_then(Value::as_str).map(PathBuf::from);
    let storage = match configured.filter(|path| path.is_dir()) {
        Some(path) => path,
        None => {
            let path = app.path().app_data_dir().map_err(|error| error.to_string())?
                .join("restored-tools").join(normalized_environment(environment));
            fs::create_dir_all(&path).map_err(|error| error.to_string())?;
            if let Some(root) = data.as_object_mut() {
                root.insert("localToolsStoragePath".into(), Value::String(path.to_string_lossy().into_owned()));
            }
            path
        }
    };
    let tools = data.get_mut("localTools").and_then(Value::as_array_mut);
    let Some(tools) = tools else { return Ok(()); };
    for tool in tools {
        if tool.get("managedCopy").and_then(Value::as_bool) != Some(true) { continue; }
        let original_id = tool.get("id").and_then(Value::as_str).ok_or_else(|| "管理ツールのIDがありません。".to_string())?;
        let id = safe_component(original_id).ok_or_else(|| "管理ツールのIDが不正です。".to_string())?;
        let source = backup.join("local-tools").join(&id);
        if !source.is_dir() { return Err(format!("完全バックアップ内に管理ツール {id} がありません。")); }
        let folder_name = tool.get("folderPath").and_then(Value::as_str)
            .and_then(|value| Path::new(value).file_name()).and_then(|value| value.to_str())
            .filter(|value| !value.trim().is_empty()).map(str::to_owned).unwrap_or_else(|| format!("tool-{id}"));
        let mut destination = storage.join(&folder_name);
        let mut replace_owned = false;
        if destination.exists() {
            let owned = fs::read_to_string(destination.join(".chattask-tool")).ok().as_deref() == Some(original_id);
            if owned {
                replace_owned = true;
            } else {
                let mut suffix = 2;
                while destination.exists() {
                    destination = storage.join(format!("{folder_name} (復元 {suffix})"));
                    suffix += 1;
                }
            }
        }
        if replace_owned { replace_directory_from_backup(&source, &destination)?; }
        else { copy_directory(&source, &destination)?; }
        if let Some(object) = tool.as_object_mut() {
            object.insert("folderPath".into(), Value::String(destination.to_string_lossy().into_owned()));
        }
    }
    Ok(())
}

fn restore_complete_resources(app: &AppHandle, environment: &str, backup: &Path, data: &mut Value) -> Result<(), String> {
    restore_managed_tools(app, environment, backup, data)?;
    let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    replace_file_from_backup(&backup.join("attachments.sqlite3"), &app_data.join("attachments.sqlite3"))?;
    replace_directory_from_backup(&backup.join("attachments"), &app_data.join("attachments"))?;
    replace_directory_from_backup(&backup.join("profile"), &app_data.join("profile"))?;
    Ok(())
}

#[tauri::command]
pub fn restore_app_backup(app: AppHandle, file_name: String, environment: String) -> Result<Value, String> {
    if safe_component(&file_name).as_deref() != Some(file_name.as_str()) { return Err("バックアップ名が不正です。".into()); }
    let path = backup_root(&app, &environment)?.join(file_name);
    let complete = path.is_dir() && path.extension().and_then(|value| value.to_str()) == Some(COMPLETE_BACKUP_EXTENSION);
    let data_path = if complete { path.join("data.json") } else { path.clone() };
    let mut data: Value = serde_json::from_slice(&fs::read(data_path).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    let mut connection = database(&app, &environment)?;
    if let Some(current) = load_from_connection(&connection)? { write_backup(&app, &environment, &current, "before-restore")?; }
    if complete { restore_complete_resources(&app, &environment, &path, &mut data)?; }
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    save_in_transaction(&transaction, &data)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory(name: &str) -> PathBuf {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("chattask-{name}-{}-{unique}", std::process::id()))
    }

    #[test]
    fn backup_names_are_single_safe_components() {
        assert_eq!(safe_component("manual-1.chattask-backup").as_deref(), Some("manual-1.chattask-backup"));
        assert_eq!(safe_component("../outside"), None);
        assert_eq!(safe_component("folder/file"), None);
        assert_eq!(safe_component(""), None);
    }

    #[test]
    fn recursive_backup_copy_preserves_files() {
        let root = test_directory("copy");
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(source.join("nested")).unwrap();
        fs::write(source.join("root.txt"), b"root").unwrap();
        fs::write(source.join("nested/item.bin"), [1_u8, 2, 3]).unwrap();

        assert_eq!(copy_directory(&source, &destination).unwrap(), 7);
        assert_eq!(fs::read(destination.join("root.txt")).unwrap(), b"root");
        assert_eq!(fs::read(destination.join("nested/item.bin")).unwrap(), [1_u8, 2, 3]);
        fs::remove_dir_all(root).unwrap();
    }
}
