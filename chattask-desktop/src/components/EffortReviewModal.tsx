import { useMemo, useState } from "react";
import { buildEffortReview, type EffortReviewPeriodDays } from "../effortReview";
import type { Goal, ProjectTag, Task } from "../types";
import { Modal } from "./Modal";

const hours = (value: number) => `${Number(value.toFixed(2))}h`;
const signedHours = (value: number) => `${value > 0 ? "+" : ""}${hours(value)}`;

export function EffortReviewModal({ tasks, projects, tags, onSelect, onClose }: {
  tasks: Task[];
  projects: Goal[];
  tags: ProjectTag[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [periodDays, setPeriodDays] = useState<EffortReviewPeriodDays>(30);
  const review = useMemo(() => buildEffortReview(tasks, projects, periodDays), [tasks, projects, periodDays]);
  const tagById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const variance = review.actualHours - review.plannedHours;

  return <Modal title="工数振り返り" wide onClose={onClose}>
    <div className="effort-review">
      <header className="effort-review-header">
        <div><strong>見積もりと実績の差を確認</strong><p>完了した予定のうち、予定工数と実績工数が入力されたものを比較します。</p></div>
        <label>対象期間<select value={periodDays} onChange={(event) => setPeriodDays(Number(event.target.value) as EffortReviewPeriodDays)}><option value={7}>直近7日</option><option value={30}>直近30日</option><option value={90}>直近90日</option></select></label>
      </header>

      <section className="effort-review-summary" aria-label="工数集計">
        <article><small>予定工数</small><strong>{hours(review.plannedHours)}</strong><span>比較可能 {review.measuredEntries.length}件</span></article>
        <article><small>実績工数</small><strong>{hours(review.actualHours)}</strong><span>{review.startDate}〜{review.endDate}</span></article>
        <article className={variance > 0 ? "over" : variance < 0 ? "under" : ""}><small>予定との差</small><strong>{signedHours(variance)}</strong><span>{variance > 0 ? "予定超過" : variance < 0 ? "予定内" : "予定どおり"}</span></article>
        <article><small>見積もり精度</small><strong>{review.accuracy.accuracyPercent === null ? "—" : `${review.accuracy.accuracyPercent}%`}</strong><span>差が小さいほど高精度</span></article>
      </section>

      {(review.missingPlannedCount > 0 || review.missingActualCount > 0) && <div className="effort-review-missing" role="note"><strong>集計対象外</strong><span>予定工数なし {review.missingPlannedCount}件</span><span>実績工数なし {review.missingActualCount}件</span><small>未入力を0時間として扱わず、見積もり精度から除外しています。</small></div>}

      <section className="effort-review-list">
        <header><div><strong>完了予定ごとの内訳</strong><small>差が大きい順</small></div><span>{review.entries.length}件</span></header>
        {review.entries.length === 0 ? <div className="effort-review-empty"><strong>対象期間に完了した予定がありません</strong><p>予定を完了にすると、ここで予定工数と実績工数を比較できます。</p></div> : <div className="effort-review-table-wrap"><table>
          <thead><tr><th>予定</th><th>完了日</th><th>予定</th><th>実績</th><th>差</th><th>精度</th></tr></thead>
          <tbody>{review.entries.map((entry) => {
            const task = taskById.get(entry.taskId);
            const tag = task ? tagById.get(task.projectTagId) : undefined;
            return <tr key={entry.id} className={entry.reason !== "ready" ? "is-missing" : ""}>
              <td><button type="button" onClick={() => onSelect(entry.taskId)}><strong>{entry.scheduleTitle}</strong><small>{entry.taskTitle}{tag ? ` · ${tag.name}` : ""}</small></button></td>
              <td>{entry.completedDate}</td><td>{hours(entry.plannedHours)}</td><td>{entry.actualHours > 0 ? hours(entry.actualHours) : "—"}</td>
              <td className={entry.varianceHours > 0 ? "over" : entry.varianceHours < 0 ? "under" : ""}>{entry.reason === "ready" ? signedHours(entry.varianceHours) : "—"}</td>
              <td>{entry.accuracyPercent === null ? <span className="effort-review-unmeasured">未集計</span> : `${entry.accuracyPercent}%`}</td>
            </tr>;
          })}</tbody>
        </table></div>}
      </section>
    </div>
  </Modal>;
}
