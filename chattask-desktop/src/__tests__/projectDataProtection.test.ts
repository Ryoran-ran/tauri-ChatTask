import { describe, expect, it } from "vitest";
import { createTask, repairDuplicateProjectSchedules } from "../appHelpers";
import {
  changedProjectFields,
  deleteProjectReferences,
  effectiveProjectChanges,
  ganttProjectWorkItems,
  releaseProjectSchedulesFromTask,
  standaloneTaskScheduleSnapshot,
  syncProjectScheduleOnTask,
} from "../projectDataProtection";
import { checkAppDataIntegrity } from "../services/integrityCheck";
import { normalizeTask, parseImportedData } from "../services/storage";
import type { AppData, Goal, PlannedRange, ProjectWorkItem, Task } from "../types";

const range = (id: string, changes: Partial<PlannedRange> = {}): PlannedRange => ({
  id,
  startDate: "2026-09-25",
  endDate: "2026-09-25",
  title: "同じ予定",
  plannedHours: 2,
  status: "not-started",
  ...changes,
});

const task = (changes: Partial<Task> = {}): Task => ({
  ...createTask(),
  id: "task-1",
  title: "テスト",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...changes,
});

const work = (id: string, plannedRanges: PlannedRange[] = [range(`${id}-range`)]): ProjectWorkItem => ({
  id,
  milestoneId: "",
  linkedTaskId: "task-1",
  title: `作業 ${id}`,
  description: "",
  status: "not-started",
  priority: "B",
  dueDate: "",
  plannedHours: 2,
  actualHours: 0,
  plannedRanges,
  sortOrder: 0,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});

const goal = (changes: Partial<Goal> = {}): Goal => ({
  id: "project-1",
  title: "プロジェクト",
  description: "",
  successCriteria: "",
  dueDate: "",
  status: "in-progress",
  projectTagId: "",
  taskIds: [],
  milestones: [],
  workItems: [],
  reviews: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...changes,
});

const appData = (changes: Partial<AppData> = {}): AppData => ({
  version: 17,
  workspaceMode: "work",
  organizationSeed: 1,
  tasks: [],
  projectTags: [],
  activityLog: [],
  dailyNotes: {},
  dailyFinalizedAt: {},
  nonWorkingPeriods: [],
  userProfile: { displayName: "テスト", avatarUpdatedAt: "" },
  goals: [],
  issues: [],
  inboxItems: [],
  todayTaskOrders: {},
  localTools: [],
  localToolsStoragePath: "",
  habits: [],
  ...changes,
});

