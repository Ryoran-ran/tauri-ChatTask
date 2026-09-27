import { describe, expect, it } from "vitest";
import { migrateLegacyMilestoneData, migrateLegacyMilestoneProject } from "../projectLegacyMigration";
import { mergeProjectEdit } from "../projectEditMerge";
import { buildProjectWorkEditChanges } from "../projectWorkEditing";
import { createTask, repairDuplicateProjectSchedules } from "../appHelpers";
import { parseImportedData } from "../services/storage";
import { applyScheduleCommand, scheduleChangesForStorage } from "../projectScheduleHistory";
import type { Goal } from "../types";

const legacy = (): Goal => ({ id: "p", title: "旧プロジェクト", description: "", successCriteria: "", dueDate: "", status: "in-progress", projectTagId: "", taskIds: [], priority: "A", reviews: [], workItems: [], createdAt: "2026-09-01", updatedAt: "2026-09-20",
  milestones: [{ id: "m", title: "到達点", description: "完了条件", completed: false, status: "in-progress", taskIds: ["t"], linkedTaskId: "t", dueDate: "2026-09-30", targetWorkStartDate: "", targetWorkEndDate: "",
    plannedRanges: [{ id: "r", title: "旧作業", startDate: "2026-09-21", endDate: "2026-09-23", plannedHours: 3, note: "残すメモ" }],
    baselinePlannedRanges: [{ id: "r", startDate: "2026-09-20", endDate: "2026-09-21", plannedHours: 2 }], replanReason: "日程調整", replannedAt: "2026-09-20" }] });
const data = () => parseImportedData(JSON.stringify({ tasks: [{ ...createTask(), id: "t", plannedRanges: [{ ...legacy().milestones[0].plannedRanges![0], sourceType: "project-milestone", sourceId: "m" }, { id: "ordinary", title: "通常予定", startDate: "2026-10-01", endDate: "2026-10-01", plannedHours: 4 }], dailyActualHours: { "2026-09-21::r": 1.5 }, dailyPlans: { "2026-09-21::r": "メモ" }, plannedHours: 7 }], goals: [legacy()], organizationSeed: 1, projectDailyCapacityHours: 6 }));

