import { STATUS_LABELS, WAITING_STATUSES, isTerminalStatus } from "../data/constants";
import type { TaskProjectContext } from "../projectContext";
import type { NonWorkingPeriod, ProjectTag, Task } from "../types";
import { TagIcon } from "./TagIcon";
import { hasIncompletePlanForDate, isRecurringDue, localDateValue, recurrenceLabel, todayValue } from "../utils";

type QuickAction = "doing" | "waiting" | "done" | "today" | "tomorrow" | "log";

interface Props {
  task: Task;
  tag?: ProjectTag;
  projectContexts: TaskProjectContext[];
  completedProjectWorkIds: ReadonlySet<string>;
  periods: NonWorkingPeriod[];
  hasTodayDescendant: boolean;
  selected: boolean;
  childCount: number;
  completedChildren: number;
  depth: number;
  isLastChild: boolean;
  ancestorContinuationDepths: number[];
  collapsed: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onQuick: (action: QuickAction) => void;
  onOpenProject: (id: string) => void;
  onSaveTemplate: () => void;
}

export function TaskCard({ task, tag, projectContexts, completedProjectWorkIds, periods, hasTodayDescendant, selected, childCount, completedChildren, depth, isLastChild, ancestorContinuationDepths, collapsed, onSelect, onToggle, onOpenProject }: Props) {
  const today = todayValue();
  const waiting = WAITING_STATUSES.includes(task.status);
  const waitingReviewDue = Boolean(waiting && task.waitingFollowUp?.reviewDate && task.waitingFollowUp.reviewDate <= today);
  const visualStatus = waiting ? "waiting" : task.status === "doing" ? "doing" : task.status === "done" ? "done" : task.status === "cancelled" || task.status === "pending" ? "paused" : task.status === "handed-over" ? "handed-over" : task.status === "recurring" ? "recurring" : "todo";
  const statusIcon = visualStatus === "doing" ? <path d="M9 5.5l8 6.5-8 6.5z" />
    : visualStatus === "waiting" ? <><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></>
    : visualStatus === "recurring" ? <><path d="M18 8a7 7 0 0 0-12-2L4 8" /><path d="M4 4v4h4M6 16a7 7 0 0 0 12 2l2-2M20 20v-4h-4" /></>
    : visualStatus === "paused" ? <><path d="M9 7v10M15 7v10" /></>
    : visualStatus === "done" ? <path d="M5 12l4 4L19 7" />
    : visualStatus === "handed-over" ? <><path d="M5 12h13M14 8l4 4-4 4" /></>
    : <circle cx="12" cy="12" r="7" />;
  const isToday = !isTerminalStatus(task.status) && (hasIncompletePlanForDate(task, today, completedProjectWorkIds) || isRecurringDue(task, today, periods));
  const range = task.plannedRanges.find((item) => item.endDate >= today) || task.plannedRanges[task.plannedRanges.length - 1];
  const deadline = (() => {
    if (!task.reminderDate || isTerminalStatus(task.status)) return null;
    const deadlineDate = new Date(`${task.reminderDate}T00:00:00Z`);
    const todayDate = new Date(`${today}T00:00:00Z`);
    const days = Math.round((deadlineDate.getTime() - todayDate.getTime()) / 86_400_000);
    if (days < 0) return { className: "overdue", label: `${Math.abs(days)}日超過` };
    if (days === 0) return { className: "today", label: "今日" };
    if (days <= 3) return { className: "soon", label: `あと${days}日` };
    if (days <= 7) return { className: "near", label: `あと${days}日` };
    return null;
  })();

  return (
    <article data-task-id={task.id} data-task-depth={depth} className={`task-card task-card-status-${visualStatus} ${depth > 0 ? "task-card-child" : ""} ${isLastChild ? "task-card-last-child" : ""} ${selected ? "selected" : ""} ${isTerminalStatus(task.status) ? "completed" : ""} ${deadline?.className === "overdue" ? "has-overdue-deadline" : ""}`} title={`ステータス：${STATUS_LABELS[task.status]}${deadline?.className === "overdue" ? `／期限 ${deadline.label}` : ""}`} style={{ marginLeft: Math.min(depth, 3) * 14 }} onClick={onSelect}>
      {ancestorContinuationDepths.map((ancestorDepth) => <span key={ancestorDepth} className="task-tree-ancestor-line" aria-hidden="true" style={{ left: -8 - (depth - ancestorDepth) * 14 }} />)}
      {waitingReviewDue && <span className="task-waiting-review-dot" role="img" aria-label="今日確認する待ちタスク" title={`今日確認する（確認日：${task.waitingFollowUp?.reviewDate}）`} />}
      <div className="task-card-row">
        {childCount > 0 ? <button className={`collapse-button ${hasTodayDescendant ? "has-today-descendant" : ""}`} title={hasTodayDescendant ? "配下の子タスクに今日の予定があります" : undefined} aria-label={`${collapsed ? "子タスクを開く" : "子タスクを閉じる"}${hasTodayDescendant ? "。配下に今日の予定があります" : ""}`} onClick={(event) => { event.stopPropagation(); onToggle(); }}><span>{collapsed ? "▶" : "▼"}</span>{hasTodayDescendant && <i aria-hidden="true" />}</button> : <span className="collapse-spacer" />}
        <span className="task-priority-wrap"><span className={`priority priority-${task.priority}`}>{task.priority}</span>{isToday && <i className="task-today-dot" role="img" aria-label="今日の予定" title="今日の予定" />}</span>
        {projectContexts.length > 0 && <span className="task-relation-marks">
          {[...projectContexts].sort((a, b) => Number(a.kind === "origin") - Number(b.kind === "origin")).map((context) => <button key={`${context.projectId}-${context.kind}`} type="button" className={`task-project-mark ${context.kind}`} title={`${context.kind === "origin" ? "プロジェクトへ昇華済み" : "関連プロジェクトあり"}\n${context.projectTitle}\n${context.location}`} aria-label={`${context.projectTitle}を開く`} onClick={(event) => { event.stopPropagation(); onOpenProject(context.projectId); }}>{context.kind === "origin" ? "P" : "↗"}</button>)}
        </span>}
        <strong className="task-card-title">{task.title || "無題のタスク"}</strong>
        {deadline && <div className="task-card-state"><span className={`deadline-badge deadline-${deadline.className}`}>{deadline.label}</span></div>}
        <span className={`task-status-mark ${visualStatus}`} role="img" aria-label={STATUS_LABELS[task.status]} title={`ステータス：${STATUS_LABELS[task.status]}`}><svg viewBox="0 0 24 24" aria-hidden="true">{statusIcon}</svg></span>
      </div>
      <div className="task-meta">
        <span className={`status status-${task.status}`}>{STATUS_LABELS[task.status]}</span>
        {tag && <span className="tag-chip tag-chip-colored" style={{ borderColor: `${tag.color || "#64748b"}55`, backgroundColor: `${tag.color || "#64748b"}18`, color: tag.color || "#64748b" }}><TagIcon tag={tag} className="tag-chip-icon" />{tag.name}</span>}
        {childCount > 0 && <span>子 {completedChildren}/{childCount}</span>}
        {range && <span>予定 {range.startDate.slice(5).replace("-", "/")}{range.endDate !== range.startDate ? `〜${range.endDate.slice(5).replace("-", "/")}` : ""}</span>}
        {task.status === "recurring" && <span>{task.recurrence?.paused ? "停止中 " : ""}{recurrenceLabel(task)}</span>}
      </div>
      <div className="task-card-footer">
        <time className="updated-date">{localDateValue(task.updatedAt).replace(/-/g, "/")} 更新</time>
      </div>
    </article>
  );
}
