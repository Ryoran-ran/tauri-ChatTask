import type { TaskChecklistItem, TaskCodeReviewTimelineEntry } from "./types";
import { generateId } from "./utils";

export const reviewStatusLabel = {
  pending: "未対応",
  "in-progress": "対応中",
  completed: "対応済み",
  ignored: "対応しない",
} as const;

export const reviewItemStatus = (item: TaskChecklistItem) => item.reviewStatus || (item.completed ? "completed" : "pending");

export function reviewStatusChanges(before: TaskChecklistItem[], after: TaskChecklistItem[], now = new Date().toISOString()): TaskCodeReviewTimelineEntry[] {
  const previous = new Map(before.map((item) => [item.id, item]));
  return after.flatMap((item) => {
    const old = previous.get(item.id);
    if (!old) return [];
    const fromStatus = reviewItemStatus(old);
    const toStatus = reviewItemStatus(item);
    if (fromStatus === toStatus) return [];
    return [{
      id: generateId(), itemId: item.id, itemTitle: item.title, kind: "status" as const,
      text: "", fromStatus, toStatus,
      fromCompletedAt: old.completedAt,
      fromIgnoredReasonCategory: old.ignoredReasonCategory,
      fromIgnoredReasonNote: old.ignoredReasonNote,
      fromIgnoredAt: old.ignoredAt,
      createdAt: now,
    }];
  });
}

export function canUndoReviewStatus(entry: TaskCodeReviewTimelineEntry, item: TaskChecklistItem | undefined, timeline: TaskCodeReviewTimelineEntry[]) {
  if (entry.kind !== "status" || entry.revertsEntryId || !entry.fromStatus || !entry.toStatus || !item || reviewItemStatus(item) !== entry.toStatus) return false;
  return [...timeline].reverse().find((candidate) => candidate.kind === "status" && candidate.itemId === entry.itemId)?.id === entry.id;
}

export function undoReviewStatus(entry: TaskCodeReviewTimelineEntry, item: TaskChecklistItem, now = new Date().toISOString()) {
  if (!entry.fromStatus || !entry.toStatus) throw new Error("状態変更の履歴ではありません。");
  const restored: TaskChecklistItem = {
    ...item,
    reviewStatus: entry.fromStatus,
    completed: entry.fromStatus === "completed",
    completedAt: entry.fromStatus === "completed" ? entry.fromCompletedAt || now : undefined,
    ignoredReasonCategory: entry.fromIgnoredReasonCategory,
    ignoredReasonNote: entry.fromIgnoredReasonNote,
    ignoredAt: entry.fromIgnoredAt,
  };
  const reversal = reviewStatusChanges([item], [restored], now)[0];
  return { restored, reversal: { ...reversal, revertsEntryId: entry.id, text: "タイムラインから元に戻しました。" } };
}
