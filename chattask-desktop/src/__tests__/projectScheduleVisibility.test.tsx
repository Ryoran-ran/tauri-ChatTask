import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { projectScheduleVisibility } from "../projectScheduleVisibility";
import { compareScheduleWorks, reorderScheduleWorks } from "../projectScheduleOrder";
import { ProjectSchedulePlanner } from "../components/ProjectSchedulePlanner";
import type { Goal, GoalMilestone, ProjectWorkItem } from "../types";

const milestone = (id: string, completed = false): GoalMilestone => ({ id, title: id, completed, taskIds: [], status: completed ? "achieved" : "not-started" });
const work = (id: string, milestoneId = "m", status: ProjectWorkItem["status"] = "not-started", sortOrder = 0): ProjectWorkItem => ({
  id, title: id, description: "保持", milestoneId, status, sortOrder, linkedTaskId: "", priority: "A", dueDate: "2026-09-30", plannedHours: 3, actualHours: 1, targetWorkStartDate: "2026-09-21", targetWorkEndDate: "2026-09-25", createdAt: "created", updatedAt: "updated",
});
const project = (changes: Partial<Goal> = {}): Goal => ({ id: "p", title: "project", description: "", successCriteria: "", dueDate: "", status: "in-progress", projectTagId: "", taskIds: [], reviews: [], milestones: [milestone("m")], workItems: [work("active"), work("finished", "m", "done")], createdAt: "created", updatedAt: "updated", ...changes });
afterEach(() => vi.unstubAllGlobals());

describe("完了済みの表示切り替え", () => {
  it("完了作業だけを非表示にして未着手・進行中は残す", () => {
    const p = project({ workItems: [work("todo"), work("doing", "m", "in-progress"), work("done", "m", "done")] });
    const result = projectScheduleVisibility(p, false);
    expect(result.groups[0].works.map(w => w.id)).toEqual(["doing", "todo"]);
    expect(result.groups[0].totalWorkCount).toBe(3);
    expect(result.hiddenWorkCount).toBe(1);
  });
  it("完了マイルストーンと完了した子作業を隠す", () => {
    const result = projectScheduleVisibility(project({ milestones: [milestone("m", true)], workItems: [work("done", "m", "done")] }), false);
    expect(result.groups).toEqual([]);
    expect(result.hiddenMilestoneCount).toBe(1); expect(result.hiddenWorkCount).toBe(1);
  });
  it("完了マイルストーンにも未完了の作業があれば親と未完了作業を残す", () => {
    const result = projectScheduleVisibility(project({ milestones: [milestone("m", true)] }), false);
    expect(result.groups[0].works.map(w => w.id)).toEqual(["active"]);
    expect(result.hiddenMilestoneCount).toBe(0);
  });
  it("空の未完了マイルストーンは残し、空の完了マイルストーンは隠す", () => {
    const result = projectScheduleVisibility(project({ milestones: [milestone("open"), milestone("closed", true)], workItems: [] }), false);
    expect(result.groups.map(g => g.id)).toEqual(["open"]);
    expect(result.hiddenMilestoneCount).toBe(1);
  });
  it("statusがない旧形式はcompletedを使い、statusがあればそちらを優先する", () => {
    const result = projectScheduleVisibility(project({ milestones: [{ ...milestone("legacy", true), status: undefined }, { ...milestone("active", true), status: "in-progress" }], workItems: [] }), false);
    expect(result.groups.map(g => g.id)).toEqual(["active"]);
  });
  it("未割当の作業も絞り込み、すべて完了なら未割当グループを隠す", () => {
    const p = project({ milestones: [], workItems: [work("done", "", "done")] });
    expect(projectScheduleVisibility(p, false)).toEqual({ groups: [], hiddenMilestoneCount: 0, hiddenWorkCount: 1 });
    expect(projectScheduleVisibility(p, true).groups[0].works).toEqual(p.workItems);
  });
  it("再表示時に全件を元の順番で表示し、元データは変更しない", () => {
    const p = project({ milestones: [milestone("m", true)], workItems: [work("last", "m", "done", 2), work("first", "m", "done", 0)] });
    const original = structuredClone(p);
    projectScheduleVisibility(p, false);
    const result = projectScheduleVisibility(p, true);
    expect(result.groups[0].works.map(w => w.id)).toEqual(["first", "last"]);
    expect(result.hiddenWorkCount).toBe(0); expect(result.hiddenMilestoneCount).toBe(0);
    expect(p).toEqual(original);
    expect(result.groups[0].works[0]).toBe(p.workItems![1]);
  });
  it("ステータス変更後も最新の状態を反映する", () => {
    const p = project(); expect(projectScheduleVisibility(p, false).groups[0].works).toHaveLength(1);
    const reopened = { ...p, workItems: p.workItems!.map(w => ({ ...w, status: "in-progress" as const })) };
    expect(projectScheduleVisibility(reopened, false).groups[0].works).toHaveLength(2);
  });
});

