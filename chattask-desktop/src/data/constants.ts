import type { Priority, ProjectTag, TaskFilter, TaskStatus } from "../types";

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "未対応",
  doing: "進行中",
  "waiting-general": "待ち",
  "waiting-client": "先方確認待ち",
  "waiting-team": "チーム確認待ち",
  "waiting-pr": "PR確認待ち",
  recurring: "定期タスク",
  done: "完了",
  cancelled: "中止",
  "handed-over": "引き継ぎ",
  pending: "保留",
};

export const STATUS_GROUPS: { label: string; values: TaskStatus[] }[] = [
  { label: "未着手", values: ["todo"] },
  { label: "進行中", values: ["doing", "recurring"] },
  { label: "待機", values: ["waiting-general", "waiting-client", "waiting-team", "waiting-pr", "pending"] },
  { label: "終了", values: ["done", "cancelled", "handed-over"] },
];

export const TERMINAL_STATUSES: TaskStatus[] = ["done", "cancelled", "handed-over"];
export const isTerminalStatus = (status: TaskStatus) => TERMINAL_STATUSES.includes(status);

export const PRIORITIES: Priority[] = ["A", "B", "C", "D"];

export const FILTERS: { id: TaskFilter; label: string }[] = [
  { id: "all", label: "未完了" },
  { id: "all-with-done", label: "すべて" },
  { id: "today", label: "今日やる" },
  { id: "today-waiting", label: "今日の待ち" },
  { id: "my-turn", label: "進行中" },
  { id: "waiting", label: "待ち" },
  { id: "deadline", label: "期限/リマインドあり" },
  { id: "done", label: "終了済み" },
];

export const DEFAULT_TAGS: ProjectTag[] = [
  { id: "project", name: "案件", visible: true },
  { id: "admin", name: "事務作業", visible: true },
];

export const WAITING_STATUSES: TaskStatus[] = [
  "waiting-general", "waiting-client", "waiting-team", "waiting-pr", "pending",
];
