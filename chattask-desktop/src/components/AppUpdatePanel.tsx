import { useEffect, useRef, useState } from "react";
import { checkAppUpdate, getCurrentAppVersion, openReleasePage, type AppRelease } from "../services/appUpdates";

export function AppUpdatePanel({ onBackup }: { onBackup: () => void }) {
  const [version, setVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void getCurrentAppVersion().then(value => { if (active) setVersion(value); }).catch(() => {
      if (active) setError("現在のバージョンを取得できませんでした。「更新を確認」から再度お試しください。");
    });
    return () => { active = false; mounted.current = false; request.current?.abort(); };
  }, []);

  const check = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setChecking(true); setError(""); setRelease(null); setCheckedAt(null);
    try {
      const current = await getCurrentAppVersion();
      if (controller.signal.aborted) return;
      setVersion(current);
      const result = await checkAppUpdate(current, controller.signal);
      if (!controller.signal.aborted) { setRelease(result); setCheckedAt(new Date()); }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "更新確認に失敗しました。再度お試しください。");
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setChecking(false);
    }
  };

  const openPage = async () => {
    try { await openReleasePage(release?.url); }
    catch { if (mounted.current) setError("ブラウザーを開けませんでした。時間をおいて再度お試しください。"); }
  };

  return <section className="app-update-panel" aria-labelledby="app-update-title">
    <header><div><h4 id="app-update-title">アプリのアップデート</h4><p>現在のバージョン：{version ? `v${version}` : "確認中…"}</p></div><span className="app-update-badge">ChatTask</span></header>
    <p>新しいバージョンと変更内容を確認できます。</p>
    <div className="app-update-actions"><button type="button" className="primary" disabled={checking} onClick={() => void check()}>{checking ? "確認中…" : "更新を確認"}</button><button type="button" onClick={() => void openPage()}>{release?.newer ? "ダウンロードページを開く" : "配布ページを開く"}</button></div>
    <div aria-live="polite" aria-busy={checking}>
      {checking && <p>更新情報を確認しています…</p>}
      {error && <p className="app-update-error" role="alert">{error}</p>}
      {release && <div className="app-update-result">
        <strong>{release.newer ? `新しいバージョン v${release.version} が利用できます` : "現在のバージョンで利用できる更新はありません"}</strong>
        <p>最新の公開バージョン：v{release.version}{release.publishedAt && ` ／ 公開日：${new Date(release.publishedAt).toLocaleDateString("ja-JP")}`}</p>
        <h5>変更内容</h5><pre className="app-update-notes">{release.notes.trim() || "変更内容は記載されていません。配布ページをご確認ください。"}</pre>
      </div>}
      {checkedAt && <small>最終確認：{checkedAt.toLocaleString("ja-JP")}</small>}
    </div>
    <div className="settings-center-note"><strong>更新前に完全バックアップを作成してください</strong><span>配布ページから更新版をダウンロードし、ChatTaskを終了してからアプリを置き換えます。</span><button type="button" onClick={onBackup}>データ管理・バックアップを開く</button></div>
  </section>;
}
