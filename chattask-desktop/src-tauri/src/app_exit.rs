use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct ExitGuard {
    requested: AtomicBool,
    approved: AtomicBool,
}

impl ExitGuard {
    pub fn approved(&self) -> bool { self.approved.load(Ordering::SeqCst) }
    fn request(&self) { self.requested.store(true, Ordering::SeqCst); }
    fn approve(&self) -> Result<(), String> {
        if !self.requested.load(Ordering::SeqCst) {
            return Err("終了要求がありません。".into());
        }
        self.approved.store(true, Ordering::SeqCst);
        Ok(())
    }
}

pub fn request_save(app: &AppHandle) {
    app.state::<ExitGuard>().request();
    // 失敗しても終了は許可しない。初期化後のready通知で再送する。
    if let Err(error) = app.emit_to("main", "app-save-before-exit", ()) {
        eprintln!("終了前の保存要求を送信できませんでした: {error}");
    }
}

#[tauri::command]
pub fn app_exit_listener_ready(app: AppHandle) -> Result<(), String> {
    if app.state::<ExitGuard>().requested.load(Ordering::SeqCst) {
        app.emit_to("main", "app-save-before-exit", ()).map_err(|error| error.to_string())?;
    }
    Ok(())
}

// フロントエンドが保存キューの完了を確認した場合にだけ呼ぶ。
#[tauri::command]
pub fn finish_app_exit(app: AppHandle) -> Result<(), String> {
    app.state::<ExitGuard>().approve()?;
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn close_and_quit_remain_blocked_until_save_acknowledgement() {
        let guard = ExitGuard::default();
        assert!(!guard.approved());
        assert!(guard.approve().is_err());
        guard.request();
        guard.request();
        assert!(!guard.approved()); // 保存失敗・要求連打では終了しない
        guard.approve().unwrap();
        assert!(guard.approved());
    }
}
