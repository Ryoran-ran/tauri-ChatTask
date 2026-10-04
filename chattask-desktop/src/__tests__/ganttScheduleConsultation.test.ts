import { describe, expect, it } from "vitest";
import { buildGanttScheduleConsultationPrompt } from "../services/ganttScheduleConsultation";

describe("ガントチャートのスケジュール相談", () => {
  it("自動変更を行わない相談用プロンプトを生成する", () => {
    const prompt = buildGanttScheduleConsultationPrompt({
      title: "全Task・プロジェクト",
      today: "2026-10-03",
      dailyCapacityHours: 6,
      periods: [],
      question: "来月の締切に間に合うか確認したい",
      items: [{
        kind: "作業",
        title: "免許情報を更新する",
        parentTitle: "宅建免許更新",
        hierarchyDepth: 2,
        summary: false,
        description: "",
        status: "進行中",
        priority: "A",
        baselineRanges: [],
        plannedRanges: [{ id: "range-1", startDate: "2026-10-05", endDate: "2026-10-09", plannedHours: 8 }],
        actualDates: [],
        achievedDates: [],
        plannedHours: 8,
        actualHours: 2,
        dueDate: "2026-10-10",
      }],
    });

    expect(prompt).toContain("今回は相談だけを行います");
    expect(prompt).toContain("データを更新するJSON");
    expect(prompt).toContain("来月の締切に間に合うか確認したい");
    expect(prompt).toContain('"dailyCapacityHours": 6');
    expect(prompt).toContain("子項目と工数を二重計上しない");
    expect(prompt).toContain("一問一答で終了させず");
    expect(prompt).toContain("判断への影響が大きい質問を優先度順に最大3問");
    expect(prompt).toContain("回答済みの質問を言い換えて繰り返さず");
    expect(prompt).toContain("同じAIチャット内");
    expect(prompt).toContain("免許情報を更新する");
  });
});
