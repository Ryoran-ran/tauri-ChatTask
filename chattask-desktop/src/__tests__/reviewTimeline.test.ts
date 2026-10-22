import { describe, expect, it } from "vitest";
import type { TaskChecklistItem } from "../types";
import { canUndoReviewStatus, reviewEntryItemIds, reviewStatusChanges, setReviewItemStatus, undoReviewStatus } from "../reviewTimeline";
import { normalizeTask } from "../services/storage";

const item = (changes: Partial<TaskChecklistItem> = {}): TaskChecklistItem => ({
  id: "finding-1", title: "境界条件を直す", category: "バグ", details: "", reviewStatus: "pending", completed: false, createdAt: "2026-10-21T00:00:00Z", ...changes,
});

describe("コードレビューの状態履歴", () => {
  it("タイムラインとチェックリストで同じ状態更新を使い、完了情報と除外理由を整える", () => {
    const completed = setReviewItemStatus(item(), "completed", undefined, "2026-10-21T01:00:00Z");
    expect(completed).toMatchObject({ reviewStatus: "completed", completed: true, completedAt: "2026-10-21T01:00:00Z" });
    const ignored = setReviewItemStatus(completed, "ignored", { category: "other", note: " 後で確認 " }, "2026-10-21T02:00:00Z");
    expect(ignored).toMatchObject({ reviewStatus: "ignored", completed: false, completedAt: undefined, ignoredReasonCategory: "other", ignoredReasonNote: "後で確認", ignoredAt: "2026-10-21T02:00:00Z" });
    const reopened = setReviewItemStatus(ignored, "in-progress");
    expect(reopened).toMatchObject({ reviewStatus: "in-progress", completed: false, ignoredReasonCategory: undefined, ignoredReasonNote: undefined, ignoredAt: undefined });
  });
  it("完了への変更を記録し、最新の履歴から元の未対応へ戻す", () => {
    const before = item();
    const after = item({ reviewStatus: "completed", completed: true, completedAt: "2026-10-21T01:00:00Z" });
    const [entry] = reviewStatusChanges([before], [after], "2026-10-21T01:00:00Z");
    expect(entry).toMatchObject({ itemId: before.id, fromStatus: "pending", toStatus: "completed" });
    expect(canUndoReviewStatus(entry, after, [entry])).toBe(true);
    const { restored, reversal } = undoReviewStatus(entry, after, "2026-10-21T02:00:00Z");
    expect(restored).toMatchObject({ reviewStatus: "pending", completed: false, completedAt: undefined });
    expect(reversal).toMatchObject({ fromStatus: "completed", toStatus: "pending", revertsEntryId: entry.id });
    expect(canUndoReviewStatus(entry, restored, [entry, reversal])).toBe(false);
    expect(canUndoReviewStatus(reversal, restored, [entry, reversal])).toBe(false);
  });

  it("過去の履歴や現在の状態と食い違う履歴からは戻せない", () => {
    const first = reviewStatusChanges([item()], [item({ reviewStatus: "in-progress" })])[0];
    const second = reviewStatusChanges([item({ reviewStatus: "in-progress" })], [item({ reviewStatus: "completed", completed: true })])[0];
    expect(canUndoReviewStatus(first, item({ reviewStatus: "completed", completed: true }), [first, second])).toBe(false);
    expect(canUndoReviewStatus(second, item(), [first, second])).toBe(false);
    expect(canUndoReviewStatus(second, undefined, [first, second])).toBe(false);
  });

  it("対応しない判断を戻す際に以前の状態と判断理由を復元する", () => {
    const before = item({ reviewStatus: "ignored", ignoredReasonCategory: "accepted-risk", ignoredReasonNote: "期限を確認", ignoredAt: "2026-10-21T00:30:00Z" });
    const after = item({ reviewStatus: "pending" });
    const [entry] = reviewStatusChanges([before], [after]);
    const { restored } = undoReviewStatus(entry, after);
    expect(restored).toMatchObject({ reviewStatus: "ignored", ignoredReasonCategory: "accepted-risk", ignoredReasonNote: "期限を確認", ignoredAt: "2026-10-21T00:30:00Z" });
    expect(reviewStatusChanges([item()], [item()])).toEqual([]);
  });

  it("複数指摘の記録や返信を保存形式から復元し、旧形式の状態履歴も元に戻せる", () => {
    const before = item();
    const after = item({ reviewStatus: "completed", completed: true });
    const [status] = reviewStatusChanges([before], [after]);
    const task = normalizeTask({ codeReviewTimeline: [
      { ...status, itemIds: undefined, itemTitles: undefined },
      { id: "note-1", kind: "issue", itemId: "finding-1", itemTitle: before.title, itemIds: ["finding-1", "finding-2"], itemTitles: [before.title, "別の指摘"], attachmentIds: ["attachment-1"], text: "再現手順", createdAt: "2026-10-21T01:00:00Z" },
      { id: "reply-1", kind: "reply", parentEntryId: "note-1", itemId: "", itemTitle: "", itemIds: ["finding-1", "finding-2"], itemTitles: [before.title, "別の指摘"], attachmentIds: ["attachment-2"], text: "修正を確認", createdAt: "2026-10-21T02:00:00Z" },
      { id: "general-1", kind: "note", itemId: "", itemTitle: "", text: "全体メモ", createdAt: "2026-10-21T03:00:00Z" },
    ] });
    const timeline = task.codeReviewTimeline || [];
    expect(timeline).toHaveLength(4);
    expect(reviewEntryItemIds(timeline[0])).toEqual(["finding-1"]);
    expect(reviewEntryItemIds(timeline[1])).toEqual(["finding-1", "finding-2"]);
    expect(timeline[1].attachmentIds).toEqual(["attachment-1"]);
    expect(timeline[2]).toMatchObject({ kind: "reply", parentEntryId: "note-1", attachmentIds: ["attachment-2"] });
    expect(reviewEntryItemIds(timeline[3])).toEqual([]);
    expect(canUndoReviewStatus(timeline[0], after, timeline)).toBe(true);
  });
});
