import { describe, expect, it } from "vitest";
import { mergeProjectEdit } from "../projectEditMerge";
import { buildProjectWorkEditChanges, createProjectWorkEditDraft, reflectTaskScheduleOnWork } from "../projectWorkEditing";
import { createTask } from "../appHelpers";
import type { Goal, ProjectWorkItem } from "../types";

const work = (id: string): ProjectWorkItem => ({ id, milestoneId: "m", title: id, description: "元の説明", status: "not-started", priority: "A", dueDate: "2026-09-30", linkedTaskId: "task", plannedHours: 3, actualHours: 1, sortOrder: 0,
  plannedRanges: [{ id: `range-${id}`, startDate: "2026-09-21", endDate: "2026-09-23", plannedHours: 3 }],
  targetWorkStartDate: "2026-09-24", targetWorkEndDate: "2026-09-25", createdAt: "created", updatedAt: "updated" });
const project = (): Goal => ({ id: "p", title: "project", description: "", successCriteria: "", dueDate: "", status: "in-progress", projectTagId: "", taskIds: [], reviews: [], milestones: [{ id: "m", title: "milestone", completed: false, taskIds: [] }], workItems: [work("a"), work("b")], createdAt: "created", updatedAt: "updated" });
const edit = (base: Goal, id: string, changes: Partial<ProjectWorkItem>) => ({ workItems: base.workItems!.map(item => item.id === id ? { ...item, ...changes } : item) });

describe("通常編集のID単位マージ", () => {
  it("同期せずに追加・編集し、古い編集コールバックが後から実行されても追加した作業を保持する", () => {
    const before = project();
    const added = mergeProjectEdit(before, { workItems: [...before.workItems!, work("c")] }, { before });
    const saved = mergeProjectEdit(added, edit(before, "a", { description: "更新" }), { before });
    expect(saved.workItems!.map(item => item.id)).toEqual(["a", "b", "c"]);
    expect(saved.workItems![0]).toMatchObject({ description: "更新", plannedHours: 3, targetWorkStartDate: "2026-09-24" });
    expect(saved.workItems![2]).toEqual(work("c"));
    expect(before.workItems).toHaveLength(2);
  });
  it("保存して次を追加の追加処理が古い一覧を使っても直前の保存を戻さない", () => {
    const before = project();
    const saved = mergeProjectEdit(before, edit(before, "b", { title: "保存した作業", plannedHours: 7 }), { before });
    const added = mergeProjectEdit(saved, { workItems: [...before.workItems!, work("c")] }, { before });
    expect(added.workItems![1]).toMatchObject({ title: "保存した作業", plannedHours: 7 });
    expect(added.workItems).toHaveLength(3);
  });
  it("説明だけの編集は最新の日付・工数・期限・優先度・目標期間を上書きしない", () => {
    const before = project();
    const current = mergeProjectEdit(before, edit(before, "a", { plannedHours: 8, dueDate: "2026-10-10", priority: "C", targetWorkEndDate: "2026-10-01", plannedRanges: [] }), { before });
    const draft = createProjectWorkEditDraft(before.workItems![0], before.workItems![0]);
    const changes = buildProjectWorkEditChanges(draft, { ...draft, description: "説明のみ" }, "now");
    const saved = mergeProjectEdit(current, edit(before, "a", changes), { before });
    expect(saved.workItems![0]).toEqual({ ...current.workItems![0], description: "説明のみ" });
  });
  it("一覧に含まれないだけでは削除せず、明示指定した作業だけ削除する", () => {
    const before = project();
    const current = { ...before, workItems: [...before.workItems!, work("c")] };
    expect(mergeProjectEdit(current, { workItems: [] }, { before }).workItems).toHaveLength(3);
    expect(mergeProjectEdit(current, { workItems: [before.workItems![1]] }, { before, deletedWorkIds: ["a"] }).workItems!.map(w => w.id)).toEqual(["b", "c"]);
  });
  it("削除済み作業は古い編集・追加によって復活しない", () => {
    const before = project();
    const deleted = mergeProjectEdit(before, { workItems: [before.workItems![1]] }, { before, deletedWorkIds: ["a"] });
    const saved = mergeProjectEdit(deleted, edit(before, "a", { title: "古い編集" }), { before });
    expect(saved.workItems!.map(w => w.id)).toEqual(["b"]);
  });
  it("新規作業の破棄と次の追加でも他の追加・編集を保持する", () => {
    const before = project();
    const current = { ...before, workItems: [...before.workItems!.map(w => ({ ...w, description: "最新" })), work("c")] };
    const saved = mergeProjectEdit(current, { workItems: [before.workItems![0], work("next")] }, { before, deletedWorkIds: ["b"] });
    expect(saved.workItems!.map(w => w.id)).toEqual(["a", "c", "next"]);
    expect(saved.workItems![0].description).toBe("最新");
  });
  it("マイルストーン編集でも追加済みの別マイルストーンを保持する", () => {
    const before = project();
    const current = { ...before, milestones: [...before.milestones, { ...before.milestones[0], id: "new" }] };
    const saved = mergeProjectEdit(current, { milestones: [{ ...before.milestones[0], title: "変更" }] }, { before });
    expect(saved.milestones.map(m => m.id)).toEqual(["m", "new"]);
    expect(saved.milestones[0].title).toBe("変更");
  });
  it("新規マイルストーン確定と配下作業追加が連続しても所属を保持する", () => {
    const before = { ...project(), milestones: [], workItems: [] };
    const milestone = { id: "new-milestone", title: "新しい到達点", completed: false, taskIds: [] };
    const child = { ...work("child"), milestoneId: milestone.id };
    const savedMilestone = mergeProjectEdit(before, { milestones: [milestone] }, { before });
    const savedWork = mergeProjectEdit(savedMilestone, { workItems: [child] }, { before });
    expect(savedWork.milestones).toEqual([milestone]);
    expect(savedWork.workItems).toEqual([child]);
    expect(savedWork.workItems![0].milestoneId).toBe(savedWork.milestones[0].id);
  });
  it("マイルストーン削除の間に追加された作業も未割当にして保持する", () => {
    const before = project();
    const current = { ...before, workItems: [...before.workItems!, work("c")] };
    const saved = mergeProjectEdit(current, { milestones: [] }, { before, deletedMilestoneIds: ["m"] });
    expect(saved.milestones).toEqual([]);
    expect(saved.workItems).toHaveLength(3);
    expect(saved.workItems!.every(w => w.milestoneId === "")).toBe(true);
  });
  it("マイルストーン削除時に配下作業も削除できる", () => {
    const before = project();
    const current = { ...before, workItems: [...before.workItems!, work("concurrent")] };
    const saved = mergeProjectEdit(current, { milestones: [] }, {
      before,
      deletedMilestoneIds: ["m"],
      deletedMilestoneWorkDisposition: { kind: "delete" },
    });
    expect(saved.milestones).toEqual([]);
    expect(saved.workItems).toEqual([]);
  });
  it("マイルストーン削除時に配下作業を別のマイルストーンへ移動できる", () => {
    const before = project();
    const destination = { ...before.milestones[0], id: "destination", title: "移動先" };
    const current = { ...before, milestones: [...before.milestones, destination], workItems: [...before.workItems!, work("concurrent")] };
    const saved = mergeProjectEdit(current, { milestones: [destination] }, {
      before,
      deletedMilestoneIds: ["m"],
      deletedMilestoneWorkDisposition: { kind: "move", milestoneId: destination.id },
    });
    expect(saved.milestones.map(item => item.id)).toEqual([destination.id]);
    expect(saved.workItems!.every(item => item.milestoneId === destination.id)).toBe(true);
  });
  it("明示した空欄・0時間は保存できる", () => {
    const before = project();
    const saved = mergeProjectEdit(before, edit(before, "a", { plannedHours: 0, plannedRanges: [], targetWorkStartDate: "", targetWorkEndDate: "" }), { before });
    expect(saved.workItems![0]).toMatchObject({ plannedHours: 0, plannedRanges: [], targetWorkStartDate: "", targetWorkEndDate: "" });
  });
  it("旧データの表示時補完値を無関係な編集で保存せず、明示的な期間削除は保持する", () => {
    const raw = project();
    delete raw.workItems![0].targetWorkStartDate;
    delete raw.workItems![0].targetWorkEndDate;
    const view = structuredClone(raw);
    Object.assign(view.workItems![0], { targetWorkStartDate: "2026-09-21", targetWorkEndDate: "2026-09-23" });
    const described = mergeProjectEdit(raw, edit(view, "a", { description: "説明" }), { before: view });
    expect(described.workItems![0].targetWorkStartDate).toBeUndefined();
    const cleared = mergeProjectEdit(described, edit(view, "a", { targetWorkStartDate: "", targetWorkEndDate: "" }), { before: view });
    expect(cleared.workItems![0]).toMatchObject({ description: "説明", targetWorkStartDate: "", targetWorkEndDate: "" });
  });
  it("無関係な履歴とプロジェクト・重複した追加を壊さない", () => {
    const before = project();
    const added = mergeProjectEdit(before, { workItems: [...before.workItems!, work("c")] }, { before });
    expect(mergeProjectEdit(added, { workItems: [...before.workItems!, work("c")] }, { before }).workItems).toHaveLength(3);
    const other = { ...before, id: "other" };
    expect(mergeProjectEdit(other, edit(before, "a", { title: "変更" }), { before })).toBe(other);
  });
});

