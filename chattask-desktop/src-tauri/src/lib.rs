use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}, process::Command};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
mod app_database;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Attachment {
    id: String,
    task_id: String,
    name: String,
    mime_type: String,
    size: i64,
    created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentFile {
    name: String,
    mime_type: String,
    data: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DroppedToolFile {
    relative_path: String,
    data: Vec<u8>,
}

fn attachment_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("attachments.sqlite3"))
}

fn attachment_root(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?.join("attachments");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn profile_root(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?.join("profile");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn stored_file_name(id: &str, original_name: &str) -> String {
    let safe_id: String = id.chars().filter(|character| character.is_ascii_alphanumeric() || *character == '-' || *character == '_').collect();
    let extension = Path::new(original_name).extension().and_then(|value| value.to_str())
        .filter(|value| value.len() <= 12 && value.chars().all(|character| character.is_ascii_alphanumeric()));
    match extension { Some(value) => format!("{}.{}", safe_id, value), None => safe_id }
}

fn migrate_blob_attachments(app: &AppHandle, connection: &Connection) -> Result<(), String> {
    let has_storage_path = connection.prepare("PRAGMA table_info(attachments)").map_err(|error| error.to_string())?
        .query_map([], |row| row.get::<_, String>(1)).map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?
        .iter().any(|column| column == "storage_path");
    if !has_storage_path {
        connection.execute("ALTER TABLE attachments ADD COLUMN storage_path TEXT", []).map_err(|error| error.to_string())?;
    }
    let legacy = {
        let mut statement = connection.prepare("SELECT id, name, data FROM attachments WHERE (storage_path IS NULL OR storage_path = '') AND length(data) > 0").map_err(|error| error.to_string())?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Vec<u8>>(2)?)))
            .map_err(|error| error.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
        rows
    };
    let root = attachment_root(app)?;
    for (id, name, data) in legacy {
        let stored_name = stored_file_name(&id, &name);
        fs::write(root.join(&stored_name), data).map_err(|error| error.to_string())?;
        connection.execute("UPDATE attachments SET storage_path = ?1, data = X'' WHERE id = ?2", params![format!("attachments/{stored_name}"), id]).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn attachment_db(app: &AppHandle) -> Result<Connection, String> {
    let connection = Connection::open(attachment_db_path(app)?).map_err(|error| error.to_string())?;
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size INTEGER NOT NULL,
            data BLOB NOT NULL DEFAULT X'',
            created_at TEXT NOT NULL,
            storage_path TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_attachments_task_id ON attachments(task_id);",
    ).map_err(|error| error.to_string())?;
    migrate_blob_attachments(app, &connection)?;
    Ok(connection)
}

#[tauri::command]
fn list_attachments(app: AppHandle, task_id: String) -> Result<Vec<Attachment>, String> {
    let connection = attachment_db(&app)?;
    let mut statement = connection.prepare(
        "SELECT id, task_id, name, mime_type, size, created_at
         FROM attachments WHERE task_id = ?1 ORDER BY created_at ASC, rowid ASC",
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map(params![task_id], |row| Ok(Attachment {
        id: row.get(0)?, task_id: row.get(1)?, name: row.get(2)?, mime_type: row.get(3)?,
        size: row.get(4)?, created_at: row.get(5)?,
    })).map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

#[tauri::command]
fn add_attachment(app: AppHandle, id: String, task_id: String, name: String, mime_type: String, data: Vec<u8>, created_at: String) -> Result<Attachment, String> {
    const MAX_FILE_SIZE: usize = 50 * 1024 * 1024;
    if data.len() > MAX_FILE_SIZE { return Err("1ファイルの上限は50MBです。".into()); }
    let connection = attachment_db(&app)?;
    let stored_name = stored_file_name(&id, &name);
    if stored_name.is_empty() { return Err("添付ファイルIDが不正です。".into()); }
    let relative_path = format!("attachments/{stored_name}");
    let file_path = attachment_root(&app)?.join(&stored_name);
    fs::write(&file_path, &data).map_err(|error| error.to_string())?;
    if let Err(error) = connection.execute(
        "INSERT INTO attachments (id, task_id, name, mime_type, size, data, created_at, storage_path) VALUES (?1, ?2, ?3, ?4, ?5, X'', ?6, ?7)",
        params![&id, &task_id, &name, &mime_type, data.len() as i64, &created_at, relative_path],
    ) {
        let _ = fs::remove_file(file_path);
        return Err(error.to_string());
    }
    Ok(Attachment { id, task_id, name, mime_type, size: data.len() as i64, created_at })
}

#[tauri::command]
fn rename_attachment(app: AppHandle, id: String, name: String) -> Result<bool, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() { return Err("表示名を入力してください。".into()); }
    if trimmed.chars().any(|character| matches!(character, '/' | '\\') || character.is_control()) {
        return Err("表示名に使用できない文字が含まれています。".into());
    }
    let connection = attachment_db(&app)?;
    let current_name: String = connection.query_row("SELECT name FROM attachments WHERE id = ?1", params![&id], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let extension = Path::new(&current_name).extension().and_then(|value| value.to_str())
        .map(|value| format!(".{value}")).unwrap_or_default();
    let next_name = format!("{trimmed}{extension}");
    if next_name.chars().count() > 255 { return Err("表示名は255文字以内で入力してください。".into()); }
    let updated = connection.execute("UPDATE attachments SET name = ?1 WHERE id = ?2", params![next_name, id])
        .map_err(|error| error.to_string())?;
    Ok(updated > 0)
}

#[tauri::command]
fn get_attachment(app: AppHandle, id: String) -> Result<AttachmentFile, String> {
    let connection = attachment_db(&app)?;
    let (name, mime_type, storage_path, legacy_data) = connection.query_row(
        "SELECT name, mime_type, storage_path, data FROM attachments WHERE id = ?1",
        params![id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?, row.get::<_, Vec<u8>>(3)?)),
    ).map_err(|error| error.to_string())?;
    let data = if let Some(relative_path) = storage_path {
        let base = app.path().app_data_dir().map_err(|error| error.to_string())?;
        fs::read(base.join(relative_path)).map_err(|error| error.to_string())?
    } else { legacy_data };
    Ok(AttachmentFile { name, mime_type, data })
}

#[tauri::command]
fn delete_attachment(app: AppHandle, id: String) -> Result<bool, String> {
    let connection = attachment_db(&app)?;
    let storage_path = connection.query_row("SELECT storage_path FROM attachments WHERE id = ?1", params![&id], |row| row.get::<_, Option<String>>(0)).ok().flatten();
    let deleted = connection.execute("DELETE FROM attachments WHERE id = ?1", params![id]).map_err(|error| error.to_string())?;
    if deleted == 0 { return Ok(false); }
    if let Some(relative_path) = storage_path {
        let base = app.path().app_data_dir().map_err(|error| error.to_string())?;
        match fs::remove_file(base.join(relative_path)) { Ok(()) => {}, Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}, Err(error) => eprintln!("添付ファイル実体の削除に失敗しました: {error}") }
    }
    Ok(true)
}

#[tauri::command]
fn open_attachment(app: AppHandle, id: String) -> Result<(), String> {
    let connection = attachment_db(&app)?;
    let relative_path = connection.query_row("SELECT storage_path FROM attachments WHERE id = ?1", params![id], |row| row.get::<_, Option<String>>(0))
        .map_err(|error| error.to_string())?.ok_or_else(|| "添付ファイルの保存先がありません。".to_string())?;
    let path = app.path().app_data_dir().map_err(|error| error.to_string())?.join(relative_path);
    if !path.exists() { return Err("添付ファイルが見つかりません。".into()); }
    app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|error| error.to_string())
}

