import { describe, expect, it } from "vitest";
import type { TaskChecklistItem } from "../types";
import { canUndoReviewStatus, reviewStatusChanges, undoReviewStatus } from "../reviewTimeline";

const item = (changes: Partial<TaskChecklistItem> = {}): TaskChecklistItem => ({
  id: "finding-1", title: "境界条件を直す", category: "バグ", details: "", reviewStatus: "pending", completed: false, createdAt: "2026-10-21T00:00:00Z", ...changes,
});

describe("コードレビューの状態履歴", () => {
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
});