describe("非表示中の並び替え", () => {
  const works = () => [work("a", "m", "not-started", 0), work("hidden", "m", "done", 1), work("b", "m", "not-started", 2)];
  it("完了項目を飛ばして見えている隣の行へ移動し、非表示の行を削除しない", () => {
    const stored = works(); const result = reorderScheduleWorks(stored, stored, "a", 1, false);
    expect([...result].sort(compareScheduleWorks).map(w => w.id)).toEqual(["b", "hidden", "a"]);
    expect(result.map(({ scheduleSortOrder: _, ...rest }) => rest)).toEqual(stored);
  });
  it("非表示の項目だけが隣にあるときや非表示の対象は移動しない", () => {
    const stored = works();
    expect(reorderScheduleWorks(stored, stored, "b", 1, false)).toBe(stored);
    expect(reorderScheduleWorks(stored, stored, "a", -1, false)).toBe(stored);
    expect(reorderScheduleWorks(stored, stored, "hidden", 1, false)).toBe(stored);
  });
  it("全件表示なら従来通り完了項目とも順番を変えられる", () => {
    const stored = works();
    expect(reorderScheduleWorks(stored, stored, "a", 1, true).sort(compareScheduleWorks).map(w => w.id)).toEqual(["hidden", "a", "b"]);
  });
});

describe("スケジュール画面の表示設定", () => {
  const render = (p = project()) => renderToStaticMarkup(<ProjectSchedulePlanner project={p} projects={[p]} periods={[]} dailyCapacityHours={6} onDailyCapacityHoursChange={vi.fn()} onAddMilestone={vi.fn()} onEditMilestone={vi.fn()} onAddWork={vi.fn()} onEditWork={vi.fn()} onUpdateMilestone={vi.fn()} onUpdateWork={vi.fn()} onReorderWork={vi.fn()} onSyncWorkDates={() => null} />);
  it("初期値は完了非表示で、同期件数からは完了作業を除外しない", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const html = render();
    expect(html).toContain("完了済みを表示"); expect(html).toContain("作業 1件");
    expect(html).not.toContain('title="finished"'); expect(html).toContain('title="active"');
    expect(html).toContain("作業日を同期（差異2件）");
  });
  it("保存済みの全件表示設定を読み込む", () => {
    vi.stubGlobal("localStorage", { getItem: () => "true" });
    const html = render();
    expect(html).toContain('checked=""'); expect(html).toContain('title="finished"');
  });
  it("すべて非表示でも再表示の操作と案内が残る", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const html = render(project({ milestones: [milestone("m", true)], workItems: [work("done", "m", "done")] }));
    expect(html).toContain("表示対象の項目はありません。"); expect(html).toContain("完了済みを表示");
  });
  it("保存領域が使用できなくても描画できる", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("storage disabled"); } });
    expect(render()).toContain("完了済みを表示");
  });
});
