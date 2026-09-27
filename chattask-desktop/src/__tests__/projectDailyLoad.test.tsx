import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { assessProjectDailyCapacity, assessProjectWorkCapacity } from "../projectCapacity";
import { ProjectDailyLoad } from "../components/ProjectDailyLoad";
import type { Goal, ProjectWorkItem } from "../types";

const work = (id: string, plannedHours: number, changes: Partial<ProjectWorkItem> = {}): ProjectWorkItem => ({
  id, title: id, description: "保持", milestoneId: "m", linkedTaskId: "", status: "not-started", priority: "A", dueDate: "", plannedHours, actualHours: 0, sortOrder: 0, targetWorkStartDate: "2026-09-28", targetWorkEndDate: "2026-10-02", createdAt: "created", updatedAt: "updated", ...changes,
});
const project = (id: string, workItems: ProjectWorkItem[]): Goal => ({ id, title: id, description: "", successCriteria: "", dueDate: "", status: "in-progress", projectTagId: "", taskIds: [], milestones: [], reviews: [], workItems, createdAt: "created", updatedAt: "updated" });
const dates = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];
const assess = (projects: Goal[], dailyCapacityHours = 6) => assessProjectDailyCapacity({ projects, periods: [], dates, dailyCapacityHours, currentProjectId: "current" });

describe("全プロジェクトの日別負荷", () => {
  it("複数プロジェクトと複数作業を合計し内訳を保持する", () => {
    const result = assess([project("current", [work("a", 10), work("b", 5)]), project("other", [work("a", 20)])]);
    for (const day of result.days) {
      expect(day.plannedHours).toBe(7); expect(day.capacityHours).toBe(6); expect(day.over).toBe(true);
      expect(day.currentProjectHours).toBe(3); expect(day.otherProjectHours).toBe(4);
      expect(day.contributions).toHaveLength(3);
    }
  });
  it("表示期間の一部だけを見ても全期間の営業日で配分する", () => {
    const result = assessProjectDailyCapacity({ projects: [project("current", [work("a", 10)])], periods: [], dates: [dates[2]], dailyCapacityHours: 6, currentProjectId: "current" });
    expect(result.days[0].plannedHours).toBe(2);
  });
  it("土日と休暇は確保0hで配分対象外にする", () => {
    const result = assessProjectDailyCapacity({ projects: [project("current", [work("a", 12, { targetWorkStartDate: "2026-09-25", targetWorkEndDate: "2026-09-29" })])], periods: [{ id: "leave", startDate: "2026-09-28", endDate: "2026-09-28", type: "vacation" }], dates: ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29"], dailyCapacityHours: 6, currentProjectId: "current" });
    expect(result.days.map(d => d.plannedHours)).toEqual([6, 0, 0, 0, 6]);
    expect(result.days.map(d => d.capacityHours)).toEqual([6, 0, 0, 0, 6]);
    expect(result.days.every(d => !d.over)).toBe(true);
  });
  it("完了作業は工数・未入力件数・期間未設定件数に含めない", () => {
    const result = assess([project("current", [work("done", 100, { status: "done" }), work("unsetDone", 0, { status: "done", targetWorkStartDate: "" }), work("active", 5)])]);
    expect(result.days[0].plannedHours).toBe(1); expect(result.days[0].contributions).toHaveLength(1);
    expect(result.days[0].missingEstimateCount).toBe(0); expect(result.unscheduledWorkCount).toBe(0);
  });
  it("工数未入力を0hの余裕と区別する", () => {
    const result = assess([project("current", [work("unknown", 0), work("negative", -1)])]);
    expect(result.days[0].plannedHours).toBe(0); expect(result.days[0].missingEstimateCount).toBe(2);
  });
  it("期間なし・逆転・休日のみは配分せず集計外として報告する", () => {
    const result = assess([project("current", [work("unset", 3, { targetWorkStartDate: "" }), work("invalid", 3, { targetWorkEndDate: "2026-09-01" }), work("weekend", 3, { targetWorkStartDate: "2026-09-26", targetWorkEndDate: "2026-09-27" })])]);
    expect(result.unscheduledWorkCount).toBe(3); expect(result.days.every(d => d.plannedHours === 0)).toBe(true);
  });
  it("予定なしでも営業日の確保時間を表示する", () => {
    const day = assess([]).days[0]; expect(day.plannedHours).toBe(0); expect(day.capacityHours).toBe(6); expect(day.over).toBe(false);
  });
  it("容量変更で超過判定を再計算し、小数の境界は丸め誤差で超過にしない", () => {
    const projects = [project("current", [work("a", 10)])];
    expect(assess(projects, 2).days[0].over).toBe(false); expect(assess(projects, 1).days[0].over).toBe(true);
    const fractional = assess([project("current", Array.from({ length: 10 }, (_, i) => work(String(i), 0.5)))], 1);
    expect(fractional.days[0].over).toBe(false);
  });
  it("既存の作業別チェックの競合工数と一致する", () => {
    const w = work("a", 10); const projects = [project("current", [w]), project("other", [work("b", 20)])];
    const dayResult = assess(projects);
    const workResult = assessProjectWorkCapacity({ projects, projectId: "current", work: w, periods: [], dailyCapacityHours: 6 });
    expect(dayResult.days.reduce((sum, d) => sum + d.otherProjectHours, 0)).toBe(workResult.competingHours);
    expect(dayResult.days.reduce((sum, d) => sum + d.currentProjectHours, 0)).toBe(workResult.requiredHours);
  });
  it("目標期間を使い実作業日やマイルストーンを重複加算しない", () => {
    const p = project("current", [work("a", 10, { plannedRanges: [{ id: "range", startDate: "2026-10-10", endDate: "2026-10-11", plannedHours: 50 }] })]);
    p.milestones = [{ id: "m", title: "m", completed: false, taskIds: [], plannedHours: 100 }];
    expect(assess([p]).days[0].plannedHours).toBe(2);
  });
  it("日付変更後は再集計でき、入力データを変更しない", () => {
    const p = project("current", [work("a", 10)]); const snapshot = structuredClone(p);
    assess([p]); expect(p).toEqual(snapshot);
    const changed = { ...p, workItems: [{ ...p.workItems![0], targetWorkStartDate: "2026-09-29" }] };
    expect(assess([changed]).days.map(d => d.plannedHours)).toEqual([0, 2.5, 2.5, 2.5, 2.5]);
  });
});

describe("日別負荷の表示", () => {
  it("超過を赤色用クラスと文字で示し、内訳をツールチップに表示する", () => {
    const { days } = assess([project("current", [work("a", 35)])]);
    const html = renderToStaticMarkup(<ProjectDailyLoad days={days} dayWidth={30} />);
    expect(html).toContain("is-over"); expect(html).toContain("予定7h／確保6h（超過）");
    expect(html).toContain("current / a：7h"); expect(html).toContain("repeat(5, 30px)");
  });
  it("工数未入力を明示する", () => {
    const { days } = assess([project("current", [work("unknown", 0)])]);
    const html = renderToStaticMarkup(<ProjectDailyLoad days={days} dayWidth={30} />);
    expect(html).toContain("has-missing"); expect(html).toContain("工数未入力1件"); expect(html).toContain(">?</span>");
  });
});
