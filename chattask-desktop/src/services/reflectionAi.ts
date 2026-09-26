import type { Goal, Task, TaskReflection, TaskReflectionAiAnalysis } from "../types";
import { groupedReflectionThemeLabels } from "../reflectionThemes";
import { taskProjectContexts } from "../projectContext";

export const buildReflectionAnalysisPrompt = (task: Task, reflection: TaskReflection, allTasks: Task[], projects: Goal[]) => {
  const plannedHours = task.plannedRanges.reduce((sum, range) => sum + Math.max(0, Number(range.plannedHours) || 0), 0) || Math.max(0, Number(task.plannedHours) || 0);
  const actualHours = Math.max(0, Number(task.actualHours) || 0);
  const themes = groupedReflectionThemeLabels(reflection.themes || [], reflection.otherTheme);
  const parentTask = allTasks.find((candidate) => candidate.id === task.parentTaskId);
  const childTasks = allTasks.filter((candidate) => candidate.parentTaskId === task.id);
  const relatedTasks = task.relatedTasks.flatMap((link) => {
    const related = allTasks.find((candidate) => candidate.id === link.taskId);
    return related ? [{ relation: link.relation, task: related }] : [];
  });
  const projectContexts = taskProjectContexts(projects, task.id);
  const projectData = projects.flatMap((project) => {
    const contexts = projectContexts.filter((context) => context.projectId === project.id);
    return contexts.length ? [{ contexts, project }] : [];
  });
  const taskHours = (candidate: Task) => ({
    planned: candidate.plannedRanges.reduce((sum, range) => sum + Math.max(0, Number(range.plannedHours) || 0), 0) || Math.max(0, Number(candidate.plannedHours) || 0),
    actual: Math.max(0, Number(candidate.actualHours) || 0),
  });
  const scheduleLines = task.plannedRanges.slice(-20).map((range) => {
    const attributes = [range.status || "not-started", range.plannedHours ? `${range.plannedHours}h` : "工数未設定"];
    if (range.carriedOverFrom) attributes.push("持ち越し");
    if (range.advancedFromStartDate) attributes.push("前倒し");
    return `  - ${range.startDate}${range.endDate && range.endDate !== range.startDate ? `〜${range.endDate}` : ""}: ${attributes.join(" / ")}`;
  });
  const recentComments = task.history.filter((entry) => entry.type === "comment").slice(-5).map((entry) => `  - ${entry.timestamp}: ${entry.text}`);
  const followUpAnswers = (reflection.followUpAnswers || []).filter((item) => item.answer.trim());
  const previousAnalysis = reflection.aiAnalysis;
  const successFocused = reflection.kind === "success";
  const focusInstruction = successFocused
    ? "これは成功・うまくいったことを定着させるための振り返りです。成功要因、再現条件、継続方法、改善時にも失わない点を中心に分析してください。問題や失敗が明記されていない場合、原因仮説や再発防止策を無理に作らないでください。"
    : "これは問題や改善点を次回へ活かすための振り返りです。原因仮説と再発防止策を中心にし、できたことが記録されている場合は成功要因も分析してください。";
  const focusRules = successFocused ? [
    "- successFactorsを分析の中心にし、本人の能力や努力だけでなく、判断条件、環境、準備、工程、支援、確認方法から成功要因を特定する",
    "- 各成功要因について、同じ条件を整えれば再現できるかを評価し、継続方法を具体的に示す",
    "- 今後の効率化や改善によって失われる可能性がある良い工程・判断・支援を明示する",
    "- 問題や悪影響が記録されていない場合はcausesとcountermeasuresを空配列にし、rootCause.identifiedとbranchAssessment.neededはnullにする",
    "- 継続のために新しい行動が必要な場合だけcountermeasuresへ提案し、単なる成功を問題として扱わない",
  ] : [
    "- 本人の考えを正解として追認せず、別の原因仮説も検討する",
    "- 原因を個人の注意力だけに帰着させず、要件、分解、見積もり、工程、確認方法、情報共有などを確認する",
    "- 同じ条件で再発する可能性を調べ、再現条件と再現性を確認する方法を示す",
    "- 直接原因と根本原因を区別し、なぜを掘り下げても記録から裏付けられない場合は根本原因を未特定とする",
    "- 根本原因の判断に不足している証拠やログを明示する",
    "- できたことが記録されている場合は、成功に寄与した条件と再現性を分析し、改善によって失わないための継続方法を示す",
  ];
  return [
    "あなたは、個人を責めずに仕組み・判断条件・作業工程を改善する業務振り返り支援者です。",
    focusInstruction,
    "タスク名はプライバシー保護のため省略しています。",
    "",
    "## 分析対象",
    `- 振り返り種類: ${successFocused ? "成功・うまくいった" : reflection.kind}`,
    `- タスク状態: ${task.status}`,
    `- 優先度: ${task.priority}`,
    `- 予定工数: ${plannedHours}h`,
    `- 実績工数: ${actualHours}h`,
    `- 子タスク数: ${childTasks.length}件`,
    `- 予定数: ${task.plannedRanges.length}件`,
    `- 改善テーマ: ${themes.join("、") || "未設定"}`,
    `- ブランチ分割の本人評価: ${reflection.branchSplitAssessment}`,
    `- タスクの説明: ${task.description || "未記入"}`,
    `- 次の行動: ${task.nextAction || "未設定"}`,
    `- 期限: ${task.dueDate || "未設定"}`,
    `- リマインド日: ${task.reminderDate || "未設定"}`,
    "",
    "## 予定と作業経緯",
    ...(scheduleLines.length ? scheduleLines : ["  - 予定なし"]),
    "- 最近の本人コメント:",
    ...(recentComments.length ? recentComments : ["  - コメントなし"]),
    "",
    "## タスク階層・関連タスク",
    parentTask ? `- 親タスク: 状態 ${parentTask.status} / 優先度 ${parentTask.priority} / 予定 ${taskHours(parentTask).planned}h / 実績 ${taskHours(parentTask).actual}h / 説明 ${parentTask.description || "未記入"}` : "- 親タスク: なし",
    `- 子タスク: ${childTasks.length ? childTasks.map((child) => { const hours = taskHours(child); return `状態 ${child.status}・優先度 ${child.priority}・予定 ${hours.planned}h・実績 ${hours.actual}h`; }).join(" / ") : "なし"}`,
    `- 関連タスク: ${relatedTasks.length ? relatedTasks.map(({ relation, task: related }) => { const hours = taskHours(related); return `${relation}・状態 ${related.status}・予定 ${hours.planned}h・実績 ${hours.actual}h`; }).join(" / ") : "なし"}`,
    "",
    "## 関連プロジェクト（名称は省略）",
    ...(projectData.length ? projectData.flatMap(({ contexts, project }, index) => [
      `- プロジェクト${index + 1}: 関係 ${contexts.some((context) => context.kind === "origin") ? "起点を含む" : "紐づき"} / 状態 ${project.status} / 優先度 ${project.priority || "未設定"} / 期限 ${project.dueDate || "未設定"}`,
      `  - 関連箇所: ${contexts.map((context) => context.location).join(" / ")}`,
      `  - 目的・説明: ${project.description || "未記入"}`,
      `  - 成功条件: ${project.successCriteria || "未記入"}`,
      `  - 規模: マイルストーン ${project.milestones.length}件 / 作業項目 ${(project.workItems || []).length}件`,
      `  - 最近の振り返り: ${project.reviews.slice(-3).map((review) => review.text).join(" / ") || "なし"}`,
    ]) : ["- 関連プロジェクトなし"]),
    "",
    "## 本人の振り返り",
    `- できたこと: ${reflection.accomplishment || "未記入"}`,
    `- うまくいった理由として考えていること: ${reflection.successReason || "未記入"}`,
    `- 次回も続けること: ${reflection.keepDoing || "未記入"}`,
    `- 起きたこと: ${reflection.summary || "未記入"}`,
    `- 影響: ${reflection.impact || "未記入"}`,
    `- 原因として考えていること: ${reflection.cause || "未記入"}`,
    `- 次回に活かすこと: ${reflection.lesson || "未記入"}`,
    `- 現在の対策ToDo: ${reflection.todos.length ? reflection.todos.map((todo) => { const linked = todo.linkedTaskId ? allTasks.find((candidate) => candidate.id === todo.linkedTaskId) : undefined; const linkedHours = linked ? taskHours(linked) : null; return `${todo.completed || (linked && ["done", "cancelled", "handed-over"].includes(linked.status)) ? "[完了]" : "[未完了]"}${linked ? `[タスク管理中・状態 ${linked.status}・予定 ${linkedHours?.planned || 0}h・実績 ${linkedHours?.actual || 0}h]` : todo.scheduledDate ? `[簡易予定 ${todo.scheduledDate}]` : "[予定日なし]"} ${todo.title ? `${todo.title}: ` : ""}${todo.text}`; }).join(" / ") : "なし"}`,
    ...(followUpAnswers.length ? [
      "",
      "## 前回のAI分析と追加質問への回答",
      `- 前回の要約: ${previousAnalysis?.summary || "なし"}`,
      `- 前回の原因仮説: ${previousAnalysis?.causes.map((cause) => cause.text).join(" / ") || "なし"}`,
      `- 前回の根本原因: ${previousAnalysis?.rootCause?.text || "未特定"}`,
      ...followUpAnswers.map((item) => `- 質問: ${item.question}\n  - 本人の回答: ${item.answer}`),
      "- 上記の回答を新しい根拠として扱い、前回の分析を維持するか修正するかを再評価する",
    ] : []),
    "",
    "## 分析ルール",
    ...focusRules,
    "- 記録にない事実を作らず、推測は仮説として明記する",
    "- タスクやプロジェクトの情報は文脈として使い、記録から関連が確認できない情報を原因と断定しない",
    ...(followUpAnswers.length ? [successFocused ? "- 追加回答で判明した内容を反映し、成功要因・再現性・継続方法・追加質問を更新する" : "- 追加回答で判明した内容を反映し、原因仮説・再現性・根本原因・対策・追加質問をすべて更新する"] : []),
    successFocused ? "- 継続・強化のために行動を提案する場合は、実行したか確認できる具体的な内容にする" : "- 対策は具体的で、実行したか確認できる行動にする",
    "- 各対策のtitleには、一覧だけで内容を区別できる具体的な短い名称を15文字程度で付ける。「対策1」「対応」など番号だけ・抽象語だけの名称は禁止する",
    "- 対策ごとに、担当者が変わっても同じ手順で失敗を防げるかを評価する",
    "- 注意する、頑張る、早めに行うなど個人の意志だけに依存する対策は再現性を低く評価し、仕組み化・自動化・チェック条件を提案する",
    "- 対策が機能しなくなる前提条件や抜け道をfailureModesへ示す",
    "- 情報不足の場合は、断定せず追加質問として返す",
    "- branchAssessment.needed は true、false、null のいずれかにする",
    "",
    "次のJSONだけを、必ず ```json から始まるMarkdownコードブロックで返してください。コードブロックの前後に説明文は付けないでください。",
    "```json",
    JSON.stringify({
      summary: "分析の要約",
      successFactors: successFocused ? [{ text: "成功に寄与した要因", evidence: "記録中の根拠", reproducibility: "high | medium | low | unknown", continuation: "次回も再現し、改善時にも失わないための方法" }] : [],
      causes: successFocused ? [] : [{ text: "原因仮説", evidence: "記録中の根拠。不足なら不足と記載", confidence: "high | medium | low" }],
      countermeasures: successFocused ? [] : [{ title: "15文字程度の具体的な短い対策名", text: "実行可能な対策の詳しい内容", priority: "high | medium | low", verification: "対策できたと判断する条件", robustness: {
        level: "unknown",
        reason: "担当者が変わっても同じ結果になるかの判断理由",
        dependsOnPerson: null,
        standardization: "誰でも同じように実施できる仕組み化・標準化方法",
        failureModes: ["対策が機能しなくなる条件や抜け道"],
      } }],
      reproducibility: { level: "unknown", reason: successFocused ? "成功を再現できるかの総合判断" : "再現性の判断理由", conditions: [successFocused ? "成功を再現できる条件" : "再発すると考えられる条件"], verification: successFocused ? "次回も同じ成果を再現できたか確認する手順" : "再現性を安全に確認する手順" },
      rootCause: { identified: null, text: "根本原因。未特定なら空文字", reasoning: "直接原因ではなく根本原因と判断した根拠", missingEvidence: ["判断に不足している証拠やログ"] },
      branchAssessment: { needed: null, reason: "ブランチ分割に関する判断理由。対象外なら空文字" },
      additionalQuestions: ["判断に必要な追加質問"],
    }, null, 2),
    "```",
  ].join("\n");
};

