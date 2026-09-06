import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from "react";

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
  onHelp: () => void;
  onProfile: () => void;
  onDataManagement: () => void;
  onAchievements: () => void;
  hideRecurring: boolean;
  openTodayOnStartup: boolean;
  onHideRecurring: (value: boolean) => void;
  onOpenTodayOnStartup: (value: boolean) => void;
}

export function Header(props: Props) {
  const [settings, setSettings] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setSettings(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return <header className="app-header">
    <div className="brand"><span className="brand-icon">◇</span><strong>ChatTask</strong>{localStorage.getItem("chatTaskActiveEnvironment") === "test" && <span className="test-environment-badge">TEST環境</span>}</div>
    <nav className="header-actions">
      <button title="全文横断検索（⌘/Ctrl + Shift + F）" onClick={props.onSearch}>全文検索</button>
      <button className={`header-inbox-button ${props.inboxCount ? "has-items" : ""}`} onClick={props.onInbox}>Inbox{props.inboxCount > 0 && <span>{props.inboxCount > 99 ? "99+" : props.inboxCount}</span>}</button>
      <button className={`header-waiting-button ${props.waitingCount ? "has-items" : ""}`} onClick={props.onWaiting}>待ち{props.waitingCount > 0 && <span>{props.waitingCount > 99 ? "99+" : props.waitingCount}</span>}</button>
      <button className={`header-notification-button ${props.notificationCount ? "has-notifications" : ""}`} onClick={props.onNotifications}>通知{props.notificationCount > 0 && <span>{props.notificationCount > 99 ? "99+" : props.notificationCount}</span>}</button>
      <button onClick={props.onGoals}>プロジェクト</button>
      <button onClick={props.onGantt}>ガントチャート</button>
      <button onClick={props.onWeeklyLoad}>週間予定</button>
      <div className="settings-menu" ref={menuRef}>
        <button className="settings-trigger" onClick={() => setSettings(!settings)} aria-expanded={settings}>設定 <span>▼</span></button>
        {settings && <div className="settings-panel">
          <button onClick={() => { props.onAchievements(); setSettings(false); }}>頑張りの記録</button>
          <button onClick={() => { props.onIssues(); setSettings(false); }}>課題一覧</button>
          <button onClick={() => { props.onReport(); setSettings(false); }}>まとめ出力</button>
          <button onClick={() => { props.onProfile(); setSettings(false); }}>プロフィール設定</button>
          <button onClick={() => { props.onNonWorking(); setSettings(false); }}>休暇・祝日設定</button>
          <button onClick={() => { props.onTags(); setSettings(false); }}>案件タグ設定</button>
          <button onClick={() => { props.onTemplates(); setSettings(false); }}>タスクテンプレート管理</button>
          <label><input type="checkbox" checked={props.hideRecurring} onChange={(event) => props.onHideRecurring(event.target.checked)} /><span>定期タスクを一覧で非表示</span></label>
          <label><input type="checkbox" checked={props.openTodayOnStartup} onChange={(event) => props.onOpenTodayOnStartup(event.target.checked)} /><span>起動時に今日を開く</span></label>
          <button onClick={() => { props.onHelp(); setSettings(false); }}>ヘルプ</button>
          <button onClick={() => { props.onDataManagement(); setSettings(false); }}>データ管理・バックアップ</button>
          <button onClick={() => { props.onExport(); setSettings(false); }}>データをエクスポート</button>
          <button type="button" onClick={() => { if (props.importRef.current) { props.importRef.current.value = ""; props.importRef.current.click(); } setSettings(false); }}>データをインポート</button>
        </div>}
      </div>
      <input ref={props.importRef} hidden type="file" accept=".json,application/json" onChange={props.onImport} />
    </nav>
  </header>;
}