describe("プロジェクトデータ保全", () => {
  it("同じ日付の通常記録と予定別記録を正規化で上書きしない", () => {
    const source = task({
      plannedRanges: [range("range-1")],
      dailyPlans: { "2026-09-25": "通常", "2026-09-25::range-1": "予定別" },
      dailyPlanCompleted: { "2026-09-25": false, "2026-09-25::range-1": true },
      dailyPlanStatuses: { "2026-09-25": "todo", "2026-09-25::range-1": "doing" },
      dailyActualHours: { "2026-09-25": 1, "2026-09-25::range-1": 2 },
    });
    const normalized = normalizeTask({ ...source });

    expect(normalized.dailyPlans).toEqual({ "2026-09-25": "通常", "2026-09-25::range-1": "予定別" });
    expect(normalized.dailyPlanCompleted).toEqual({ "2026-09-25": false, "2026-09-25::range-1": true });
    expect(normalized.dailyPlanStatuses).toEqual({ "2026-09-25": "todo", "2026-09-25::range-1": "doing" });
    expect(normalized.dailyActualHours).toEqual({ "2026-09-25": 1, "2026-09-25::range-1": 2 });
  });

  it("予定をプロジェクトへ移しても衝突する日別記録を両方残す", () => {
    const original = task({
      plannedRanges: [range("range-1")],
      dailyPlans: { "2026-09-25": "通常", "2026-09-25::range-1": "予定別" },
      dailyActualHours: { "2026-09-25": 1, "2026-09-25::range-1": 2 },
    });
    const changes = syncProjectScheduleOnTask(original, [range("range-1")], "project-work", "work-1");

    expect(changes?.dailyPlans).toEqual({ "2026-09-25": "通常", "2026-09-25::range-1": "予定別" });
    expect(changes?.dailyActualHours).toEqual({ "2026-09-25": 1, "2026-09-25::range-1": 2 });
    expect(original.plannedRanges[0].sourceId).toBeUndefined();
  });

  it("同じsourceIdでも別種のプロジェクト予定を上書きしない", () => {
    const milestoneRange = range("milestone-range", { sourceType: "project-milestone", sourceId: "shared-id" });
    const original = task({ plannedRanges: [milestoneRange] });
    const changes = syncProjectScheduleOnTask(
      original,
      [range("work-range")],
      "project-work",
      "shared-id",
    );

    expect(changes?.plannedRanges).toEqual([
      milestoneRange,
      range("work-range", { sourceType: "project-work", sourceId: "shared-id" }),
    ]);
  });

  it("関連付け前のTask予定スナップショットには通常予定だけを複製する", () => {
    const ordinary = range("ordinary");
    const managed = range("managed", { sourceType: "project-work", sourceId: "work-1" });
    const original = task({ plannedRanges: [ordinary, managed] });
    const snapshot = standaloneTaskScheduleSnapshot(original);

    expect(snapshot).toEqual([ordinary]);
    expect(snapshot[0]).not.toBe(ordinary);
  });

  it("同じタスクに紐づく複数作業を一括解除し、無関係な予定と全記録を残す", () => {
    const original = task({
      plannedRanges: [
        range("range-1", { sourceType: "project-work", sourceId: "work-1" }),
        range("range-2", { sourceType: "project-work", sourceId: "work-2" }),
        range("unrelated", { startDate: "2026-09-26", endDate: "2026-09-26" }),
      ],
      dailyActualHours: {
        "2026-09-25": 1,
        "2026-09-25::range-1": 2,
        "2026-09-25::range-2": 3,
        "2026-09-26::unrelated": 4,
      },
    });
    const changes = releaseProjectSchedulesFromTask(original, [
      { sourceType: "project-work", sourceId: "work-1", snapshot: [range("range-1")] },
      { sourceType: "project-work", sourceId: "work-2", snapshot: [range("range-2")] },
    ]);

    expect(changes?.plannedRanges).toHaveLength(3);
    expect(changes?.plannedRanges?.filter((item) => item.sourceId)).toHaveLength(0);
    expect(changes?.dailyActualHours).toEqual({
      "2026-09-25": 1,
      "2026-09-25::range-1": 2,
      "2026-09-25::range-2": 3,
      "2026-09-26::unrelated": 4,
    });
  });

  it("内容が同じでもIDが異なる通常予定とプロジェクト予定を削除しない", () => {
    const projectRange = range("project-range", { sourceType: "project-work", sourceId: "work-1" });
    const data = appData({
      goals: [goal({ workItems: [work("work-1", [projectRange])] })],
      tasks: [task({ plannedRanges: [range("ordinary-range"), projectRange] })],
    });

    const repaired = repairDuplicateProjectSchedules(data);
    expect(repaired.tasks[0].plannedRanges.map((item) => item.id)).toEqual(["ordinary-range", "project-range"]);
  });

  it("複数予定を持つ旧作業の分割時に各予定のsourceIdを更新する", () => {
    const first = range("range-1", { sourceType: "project-work", sourceId: "work-1" });
    const second = range("range-2", { sourceType: "project-work", sourceId: "work-1", startDate: "2026-09-26", endDate: "2026-09-26" });
    const data = appData({
      goals: [goal({ workItems: [work("work-1", [first, second])] })],
      tasks: [task({ plannedRanges: [first, second] })],
    });

    const repaired = repairDuplicateProjectSchedules(data);
    expect(repaired.goals[0].workItems?.map((item) => item.id)).toEqual(["work-1", "work-1:range-2"]);
    expect(repaired.tasks[0].plannedRanges.map((item) => item.sourceId)).toEqual(["work-1", "work-1:range-2"]);
  });

  it("プロジェクト直属作業をガント対象に含め、整合性エラーにしない", () => {
    const directWork = work("direct-work");
    const project = goal({ workItems: [directWork] });
    const data = appData({ goals: [project], tasks: [task()] });

    expect(ganttProjectWorkItems(project)).toEqual([directWork]);
    expect(checkAppDataIntegrity(data).issues.filter((issue) => issue.target.includes("direct-work"))).toEqual([]);
  });

  it("画面の古い全件スナップショットではなく編集した項目だけを更新する", () => {
    const opened = goal({ description: "画面を開いた時点" });
    const draft = { ...opened, title: "変更後の名前" };
    const externallyUpdated = { ...opened, description: "別処理による最新値" };
    const requested = changedProjectFields(opened, draft);
    const changes = effectiveProjectChanges(externallyUpdated, requested);

    expect(changes).toEqual({ title: "変更後の名前" });
    expect({ ...externallyUpdated, ...changes }).toMatchObject({
      title: "変更後の名前",
      description: "別処理による最新値",
    });
    expect(changedProjectFields(opened, structuredClone(opened))).toEqual({});
  });

  it("プロジェクト削除時に習慣参照を解除し、無関係なデータを変更しない", () => {
    const data = appData({
      goals: [goal(), goal({ id: "project-2", title: "残す" })],
      habits: [
        { id: "habit-1", title: "解除対象", projectId: "project-1", updatedAt: "old" },
        { id: "habit-2", title: "そのまま", projectId: "project-2", updatedAt: "old" },
      ] as AppData["habits"],
      dailyNotes: { "2026-09-25": "保持" },
    });

    const next = deleteProjectReferences(data, "project-1");
    expect(next.goals.map((item) => item.id)).toEqual(["project-2"]);
    expect(next.habits[0].projectId).toBe("");
    expect(next.habits[1]).toEqual(data.habits[1]);
    expect(next.dailyNotes).toBe(data.dailyNotes);
  });

  it("エクスポート相当のJSONを再読込しても主要データが安定する", () => {
    const original = appData({
      tasks: [task({ plannedRanges: [range("range-1")], dailyActualHours: { "2026-09-25::range-1": 2 } })],
      goals: [goal({ workItems: [work("work-1")] })],
      dailyNotes: { "2026-09-25": "保持するメモ" },
    });
    const first = parseImportedData(JSON.stringify(original));
    const second = parseImportedData(JSON.stringify(first));

    expect(second).toEqual(first);
  });
});
