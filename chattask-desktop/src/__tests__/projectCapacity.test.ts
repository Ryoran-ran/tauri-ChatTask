import { describe, expect, it } from "vitest";
import { assessProjectWorkCapacity } from "../projectCapacity";
import type { Goal, GoalMilestone, ProjectWorkItem } from "../types";

const milestone = (changes: Partial<GoalMilestone> = {}): GoalMilestone => ({
  id: "milestone-1", title: "公開", completed: false, taskIds: [], status: "not-started", ...changes,
});

const work = (id: string, hours: number, changes: Partial<ProjectWorkItem> = {}): ProjectWorkItem => ({
  id, milestoneId: "milestone-1", title: id, description: "", status: "not-started", priority: "B",
  dueDate: "", linkedTaskId: "", plannedHours: hours, actualHours: 0, sortOrder: 0,
  targetWorkStartDate: "2026-09-28", targetWorkEndDate: "2026-10-02",
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", ...changes,
});

const project = (id: string, milestones: GoalMilestone[], workItems: ProjectWorkItem[]): Goal => ({
  id, title: id, description: "", successCriteria: "", dueDate: "", status: "in-progress",
  projectTagId: "", taskIds: [], milestones, reviews: [], workItems,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
});

describe("assessProjectWorkCapacity", () => {
  it("作業の目標期間について営業日と1日の計画可能時間から実行可能性を判定する", () => {
    const target = work("build", 24);
    const current = project("project-1", [milestone()], [target]);
    const result = assessProjectWorkCapacity({ projectId: current.id, work: target, deadline: "2026-10-02", projects: [current], periods: [], dailyCapacityHours: 6 });
    expect(result.workingDates).toHaveLength(5);
    expect(result.grossCapacityHours).toBe(30);
    expect(result.availableHours).toBe(30);
    expect(result.requiredHours).toBe(24);
    expect(result.status).toBe("feasible");
  });

  it("休暇と他Projectの作業工数を利用可能時間から差し引く", () => {
    const target = work("target-work", 20);
    const current = project("project-1", [milestone()], [target]);
    const competitor = work("other-work", 16, { milestoneId: "milestone-2" });
    const other = project("project-2", [milestone({ id: "milestone-2" })], [competitor]);
    const result = assessProjectWorkCapacity({
      projectId: current.id,
      work: target,
      deadline: "2026-10-02",
      projects: [current, other],
      periods: [{ id: "leave", startDate: "2026-09-30", endDate: "2026-09-30", type: "vacation" }],
      dailyCapacityHours: 6,
    });
    expect(result.workingDates).toHaveLength(4);
    expect(result.grossCapacityHours).toBe(24);
    expect(result.competingHours).toBe(16);
    expect(result.availableHours).toBe(8);
    expect(result.shortageHours).toBe(12);
    expect(result.status).toBe("over");
  });

  it("完了済み作業を除外し、工数未入力と期限超過を報告する", () => {
    const completed = work("done", 10, { status: "done" });
    const current = project("project-1", [milestone()], [completed]);
    const completedResult = assessProjectWorkCapacity({ projectId: current.id, work: completed, deadline: "2026-10-01", projects: [current], periods: [], dailyCapacityHours: 6 });
    expect(completedResult.requiredHours).toBe(0);
    expect(completedResult.status).toBe("completed");
    expect(completedResult.exceedsDeadline).toBe(true);

    const unknown = work("unknown", 0);
    const unknownProject = project("project-2", [milestone()], [unknown]);
    const unknownResult = assessProjectWorkCapacity({ projectId: unknownProject.id, work: unknown, deadline: "", projects: [unknownProject], periods: [], dailyCapacityHours: 6 });
    expect(unknownResult.missingEstimateCount).toBe(1);
  });
});