#[tauri::command]
fn copy_attachment(app: AppHandle, id: String) -> Result<(), String> {
    let connection = attachment_db(&app)?;
    let (name, storage_path) = connection.query_row(
        "SELECT name, storage_path FROM attachments WHERE id = ?1",
        params![id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
    ).map_err(|error| error.to_string())?;
    let relative_path = storage_path.ok_or_else(|| "添付ファイルの保存先がありません。".to_string())?;
    let source = app.path().app_data_dir().map_err(|error| error.to_string())?.join(relative_path);
    if !source.exists() { return Err("添付ファイルが見つかりません。".into()); }
    let safe_name = Path::new(&name).file_name().and_then(|value| value.to_str()).filter(|value| !value.is_empty()).unwrap_or("attachment");
    let clipboard_dir = app.path().app_cache_dir().map_err(|error| error.to_string())?.join("clipboard").join(stored_file_name(&id, ""));
    fs::create_dir_all(&clipboard_dir).map_err(|error| error.to_string())?;
    let clipboard_file = clipboard_dir.join(safe_name);
    fs::copy(source, &clipboard_file).map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("osascript")
            .args(["-e", "on run argv", "-e", "set the clipboard to (POSIX file (item 1 of argv))", "-e", "end run", "--"])
            .arg(&clipboard_file)
            .status()
            .map_err(|error| error.to_string())?;
        if !status.success() { return Err("クリップボードへコピーできませんでした。".into()); }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = clipboard_file;
        Err("ファイルコピーは現在macOS版のみ対応しています。".into())
    }
}