describe("旧マイルストーン予定の永続作業への移行", () => {
  it("旧形式を直接編集保存しても名称・工数・日付が再読み込み後に残る（消失回帰）", () => {
    const raw = legacy();
    const view = migrateLegacyMilestoneProject(raw).project;
    const initial = view.workItems![0];
    const draft = { ...initial, title: "編集した作業", plannedHours: 5, plannedRanges: initial.plannedRanges!.map(range => ({ ...range, startDate: "2026-09-22", plannedHours: 5 })) };
    const changes = buildProjectWorkEditChanges(initial, draft, "now");
    const saved = mergeProjectEdit(raw, { workItems: view.workItems!.map(work => ({ ...work, ...changes })) }, { before: view });
    const reopened = migrateLegacyMilestoneProject(JSON.parse(JSON.stringify(saved))).project;
    expect(reopened.workItems).toHaveLength(1);
    expect(reopened.workItems![0]).toMatchObject({ id: initial.id, title: "編集した作業", plannedHours: 5, priority: "A", dueDate: "2026-09-30" });
    expect(reopened.workItems![0].plannedRanges![0].startDate).toBe("2026-09-22");
    expect(reopened.milestones[0].plannedRanges).toEqual([]);
    expect(raw.workItems).toEqual([]);
    expect(raw.milestones[0].plannedRanges![0].plannedHours).toBe(3);
  });
  it("同じ旧データのIDは安定し、繰り返し読み込んでも作業が増えない", () => {
    const raw = legacy();
    const first = migrateLegacyMilestoneProject(raw).project;
    expect(migrateLegacyMilestoneProject(raw).project).toEqual(first);
    let next = first;
    for (let i = 0; i < 20; i++) next = migrateLegacyMilestoneProject(JSON.parse(JSON.stringify(next))).project;
    expect(next).toEqual(first);
    expect(migrateLegacyMilestoneProject(first).project).toBe(first);
  });
  it("説明だけの保存では旧日付・工数・目標期間を変えない", () => {
    const raw = legacy(), view = migrateLegacyMilestoneProject(raw).project;
    const saved = mergeProjectEdit(raw, { workItems: view.workItems!.map(work => ({ ...work, description: "変更" })) }, { before: view });
    expect(saved.workItems![0]).toEqual({ ...view.workItems![0], description: "変更" });
    expect(saved.milestones[0]).toMatchObject({ targetWorkStartDate: "", targetWorkEndDate: "" });
  });
  it("変換された作業の削除・目標期間クリアは再読込でも復活しない", () => {
    const raw = legacy(), before = migrateLegacyMilestoneProject(raw).project;
    const cleared = mergeProjectEdit(raw, { workItems: before.workItems!.map(work => ({ ...work, targetWorkStartDate: "", targetWorkEndDate: "" })) }, { before });
    expect(migrateLegacyMilestoneProject(cleared).project.workItems![0].targetWorkStartDate).toBe("");
    const removed = mergeProjectEdit(cleared, { workItems: [] }, { before: cleared, deletedWorkIds: [cleared.workItems![0].id] });
    expect(migrateLegacyMilestoneProject(JSON.parse(JSON.stringify(removed))).project.workItems).toEqual([]);
    expect(mergeProjectEdit(removed, { workItems: before.workItems }, { before }).workItems).toEqual([]);
  });
  it("複数の旧予定・同名同日の別作業を全件保持し、ID衝突を避ける", () => {
    const raw = legacy();
    const converted = migrateLegacyMilestoneProject(raw).project.workItems![0];
    raw.workItems = [{ ...converted, description: "既存の別作業" }];
    raw.milestones[0].plannedRanges!.push({ ...raw.milestones[0].plannedRanges![0], id: "r2" });
    const result = migrateLegacyMilestoneProject(raw).project;
    expect(result.workItems).toHaveLength(3);
    expect(new Set(result.workItems!.map(work => work.id)).size).toBe(3);
    expect(result.workItems![0]).toBe(raw.workItems[0]);
    expect(migrateLegacyMilestoneProject(raw).project.workItems!.map(work => work.id)).toEqual(result.workItems!.map(work => work.id));
  });
  it("予定のメモ・当初計画・変更理由・完了状態を移行する", () => {
    const raw = legacy(); raw.milestones[0].status = "achieved"; raw.milestones[0].completedAt = "2026-09-24";
    const work = migrateLegacyMilestoneProject(raw).project.workItems![0];
    expect(work).toMatchObject({ status: "done", completedAt: "2026-09-24", replanReason: "日程調整", replannedAt: "2026-09-20", baselinePlannedHours: 2 });
    expect(work.plannedRanges![0].note).toBe("残すメモ");
    expect(work.baselinePlannedRanges).toEqual(raw.milestones[0].baselinePlannedRanges);
  });
  it("関連Taskの予定所有者だけを移行し、通常予定・予定ID・実績・メモは保持する", () => {
    const raw = data(), result = repairDuplicateProjectSchedules(raw);
    const task = result.tasks[0], work = result.goals[0].workItems![0];
    expect(task.plannedRanges[0]).toEqual({ ...raw.tasks[0].plannedRanges[0], sourceType: "project-work", sourceId: work.id });
    expect(task.plannedRanges[1]).toEqual(raw.tasks[0].plannedRanges[1]);
    expect(task.dailyActualHours).toEqual(raw.tasks[0].dailyActualHours);
    expect(task.dailyPlans).toEqual(raw.tasks[0].dailyPlans);
    expect(task.plannedHours).toBe(7);
    expect(repairDuplicateProjectSchedules(result)).toBe(result);
    expect(repairDuplicateProjectSchedules(parseImportedData(JSON.stringify(result)))).toEqual(result);
  });
  it("同一IDが別のTaskにあっても付け替えない", () => {
    const raw = data(); raw.tasks.push({ ...raw.tasks[0], id: "other" });
    const result = migrateLegacyMilestoneData(raw);
    expect(result.tasks[1]).toBe(raw.tasks[1]);
  });
  it("変換不要な新形式ではデータを変更しない", () => {
    const migrated = migrateLegacyMilestoneData(data());
    expect(migrateLegacyMilestoneData(migrated)).toBe(migrated);
  });
  it("読み込み後すぐに目標期間を変更し、履歴から戻せる", () => {
    const initial = repairDuplicateProjectSchedules(data()), project = initial.goals[0];
    const patch = scheduleChangesForStorage(project, project, { workItems: project.workItems!.map(work => ({ ...work, targetWorkEndDate: "2026-09-25" })) });
    const saved = applyScheduleCommand(initial, { kind: "apply", id: "h", now: "now", projectId: project.id, expectedProject: project, expectedTasks: [], expectedCapacity: 6, changes: patch, taskChanges: [], label: "目標期間変更" }).data;
    const reloaded = repairDuplicateProjectSchedules(parseImportedData(JSON.stringify(saved)));
    const undone = applyScheduleCommand(reloaded, { kind: "undo", id: "u", now: "later", projectId: project.id, historyId: "h" }).data;
    expect(undone.goals[0].workItems).toHaveLength(1);
    expect(undone.goals[0].workItems![0].targetWorkEndDate).toBe("2026-09-23");
  });
});
