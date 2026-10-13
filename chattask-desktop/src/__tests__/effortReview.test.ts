import { describe, expect, it } from "vitest";
import { createTask } from "../appHelpers";
import { buildEffortReview } from "../effortReview";

describe("工数振り返り", () => {
  it("対象期間内に完了した予定だけを集計する", () => {
    const task = createTask();
    task.plannedRanges = [
      { id: "included", title: "対象", startDate: "2026-10-10", endDate: "2026-10-10", plannedHours: 2, status: "completed", completedAt: "2026-10-10T12:00:00+09:00" },
      { id: "pending", title: "未完了", startDate: "2026-10-11", endDate: "2026-10-11", plannedHours: 2, status: "in-progress" },
      { id: "old", title: "期間外", startDate: "2026-09-01", endDate: "2026-09-01", plannedHours: 2, status: "completed", completedAt: "2026-09-01T12:00:00+09:00" },
    ];
    task.dailyActualHours = { "2026-10-10::included": 3, "2026-10-11::pending": 4, "2026-09-01::old": 1 };

    const result = buildEffortReview([task], [], 30, "2026-10-14");

    expect(result.entries.map((entry) => entry.scheduleTitle)).toEqual(["対象"]);
    expect(result).toMatchObject({ plannedHours: 2, actualHours: 3, missingPlannedCount: 0, missingActualCount: 0 });
  });

  it("同じ日の別予定の実績を混ぜない", () => {
    const task = createTask();
    task.plannedRanges = [
      { id: "first", title: "1件目", startDate: "2026-10-10", endDate: "2026-10-10", plannedHours: 2, status: "completed", completedAt: "2026-10-10T12:00:00+09:00" },
      { id: "second", title: "2件目", startDate: "2026-10-10", endDate: "2026-10-10", plannedHours: 4, status: "completed", completedAt: "2026-10-10T13:00:00+09:00" },
    ];
    task.dailyActualHours = { "2026-10-10::first": 1, "2026-10-10::second": 5, "2026-10-10": 9 };

    const result = buildEffortReview([task], [], 30, "2026-10-14");

    expect(result.entries.find((entry) => entry.id.endsWith(":first"))?.actualHours).toBe(1);
    expect(result.entries.find((entry) => entry.id.endsWith(":second"))?.actualHours).toBe(5);
  });

  it("未入力を精度から除外して件数を分ける", () => {
    const task = createTask();
    task.plannedRanges = [
      { id: "ready", title: "比較可能", startDate: "2026-10-10", endDate: "2026-10-10", plannedHours: 2, status: "completed" },
      { id: "no-plan", title: "予定なし", startDate: "2026-10-11", endDate: "2026-10-11", status: "completed" },
      { id: "no-actual", title: "実績なし", startDate: "2026-10-12", endDate: "2026-10-12", plannedHours: 3, status: "completed" },
    ];
    task.dailyActualHours = { "2026-10-10::ready": 2, "2026-10-11::no-plan": 1 };

    const result = buildEffortReview([task], [], 30, "2026-10-14");

    expect(result).toMatchObject({ plannedHours: 2, actualHours: 2, missingPlannedCount: 1, missingActualCount: 1 });
    expect(result.accuracy.accuracyPercent).toBe(100);
  });

  it("過大・過小見積もりが相殺されず、絶対差で全体精度を出す", () => {
    const task = createTask();
    task.plannedRanges = [
      { id: "over", title: "超過", startDate: "2026-10-10", endDate: "2026-10-10", plannedHours: 2, status: "completed" },
      { id: "under", title: "予定内", startDate: "2026-10-11", endDate: "2026-10-11", plannedHours: 2, status: "completed" },
    ];
    task.dailyActualHours = { "2026-10-10::over": 3, "2026-10-11::under": 1 };

    const result = buildEffortReview([task], [], 30, "2026-10-14");

    expect(result.actualHours - result.plannedHours).toBe(0);
    expect(result.accuracy.accuracyPercent).toBe(50);
  });
});