#[tauri::command]
fn download_attachment(app: AppHandle, id: String) -> Result<String, String> {
    let connection = attachment_db(&app)?;
    let (name, storage_path) = connection.query_row(
        "SELECT name, storage_path FROM attachments WHERE id = ?1",
        params![id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
    ).map_err(|error| error.to_string())?;
    let relative_path = storage_path.ok_or_else(|| "添付ファイルの保存先がありません。".to_string())?;
    let source = app.path().app_data_dir().map_err(|error| error.to_string())?.join(relative_path);
    if !source.exists() { return Err("添付ファイルが見つかりません。".into()); }
    let safe_name = Path::new(&name).file_name().and_then(|value| value.to_str()).filter(|value| !value.is_empty()).unwrap_or("attachment");
    let original = Path::new(safe_name);
    let stem = original.file_stem().and_then(|value| value.to_str()).filter(|value| !value.is_empty()).unwrap_or("attachment");
    let extension = original.extension().and_then(|value| value.to_str());
    let directory = app.path().download_dir().map_err(|error| error.to_string())?;
    let file_name = |number: Option<usize>| match (number, extension) {
        (Some(number), Some(extension)) => format!("{stem} ({number}).{extension}"),
        (Some(number), None) => format!("{stem} ({number})"),
        (None, _) => safe_name.to_string(),
    };
    let mut destination = directory.join(file_name(None));
    let mut number = 2;
    while destination.exists() {
        destination = directory.join(file_name(Some(number)));
        number += 1;
    }
    fs::copy(source, &destination).map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
fn delete_task_attachments(app: AppHandle, task_id: String) -> Result<(), String> {
    let connection = attachment_db(&app)?;
    let paths = {
        let mut statement = connection.prepare("SELECT storage_path FROM attachments WHERE task_id = ?1 AND storage_path IS NOT NULL").map_err(|error| error.to_string())?;
        let rows = statement.query_map(params![&task_id], |row| row.get::<_, String>(0)).map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
        rows
    };
    connection.execute("DELETE FROM attachments WHERE task_id = ?1", params![task_id]).map_err(|error| error.to_string())?;
    let base = app.path().app_data_dir().map_err(|error| error.to_string())?;
    for relative_path in paths { let _ = fs::remove_file(base.join(relative_path)); }
    Ok(())
}

fn collect_tool_html_files(root: &Path, directory: &Path, depth: usize, files: &mut Vec<String>) -> Result<(), String> {
    if depth > 12 || files.len() >= 1000 { return Ok(()); }
    let mut entries = fs::read_dir(directory).map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        if files.len() >= 1000 { break; }
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() { continue; }
        let ignored_directory = file_type.is_dir() && matches!(entry.file_name().to_str(), Some(".git" | "node_modules" | "target" | ".next" | ".cache" | "coverage"));
        if ignored_directory { continue; }
        let path = entry.path();
        if file_type.is_dir() {
            collect_tool_html_files(root, &path, depth + 1, files)?;
        } else if file_type.is_file() && path.extension().and_then(|value| value.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("html") || extension.eq_ignore_ascii_case("htm")) {
            let relative = path.strip_prefix(root).map_err(|error| error.to_string())?;
            files.push(relative.to_string_lossy().replace('\\', "/"));
        }
    }
    Ok(())
}

#[tauri::command]
fn select_tool_folder(initial_path: Option<String>) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let initial_path = initial_path.filter(|path| Path::new(path).is_dir()).unwrap_or_default();
        let output = Command::new("osascript")
            .args(["-e", "on run argv", "-e", "if (count of argv) > 0 and item 1 of argv is not \"\" then", "-e", "set chosenFolder to choose folder with prompt \"ツールのフォルダを選択\" default location (POSIX file (item 1 of argv) as alias)", "-e", "else", "-e", "set chosenFolder to choose folder with prompt \"ツールのフォルダを選択\"", "-e", "end if", "-e", "return POSIX path of chosenFolder", "-e", "end run", "--"])
            .arg(initial_path)
            .output().map_err(|error| error.to_string())?;
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            if error.contains("(-128)") { return Ok(None); }
            return Err(error.trim().to_string());
        }
        let path = String::from_utf8_lossy(&output.stdout).trim().trim_end_matches('/').to_string();
        return Ok((!path.is_empty()).then_some(path));
    }
    #[cfg(not(target_os = "macos"))]
    Err("フォルダ選択は現在macOS版のみ対応しています。".into())
}

