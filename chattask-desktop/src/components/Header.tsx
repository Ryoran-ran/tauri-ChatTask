import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from "react";
import type { WorkspaceMode } from "../types";
import { Modal } from "./Modal";
import { SettingsCenterModal } from "./SettingsCenterModal";

interface Props {
  importRef: RefObject<HTMLInputElement | null>;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onExport: () => void;
  onTags: () => void;
  onTemplates: () => void;
  onReport: () => void;
  onGantt: () => void;
  onWeeklyLoad: () => void;
  onGoals: () => void;
  onIssues: () => void;
  onNotifications: () => void;
  onSearch: () => void;
  onInbox: () => void;
  onWaiting: () => void;
  waitingCount: number;
  inboxCount: number;
  notificationCount: number;
  onNonWorking: () => void;
  onWeekendSettings: () => void;
  onHelp: () => void;
  onProfile: () => void;
  onDataManagement: () => void;
  onAchievements: () => void;
  onTools: () => void;
  hideRecurring: boolean;
  openTodayOnStartup: boolean;
  onHideRecurring: (value: boolean) => void;
  onOpenTodayOnStartup: (value: boolean) => void;
  workspaceMode: WorkspaceMode;
  onWorkspaceMode: (mode: WorkspaceMode) => void;
}

export function Header(props: Props) {
  const [settings, setSettings] = useState(false);
  const [records, setRecords] = useState(false);
  const [settingsCenterOpen, setSettingsCenterOpen] = useState(false);
  const modeSetupKey = localStorage.getItem("chatTaskActiveEnvironment") === "test" ? "chatTaskWorkspaceModeConfigured:test" : "chatTaskWorkspaceModeConfigured";
  const [modeSetupOpen, setModeSetupOpen] = useState(() => !localStorage.getItem(modeSetupKey) && !localStorage.getItem(localStorage.getItem("chatTaskActiveEnvironment") === "test" ? "chatTaskWorkspaceMode:test" : "chatTaskWorkspaceMode"));
  const [modeDialogOpen, setModeDialogOpen] = useState(false);
  const [modeDraft, setModeDraft] = useState<WorkspaceMode>(props.workspaceMode);
  const menuRef = useRef<HTMLDivElement>(null);
  const recordsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setSettings(false);
      if (!recordsRef.current?.contains(event.target as Node)) setRecords(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const openModeDialog = () => {
    setModeDraft(props.workspaceMode);
    setSettings(false);
    setModeDialogOpen(true);
  };
  const applyWorkspaceMode = () => {
    props.onWorkspaceMode(modeDraft);
    localStorage.setItem(modeSetupKey, "true");
    setModeDialogOpen(false);
  };
  const selectInitialMode = (mode: WorkspaceMode) => {
    props.onWorkspaceMode(mode);
    localStorage.setItem(modeSetupKey, "true");
    setModeSetupOpen(false);
  };

  return <><header className="app-header">
    <div className="brand"><span className="brand-icon">◇</span><strong>ChatTask</strong>{localStorage.getItem("chatTaskActiveEnvironment") === "test" && <span className="test-environment-badge">TEST環境</span>}<span className={`workspace-mode-badge ${props.workspaceMode}`}><i aria-hidden="true" />{props.workspaceMode === "work" ? "仕事" : "日常"}</span></div>
    <nav className="header-actions">
      <button title="全文横断検索（⌘/Ctrl + Shift + F）" onClick={props.onSearch}>全文検索</button>
      <button className={`header-inbox-button ${props.inboxCount ? "has-items" : ""}`} onClick={props.onInbox}>Inbox{props.inboxCount > 0 && <span>{props.inboxCount > 99 ? "99+" : props.inboxCount}</span>}</button>
      {props.workspaceMode === "work" && <button className={`header-waiting-button ${props.waitingCount ? "has-items" : ""}`} onClick={props.onWaiting}>待ち{props.waitingCount > 0 && <span>{props.waitingCount > 99 ? "99+" : props.waitingCount}</span>}</button>}
      <button className={`header-notification-button ${props.notificationCount ? "has-notifications" : ""}`} onClick={props.onNotifications}>通知{props.notificationCount > 0 && <span>{props.notificationCount > 99 ? "99+" : props.notificationCount}</span>}</button>
      <button onClick={props.onGoals}>プロジェクト</button>
      <button onClick={props.onGantt}>ガントチャート</button>
      <button onClick={props.onWeeklyLoad}>週間予定</button>
      <div className="settings-menu records-menu" ref={recordsRef}>
        <button className="settings-trigger" onClick={() => { setRecords(!records); setSettings(false); }} aria-expanded={records}>記録・分析 <span>▼</span></button>
        {records && <div className="settings-panel records-panel"><button onClick={() => { props.onAchievements(); setRecords(false); }}>頑張りの記録<small>日々の実績と変化を確認</small></button><button onClick={() => { props.onIssues(); setRecords(false); }}>課題一覧<small>気づいた課題を整理</small></button><button onClick={() => { props.onReport(); setRecords(false); }}>まとめ出力<small>記録をレポートとして出力</small></button></div>}
      </div>
      <div className="settings-menu" ref={menuRef}>
        <button className="settings-trigger" onClick={() => { setSettings(!settings); setRecords(false); }} aria-expanded={settings}>設定 <span>▼</span></button>
        {settings && <div className="settings-panel">
          <button type="button" className="settings-center-open" onClick={() => { setSettings(false); setSettingsCenterOpen(true); }}><span><b>設定を開く</b><small>すべての設定をカテゴリーから選択</small></span><em>→</em></button>
          <span className="settings-group-label">クイック表示設定</span>
          <label><input type="checkbox" checked={props.hideRecurring} onChange={(event) => props.onHideRecurring(event.target.checked)} /><span>定期タスクを一覧で非表示</span></label>
          <label><input type="checkbox" checked={props.openTodayOnStartup} onChange={(event) => props.onOpenTodayOnStartup(event.target.checked)} /><span>起動時に今日を開く</span></label>
          <span className="settings-group-label">現在の利用モード</span>
          <button type="button" className="workspace-mode-open" onClick={openModeDialog}><span><b>{props.workspaceMode === "work" ? "仕事用" : "日常用"}</b><small>クリックして利用モードを変更</small></span></button>
          <button onClick={() => { props.onHelp(); setSettings(false); }}>ヘルプ</button>
        </div>}
      </div>
      <input ref={props.importRef} hidden type="file" accept=".json,application/json" onChange={props.onImport} />
    </nav>
  </header>
  {settingsCenterOpen && <SettingsCenterModal workspaceMode={props.workspaceMode} hideRecurring={props.hideRecurring} openTodayOnStartup={props.openTodayOnStartup} importRef={props.importRef} onHideRecurring={props.onHideRecurring} onOpenTodayOnStartup={props.onOpenTodayOnStartup} onProfile={props.onProfile} onWorkspaceMode={openModeDialog} onWeekendSettings={props.onWeekendSettings} onNonWorking={props.onNonWorking} onTags={props.onTags} onTemplates={props.onTemplates} onTools={props.onTools} onDataManagement={props.onDataManagement} onExport={props.onExport} onHelp={props.onHelp} onClose={() => setSettingsCenterOpen(false)} />}
  {modeDialogOpen && <Modal title="利用モード設定" onClose={() => setModeDialogOpen(false)}><div className="workspace-mode-dialog"><header><strong>この端末で使うモード</strong><p>利用する機能のまとまりを選択します。タスクやプロジェクトなど、登録済みのデータは削除されません。</p></header><div className="workspace-mode-dialog-options" role="radiogroup" aria-label="利用モード"><button type="button" role="radio" aria-checked={modeDraft === "work"} className={modeDraft === "work" ? "selected" : ""} onClick={() => setModeDraft("work")}><span aria-hidden="true">▣</span><div><strong>仕事用</strong><small>業務タスク、工数、休暇・祝日設定を使う</small></div><b>{modeDraft === "work" ? "✓" : ""}</b></button><button type="button" role="radio" aria-checked={modeDraft === "personal"} className={modeDraft === "personal" ? "selected personal" : "personal"} onClick={() => setModeDraft("personal")}><span aria-hidden="true">⌂</span><div><strong>日常用</strong><small>日々のタスク、習慣、休日に関係しない予定を使う</small></div><b>{modeDraft === "personal" ? "✓" : ""}</b></button></div>{modeDraft !== props.workspaceMode && <div className="workspace-mode-change-notice"><strong>{modeDraft === "work" ? "仕事用" : "日常用"}へ切り替えます</strong><small>画面を閉じずに表示内容が切り替わります。</small></div>}<footer><button type="button" onClick={() => setModeDialogOpen(false)}>キャンセル</button><button type="button" className="primary" onClick={applyWorkspaceMode} disabled={modeDraft === props.workspaceMode}>このモードに切り替える</button></footer></div></Modal>}
  {modeSetupOpen && <Modal title="利用モードを選択" onClose={() => selectInitialMode(props.workspaceMode)}><div className="workspace-mode-onboarding"><p>この端末で主に使うモードを選んでください。あとから設定で変更できます。</p><div><button type="button" onClick={() => selectInitialMode("work")}><span aria-hidden="true">▣</span><strong>仕事用</strong><small>業務タスク、工数、休暇設定を使う</small></button><button type="button" className="personal" onClick={() => selectInitialMode("personal")}><span aria-hidden="true">⌂</span><strong>日常用</strong><small>日々のタスクと習慣を記録する</small></button></div></div></Modal>}
  </>;
}
