import { describe, expect, it } from "vitest";
import { createTask } from "../appHelpers";
import { effectiveProjectWorkActualHours, projectItemActual } from "../projectEffort";
import { taskProjectContexts } from "../projectContext";
import type { Goal, PlannedRange, ProjectWorkItem, Task } from "../types";

const range = (id: string, sourceId?: string): PlannedRange => ({
  id,
  startDate: "2026-09-24",
  endDate: "2026-09-26",
  ...(sourceId ? { sourceType: "project-work" as const, sourceId } : {}),
});

const work = (id: string, milestoneId: string, linkedTaskId = "task-1"): ProjectWorkItem => ({
  id,
  milestoneId,
  linkedTaskId,
  title: `作業 ${id}`,
  description: "",
  status: "not-started",
  priority: "B",
  dueDate: "",
  plannedHours: 0,
  actualHours: 9,
  plannedRanges: [range(`${id}-range`)],
  sortOrder: 0,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});

const project = (): Goal => ({
  id: "project-1",
  title: "プロジェクト",
  description: "",
  successCriteria: "",
  dueDate: "",
  status: "in-progress",
  projectTagId: "",
  taskIds: ["task-1"],
  originTaskId: "task-1",
  milestones: [
    { id: "milestone-1", title: "工程1", completed: false, taskIds: [], linkedTaskId: "task-1" },
    { id: "milestone-2", title: "工程2", completed: false, taskIds: ["task-1"] },
  ],
  workItems: [work("work-1", "milestone-1"), work("work-2", "")],
  reviews: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});

const linkedTask = (changes: Partial<Task> = {}): Task => ({
  ...createTask(),
  id: "task-1",
  plannedRanges: [range("task-range", "work-1")],
  dailyActualHours: {},
  ...changes,
});

describe("プロジェクト関連情報", () => {
  it("起点タスクでも同じプロジェクト内の全関連先を返す", () => {
    const contexts = taskProjectContexts([project()], "task-1");

    expect(contexts.map((context) => context.id)).toEqual([
      "origin:project-1",
      "milestone:project-1:milestone-1",
      "milestone:project-1:milestone-2",
      "work:project-1:work-1",
      "work:project-1:work-2",
      "direct:project-1:task-1",
    ]);
    expect(new Set(contexts.map((context) => context.id)).size).toBe(contexts.length);
  });

  it("複数の作業をそれぞれ異なる関連情報として返す", () => {
    const locations = taskProjectContexts([project()], "task-1")
      .filter((context) => context.id.startsWith("work:"))
      .map((context) => context.location);

    expect(locations).toEqual([
      "マイルストーン「工程1」／作業項目「作業 work-1」",
      "プロジェクト直属／作業項目「作業 work-2」",
    ]);
  });
});

describe("プロジェクト作業の実績工数", () => {
  it("関連タスクの日別実績を予定IDと日付から集計する", () => {
    const item = work("work-1", "milestone-1");
    const task = linkedTask({
      dailyActualHours: {
        "2026-09-24::task-range": 1.5,
        "2026-09-25::work-1-range": 2,
        "2026-09-26": 0.5,
        "2026-09-24::unrelated-range": 7,
      },
    });

    expect(projectItemActual(task, item, "project-work")).toEqual({
      start: "2026-09-24",
      end: "2026-09-26",
      dates: ["2026-09-24", "2026-09-25", "2026-09-26"],
      hours: 4,
    });
  });

  it("最新の日別実績が0時間なら古い保存値を表示しない", () => {
    const item = work("work-1", "milestone-1");

    expect(effectiveProjectWorkActualHours(item, linkedTask())).toBe(0);
  });

  it("関連タスクが存在しない場合だけ保存値を互換表示する", () => {
    const item = work("work-1", "milestone-1");

    expect(effectiveProjectWorkActualHours(item, undefined)).toBe(9);
  });
});
