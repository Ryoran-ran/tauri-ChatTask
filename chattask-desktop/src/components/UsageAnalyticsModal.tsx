import { useEffect, useMemo, useState } from "react";
import { buildUsageAnalysisExport, clearUsageData, loadUsageStore, summarizeUsage, usageAnalysisCsv, USAGE_ACTIONS, USAGE_RETENTION_DAYS, type UsageActionSummary, type UsageStore } from "../usageAnalytics";
import { Modal } from "./Modal";

const CLASS_LABELS: Record<UsageActionSummary["classification"], string> = {
  frequent: "よく使う",
  occasional: "ときどき",
  rare: "利用少なめ",
  unused: "未使用",
  protected: "必要時に使用",
  collecting: "集計中",
};

const formatDate = (value: string) => value ? new Date(value).toLocaleDateString("ja-JP") : "—";
const percent = (value: number | null) => value === null ? "—" : `${Math.round(value * 100)}%`;

export function UsageAnalyticsModal({ onClose }: { onClose: () => void }) {
  const [days, setDays] = useState(30);
  const [store, setStore] = useState<UsageStore>(() => loadUsageStore());
  const [confirmingClear, setConfirmingClear] = useState(false);
  useEffect(() => {
    const refresh = () => setStore(loadUsageStore());
    window.addEventListener("chattask-usage-updated", refresh);
    return () => window.removeEventListener("chattask-usage-updated", refresh);
  }, []);
  const summaries = useMemo(() => summarizeUsage(store.events, USAGE_ACTIONS, days), [store.events, days]);
  const used = summaries.filter((item) => item.uses > 0).sort((a, b) => b.uses - a.uses || b.activeDays - a.activeDays);
  const lowUsage = summaries.filter((item) => item.classification === "unused" || item.classification === "rare")
    .sort((a, b) => b.eligibleSessions - a.eligibleSessions || a.uses - b.uses);
  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - days);
  const periodEvents = store.events.filter((event) => event.occurredAt >= periodStart.toISOString());
  const activeDays = new Set(periodEvents.map((event) => event.occurredAt.slice(0, 10))).size;
  const actionCount = periodEvents.filter((event) => event.kind === "action").length;
  const lifetimeActions = Object.values(store.daily).reduce((total, day) => total + Object.values(day.actions || {}).reduce((sum, count) => sum + count, 0), 0);
  const clear = () => {
    clearUsageData();
    setStore(loadUsageStore());
    setConfirmingClear(false);
  };
  const exportAnalysis = (format: "csv" | "json") => {
    const now = new Date();
    const analysis = buildUsageAnalysisExport(store, days, now);
    const content = format === "csv" ? `\uFEFF${usageAnalysisCsv(analysis)}` : JSON.stringify(analysis, null, 2);
    const blob = new Blob([content], { type: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `chattask_usage_${analysis.period.end}_${days}days.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const rows = (items: UsageActionSummary[], empty: string) => items.length
    ? <div className="usage-table-wrap"><table className="usage-table"><thead><tr><th>機能</th><th>利用回数</th><th>利用日数</th><th>利用セッション</th><th>利用率</th><th>最終利用</th><th>分類</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><th><strong>{item.label}</strong><small>{item.category}</small></th><td>{item.uses}</td><td>{item.activeDays}日</td><td>{item.sessions}{item.eligibleSessions ? ` / ${item.eligibleSessions}` : ""}</td><td>{percent(item.sessionRate)}</td><td>{formatDate(item.lastUsedAt)}</td><td><span className={`usage-classification is-${item.classification}`}>{CLASS_LABELS[item.classification]}</span></td></tr>)}</tbody></table></div>
    : <p className="usage-empty">{empty}</p>;
  return <Modal title="利用状況" onClose={onClose} wide>
    <div className="usage-analytics">
      <header className="usage-heading"><div><small>LOCAL USAGE ANALYTICS</small><h3>よく使う機能・あまり使わない機能</h3><p>主要な操作だけをこの端末内で集計します。タスク名、入力内容、ファイル名などは記録しません。</p></div><label>集計期間<select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>直近7日</option><option value={30}>直近30日</option><option value={90}>直近90日</option></select></label></header>
      <div className="usage-summary-cards"><article><small>操作回数</small><strong>{actionCount}</strong><span>期間内</span></article><article><small>利用日数</small><strong>{activeDays}</strong><span>{days}日中</span></article><article><small>使用した機能</small><strong>{used.length}</strong><span>計測対象 {USAGE_ACTIONS.length}件</span></article><article><small>累計操作</small><strong>{lifetimeActions}</strong><span>日別集計として保持</span></article></div>
      <section><header><div><h4>よく使う項目</h4><p>期間内に1回以上使った機能を、利用回数の多い順に表示します。</p></div><span>{used.length}件</span></header>{rows(used, "まだ主要操作の記録がありません。しばらく通常どおり利用すると集計されます。")}</section>
      <section><header><div><h4>あまり使わない項目</h4><p>表示機会があるのに利用が少ない機能です。バックアップなど必要時に使う操作は整理候補から除外します。</p></div><span>{lowUsage.length}件</span></header>{rows(lowUsage, "整理候補はまだありません。")}</section>
      <aside className="usage-privacy-note"><strong>保存について</strong><span>生の操作履歴は最大{USAGE_RETENTION_DAYS}日間だけ保持し、日別の件数は長期集計用に残します。外部への送信は行いません。利用率は、その画面を開いたセッションのうち操作したセッションの割合です。</span></aside>
      <footer className="usage-footer">{confirmingClear ? <div><span>この端末の利用状況をすべて削除しますか？</span><button type="button" onClick={() => setConfirmingClear(false)}>戻る</button><button type="button" className="danger" onClick={clear}>削除を実行</button></div> : <><button type="button" className="danger-text" onClick={() => setConfirmingClear(true)}>利用状況を削除</button><span className="usage-footer-spacer" /><div className="usage-export-actions"><small>個別履歴や入力内容は含みません</small><div><button type="button" className="usage-export-button is-csv" onClick={() => exportAnalysis("csv")}><span aria-hidden="true">↓</span>CSVを出力</button><button type="button" className="usage-export-button is-json" onClick={() => exportAnalysis("json")}><span aria-hidden="true">↓</span>JSONを出力</button></div></div></>}</footer>
    </div>
  </Modal>;
}
