import { describe, expect, it } from "vitest";
import { batchMoveContextSignature, buildBatchScheduleMoveChanges, moveWorkByWorkingDays, shiftByWorkingDays, type BatchScheduleMoveRequest } from "../projectScheduleBatchMove";
import { createScheduleUndo, buildScheduleUndo } from "../projectScheduleUndo";
import { projectWorkWorkingDates } from "../projectCapacity";
import type { Goal, NonWorkingPeriod, ProjectWorkItem } from "../types";

const work = (id = "a", changes: Partial<ProjectWorkItem> = {}): ProjectWorkItem => ({ id, title: id, description: "保持", milestoneId: "m", status: "not-started", priority: "A", dueDate: "2026-10-01", linkedTaskId: "t", plannedHours: 8, actualHours: 2, sortOrder: 1, scheduleSortOrder: 3, targetWorkStartDate: "2026-09-24", targetWorkEndDate: "2026-09-29", plannedRanges: [{ id: `r-${id}`, startDate: "2026-09-21", endDate: "2026-09-22", plannedHours: 8 }], createdAt: "created", updatedAt: "updated", ...changes });
const project = (): Goal => ({ id: "p", title: "p", description: "", successCriteria: "", dueDate: "2026-10-10", status: "in-progress", projectTagId: "", taskIds: [], reviews: [], createdAt: "created", updatedAt: "updated", milestones: [{ id: "m", title: "milestone", completed: false, taskIds: [], dueDate: "2026-09-30", targetWorkStartDate: "2026-09-21", targetWorkEndDate: "2026-09-30" }], workItems: [work(), work("b"), work("excluded", { milestoneId: "other" })] });
const request = (p: Goal, periods: NonWorkingPeriod[] = [], projects = [p]): BatchScheduleMoveRequest => ({ projectId: p.id, milestoneId: "m", milestoneSignature: JSON.stringify(p.milestones[0]), works: p.workItems!.filter(w => w.milestoneId === "m").map(w => ({ id: w.id, signature: JSON.stringify(w) })), days: 3, moveDeadline: false, contextSignature: batchMoveContextSignature(projects, periods, 6) });
const build = (p: Goal, r = request(p)) => buildBatchScheduleMoveChanges(p, p, [p], [], 6, r);

describe("営業日による日付移動", () => {
  it("土日を飛ばして3営業日後ろ・前へ移動する", () => {
    expect(shiftByWorkingDays("2026-09-25", 3, [])).toBe("2026-09-30");
    expect(shiftByWorkingDays("2026-09-30", -3, [])).toBe("2026-09-25");
  });
  it("休暇・年越し・休日開始を扱う", () => {
    expect(shiftByWorkingDays("2026-09-25", 3, [{ id: "leave", startDate: "2026-09-28", endDate: "2026-09-28", type: "vacation" }])).toBe("2026-10-01");
    expect(shiftByWorkingDays("2026-12-31", 1, [])).toBe("2027-01-01");
    expect(shiftByWorkingDays("2026-09-26", 1, [])).toBe("2026-09-28");
    expect(shiftByWorkingDays("2026-09-26", -1, [])).toBe("2026-09-25");
  });
  it("開始日と終了日の両方で元の営業日数を維持する", () => {
    const w = work(); const moved = moveWorkByWorkingDays(w, 3, []);
    expect(moved).toEqual({ targetWorkStartDate: "2026-09-29", targetWorkEndDate: "2026-10-02" });
    expect(projectWorkWorkingDates({ ...w, ...moved }, [])).toHaveLength(projectWorkWorkingDates(w, []).length);
  });
  it("休暇が移動先にあっても作業日数は減らさない", () => {
    const periods: NonWorkingPeriod[] = [{ id: "leave", startDate: "2026-10-01", endDate: "2026-10-01", type: "vacation" }];
    expect(moveWorkByWorkingDays(work(), 3, periods)).toEqual({ targetWorkStartDate: "2026-09-29", targetWorkEndDate: "2026-10-05" });
  });
  it.each([0, 1.5, NaN, 366, -366])("無効な移動量を拒否する: %s", days => {
    expect(() => shiftByWorkingDays("2026-09-25", days, [])).toThrow("1〜365");
  });
  it("不正日付・完了・休日のみ・期間未設定を拒否する", () => {
    expect(() => shiftByWorkingDays("2026-02-30", 1, [])).toThrow("不正");
    for (const changes of [{ status: "done" as const }, { targetWorkStartDate: "" }, { targetWorkStartDate: "2026-09-26", targetWorkEndDate: "2026-09-27" }]) expect(() => moveWorkByWorkingDays(work("a", changes), 3, [])).toThrow();
  });
  it("全曜日休みでも無限ループにならない", () => {
    expect(() => shiftByWorkingDays("2026-09-25", 1, [{ id: "all", type: "weekend", startDate: "2026-01-01", endDate: "", weekdays: [0, 1, 2, 3, 4, 5, 6] }])).toThrow("見つかりません");
  });
});

