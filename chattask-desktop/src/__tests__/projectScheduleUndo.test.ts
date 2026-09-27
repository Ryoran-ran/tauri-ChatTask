import { describe, expect, it } from "vitest";
import { createTask } from "../appHelpers";
import type { Goal, ProjectWorkItem } from "../types";
import { buildScheduleUndo, createScheduleUndo } from "../projectScheduleUndo";
import { buildBatchWorkDateSyncChanges, workDateSyncSignature } from "../projectWorkDateSync";
import { reorderScheduleWorks } from "../projectScheduleOrder";

const work = (id = "w"): ProjectWorkItem => ({
  id, title: id, description: "説明", milestoneId: "m", linkedTaskId: "", status: "not-started", priority: "A", dueDate: "2026-09-30",
  targetWorkStartDate: "2026-09-21", targetWorkEndDate: "2026-09-25", plannedHours: 3, actualHours: 1, sortOrder: 0,
  plannedRanges: [{ id: `r-${id}`, startDate: "2026-09-22", endDate: "2026-09-24", plannedHours: 3 }], createdAt: "created", updatedAt: "updated",
});
const project = (): Goal => ({
  id: "p", title: "Project", description: "", successCriteria: "", dueDate: "2026-09-30", status: "in-progress", projectTagId: "", taskIds: [], reviews: [], createdAt: "created", updatedAt: "updated",
  milestones: [{ id: "m", title: "Milestone", completed: false, taskIds: [], dueDate: "2026-09-30", targetWorkStartDate: "2026-09-21", targetWorkEndDate: "2026-09-25" }],
  workItems: [work()],
});
const moved = (p: Goal): Goal => ({ ...p, workItems: p.workItems!.map(w => ({ ...w, targetWorkEndDate: "2026-09-28" })) });

