import { describe, expect, it } from "vitest";
import { inheritLegacyPlannedHours } from "../legacyPlannedHours";
import { repairDuplicateProjectSchedules } from "../appHelpers";
import { parseImportedData } from "../services/storage";
import type { Goal, ProjectWorkItem } from "../types";

const ranges = [{ id: "r1", startDate: "2026-09-21", endDate: "2026-09-22", note: "保持" }, { id: "r2", startDate: "2026-09-24", endDate: "2026-09-25" }];
const project = (): Goal => ({ id: "p", title: "旧プロジェクト", description: "", successCriteria: "", dueDate: "", status: "in-progress", projectTagId: "", taskIds: [], priority: "A", reviews: [], workItems: [], createdAt: "2026-09-01", updatedAt: "2026-09-20", milestones: [{ id: "m", title: "到達点", completed: false, taskIds: [] }] });
const migrate = (p: Goal) => repairDuplicateProjectSchedules(parseImportedData(JSON.stringify({ tasks: [], goals: [p], organizationSeed: 1 })));
const work = (): ProjectWorkItem => ({ id: "w", milestoneId: "m", title: "旧作業", description: "", status: "not-started", priority: "A", dueDate: "", linkedTaskId: "", plannedHours: 8, actualHours: 0, plannedRanges: ranges, baselinePlannedHours: 6, sortOrder: 0, createdAt: "2026-09-01", updatedAt: "2026-09-01" });
describe("旧形式の全体工数を失わない移行", () => {
  it("旧マイルストーンの全体工数8h・当初工数6hを保持する", () => {
    const p = project();
    p.milestones[0] = { ...p.milestones[0], plannedHours: 8, baselinePlannedHours: 6, plannedRanges: [ranges[0]] };
    const result = migrate(p);
    expect(result.goals[0].workItems![0]).toMatchObject({ plannedHours: 8, baselinePlannedHours: 6, plannedRanges: [{ ...ranges[0], plannedHours: 8 }] });
    expect(p.milestones[0].plannedRanges).toEqual([ranges[0]]);
    expect(repairDuplicateProjectSchedules(parseImportedData(JSON.stringify(result)))).toEqual(result);
  });
  it("旧作業の複数予定へ8hを分割しても合計と当初計画を保持する", () => {
    const p = project(); p.workItems = [work()];
    const result = migrate(p);
    expect(result.goals[0].workItems!.map(item => item.plannedHours)).toEqual([4, 4]);
    expect(result.goals[0].workItems!.map(item => item.baselinePlannedHours)).toEqual([3, 3]);
    expect(repairDuplicateProjectSchedules(parseImportedData(JSON.stringify(result)))).toEqual(result);
    expect(p.workItems[0].plannedRanges).toEqual(ranges);
  });
  it("一部入力済みの内訳は変えず未入力分だけ補う", () => {
    const result = inheritLegacyPlannedHours([{ ...ranges[0], plannedHours: 3 }, ranges[1]], 8);
    expect(result.map(range => range.plannedHours)).toEqual([3, 5]);
  });
  it("明示的な0を未入力扱いしない", () => {
    const result = inheritLegacyPlannedHours([{ ...ranges[0], plannedHours: 0 }, ranges[1]], 8);
    expect(result.map(range => range.plannedHours)).toEqual([0, 8]);
  });
  it("合計未設定や全内訳入力済みでは書き換えない", () => {
    expect(inheritLegacyPlannedHours(ranges, undefined)).toBe(ranges);
    const explicit = ranges.map(range => ({ ...range, plannedHours: 0 }));
    expect(inheritLegacyPlannedHours(explicit, 8)).toBe(explicit);
  });
  it("当初計画の一部入力済み工数も保持する", () => {
    const p = project(); p.workItems = [{ ...work(), baselinePlannedRanges: [{ ...ranges[0], plannedHours: 0 }, ranges[1]] }];
    expect(migrate(p).goals[0].workItems!.map(item => item.baselinePlannedHours)).toEqual([0, 6]);
  });
  it("当初計画がない場合は現在の内訳をそのまま使う", () => {
    const p = project(); p.workItems = [{ ...work(), baselinePlannedHours: 0, plannedRanges: [{ ...ranges[0], plannedHours: 3 }, { ...ranges[1], plannedHours: 5 }] }];
    expect(migrate(p).goals[0].workItems!.map(item => item.baselinePlannedHours)).toEqual([3, 5]);
  });
  it("小数合計の残差を消さず、日付とメモを変えない", () => {
    const input = [...ranges, { ...ranges[0], id: "r3" }];
    const result = inheritLegacyPlannedHours(input, 1.25);
    expect(result.reduce((sum, range) => sum + range.plannedHours!, 0)).toBeCloseTo(1.25, 12);
    expect(result[0]).toMatchObject(ranges[0]);
  });
});