describe("選択作業の一括移動とデータ保護", () => {
  it("選択作業の目標期間だけを変更し他の項目・未選択作業を保持する", () => {
    const p = project(); const original = structuredClone(p); const r = request(p); r.works = r.works.slice(0, 1);
    const result = build(p, r);
    expect(result.milestones).toBeUndefined();
    expect(result.workItems![0]).toEqual({ ...p.workItems![0], targetWorkStartDate: "2026-09-29", targetWorkEndDate: "2026-10-02", updatedAt: expect.any(String) });
    expect(result.workItems![1]).toBe(p.workItems![1]); expect(result.workItems![2]).toBe(p.workItems![2]); expect(p).toEqual(original);
  });
  it("期限の移動を選んだときだけ期限を移動し青い目標期間は保持する", () => {
    const p = project(); const r = { ...request(p), moveDeadline: true }; const result = build(p, r);
    expect(result.milestones).toEqual([{ ...p.milestones[0], dueDate: "2026-10-05" }]);
    expect(result.workItems![0].dueDate).toBe(p.workItems![0].dueDate);
  });
  it("期限未設定なら期限移動を拒否し日付を勝手に作らない", () => {
    const p = project(); p.milestones[0].dueDate = "";
    expect(() => build(p, { ...request(p), moveDeadline: true })).toThrow("未設定");
    expect(build(p).workItems).toHaveLength(3);
  });
  it("関連Task由来の表示値を保存データへ混ぜない", () => {
    const p = project(); const displayed = { ...p, workItems: p.workItems!.map(w => ({ ...w, priority: "B" as const, dueDate: "", actualHours: 99 })) };
    const result = buildBatchScheduleMoveChanges(p, displayed, [displayed], [], 6, request(displayed));
    expect(result.workItems![0]).toMatchObject({ priority: "A", dueDate: "2026-10-01", actualHours: 2, plannedRanges: p.workItems![0].plannedRanges });
  });
  it("確認後に1件でも変更されたら全件中止し元データを変更しない", () => {
    const p = project(); const r = request(p); p.workItems![1].description = "変更"; const snapshot = structuredClone(p);
    expect(() => build(p, r)).toThrow("変更・削除"); expect(p).toEqual(snapshot);
  });
  it("別プロジェクトの負荷・休日・容量が変わったら開き直しを求める", () => {
    const p = project(); const other = { ...project(), id: "other" }; const r = request(p, [], [p, other]);
    const changed = { ...other, workItems: [work("other", { plannedHours: 99 })] };
    expect(() => buildBatchScheduleMoveChanges(p, p, [p, changed], [], 6, r)).toThrow("予定・工数・休日設定");
    expect(() => buildBatchScheduleMoveChanges(p, p, [p, other], [], 7, r)).toThrow("予定・工数・休日設定");
    expect(() => buildBatchScheduleMoveChanges(p, p, [p, other], [{ id: "leave", startDate: "2026-09-28", endDate: "2026-09-28", type: "vacation" }], 6, r)).toThrow("予定・工数・休日設定");
  });
  it("マイルストーンの期限変更・削除を検出する", () => {
    const p = project(); const r = request(p); p.milestones[0].dueDate = "2026-10-01";
    expect(() => build(p, r)).toThrow("マイルストーンが変更");
    p.milestones = []; expect(() => build(p, r)).toThrow("マイルストーンが変更");
  });
  it("対象外の所属・削除・重複・0件選択を拒否する", () => {
    const p = project(); const r = request(p);
    expect(() => build(p, { ...r, works: [] })).toThrow("選択");
    expect(() => build(p, { ...r, works: [r.works[0], r.works[0]] })).toThrow("重複");
    expect(() => build(p, { ...r, works: [{ id: "excluded", signature: JSON.stringify(p.workItems![2]) }] })).toThrow("変更・削除");
    expect(() => buildBatchScheduleMoveChanges({ ...p, workItems: p.workItems!.slice(1) }, p, [p], [], 6, r)).toThrow("変更・削除");
    expect(() => buildBatchScheduleMoveChanges({ ...p, workItems: [...p.workItems!, p.workItems![0]] }, p, [p], [], 6, r)).toThrow("変更・削除");
  });
  it("複数作業と期限の移動を1回で取り消せる", () => {
    const p = project(); const changes = build(p, { ...request(p), moveDeadline: true }); const next = { ...p, ...changes };
    const entry = createScheduleUndo(p, next, [], [], "まとめ移動")!;
    const result = buildScheduleUndo(entry, next, [], 6);
    expect(result.projectChanges.milestones).toEqual(p.milestones);
    expect(result.projectChanges.workItems?.map(({ updatedAt: _, ...w }) => w)).toEqual(p.workItems!.map(({ updatedAt: _, ...w }) => w));
    expect(result.taskChanges).toEqual([]);
  });
});