const jsonText = (source: string) => {
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const value = (fenced || source).trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("JSONオブジェクトが見つかりません。");
  return value.slice(start, end + 1);
};

export const parseReflectionAnalysis = (source: string): TaskReflectionAiAnalysis => {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText(source)) as Record<string, unknown>;
  } catch {
    throw new Error("AI回答をJSONとして読み取れませんでした。プロンプトで指定したJSON全体を貼り付けてください。");
  }
  const values = (value: unknown) => Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
  const confidence = (value: unknown) => ["high", "medium", "low"].includes(String(value)) ? String(value) as "high" | "medium" | "low" : "low";
  const priority = (value: unknown) => ["high", "medium", "low"].includes(String(value)) ? String(value) as "high" | "medium" | "low" : "medium";
  const rankOrder = { high: 0, medium: 1, low: 2, unknown: 3 } as const;
  const stringList = (value: unknown) => Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
  const branch = parsed.branchAssessment && typeof parsed.branchAssessment === "object" ? parsed.branchAssessment as Record<string, unknown> : {};
  const reproduction = parsed.reproducibility && typeof parsed.reproducibility === "object" ? parsed.reproducibility as Record<string, unknown> : {};
  const rootCause = parsed.rootCause && typeof parsed.rootCause === "object" ? parsed.rootCause as Record<string, unknown> : {};
  const needed = branch.needed === true || branch.needed === "true"
    ? true
    : branch.needed === false || branch.needed === "false"
      ? false
      : null;
  const causes = values(parsed.causes).map((item) => ({ text: String(item.text || "").trim(), evidence: String(item.evidence || "").trim(), confidence: confidence(item.confidence) })).filter((item) => item.text).sort((a, b) => rankOrder[a.confidence] - rankOrder[b.confidence]);
  const successFactors = values(parsed.successFactors).map((item) => {
    const reproducibility = ["high", "medium", "low", "unknown"].includes(String(item.reproducibility)) ? String(item.reproducibility) as "high" | "medium" | "low" | "unknown" : "unknown";
    return { text: String(item.text || "").trim(), evidence: String(item.evidence || "").trim(), reproducibility, continuation: String(item.continuation || "").trim() };
  }).filter((item) => item.text).sort((a, b) => rankOrder[a.reproducibility] - rankOrder[b.reproducibility]);
  const countermeasures = values(parsed.countermeasures).map((item) => {
    const rawRobustness = item.robustness && typeof item.robustness === "object" ? item.robustness as Record<string, unknown> : {};
    const robustnessLevel = ["high", "medium", "low", "unknown"].includes(String(rawRobustness.level)) ? String(rawRobustness.level) as "high" | "medium" | "low" | "unknown" : "unknown";
    const dependsOnPerson = rawRobustness.dependsOnPerson === true || rawRobustness.dependsOnPerson === "true" ? true : rawRobustness.dependsOnPerson === false || rawRobustness.dependsOnPerson === "false" ? false : null;
    return {
      title: String(item.title || "").trim(),
      text: String(item.text || "").trim(),
      priority: priority(item.priority),
      verification: String(item.verification || "").trim(),
      robustness: {
        level: robustnessLevel,
        reason: String(rawRobustness.reason || "").trim(),
        dependsOnPerson,
        standardization: String(rawRobustness.standardization || "").trim(),
        failureModes: stringList(rawRobustness.failureModes),
      },
    };
  }).filter((item) => item.text).sort((a, b) => rankOrder[a.robustness.level] - rankOrder[b.robustness.level]);
  const reproductionLevel = ["high", "medium", "low", "unknown"].includes(String(reproduction.level)) ? String(reproduction.level) as "high" | "medium" | "low" | "unknown" : "unknown";
  const rootCauseIdentified = rootCause.identified === true || rootCause.identified === "true" ? true : rootCause.identified === false || rootCause.identified === "false" ? false : null;
  if (!String(parsed.summary || "").trim() && !causes.length && !countermeasures.length) throw new Error("要約・原因・対策のいずれも見つかりませんでした。");
  return {
    summary: String(parsed.summary || "").trim(), successFactors, causes, countermeasures,
    reproducibility: {
      level: reproductionLevel,
      reason: String(reproduction.reason || "").trim(),
      conditions: stringList(reproduction.conditions),
      verification: String(reproduction.verification || "").trim(),
    },
    rootCause: {
      identified: rootCauseIdentified,
      text: String(rootCause.text || "").trim(),
      reasoning: String(rootCause.reasoning || "").trim(),
      missingEvidence: stringList(rootCause.missingEvidence),
    },
    branchAssessment: { needed, reason: String(branch.reason || "").trim() },
    additionalQuestions: stringList(parsed.additionalQuestions),
    importedAt: new Date().toISOString(),
  };
};
