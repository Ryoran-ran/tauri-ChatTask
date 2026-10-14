import { Fragment, useMemo, useState } from "react";
import { buildEffortReview, type EffortReviewPeriodDays } from "../effortReview";
import type { Goal, NonWorkingPeriod, ProjectTag, Task } from "../types";
import { todayValue } from "../utils";
import { Modal } from "./Modal";

const hours = (value: number) => `${Number(value.toFixed(2))}h`;
const signedHours = (value: number) => `${value > 0 ? "+" : ""}${hours(value)}`;
const accuracyTone = (value: number) => value >= 80 ? "high" : value >= 60 ? "medium" : "low";

export function EffortReviewModal({ tasks, projects, tags, nonWorkingPeriods, onSelect, onClose }: {
  tasks: Task[];
  projects: Goal[];
  tags: ProjectTag[];
  nonWorkingPeriods: NonWorkingPeriod[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [periodDays, setPeriodDays] = useState<EffortReviewPeriodDays>(30);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(() => new Set());
  const workingDateOverrides = useMemo(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("chatTaskWorkingDateOverrides") || "[]");
      return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : [];
    } catch { return []; }
  }, []);
  const review = useMemo(() => buildEffortReview(tasks, projects, periodDays, todayValue(), nonWorkingPeriods, workingDateOverrides), [tasks, projects, periodDays, nonWorkingPeriods, workingDateOverrides]);
  const tagById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const measuredTaskCount = review.taskEntries.filter((entry) => entry.reason === "ready").length;
  const allTasksExpanded = review.taskEntries.length > 0 && review.taskEntries.every((entry) => expandedTaskIds.has(entry.taskId));
  const hasExpandedTask = review.taskEntries.some((entry) => expandedTaskIds.has(entry.taskId));
  const variance = review.actualHours - review.plannedHours;

  return <Modal title="工数振り返り" wide onClose={onClose}>
    <div className="effort-review">
      <header className="effort-review-header">
        <div><strong>見積もりと実績の差を確認</strong><p>対応済みの作業と完了した予定を、タスク単位・作業単位で比較します。</p></div>
        <label>対象期間<select value={periodDays} onChange={(event) => setPeriodDays(Number(event.target.value) as EffortReviewPeriodDays)}><option value={7}>直近7日</option><option value={30}>直近30日</option><option value={90}>直近90日</option></select></label>
      </header>

      <div className="effort-review-content">
        <aside className="effort-review-overview">
          <section className="effort-review-summary" aria-label="工数集計">
            <article><small>予定工数</small><strong>{hours(review.plannedHours)}</strong><span>比較可能 {measuredTaskCount}タスク・{review.measuredEntries.length}作業</span></article>
            <article><small>実績工数</small><strong>{hours(review.actualHours)}</strong><span>{review.startDate}〜{review.endDate}</span></article>
            <article className={variance > 0 ? "over" : variance < 0 ? "under" : ""}><small>予定との差</small><strong>{signedHours(variance)}</strong><span>{variance > 0 ? "予定超過" : variance < 0 ? "予定内" : "予定どおり"}</span></article>
            <article><small>見積もり精度</small><strong>{review.accuracy.accuracyPercent === null ? "—" : `${review.accuracy.accuracyPercent}%`}</strong><span>差が小さいほど高精度</span></article>
          </section>
          {(review.missingPlannedCount > 0 || review.missingActualCount > 0) && <div className="effort-review-missing" role="note"><strong>集計対象外</strong><span>予定工数なし {review.missingPlannedCount}作業</span><span>実績工数なし {review.missingActualCount}作業</span><small>未入力を0時間として扱わず、見積もり精度から除外しています。</small></div>}
        </aside>

        <section className="effort-review-list">
        <header><div><strong>タスクごとの内訳</strong><small>作業の差が大きい順</small></div><div className="effort-review-list-controls"><span>{review.taskEntries.length}タスク</span><button type="button" disabled={allTasksExpanded || review.taskEntries.length === 0} onClick={() => setExpandedTaskIds(new Set(review.taskEntries.map((entry) => entry.taskId)))}>すべて開く</button><button type="button" disabled={!hasExpandedTask} onClick={() => setExpandedTaskIds(new Set())}>すべて閉じる</button></div></header>
        {review.taskEntries.length === 0 ? <div className="effort-review-empty"><strong>対象期間に対応済みの作業がありません</strong><p>今日のページで作業を対応済みにするか、予定を完了にすると比較できます。</p></div> : <div className="effort-review-table-wrap"><table>
          <colgroup><col className="effort-review-col-name" /><col className="effort-review-col-date" /><col className="effort-review-col-hours" /><col className="effort-review-col-hours" /><col className="effort-review-col-hours" /><col className="effort-review-col-accuracy" /></colgroup>
          <thead><tr><th>タスク / 作業</th><th>最終対応日</th><th>予定</th><th>実績</th><th>差</th><th>作業精度</th></tr></thead>
          <tbody>{review.taskEntries.map((entry) => {
            const task = taskById.get(entry.taskId);
            const tag = task ? tagById.get(task.projectTagId) : undefined;
            const collapsed = !expandedTaskIds.has(entry.taskId);
            return <Fragment key={entry.id}><tr className={`effort-review-task-row ${entry.reason !== "ready" ? "is-missing" : ""}`}>
              <td><div className="effort-review-task-cell"><button type="button" className={`effort-review-toggle ${collapsed ? "is-collapsed" : ""}`} aria-label={`${entry.taskTitle}の作業を${collapsed ? "表示" : "非表示"}`} aria-expanded={!collapsed} onClick={() => setExpandedTaskIds((current) => { const next = new Set(current); next.has(entry.taskId) ? next.delete(entry.taskId) : next.add(entry.taskId); return next; })}><span className="effort-review-chevron" aria-hidden="true" /></button><button type="button" className="effort-review-task-open" onClick={() => onSelect(entry.taskId)}><span className="effort-review-title-line"><em>タスク</em><strong>{entry.taskTitle}</strong></span><small>{tag && <span>{tag.name}</span>}<b>{entry.measuredScheduleCount}/{entry.scheduleCount}作業を比較</b></small></button></div></td>
              <td>{entry.completedDate}</td><td>{entry.reason === "ready" ? hours(entry.plannedHours) : "—"}</td><td>{entry.reason === "ready" ? hours(entry.actualHours) : "—"}</td>
              <td className={entry.varianceHours > 0 ? "over" : entry.varianceHours < 0 ? "under" : ""}>{entry.reason === "ready" ? signedHours(entry.varianceHours) : "—"}</td>
              <td>{entry.accuracyPercent === null ? <span className="effort-review-unmeasured">未集計</span> : <span className={`effort-review-accuracy ${accuracyTone(entry.accuracyPercent)}`}>{entry.accuracyPercent}%</span>}</td>
            </tr>{!collapsed && entry.schedules.map((work, workIndex) => <tr key={work.id} className={`effort-review-work-row ${workIndex === entry.schedules.length - 1 ? "is-last" : ""} ${work.reason !== "ready" ? "is-missing" : ""}`}>
              <td><button type="button" className="effort-review-work-open" onClick={() => onSelect(work.taskId)}><span className="effort-review-branch" aria-hidden="true" /><div><span className="effort-review-title-line"><em>{work.kind === "daily-work" ? "日別作業" : "完了予定"}</em><strong>{work.scheduleTitle}</strong></span><small>{work.kind === "daily-work" ? "今日のページで対応済み" : "予定全体を完了"}</small></div></button></td>
              <td>{work.completedDate}</td><td>{work.reason === "ready" ? hours(work.plannedHours) : work.plannedHours > 0 ? hours(work.plannedHours) : "—"}</td><td>{work.actualHours > 0 ? hours(work.actualHours) : "—"}</td>
              <td className={work.reason === "ready" ? work.varianceHours > 0 ? "over" : work.varianceHours < 0 ? "under" : "" : ""}>{work.reason === "ready" ? signedHours(work.varianceHours) : "—"}</td>
              <td>{work.accuracyPercent === null ? <span className="effort-review-unmeasured">未集計</span> : <span className={`effort-review-accuracy ${accuracyTone(work.accuracyPercent)}`}>{work.accuracyPercent}%</span>}</td>
            </tr>)}</Fragment>;
          })}</tbody>
        </table></div>}
        </section>
      </div>
    </div>
  </Modal>;
}
