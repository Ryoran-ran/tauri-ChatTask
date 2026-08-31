import { useMemo, useState } from "react";
import { STATUS_LABELS, WAITING_STATUSES, isTerminalStatus } from "../data/constants";
import type { ProjectTag, Task } from "../types";
import { todayValue } from "../utils";
import { Modal } from "./Modal";
import { TagIcon } from "./TagIcon";

export type NotificationCategory = "deadline" | "waiting" | "effort";
export interface AppNotification {
  id: string;
  category: NotificationCategory;
  level: "danger" | "warning" | "info";
  task: Task;
  title: string;
  detail: string;
  sortKey: string;
}

const dayDifference = (from: string, to: string) => Math.floor((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
const taskPlannedHours = (task: Task) => {
  const scheduled = task.plannedRanges.reduce((sum, range) => sum + (Number(range.plannedHours) || 0), 0);
  if (scheduled > 0) return scheduled;
  return Number(task.plannedHours) || 0;
};
const hours = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}h`;
const taskActualHours = (task: Task) => {
  const daily = Object.values(task.dailyActualHours || {});
  return daily.length
    ? daily.reduce((sum, value) => sum + (Number(value) || 0), 0)
    : Number(task.actualHours) || 0;
};

export const buildNotifications = (tasks: Task[]): AppNotification[] => {
  const today = todayValue();
  return tasks.flatMap((task) => {
    if (isTerminalStatus(task.status)) return [];
    const notices: AppNotification[] = [];
    if (task.reminderDate && task.reminderDate < today) {
      const days = dayDifference(task.reminderDate, today);
      notices.push({ id: `${task.id}-overdue`, category: "deadline", level: "danger", task, title: `期限を${days}日超過`, detail: `期限 ${task.reminderDate.replace(/-/g, "/")}`, sortKey: `0-${task.reminderDate}` });
    } else if (task.reminderDate === today) {
      notices.push({ id: `${task.id}-today`, category: "deadline", level: "warning", task, title: "今日が期限", detail: `期限 ${today.replace(/-/g, "/")}`, sortKey: `1-${task.title}` });
    }
    // 「保留」は再開時期が未定の意図的な停止状態のため、
    // 更新がないことを催促する長期待ち通知の対象にしない。
    if (task.status !== "pending" && WAITING_STATUSES.includes(task.status)) {
      const updatedDate = task.updatedAt.slice(0, 10);
      const days = dayDifference(updatedDate, today);
      if (days >= 3) notices.push({ id: `${task.id}-waiting`, category: "waiting", level: days >= 7 ? "danger" : "warning", task, title: `待ち状態が${days}日継続`, detail: `${STATUS_LABELS[task.status]}・最終更新 ${updatedDate.replace(/-/g, "/")}`, sortKey: `2-${String(9999 - days).padStart(4, "0")}` });
    }
    // A recurring task's planned hours represent one occurrence, while its actual
    // hours are accumulated across occurrences. Comparing those totals would make
    // regular meetings look overdue after their second run, so only ordinary tasks
    // participate in the cumulative effort-overrun notification.
    if (task.status !== "recurring" && task.taskKind !== "recurring") {
      const planned = taskPlannedHours(task);
      const actual = taskActualHours(task);
      if (planned > 0 && actual > planned) notices.push({ id: `${task.id}-effort`, category: "effort", level: actual >= planned * 1.25 ? "danger" : "warning", task, title: "予定工数を超過", detail: `予定 ${hours(planned)} / 実績 ${hours(actual)}（＋${hours(actual - planned)}）`, sortKey: `3-${String(999999 - Math.round((actual - planned) * 100)).padStart(6, "0")}` });
    }
    return notices;
  }).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
};

export function NotificationsModal({ tasks, tags, onSelect, onClose }: { tasks: Task[]; tags: ProjectTag[]; onSelect: (task: Task) => void; onClose: () => void }) {
  const [filter, setFilter] = useState<"all" | NotificationCategory>("all");
  const notices = useMemo(() => buildNotifications(tasks), [tasks]);
  const visible = filter === "all" ? notices : notices.filter((notice) => notice.category === filter);
  const count = (category: NotificationCategory) => notices.filter((notice) => notice.category === category).length;
  return <Modal title="通知センター" onClose={onClose} wide>
    <div className="notification-center">
      <div className="notification-summary">
        <div className={count("deadline") ? "has-alert" : ""}><span>期限</span><strong>{count("deadline")}</strong><small>件</small></div>
        <div className={count("waiting") ? "has-warning" : ""}><span>長期の待ち</span><strong>{count("waiting")}</strong><small>件</small></div>
        <div className={count("effort") ? "has-warning" : ""}><span>工数超過</span><strong>{count("effort")}</strong><small>件</small></div>
      </div>
      <div className="notification-filters" aria-label="通知の絞り込み">
        {([["all", "すべて", notices.length], ["deadline", "期限", count("deadline")], ["waiting", "待ち", count("waiting")], ["effort", "工数", count("effort")]] as const).map(([id, label, total]) => <button type="button" className={filter === id ? "active" : ""} key={id} onClick={() => setFilter(id)}>{label}<small>{total}</small></button>)}
      </div>
      <div className="notification-list">
        {visible.map((notice) => {
          const tag = tags.find((item) => item.id === notice.task.projectTagId);
          return <button type="button" className={`notification-item level-${notice.level}`} key={notice.id} onClick={() => { onSelect(notice.task); onClose(); }}>
            <span className="notification-mark">{notice.category === "deadline" ? "!" : notice.category === "waiting" ? "…" : "h"}</span>
            <span className="notification-content"><strong>{notice.title}</strong><b>{notice.task.title}</b><small>{notice.detail}</small></span>
            {tag && <span className="notification-tag"><TagIcon tag={tag} />{tag.name}</span>}
            <span className="notification-open">開く ›</span>
          </button>;
        })}
        {!visible.length && <div className="notification-empty"><span>✓</span><strong>該当する通知はありません</strong><small>期限、待ち状態、予定工数をもとに自動で表示します。</small></div>}
      </div>
      <p className="notification-rule-note">長期の待ちは、待ち状態のタスクが最終更新から3日以上経過した場合に表示します。保留中のタスクは対象外です。定期タスクの予定工数は1回あたりの目安のため、工数超過通知の対象外です。</p>
    </div>
  </Modal>;
}
