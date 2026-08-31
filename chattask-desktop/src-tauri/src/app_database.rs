use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{collections::HashMap, fs, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub file_name: String,
    pub path: String,
    pub created_at: u64,
    pub size: u64,
}

fn normalized_environment(environment: &str) -> &'static str {
    if environment == "test" { "test" } else { "production" }
}

fn database_path(app: &AppHandle, environment: &str) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(if normalized_environment(environment) == "test" { "app-data-test.sqlite3" } else { "app-data.sqlite3" }))
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
    })))
}

fn write_backup(app: &AppHandle, environment: &str, data: &Value, prefix: &str) -> Result<BackupInfo, String> {
    let created_at = now_epoch();
    let file_name = format!("{prefix}-{created_at}.json");
    let path = backup_root(app, environment)?.join(&file_name);
    let bytes = serde_json::to_vec_pretty(data).map_err(|error| error.to_string())?;
    fs::write(&path, &bytes).map_err(|error| error.to_string())?;
    Ok(BackupInfo { file_name, path: path.to_string_lossy().into_owned(), created_at, size: bytes.len() as u64 })
}

fn maybe_automatic_backup(app: &AppHandle, environment: &str, connection: &Connection) -> Result<(), String> {
    let last = connection.query_row("SELECT value FROM app_meta WHERE key='last_backup_at'", [], |row| row.get::<_, String>(0)).optional().map_err(|error| error.to_string())?
        .and_then(|value| value.parse::<u64>().ok()).unwrap_or(0);
    if now_epoch().saturating_sub(last) < 86_400 { return Ok(()); }
    if let Some(data) = load_from_connection(connection)? {
        write_backup(app, environment, &data, "automatic")?;
        connection.execute("INSERT INTO app_meta(key,value) VALUES ('last_backup_at',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![now_epoch().to_string()]).map_err(|error| error.to_string())?;
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
        if !metadata.is_file() || entry.path().extension().and_then(|value| value.to_str()) != Some("json") { continue; }
        let created_at = metadata.modified().ok().and_then(|value| value.duration_since(UNIX_EPOCH).ok()).map(|value| value.as_secs()).unwrap_or(0);
        backups.push(BackupInfo { file_name: entry.file_name().to_string_lossy().into_owned(), path: entry.path().to_string_lossy().into_owned(), created_at, size: metadata.len() });
    }
    backups.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(backups)
}

#[tauri::command]
pub fn restore_app_backup(app: AppHandle, file_name: String, environment: String) -> Result<Value, String> {
    if file_name.contains('/') || file_name.contains('\\') { return Err("バックアップ名が不正です。".into()); }
    let path = backup_root(&app, &environment)?.join(file_name);
    let data: Value = serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    let mut connection = database(&app, &environment)?;
    if let Some(current) = load_from_connection(&connection)? { write_backup(&app, &environment, &current, "before-restore")?; }
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    save_in_transaction(&transaction, &data)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(data)
}
