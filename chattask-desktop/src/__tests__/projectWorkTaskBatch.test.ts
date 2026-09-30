import { describe, expect, it } from "vitest";
import type { ProjectWorkItem } from "../types";
import { createTask } from "../appHelpers";
import { batchRelatedTaskCandidates, effectiveRelatedTaskId, linkedWorkChanges, plannedRangesForRelatedTask, relatedTaskChangesForWork } from "../projectWorkTaskBatch";

const work = (id: string, changes: Partial<ProjectWorkItem> = {}): ProjectWorkItem => ({
  id, milestoneId: "m", title: `作業${id}`, description: "説明", status: "not-started", priority: "A",
  dueDate: "2026-10-10", linkedTaskId: "", plannedHours: 4, actualHours: 0,
  targetWorkStartDate: "2026-10-01", targetWorkEndDate: "2026-10-03", plannedRanges: [],
  sortOrder: 0, createdAt: "created", updatedAt: "updated", ...changes,
});

describe("プロジェクト作業の関連Task一括登録", () => {
  it("個別設定がある作業だけデフォルトの関連Taskを上書きする", () => {
    expect(effectiveRelatedTaskId("a", "default", ["b"], { b: "individual" })).toBe("default");
    expect(effectiveRelatedTaskId("b", "default", ["b"], { b: "individual" })).toBe("individual");
    expect(effectiveRelatedTaskId("b", "default", ["b"], {})).toBe("");
  });

  it("未登録かつ対象マイルストーンの作業だけを候補にする", () => {
    const works = [work("a"), work("b", { milestoneId: "other" }), work("c", { linkedTaskId: "task-c" }), work("d", { title: " " })];
    expect(batchRelatedTaskCandidates(works, "m").map((item) => item.id)).toEqual(["a"]);
    expect(batchRelatedTaskCandidates(works).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("目標期間から関連Task用の予定を作り、作業情報を引き継ぐ", () => {
    const target = work("a");
    const ranges = plannedRangesForRelatedTask(target, () => "range-a");
    const changes = relatedTaskChangesForWork(target, "tag", ranges);
    expect(ranges).toEqual([expect.objectContaining({ id: "range-a", startDate: "2026-10-01", endDate: "2026-10-03", plannedHours: 4 })]);
    expect(changes).toMatchObject({ status: "todo", priority: "A", projectTagId: "tag", dueDate: "2026-10-10", plannedHours: 4 });
    expect(changes.plannedRanges?.[0]).toMatchObject({ sourceType: "project-work", sourceId: "a" });
  });

  it("関連付け後の作業へ予定とベースラインを保存する", () => {
    const target = work("a");
    const ranges = plannedRangesForRelatedTask(target, () => "range-a");
    expect(linkedWorkChanges(target, "task-a", ranges, "now")).toMatchObject({
      linkedTaskId: "task-a", plannedRanges: ranges, baselinePlannedRanges: ranges,
      baselinePlannedHours: 4, linkedTaskScheduleSnapshot: [], linkedTaskPlannedHoursSnapshot: 0, updatedAt: "now",
    });
  });

  it("既存Taskへ関連付ける場合は元の予定と工数を復元用に保持する", () => {
    const target = work("a");
    const ranges = plannedRangesForRelatedTask(target, () => "range-a");
    const task = { ...createTask(), id: "existing", plannedHours: 2, plannedRanges: [{ id: "original", startDate: "2026-09-30", endDate: "2026-09-30", plannedHours: 2 }] };
    expect(linkedWorkChanges(target, task.id, ranges, "now", task)).toMatchObject({
      linkedTaskId: "existing", linkedTaskScheduleSnapshot: task.plannedRanges, linkedTaskPlannedHoursSnapshot: 2,
    });
  });
});
