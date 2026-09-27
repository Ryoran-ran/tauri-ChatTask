import { useState } from "react";
import type { Goal, Task } from "../types";
import { historyUndoProblem, validateHistory, type ScheduleHistoryRecord } from "../projectScheduleHistory";
import { Modal } from "./Modal";

const labels: Record<string, string> = { targetWorkStartDate: "目標開始日", targetWorkEndDate: "目標終了日", dueDate: "期限", scheduleSortOrder: "表示順", plannedRanges: "作業日・予定", plannedHours: "予定工数", baselinePlannedRanges: "当初予定", baselinePlannedHours: "当初工数", replanReason: "変更理由", replannedAt: "変更日時", linkedTaskScheduleSnapshot: "同期済み予定", linkedTaskPlannedHoursSnapshot: "同期済み工数" };
function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "未設定";
  if (Array.isArray(value)) return value.length ? value.map(item => item && typeof item === "object" && "startDate" in item ? `${item.title ? `${item.title}：` : ""}${item.startDate || "未設定"} 〜 ${item.endDate || item.startDate || "未設定"}${item.plannedHours !== undefined ? `（${item.plannedHours}h）` : ""}${item.status ? ` [${item.status}]` : ""}` : JSON.stringify(item)).join("\n") : "なし";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
function Changes({ record, reversing = false }: { record: ScheduleHistoryRecord; reversing?: boolean }) {
  try { validateHistory(record); } catch { return <p>この履歴の詳細を表示できません。</p>; }
  return <div className="work-date-sync-table-scroll"><table className="work-date-sync-table"><thead><tr><th>対象・項目</th><th>{reversing ? "現在（操作後）" : "変更前"}</th><th>{reversing ? "戻した後" : "変更後"}</th></tr></thead><tbody>
    {([['作業', record.works], ['マイルストーン', record.milestones], ['関連タスク', record.tasks]] as const).flatMap(([kind, changes]) => changes.flatMap(change => change.fields.map(field => <tr key={`${kind}:${change.id}:${field.key}`}>
      <th scope="row">{kind}：{change.title || change.id}<small>{labels[field.key] || field.key}</small></th><td>{formatValue(reversing ? field.after : field.before)}</td><td>{formatValue(reversing ? field.before : field.after)}</td>
    </tr>)))}
    {record.capacity && <tr><th scope="row">1日の計画可能時間<small>全プロジェクト共通</small></th><td>{reversing ? record.capacity.after : record.capacity.before}h</td><td>{reversing ? record.capacity.before : record.capacity.after}h</td></tr>}
  </tbody></table></div>;
}
export function ScheduleHistoryDialog({ project, tasks, capacity, onUndo, onClose }: { project: Goal; tasks: Task[]; capacity: number; onUndo: (id: string) => void; onClose: () => void }) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const records = Array.isArray(project.scheduleHistory) ? project.scheduleHistory.slice(0, 50) : [];
  const confirming = records.find(record => record.id === confirmId);
  const problem = confirming ? historyUndoProblem(confirming, project, tasks, capacity) : "";
  return <Modal title={`${project.title}・スケジュール変更履歴`} wide onClose={onClose}>
    <div className="schedule-history" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); if (confirmId) setConfirmId(null); else onClose(); } }}>
      <p>最新50件を保存します。通知が消えた後や、アプリの再起動後も確認できます。機能追加前の操作は含まれません。</p>
      <p className="schedule-history-note">変更した項目だけを戻します。後から同じ項目や関連付けを変更した場合は、上書きを防ぐため取り消せません。新しい変更から順に戻してください。</p>
      {confirming ? <section className="schedule-history-confirm">
        <h3>「{confirming.label}」を取り消しますか？</h3>
        <Changes record={confirming} reversing />
        {confirming.tasks.length > 0 && <p>関連タスクの予定も、表示した変更内容に限って一緒に戻します。</p>}
        {problem && <p role="alert" className="work-date-sync-error">{problem}</p>}
        <div className="modal-actions"><button autoFocus type="button" onClick={() => setConfirmId(null)}>履歴に戻る</button><button type="button" className="primary" disabled={Boolean(problem)} onClick={() => { onUndo(confirming.id); setConfirmId(null); }}>取り消しを実行</button></div>
      </section> : <>
        {!records.length && <p className="schedule-history-empty">変更履歴はまだありません。</p>}
        {records.map(record => {
          const reason = historyUndoProblem(record, project, tasks, capacity);
          const targets = [...(Array.isArray(record.works) ? record.works : []), ...(Array.isArray(record.milestones) ? record.milestones : [])].map(item => item.title || item.id);
          return <article className={`schedule-history-entry ${record.undoneAt ? "is-undone" : ""}`} key={record.id}>
            <div className="schedule-history-heading"><div><time>{new Date(record.createdAt).toLocaleString("ja-JP")}</time><h3>{record.label}</h3></div><span>{record.undoneAt ? "取り消し済み" : reason ? "取り消し不可" : "取り消し可能"}</span></div>
            <p className="schedule-history-note">{targets.slice(0, 3).join("、")}{targets.length > 3 ? ` ほか${targets.length - 3}件` : ""}{record.capacity ? "全プロジェクト共通の計画可能時間" : ""}</p>
            <details><summary>対象と変更前後を確認</summary><Changes record={record} /></details>
            {reason && !record.undoneAt && <p className="work-date-sync-error">{reason}</p>}
            {record.undoneAt ? <p className="schedule-history-note">{new Date(record.undoneAt).toLocaleString("ja-JP")} に取り消しました。</p> : <div className="modal-actions"><button type="button" disabled={Boolean(reason)} onClick={() => setConfirmId(record.id)}>この操作を取り消す</button></div>}
          </article>;
        })}
      </>}
    </div>
  </Modal>;
}
