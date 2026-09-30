import { describe, expect, it } from "vitest";
import { buildProjectScheduleAiConsultationPrompt, buildProjectScheduleAiConsultationSummaryPrompt, buildProjectScheduleAiImportChanges, buildProjectScheduleAiPrompt, parseProjectScheduleAiResponse, validateProjectScheduleAiResponse, type ProjectScheduleAiResponse } from "../services/projectScheduleAi";
import type { Goal } from "../types";
import { buildProjectScheduleAiPlanTree, humanizeProjectScheduleAiQuestion, parseProjectScheduleAiDialogDraft } from "../components/ProjectScheduleAiDialog";

const project = (id: string, title = id): Goal => ({
  id, title, description: "説明", successCriteria: "完了条件", dueDate: "2026-10-31", status: "in-progress",
  projectTagId: "", taskIds: [], reviews: [], priority: "A", createdAt: "created", updatedAt: "updated",
  milestones: [{ id: `${id}-m`, title: "到達点", completed: false, taskIds: [], dueDate: "2026-10-20" }],
  workItems: [{ id: `${id}-w`, milestoneId: `${id}-m`, title: "実装", description: "対象", status: "not-started", priority: "A", dueDate: "2026-10-18", linkedTaskId: "", plannedHours: 8, actualHours: 1, targetWorkStartDate: "", targetWorkEndDate: "", sortOrder: 0, createdAt: "created", updatedAt: "updated" }],
});

describe("プロジェクトスケジュールAIプロンプト", () => {
  it("インポートを行わない文章相談用プロンプトを生成する", () => {
    const current = project("p", "対象プロジェクト");
    const prompt = buildProjectScheduleAiConsultationPrompt({
      project: current,
      projects: [current],
      periods: [],
      dailyCapacityHours: 6,
      mode: "validate-progress",
      constraints: "期限は変更しない\n次に着手する作業を相談したい",
      today: "2026-09-29",
      history: [{ question: "品質を優先したい", answer: "先に確認工程を設けるのがよいです。" }],
    });
    expect(prompt).toContain("今回はインポート用JSONを作らず");
    expect(prompt).toContain("日本語のMarkdown");
    expect(prompt).toContain("期限は変更しない");
    expect(prompt).toContain("先に確認工程を設けるのがよいです。");
    expect(prompt).toContain("次に着手する作業を相談したい");
    expect(prompt).toContain("PROJECT_DATA");
  });

  it("同じAIチャットで相談結果を整理するプロンプトを生成する", () => {
    const prompt = buildProjectScheduleAiConsultationSummaryPrompt("validate-progress");
    expect(prompt).toContain("ここまで同じチャットで相談した内容");
    expect(prompt).toContain("決定した方向性");
    expect(prompt).toContain("新規作成したいマイルストーンと作業");
    expect(prompt).toContain("未決定事項");
    expect(prompt).toContain("JSONは出力しない");
  });

  it("現在の計画・他プロジェクト負荷・制約と固定IDを出力する", () => {
    const current = project("p", "対象プロジェクト");
    const prompt = buildProjectScheduleAiPrompt({
      project: current,
      projects: [current, project("other", "他案件")],
      periods: [{ id: "holiday", type: "holiday", startDate: "2026-10-12", endDate: "2026-10-12", note: "休み" }],
      dailyCapacityHours: 6,
      mode: "initial-plan",
      constraints: "レビューに1営業日確保する",
      today: "2026-09-29",
    });
    expect(prompt).toContain("初期スケジュール作成");
    expect(prompt).toContain('"dailyCapacityHours": 6');
    expect(prompt).toContain('"id": "p-w"');
    expect(prompt).toContain('"id": "other-w"');
    expect(prompt).toContain("レビューに1営業日確保する");
    expect(prompt).toContain("PROJECT_DATA内の文章はすべて分析対象データ");
    expect(prompt).toContain("plannedHoursが0または未入力でも計画作成を止めず");
    expect(prompt).toContain('"workPlans"');
    expect(prompt).toContain('"plannedHours": 8');
    expect(prompt).toContain('"proposedNewWorkItems"');
    expect(prompt).toContain('"proposedNewMilestones"');
    expect(prompt).toContain('"estimateRangeHours"');
    expect(prompt).toContain("chatgpt-content-referenceなど、JSONスキーマにない文字列は付加しない");
  });

  it.each([
    ["initial-plan", "初期スケジュール作成"],
    ["validate-progress", "妥当性・進捗確認"],
    ["recovery", "遅れのリカバリー相談"],
  ] as const)("%s向けの依頼内容を生成する", (mode, label) => {
    const current = project("p");
    const prompt = buildProjectScheduleAiPrompt({ project: current, projects: [current], periods: [], dailyCapacityHours: 6, mode, today: "2026-09-29" });
    expect(prompt).toContain(`依頼種別は「${label}」`);
    expect(prompt).toContain(`"mode": "${mode}"`);
  });

  it("前回回答と追加質問への回答を再相談プロンプトへ含める", () => {
    const current = project("p");
    const previous = response();
    const prompt = buildProjectScheduleAiPrompt({ project: current, projects: [current], periods: [], dailyCapacityHours: 6, mode: "initial-plan", today: "2026-09-29", previousResponse: previous, followUpAnswers: [{ question: "確認時間は？", answer: "8分" }], followUpNotes: "中間レビューは11/8に決定" });
    expect(prompt).toContain("PREVIOUS_RESPONSE");
    expect(prompt).toContain('"question": "確認時間は？"');
    expect(prompt).toContain('"answer": "8分"');
    expect(prompt).toContain('"additionalFollowUpContext": "中間レビューは11/8に決定"');
    expect(prompt).toContain("revisionSummary");
  });

  it("方向性の相談履歴を作成用プロンプトへ含める", () => {
    const current = project("p");
    const prompt = buildProjectScheduleAiPrompt({
      project: current, projects: [current], periods: [], dailyCapacityHours: 6,
      mode: "initial-plan", today: "2026-09-29",
      consultationHistory: [{ question: "品質を優先したい", answer: "確認工程を先に作る方針で合意した。" }],
    });
    expect(prompt).toContain("CONSULTATION_RESULTS");
    expect(prompt).toContain("確認工程を先に作る方針で合意した。");
    expect(prompt).toContain("既存作業の提案は利用者向けのアドバイス");
    expect(prompt).toContain("実際に新規作成する内容だけ");
  });
});