#[tauri::command]
fn select_tool_html_file(folder_path: String) -> Result<Option<String>, String> {
    let root = fs::canonicalize(&folder_path).map_err(|_| "選択したフォルダが見つかりません。".to_string())?;
    if !root.is_dir() { return Err("起動ファイルの基準となるフォルダが不正です。".into()); }
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("osascript")
            .args(["-e", "on run argv", "-e", "set baseFolder to POSIX file (item 1 of argv) as alias", "-e", "set chosenFile to choose file with prompt \"起動するHTMLを選択\" default location baseFolder", "-e", "return POSIX path of chosenFile", "-e", "end run", "--"])
            .arg(&folder_path).output().map_err(|error| error.to_string())?;
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            if error.contains("(-128)") { return Ok(None); }
            return Err(error.trim().to_string());
        }
        let selected = fs::canonicalize(String::from_utf8_lossy(&output.stdout).trim()).map_err(|_| "選択したファイルが見つかりません。".to_string())?;
        if !selected.starts_with(&root) || !selected.is_file() { return Err("登録フォルダ内のファイルを選択してください。".into()); }
        let html = selected.extension().and_then(|value| value.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("html") || extension.eq_ignore_ascii_case("htm"));
        if !html { return Err("HTMLまたはHTMファイルを選択してください。".into()); }
        let relative = selected.strip_prefix(root).map_err(|error| error.to_string())?;
        return Ok(Some(relative.to_string_lossy().replace('\\', "/")));
    }
    #[cfg(not(target_os = "macos"))]
    Err("起動HTMLの選択は現在macOS版のみ対応しています。".into())
}