describe("作業スケジュールの直前1操作の取り消し", () => {
  it("変更した日付だけを戻し、その後の名称・説明・期限・優先度・工数を保持する", () => {
    const before = project(); const after = moved(before);
    const entry = createScheduleUndo(before, after, [], [], "期間")!;
    const current = { ...after, workItems: after.workItems!.map(w => ({ ...w, title: "編集済", description: "新説明", plannedHours: 7 })) };
    const snapshot = structuredClone(current);
    const result = buildScheduleUndo(entry, current, [], 6);
    expect(result.projectChanges.workItems).toEqual(current.workItems.map(w => ({ ...w, targetWorkEndDate: "2026-09-25" })));
    expect(current).toEqual(snapshot); expect(before.workItems![0].targetWorkEndDate).toBe("2026-09-25");
  });
  it("マイルストーンの期間クリアを戻しても期限と子作業を変更しない", () => {
    const before = project(); const after = { ...before, milestones: before.milestones.map(m => ({ ...m, targetWorkStartDate: "", targetWorkEndDate: "" })) };
    const result = buildScheduleUndo(createScheduleUndo(before, after, [], [], "クリア")!, after, [], 6);
    expect(result.projectChanges).toEqual({ milestones: before.milestones });
  });
  it("初めて引いた線は明示的な空欄に戻し、旧データ補完で復活させない", () => {
    const before = project(); delete before.workItems![0].targetWorkStartDate; delete before.workItems![0].targetWorkEndDate;
    const after = { ...before, workItems: [work()] };
    const result = buildScheduleUndo(createScheduleUndo(before, after, [], [], "作成")!, after, [], 6);
    expect(result.projectChanges.workItems![0]).toMatchObject({ targetWorkStartDate: "", targetWorkEndDate: "" });
  });
  it("同日内の並び替えを戻し、元になかった順序フィールドも除去する", () => {
    const before = { ...project(), workItems: [work("a"), { ...work("b"), sortOrder: 1 }] };
    const after = { ...before, workItems: reorderScheduleWorks(before.workItems, before.workItems, "a", 1) };
    expect(buildScheduleUndo(createScheduleUndo(before, after, [], [], "順序")!, after, [], 6).projectChanges.workItems).toEqual(before.workItems);
  });
  it.each(["schedule-to-work", "work-to-schedule"] as const)("一括同期(%s)を戻し、通常予定と実績を保持する", direction => {
    const before = { ...project(), workItems: [work("a"), work("b")].map(w => ({ ...w, linkedTaskId: "t" })) };
    const normal = { id: "normal", startDate: "2026-09-22", endDate: "2026-09-24", plannedHours: 3 };
    const task = { ...createTask(), id: "t", plannedHours: 9, plannedRanges: [normal, ...before.workItems.map(w => ({ ...w.plannedRanges![0], sourceType: "project-work" as const, sourceId: w.id }))], dailyActualHours: { "2026-09-22::r-a": 1 } };
    const changes = buildBatchWorkDateSyncChanges(before.workItems, before.workItems, [task], before.workItems.map(w => ({ id: w.id, expectedSignature: workDateSyncSignature(w) })), direction, () => "new", "now");
    const after = { ...before, workItems: changes.workItems };
    const entry = createScheduleUndo(before, after, [task], changes.taskChanges, "同期")!;
    const currentTask = { ...task, ...changes.taskChanges[0]?.changes, description: "後から変更" };
    const result = buildScheduleUndo(entry, after, [currentTask], 6);
    expect(result.projectChanges.workItems).toEqual(before.workItems.map(w => ({ ...w, updatedAt: "now" })));
    expect({ ...currentTask, ...result.taskChanges[0]?.changes }).toEqual({ ...task, description: "後から変更" });
  });
  it("関連タスクへ新規予定を追加した同期も工数とともに戻せる", () => {
    const before = { ...project(), workItems: [{ ...work(), linkedTaskId: "t", plannedRanges: [] }] };
    const task = { ...createTask(), id: "t", plannedHours: 0, plannedRanges: [] };
    const changes = buildBatchWorkDateSyncChanges(before.workItems, before.workItems, [task], [{ id: "w", expectedSignature: workDateSyncSignature(before.workItems[0]) }], "schedule-to-work", () => "new", "now");
    const after = { ...before, workItems: changes.workItems };
    const entry = createScheduleUndo(before, after, [task], changes.taskChanges, "同期")!;
    const result = buildScheduleUndo(entry, after, [{ ...task, ...changes.taskChanges[0].changes }], 6);
    expect(result.taskChanges[0].changes).toEqual({ plannedRanges: [], plannedHours: 0 });
  });
  it.each([{ targetWorkEndDate: "2026-10-01" }, { targetWorkStartDate: "2026-09-28" }, { linkedTaskId: "other" }, { milestoneId: "other" }])("対象の日付・紐付けが変更されていたら拒否: %j", changes => {
    const before = project(); const after = moved(before);
    const entry = createScheduleUndo(before, after, [], [], "期間")!;
    expect(() => buildScheduleUndo(entry, { ...after, workItems: [{ ...after.workItems![0], ...changes }] }, [], 6)).toThrow("上書きを防ぐ");
  });
  it("後から追加した無関係な作業を残し、対象削除・ID重複は拒否する", () => {
    const before = project(); const after = moved(before); const entry = createScheduleUndo(before, after, [], [], "期間")!;
    const extra = work("extra");
    expect(buildScheduleUndo(entry, { ...after, workItems: [...after.workItems!, extra] }, [], 6).projectChanges.workItems![1]).toBe(extra);
    for (const workItems of [[], [...after.workItems!, ...after.workItems!]]) expect(() => buildScheduleUndo(entry, { ...after, workItems }, [], 6)).toThrow("削除されたか重複");
  });
  it("Taskの予定が後から変わったらプロジェクトも含めて何も返さない", () => {
    const before = project(); const after = moved(before); const task = { ...createTask(), id: "t", plannedRanges: [] };
    const entry = createScheduleUndo(before, after, [task], [{ id: "t", changes: { plannedRanges: work().plannedRanges } }], "同期")!;
    const currentTask = { ...task, plannedRanges: [...work().plannedRanges!, { id: "other", startDate: "2026-10-01", endDate: "2026-10-01" }] };
    const snapshot = structuredClone({ after, currentTask });
    expect(() => buildScheduleUndo(entry, after, [currentTask], 6)).toThrow("上書きを防ぐ");
    expect({ after, currentTask }).toEqual(snapshot);
  });
  it("計画可能時間を戻し、後から変更されていたら拒否する", () => {
    const p = project(); const entry = createScheduleUndo(p, p, [], [], "時間", { before: 6, after: 4 })!;
    expect(buildScheduleUndo(entry, p, [], 4)).toEqual({ projectChanges: {}, taskChanges: [], capacity: 6 });
    expect(() => buildScheduleUndo(entry, p, [], 5)).toThrow("計画可能時間が変更");
  });
  it("変更なしは履歴を作らず、登録・削除と別Projectへの適用は拒否する", () => {
    const p = project(); expect(createScheduleUndo(p, p, [], [], "no-op")).toBeNull();
    expect(() => createScheduleUndo(p, { ...p, workItems: [] }, [], [], "削除")).toThrow("対象外");
    const next = moved(p); const entry = createScheduleUndo(p, next, [], [], "期間")!;
    expect(() => buildScheduleUndo(entry, { ...next, id: "other" }, [], 6)).toThrow("プロジェクトが異なります");
  });
  it("履歴は元データから独立したコピーとして保持する", () => {
    const p = project(); const after = moved(p); const entry = createScheduleUndo(p, after, [], [], "期間")!;
    p.workItems![0].targetWorkEndDate = "2030-01-01";
    expect(buildScheduleUndo(entry, after, [], 6).projectChanges.workItems![0].targetWorkEndDate).toBe("2026-09-25");
  });
});