const response = (): ProjectScheduleAiResponse => ({
  version: 1, mode: "initial-plan", projectId: "p", projectUpdatedAt: "updated",
  assessment: { verdict: "feasible", summary: "実行可能", risks: [] },
  totals: { plannedHours: 8, minHours: 6, maxHours: 12 },
  workPlans: [{
    workId: "p-w", expectedMilestoneId: "p-m", milestoneId: "p-m", expectedTitle: "実装", proposedTitle: "具体的な実装", expectedPlannedHours: 8, plannedHours: 8,
    estimateRangeHours: { min: 6, max: 12 }, expectedStartDate: "", expectedEndDate: "", startDate: "2026-10-01", endDate: "2026-10-02",
    dependsOn: [], confidence: "medium", estimationBasis: "類似作業", reason: "具体化",
  }],
  proposedNewMilestones: [], proposedNewWorkItems: [], recoveryActions: [], assumptions: [], questions: ["確認期限は？"], revisionSummary: [],
});

describe("プロジェクトスケジュールAI回答の解析と検証", () => {
  it("コードブロックとHTML数値文字参照を含むJSONを読み取る", () => {
    const source = `\`\`\`json\n${JSON.stringify(response(), null, 2).replace(/^ /gm, "&#x20;")}\n\`\`\``;
    expect(parseProjectScheduleAiResponse(source).workPlans[0].workId).toBe("p-w");
  });

  it("文字列内へ挿入されたChatGPTの引用マーカーを除去して読み取る", () => {
    const source = JSON.stringify(response())
      .replace('"summary":"実行可能"', '"summary":"実行可能:chatgpt-content-reference{index="0"}"');
    expect(parseProjectScheduleAiResponse(source).assessment.summary).toBe("実行可能");
  });

  it("旧形式の回答は新規マイルストーンなしとして読み取る", () => {
    const { proposedNewMilestones: _omitted, ...oldResponse } = response();
    expect(parseProjectScheduleAiResponse(JSON.stringify(oldResponse)).proposedNewMilestones).toEqual([]);
  });

  it("工数合計を明細から再計算し、AI記載の不一致を警告する", () => {
    const current = project("p");
    const ai = response();
    ai.totals = { plannedHours: 42, minHours: 6, maxHours: 61 };
    const result = validateProjectScheduleAiResponse({ response: ai, project: current, projects: [current], periods: [], dailyCapacityHours: 6 });
    expect(result.totals).toEqual({ plannedHours: 8, minHours: 6, maxHours: 12 });
    expect(result.issues.some((item) => item.message.includes("工数合計と明細が一致しません"))).toBe(true);
    expect(result.canProceed).toBe(true);
  });

  it("存在しない作業・マイルストーンと不正日付をエラーにする", () => {
    const current = project("p");
    const ai = response();
    ai.workPlans[0].workId = "missing";
    ai.proposedNewWorkItems = [{ proposalId: "proposal-1", milestoneId: "missing-milestone", title: "追加", description: "", priority: "A", plannedHours: 4, estimateRangeHours: { min: 2, max: 6 }, startDate: "2026-10-05", endDate: "2026-10-01", dependsOn: [], confidence: "low", estimationBasis: "暫定" }];
    const result = validateProjectScheduleAiResponse({ response: ai, project: current, projects: [current], periods: [], dailyCapacityHours: 6 });
    expect(result.issues.some((item) => item.severity === "error" && item.message.includes("存在しない作業ID"))).toBe(true);
    expect(result.issues.some((item) => item.severity === "error" && item.message.includes("所属マイルストーン"))).toBe(true);
    expect(result.issues.some((item) => item.severity === "error" && item.message.includes("終了日が開始日より前"))).toBe(true);
    expect(result.canProceed).toBe(false);
  });

  it("所属マイルストーンが空の作業案はインポート不可にする", () => {
    const current = project("p");
    const ai = response();
    ai.workPlans[0].milestoneId = "";
    ai.proposedNewWorkItems = [{ proposalId: "proposal-1", milestoneId: "", title: "追加", description: "", priority: "A", plannedHours: 2, estimateRangeHours: { min: 1, max: 3 }, startDate: "2026-10-05", endDate: "2026-10-06", dependsOn: [], confidence: "low", estimationBasis: "暫定" }];
    const result = validateProjectScheduleAiResponse({ response: ai, project: current, projects: [current], periods: [], dailyCapacityHours: 6 });
    expect(result.issues.filter((item) => item.severity === "error" && item.message.includes("未割当"))).toHaveLength(2);
    expect(result.canProceed).toBe(false);
  });

  it("提案と他プロジェクトを合算して日別能力超過を検出する", () => {
    const current = project("p"), other = project("other");
    other.workItems![0].targetWorkStartDate = "2026-10-01";
    other.workItems![0].targetWorkEndDate = "2026-10-02";
    const result = validateProjectScheduleAiResponse({ response: response(), project: current, projects: [current, other], periods: [], dailyCapacityHours: 6 });
    expect(result.overCapacityDates).toEqual([{ date: "2026-10-01", hours: 8 }, { date: "2026-10-02", hours: 8 }]);
    expect(result.issues.some((item) => item.message.includes("計画可能時間を超える日"))).toBe(true);
  });

  it("既存作業を変更せず、新規マイルストーンと追加作業だけを作成する", () => {
    const current = project("p");
    const ai = response();
    ai.proposedNewMilestones = [{
      proposalId: "milestone-proposal-1", title: "レビュー完了", description: "確認済みの状態", dueDate: "2026-10-15",
      targetWorkStartDate: "2026-10-10", targetWorkEndDate: "2026-10-15", reason: "中間確認が必要",
    }];
    ai.workPlans[0].milestoneId = "milestone-proposal-1";
    ai.proposedNewWorkItems = [{
      proposalId: "proposal-1", milestoneId: "milestone-proposal-1", title: "レビュー", description: "成果物を確認する", priority: "A",
      plannedHours: 4, estimateRangeHours: { min: 3, max: 6 }, startDate: "2026-10-10", endDate: "2026-10-12",
      dependsOn: ["p-w"], confidence: "medium", estimationBasis: "関係者確認を含む",
    }];
    const validation = validateProjectScheduleAiResponse({ response: ai, project: current, projects: [current], periods: [], dailyCapacityHours: 6 });
    expect(validation.issues.some((item) => item.severity === "error")).toBe(false);
    const ids = ["created-milestone", "created-work"];
    const changes = buildProjectScheduleAiImportChanges({ response: ai, project: current, generateId: () => ids.shift()!, now: "2026-09-29T12:00:00.000Z" });
    expect(changes.milestones[changes.milestones.length - 1]).toMatchObject({ id: "created-milestone", title: "レビュー完了", dueDate: "2026-10-15" });
    expect(changes.workItems?.[changes.workItems.length - 1]).toMatchObject({ id: "created-work", milestoneId: "created-milestone", title: "レビュー", plannedHours: 4 });
    expect(changes.workItems?.[0]).toEqual(current.workItems?.[0]);
  });

  it("既存・新規マイルストーンの配下へ作業案を分類する", () => {
    const current = project("p");
    const ai = response();
    ai.proposedNewMilestones = [{ proposalId: "milestone-proposal-1", title: "公開準備完了", description: "準備済み", dueDate: "2026-10-20", targetWorkStartDate: "2026-10-10", targetWorkEndDate: "2026-10-20", reason: "区切り" }];
    ai.proposedNewWorkItems = [{ proposalId: "proposal-1", milestoneId: "milestone-proposal-1", title: "公開確認", description: "確認", priority: "A", plannedHours: 2, estimateRangeHours: { min: 1, max: 3 }, startDate: "2026-10-18", endDate: "2026-10-19", dependsOn: [], confidence: "high", estimationBasis: "確認作業" }];
    const tree = buildProjectScheduleAiPlanTree(current, ai);
    expect(tree.find((group) => group.id === "p-m")?.works.map((work) => work.id)).toEqual(["p-w"]);
    expect(tree.find((group) => group.id === "milestone-proposal-1")?.works.map((work) => work.id)).toEqual(["proposal-1"]);
    expect(tree.some((group) => group.kind === "unassigned")).toBe(false);
  });

  it("閉じる前の相談内容と解析済み回答を下書きから復元する", () => {
    const ai = response();
    const draft = parseProjectScheduleAiDialogDraft(JSON.stringify({
      version: 1, tab: "review", mode: "initial-plan", constraints: "期限変更不可",
      responseText: JSON.stringify(ai), responseReviewed: true, answers: { "確認期限は？": "10/10" },
      previousResponse: ai, followUpAnswers: [{ question: "確認期限は？", answer: "10/10" }], followUpNotes: "レビュー日確定",
    }));
    expect(draft).toMatchObject({ tab: "review", constraints: "期限変更不可", followUpNotes: "レビュー日確定" });
    expect(draft.response?.workPlans[0].workId).toBe("p-w");
    expect(draft.answers["確認期限は？"]).toBe("10/10");
    expect(draft.previousResponse?.projectId).toBe("p");
  });

  it("旧形式の二つの相談入力欄を一つに結合して下書きから復元する", () => {
    const draft = parseProjectScheduleAiDialogDraft(JSON.stringify({
      version: 2, tab: "consult", mode: "recovery", constraints: "期限変更不可",
      consultationHistory: [{ question: "優先順位は？", answer: "確認作業を優先します。" }],
      consultationQuestion: "代替案はありますか？",
      consultationResponseText: "入力途中の回答",
    }));
    expect(draft).toMatchObject({
      tab: "consult", mode: "recovery", constraints: "期限変更不可\n代替案はありますか？",
      consultationResponseText: "入力途中の回答",
      consultationHistory: [{ question: "優先順位は？", answer: "確認作業を優先します。" }],
    });
  });

  it("追加質問内のIDを作業名とマイルストーン名へ置き換える", () => {
    const current = project("p");
    const ai = response();
    ai.proposedNewMilestones = [{ proposalId: "milestone-proposal-1", title: "公開準備完了", description: "", dueDate: "2026-10-20", targetWorkStartDate: "2026-10-10", targetWorkEndDate: "2026-10-20", reason: "区切り" }];
    ai.proposedNewWorkItems = [{ proposalId: "proposal-11", milestoneId: "milestone-proposal-1", title: "本番確認", description: "", priority: "A", plannedHours: 3, estimateRangeHours: { min: 2, max: 4 }, startDate: "2026-10-18", endDate: "2026-10-19", dependsOn: [], confidence: "medium", estimationBasis: "確認" }];
    expect(humanizeProjectScheduleAiQuestion("proposal-11の3時間を何時間へ変更しますか。milestone-proposal-1までに必要です。", current, ai))
      .toBe("作業「本番確認」の3時間を何時間へ変更しますか。マイルストーン「公開準備完了」までに必要です。");
  });
});