fn copy_tool_directory(source: &Path, destination: &Path, file_count: &mut usize, total_size: &mut u64) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() || entry.file_name() == ".chattask-tool" { continue; }
        let ignored_directory = file_type.is_dir() && matches!(entry.file_name().to_str(), Some(".git" | "node_modules" | "target" | ".next" | ".cache" | "coverage"));
        if ignored_directory { continue; }
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_tool_directory(&entry.path(), &target, file_count, total_size)?;
        } else if file_type.is_file() {
            *file_count += 1;
            *total_size = total_size.saturating_add(entry.metadata().map_err(|error| error.to_string())?.len());
            if *file_count > 10_000 { return Err("ツール内のファイル数が上限（10,000件）を超えています。".into()); }
            if *total_size > 1024 * 1024 * 1024 { return Err("ツールの容量が上限（1GB）を超えています。".into()); }
            fs::copy(entry.path(), target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn copy_tool_folder(source_folder: String, storage_path: String, tool_id: String) -> Result<String, String> {
    if tool_id.trim().is_empty() { return Err("ツールIDがありません。".into()); }
    let source = fs::canonicalize(source_folder).map_err(|_| "取り込むフォルダが見つかりません。".to_string())?;
    let storage = fs::canonicalize(storage_path).map_err(|_| "ツールの保存先が見つかりません。".to_string())?;
    if !source.is_dir() || !storage.is_dir() { return Err("フォルダを選択してください。".into()); }
    if storage.starts_with(&source) { return Err("ツール自身の配下を保存先には指定できません。".into()); }
    let base_name = source.file_name().and_then(|value| value.to_str()).filter(|value| !value.trim().is_empty()).unwrap_or("tool");
    let mut destination = storage.join(base_name);
    let mut number = 2;
    while destination.exists() {
        destination = storage.join(format!("{base_name} ({number})"));
        number += 1;
    }
    fs::create_dir(&destination).map_err(|error| error.to_string())?;
    let result = (|| {
        #[cfg(target_os = "macos")]
        let copied_in_bulk = match Command::new("rsync")
            .args(["-a", "--exclude=.git", "--exclude=node_modules", "--exclude=target", "--exclude=.next", "--exclude=.cache", "--exclude=coverage", "--exclude=.chattask-tool"])
            .arg(source.join(".")).arg(&destination).status() {
                Ok(status) if status.success() => true,
                Ok(_) => return Err("フォルダの一括コピーに失敗しました。".into()),
                Err(_) => false,
            };
        #[cfg(not(target_os = "macos"))]
        let copied_in_bulk = false;
        if !copied_in_bulk {
            let mut file_count = 0;
            let mut total_size = 0;
            copy_tool_directory(&source, &destination, &mut file_count, &mut total_size)?;
        }
        fs::write(destination.join(".chattask-tool"), tool_id).map_err(|error| error.to_string())?;
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&destination);
        return Err(format!("ツールをコピーできませんでした。{error}"));
    }
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
fn delete_managed_tool_folder(folder_path: String, tool_id: String) -> Result<(), String> {
    let folder = fs::canonicalize(folder_path).map_err(|_| "ツールの保存フォルダが見つかりません。".to_string())?;
    if !folder.is_dir() { return Err("ツールの保存先がフォルダではありません。".into()); }
    let marker = fs::read_to_string(folder.join(".chattask-tool")).map_err(|_| "ChatTaskが取り込んだフォルダであることを確認できません。".to_string())?;
    if marker != tool_id { return Err("ツールの管理情報が一致しないため削除できません。".into()); }
    fs::remove_dir_all(folder).map_err(|error| error.to_string())
}

#[tauri::command]
fn import_dropped_tool_files(storage_path: String, tool_id: String, folder_name: String, files: Vec<DroppedToolFile>) -> Result<String, String> {
    if tool_id.trim().is_empty() || files.is_empty() { return Err("取り込むツールのファイルがありません。".into()); }
    if files.len() > 10_000 { return Err("ツール内のファイル数が上限（10,000件）を超えています。".into()); }
    let total_size = files.iter().fold(0_u64, |total, file| total.saturating_add(file.data.len() as u64));
    if total_size > 1024 * 1024 * 1024 { return Err("ツールの容量が上限（1GB）を超えています。".into()); }
    let storage = fs::canonicalize(storage_path).map_err(|_| "ツールの保存先が見つかりません。".to_string())?;
    if !storage.is_dir() { return Err("ツールの保存先がフォルダではありません。".into()); }
    let safe_name = Path::new(&folder_name).file_name().and_then(|value| value.to_str()).filter(|value| !value.trim().is_empty()).unwrap_or("tool");
    let mut destination = storage.join(safe_name);
    let mut number = 2;
    while destination.exists() {
        destination = storage.join(format!("{safe_name} ({number})"));
        number += 1;
    }
    fs::create_dir(&destination).map_err(|error| error.to_string())?;
    let result = (|| {
        for file in files {
            let relative = Path::new(&file.relative_path);
            if relative.as_os_str().is_empty() || relative.is_absolute() || relative.components().any(|component| !matches!(component, std::path::Component::Normal(_))) || relative.file_name().and_then(|value| value.to_str()) == Some(".chattask-tool") {
                return Err("ツール内に保存できないファイル名があります。".to_string());
            }
            let target = destination.join(relative);
            if let Some(parent) = target.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
            fs::write(target, file.data).map_err(|error| error.to_string())?;
        }
        fs::write(destination.join(".chattask-tool"), tool_id).map_err(|error| error.to_string())?;
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&destination);
        return Err(format!("ドロップしたツールを保存できませんでした。{error}"));
    }
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_tool_html_files(folder_path: String) -> Result<Vec<String>, String> {
    let root = fs::canonicalize(&folder_path).map_err(|_| "登録フォルダが見つかりません。".to_string())?;
    if !root.is_dir() { return Err("選択した場所はフォルダではありません。".into()); }
    let mut files = Vec::new();
    collect_tool_html_files(&root, &root, 0, &mut files)?;
    files.sort_by(|left, right| {
        let left_index = left.eq_ignore_ascii_case("index.html");
        let right_index = right.eq_ignore_ascii_case("index.html");
        right_index.cmp(&left_index).then_with(|| left.to_lowercase().cmp(&right.to_lowercase()))
    });
    Ok(files)
}

fn validated_tool_entry(folder_path: &str, entry_file: &str) -> Result<PathBuf, String> {
    if entry_file.trim().is_empty() { return Err("起動するHTMLを選択してください。".into()); }
    let root = fs::canonicalize(folder_path).map_err(|_| "登録フォルダが見つかりません。".to_string())?;
    if !root.is_dir() { return Err("登録先がフォルダではありません。".into()); }
    let candidate = fs::canonicalize(root.join(entry_file)).map_err(|_| "起動するHTMLが見つかりません。".to_string())?;
    if !candidate.starts_with(&root) || !candidate.is_file() { return Err("登録フォルダ外のファイルは起動できません。".into()); }
    let html = candidate.extension().and_then(|value| value.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("html") || extension.eq_ignore_ascii_case("htm"));
    if !html { return Err("起動ファイルにはHTMLを選択してください。".into()); }
    Ok(candidate)
}

#[tauri::command]
fn validate_tool_html_entry(folder_path: String, entry_file: String) -> Result<String, String> {
    let root = fs::canonicalize(&folder_path).map_err(|_| "取り込むフォルダが見つかりません。".to_string())?;
    let entry = validated_tool_entry(&folder_path, &entry_file)?;
    let relative = entry.strip_prefix(root).map_err(|error| error.to_string())?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
fn open_tool_in_chrome(folder_path: String, entry_file: String) -> Result<(), String> {
    let path = validated_tool_entry(&folder_path, &entry_file)?;
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open").args(["-a", "Google Chrome"]).arg(path).status().map_err(|error| error.to_string())?;
        if !status.success() { return Err("Google Chromeを起動できませんでした。".into()); }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("Chromeでの起動は現在macOS版のみ対応しています。".into())
    }
}

#[tauri::command]
fn open_tool_folder(app: AppHandle, folder_path: String) -> Result<(), String> {
    let path = fs::canonicalize(folder_path).map_err(|_| "登録フォルダが見つかりません。".to_string())?;
    if !path.is_dir() { return Err("登録先がフォルダではありません。".into()); }
    app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|error| error.to_string())
}

#[tauri::command]
fn report_frontend_error(message: String) { eprintln!("[frontend-error]\n{message}"); }

#[tauri::command]
fn save_avatar(app: AppHandle, mime_type: String, data: Vec<u8>) -> Result<(), String> {
    if data.len() > 5 * 1024 * 1024 { return Err("プロフィール画像の上限は5MBです。".into()); }
    let extension = match mime_type.as_str() {
        "image/jpeg" => "jpg", "image/png" => "png", "image/webp" => "webp", "image/gif" => "gif",
        _ => return Err("JPEG・PNG・WebP・GIF画像を選択してください。".into()),
    };
    let root = profile_root(&app)?;
    for candidate in ["avatar.jpg", "avatar.png", "avatar.webp", "avatar.gif"] { let _ = fs::remove_file(root.join(candidate)); }
    fs::write(root.join(format!("avatar.{extension}")), data).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_avatar(app: AppHandle) -> Result<AttachmentFile, String> {
    let root = profile_root(&app)?;
    for (name, mime_type) in [("avatar.jpg", "image/jpeg"), ("avatar.png", "image/png"), ("avatar.webp", "image/webp"), ("avatar.gif", "image/gif")] {
        let path = root.join(name);
        if path.exists() { return Ok(AttachmentFile { name: name.into(), mime_type: mime_type.into(), data: fs::read(path).map_err(|error| error.to_string())? }); }
    }
    Err("プロフィール画像は登録されていません。".into())
}

#[tauri::command]
fn delete_avatar(app: AppHandle) -> Result<(), String> {
    let root = profile_root(&app)?;
    for candidate in ["avatar.jpg", "avatar.png", "avatar.webp", "avatar.gif"] { let _ = fs::remove_file(root.join(candidate)); }
    Ok(())
}

#[tauri::command]
fn export_markdown(app: AppHandle, file_name: String, content: String) -> Result<String, String> {
    let directory = app.path().download_dir().map_err(|error| error.to_string())?;
    let safe_name: String = file_name.chars().map(|character| if matches!(character, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { character }).collect();
    let stem = safe_name.trim().trim_end_matches(".md");
    let stem = if stem.is_empty() { "document" } else { stem };
    let mut path = directory.join(format!("{stem}.md"));
    let mut number = 2;
    while path.exists() { path = directory.join(format!("{stem} ({number}).md")); number += 1; }
    fs::write(&path, content).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_attachments, add_attachment, rename_attachment, get_attachment, open_attachment, copy_attachment,
            download_attachment, delete_attachment, delete_task_attachments, save_avatar, get_avatar, delete_avatar,
            export_markdown, select_tool_folder, select_tool_html_file, validate_tool_html_entry,
            copy_tool_folder, delete_managed_tool_folder, import_dropped_tool_files,
            list_tool_html_files, open_tool_in_chrome, open_tool_folder,
            report_frontend_error, app_database::initialize_app_database,
            app_database::load_app_data_sqlite, app_database::save_app_data_sqlite,
            app_database::create_app_backup, app_database::list_app_backups, app_database::restore_app_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