describe("Task予定の欠落による作業消失の防止", () => {
  it("関連タスク側の予定が削除されても作業日・工数・目標期間を保持する", () => {
    const item = work("a");
    const task = { ...createTask(), id: "task", plannedRanges: [] };
    expect(reflectTaskScheduleOnWork(item, task, "now")).toBe(item);
  });
  it("他タスクに同じsourceIdがあっても上書きしない", () => {
    const item = work("a");
    const task = { ...createTask(), id: "other", plannedRanges: [{ ...item.plannedRanges![0], sourceType: "project-work" as const, sourceId: item.id, plannedHours: 0 }] };
    expect(reflectTaskScheduleOnWork(item, task, "now")).toBe(item);
  });
  it("関連タスクの明示的な予定変更は反映し、目標期間は独立して維持する", () => {
    const item = work("a");
    const task = { ...createTask(), id: "task", plannedRanges: [{ ...item.plannedRanges![0], sourceType: "project-work" as const, sourceId: item.id, startDate: "2026-09-22", plannedHours: 0 }] };
    const saved = reflectTaskScheduleOnWork(item, task, "now");
    expect(saved.plannedHours).toBe(0);
    expect(saved.plannedRanges![0].startDate).toBe("2026-09-22");
    expect(saved.targetWorkStartDate).toBe(item.targetWorkStartDate);
  });
  it("工数未設定の予定で既存見積もりを0にしない", () => {
    const item = work("a");
    const task = { ...createTask(), id: "task", plannedRanges: [{ ...item.plannedRanges![0], sourceType: "project-work" as const, sourceId: item.id, plannedHours: undefined }] };
    expect(reflectTaskScheduleOnWork(item, task, "now").plannedHours).toBe(3);
  });
});
