import { describe, expect, it } from "vitest";
import { compareScheduleWorks, reorderScheduleWorks, sameStartScheduleWorks } from "../projectScheduleOrder";
import type { ProjectWorkItem } from "../types";

const work = (id: string, start = "2026-09-21", changes: Partial<ProjectWorkItem> = {}): ProjectWorkItem => ({
  id, milestoneId: "m", title: id, description: "保持", status: "not-started", priority: "A", dueDate: "2026-09-30", linkedTaskId: "task", plannedHours: 3, actualHours: 1, sortOrder: 0,
  targetWorkStartDate: start, targetWorkEndDate: "2026-09-25", plannedRanges: [{ id: `r-${id}`, startDate: "2026-09-24", endDate: "2026-09-25" }],
  createdAt: "created", updatedAt: "updated", ...changes,
});
const ids = (works: ProjectWorkItem[]) => [...works].sort(compareScheduleWorks).map(w => w.id);
describe("作業スケジュールの同一開始日内の並び替え", () => {
  it("開始日順に並べ、未設定は最後にする", () => {
    expect(ids([work("unset", ""), work("late", "2026-09-22", { sortOrder: -2 }), work("early")])).toEqual(["early", "late", "unset"]);
  });
  it("同じ日なら従来の順序を初期値にする", () => {
    expect(ids([work("a", undefined, { sortOrder: 3 }), work("b", undefined, { sortOrder: 1 })])).toEqual(["b", "a"]);
  });
  it("終了日が違っても同じ開始日なら入れ替える", () => {
    const works = [work("a"), work("b", undefined, { sortOrder: 1, targetWorkEndDate: "2026-09-30" })];
    expect(ids(reorderScheduleWorks(works, works, "a", 1))).toEqual(["b", "a"]);
  });
  it("上への移動と連続した入れ替えを保存できる", () => {
    const works = [work("a"), work("b", undefined, { sortOrder: 1 }), work("c", undefined, { sortOrder: 2 })];
    const once = reorderScheduleWorks(works, works, "c", -1);
    const twice = reorderScheduleWorks(once, once, "c", -1);
    expect(ids(once)).toEqual(["a", "c", "b"]);
    expect(ids(JSON.parse(JSON.stringify(twice)))).toEqual(["c", "a", "b"]);
  });
  it("最上段・最下段では保存しない", () => {
    const works = [work("a"), work("b", undefined, { sortOrder: 1 })];
    expect(reorderScheduleWorks(works, works, "a", -1)).toBe(works);
    expect(reorderScheduleWorks(works, works, "b", 1)).toBe(works);
  });
  it("別の開始日やマイルストーンの作業を変更しない", () => {
    const works = [work("a"), work("b", undefined, { sortOrder: 1 }), work("c", "2026-09-22"), work("other", undefined, { milestoneId: "other" })];
    const next = reorderScheduleWorks(works, works, "a", 1);
    expect(next[2]).toBe(works[2]); expect(next[3]).toBe(works[3]);
    expect(sameStartScheduleWorks(works, works[0]).map(w => w.id)).toEqual(["a", "b"]);
  });
  it("日付未設定同士は並び替えの対象にしない", () => {
    const works = [work("a", ""), work("b", "")];
    expect(sameStartScheduleWorks(works, works[0])).toEqual([]);
    expect(reorderScheduleWorks(works, works, "a", 1)).toBe(works);
  });
  it("プロジェクト直属の作業も同じ開始日なら並び替える", () => {
    const works = [work("a", undefined, { milestoneId: "" }), work("b", undefined, { milestoneId: "", sortOrder: 1 })];
    expect(ids(reorderScheduleWorks(works, works, "a", 1))).toEqual(["b", "a"]);
  });
  it("表示用データを保存せず、日付・工数・優先度・従来の順序・実績を維持する", () => {
    const stored = [work("a"), work("b", undefined, { sortOrder: 1 })];
    const snapshot = structuredClone(stored);
    const displayed = stored.map(w => ({ ...w, title: "関連タスクの名称", dueDate: "", plannedHours: 99, actualHours: 99, priority: "B" as const, plannedRanges: [] }));
    const next = reorderScheduleWorks(stored, displayed, "a", 1);
    expect(next.map(({ scheduleSortOrder: _, ...rest }) => rest)).toEqual(snapshot);
    expect(stored).toEqual(snapshot);
    expect(next[0].plannedRanges).toBe(stored[0].plannedRanges);
  });
  it("従来画面でsortOrderが再計算されてもスケジュールの順序は維持する", () => {
    const works = [work("a"), work("b", undefined, { sortOrder: 1 })];
    const next = reorderScheduleWorks(works, works, "a", 1);
    expect(ids(next.map(w => ({ ...w, sortOrder: w.id === "a" ? 0 : 1 })))).toEqual(["b", "a"]);
  });
  it("順序の重複があっても一括で一意な順序を保存する", () => {
    const works = [work("a"), work("b"), work("c")];
    expect(ids(reorderScheduleWorks(works, works, "a", 1))).toEqual(["b", "a", "c"]);
  });
  it("不明なID・重複ID・保存データの欠落がある場合は変更しない", () => {
    const works = [work("a"), work("b")];
    expect(reorderScheduleWorks(works, works, "unknown", 1)).toBe(works);
    expect(reorderScheduleWorks(works, [...works, work("a")], "a", 1)).toBe(works);
    const stored = [works[0]];
    expect(reorderScheduleWorks(stored, works, "a", 1)).toBe(stored);
  });
});
