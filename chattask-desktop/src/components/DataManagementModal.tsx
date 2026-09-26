import { useCallback, useEffect, useState } from "react";
import type { AppData } from "../types";
import {
  createAppBackup,
  getAppDatabasePath,
  listAppBackups,
  openAppBackup,
  restoreAppBackup,
  type AppBackupInfo,
  type AppEnvironment,
  type StorageBackend,
} from "../services/storage";
import { Modal } from "./Modal";
import { checkAppDataIntegrity, type IntegrityCheckResult } from "../services/integrityCheck";

interface Props {
  data: AppData;
  backend: StorageBackend | null;
  environment: AppEnvironment;
  onSwitchEnvironment: (environment: AppEnvironment) => Promise<void>;
  onCopyProductionToTest: () => Promise<void>;
  onResetTest: () => Promise<void>;
  onRestore: (data: AppData, backup: AppBackupInfo) => Promise<void>;
  onClose: () => void;
}

const formatSize = (bytes: number) => bytes < 1024
  ? `${bytes} B`
  : bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function DataManagementModal({ data, backend, environment, onSwitchEnvironment, onCopyProductionToTest, onResetTest, onRestore, onClose }: Props) {
  const [backups, setBackups] = useState<AppBackupInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [integrityResult, setIntegrityResult] = useState<IntegrityCheckResult | null>(null);
  const [pendingEnvironment, setPendingEnvironment] = useState<AppEnvironment | null>(null);
  const [pendingRestore, setPendingRestore] = useState<AppBackupInfo | null>(null);
  const [restoringFileName, setRestoringFileName] = useState("");
  const [databasePath, setDatabasePath] = useState("");
  const [databasePathError, setDatabasePathError] = useState("");
  const [databasePathCopied, setDatabasePathCopied] = useState(false);
  const sqliteAvailable = backend === "sqlite";

  const refresh = useCallback(async () => {
    if (!sqliteAvailable) return;
    try { setBackups(await listAppBackups(environment)); }
    catch (error) { setMessage(`一覧を取得できませんでした: ${String(error)}`); }
  }, [sqliteAvailable, environment]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    let active = true;
    setDatabasePath("");
    setDatabasePathError("");
    setDatabasePathCopied(false);
    if (!sqliteAvailable) return () => { active = false; };
    void getAppDatabasePath(environment)
      .then((path) => { if (active) setDatabasePath(path); })
      .catch((error) => { if (active) setDatabasePathError(String(error)); });
    return () => { active = false; };
  }, [sqliteAvailable, environment]);

  const copyDatabasePath = async () => {
    if (!databasePath) return;
    try {
      await navigator.clipboard.writeText(databasePath);
      setDatabasePathCopied(true);
      window.setTimeout(() => setDatabasePathCopied(false), 2000);
    } catch (error) {
      setMessage(`データベースのパスをコピーできませんでした: ${String(error)}`);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      await createAppBackup(data, environment);
      setMessage("完全バックアップを作成しました。");
      await refresh();
    } catch (error) {
      setMessage(`バックアップに失敗しました: ${String(error)}`);
    } finally { setBusy(false); }
  };

  const restore = async (backup: AppBackupInfo) => {
    setPendingRestore(null);
    setBusy(true);
    setRestoringFileName(backup.fileName);
    setMessage(`${backup.fileName} を復元しています。画面を閉じずにお待ちください…`);
    try {
      await onRestore(await restoreAppBackup(backup.fileName, environment), backup);
      setMessage(`${backup.fileName} を復元しました。`);
    } catch (error) {
      setMessage(`復元に失敗しました: ${String(error)}`);
    } finally { setBusy(false); setRestoringFileName(""); }
  };

  return <Modal title="データ管理・バックアップ" onClose={onClose}>
    <div className="data-management">
      <section className={`environment-settings ${environment === "test" ? "is-test" : ""}`}>
        <div><h3>使用環境</h3><p>本番とテストのタスクデータ・バックアップ一覧は環境別に管理されます。</p></div>
        <div className="environment-choice" role="group" aria-label="使用環境">
          <button type="button" className={environment === "production" ? "active" : ""} onClick={() => environment !== "production" && setPendingEnvironment("production")}>本番環境</button>
          <button type="button" className={environment === "test" ? "active" : ""} onClick={() => environment !== "test" && setPendingEnvironment("test")}>テスト環境</button>
        </div>
        {pendingEnvironment && <div className="environment-switch-confirm" role="alertdialog" aria-label="環境切り替えの確認">
          <strong>{pendingEnvironment === "test" ? "テスト環境" : "本番環境"}へ切り替えますか？</strong>
          <p>現在の内容を保存してからアプリを再読み込みします。</p>
          <div><button type="button" disabled={busy} onClick={() => setPendingEnvironment(null)}>キャンセル</button><button type="button" className="primary" disabled={busy} onClick={async () => { setBusy(true); setMessage("環境を切り替えています…"); try { await onSwitchEnvironment(pendingEnvironment); } catch (error) { setMessage(`切り替えに失敗しました: ${String(error)}`); setBusy(false); setPendingEnvironment(null); } }}>切り替える</button></div>
        </div>}
        <div className="environment-tools">
          <button disabled={busy} onClick={async () => { setBusy(true); try { await onCopyProductionToTest(); setMessage("本番データをテスト環境へコピーしました。"); } catch (error) { setMessage(`コピーに失敗しました: ${String(error)}`); } finally { setBusy(false); } }}>本番データをテストへコピー</button>
          <button className="danger" disabled={busy} onClick={async () => { if (!confirm("テスト環境のデータを初期化しますか？\n本番環境には影響しません。")) return; setBusy(true); try { await onResetTest(); setMessage("テスト環境を初期化しました。"); } catch (error) { setMessage(`初期化に失敗しました: ${String(error)}`); } finally { setBusy(false); } }}>テスト環境を初期化</button>
        </div>
      </section>
      <p className={`storage-status ${sqliteAvailable ? "ok" : "warning"}`}>
        環境: {environment === "test" ? "テスト" : "本番"}<br />保存先: {sqliteAvailable ? "SQLite（自動保存・1日1回自動バックアップ）" : "localStorage（ブラウザ互換モード）"}
      </p>
      {sqliteAvailable && <section className="database-location" aria-labelledby="database-location-title">
        <div>
          <h3 id="database-location-title">データベースファイル</h3>
          <p>SQLite対応ツールから接続する場合は、このファイルを指定してください。</p>
        </div>
        <div className="database-location-value">
          <code title={databasePath}>{databasePath || (databasePathError ? "パスを取得できませんでした" : "取得中…")}</code>
          <button type="button" disabled={!databasePath} onClick={() => void copyDatabasePath()}>{databasePathCopied ? "コピー済み" : "パスをコピー"}</button>
        </div>
        {databasePathError && <small className="database-location-error">{databasePathError}</small>}
        <small>外部ツールから更新すると競合やデータ破損の原因になります。ChatTaskを終了してから操作し、事前にバックアップを作成してください。</small>
      </section>}
      {message && <p className={`storage-message ${message.includes("失敗") || message.includes("できません") ? "error" : restoringFileName ? "working" : "success"}`} role="status" aria-live="polite">{restoringFileName && <span className="storage-message-spinner" aria-hidden="true" />}{message}</p>}
      {sqliteAvailable
        ? <>
          <p className="muted">タスク・プロジェクトに加えて、添付ファイル、プロフィール画像、ChatTaskが管理するローカルツールを保存します。</p>
          <button type="button" className="primary" disabled={busy} onClick={() => void create()}>今すぐ完全バックアップを作成</button>
          <h3>復元できるバックアップ</h3>
          {backups.length === 0 && <p className="muted">バックアップはまだありません。</p>}
          <div className="backup-list">
            {backups.map((backup) => <div className={`backup-row ${restoringFileName === backup.fileName ? "is-restoring" : ""}`} key={backup.fileName}>
              <div>
                <strong>{backup.fileName}</strong>
                <small>{backup.complete ? "完全" : "旧形式（データのみ）"}・{new Date(backup.createdAt * 1000).toLocaleString("ja-JP")}・{formatSize(backup.size)}</small>
              </div>
              <span className="backup-row-actions"><button type="button" disabled={busy} onClick={() => void openAppBackup(backup).catch((error) => setMessage(`保存先を開けませんでした: ${String(error)}`))}>保存先を開く</button><button type="button" disabled={busy} onClick={() => setPendingRestore(backup)}>{restoringFileName === backup.fileName ? "復元中…" : "復元"}</button></span>
            </div>)}
          </div>
          {pendingRestore && <div className="backup-restore-confirm" role="alertdialog" aria-label="バックアップ復元の確認">
            <strong>{pendingRestore.fileName} の内容へ復元しますか？</strong>
            <p>現在の内容は復元前の完全バックアップとして保存されます。完全バックアップでは添付ファイルなども置き換わります。復元完了後、アプリを再読み込みします。</p>
            <div><button type="button" disabled={busy} onClick={() => setPendingRestore(null)}>キャンセル</button><button type="button" className="primary" disabled={busy} onClick={() => void restore(pendingRestore)}>復元を実行</button></div>
          </div>}
        </>
        : <p>デスクトップアプリで起動すると、SQLiteのバックアップ管理を利用できます。</p>}
      <section className="integrity-check">
        <div className="integrity-check-heading">
          <div><h3>データ整合性チェック</h3><p>データは変更せず、参照切れ・重複・不正な日付や工数を診断します。</p></div>
          <button type="button" onClick={() => setIntegrityResult(checkAppDataIntegrity(data))}>診断を実行</button>
        </div>
        {integrityResult && <>
          <div className={`integrity-summary ${integrityResult.issues.length ? "has-issues" : "is-ok"}`}>
            <strong>{integrityResult.issues.length ? `${integrityResult.issues.length}件の確認項目があります` : "問題は見つかりませんでした"}</strong>
            <span>タスク {integrityResult.checkedCounts.tasks}件・プロジェクト {integrityResult.checkedCounts.projects}件・予定 {integrityResult.checkedCounts.schedules}件</span>
          </div>
          {integrityResult.issues.length > 0 && <div className="integrity-issues">
            {integrityResult.issues.map((issue) => <article className={`integrity-issue ${issue.severity}`} key={issue.id}>
              <header><span>{issue.severity === "error" ? "要修正" : "要確認"}</span><small>{issue.category}</small></header>
              <strong>{issue.target}</strong>
              <p>{issue.message}</p>
              <div><b>対応案</b>{issue.suggestion}</div>
            </article>)}
          </div>}
          <p className="integrity-note">自動修正は行っていません。修正前にバックアップを作成してください。</p>
        </>}
      </section>
    </div>
  </Modal>;
}
