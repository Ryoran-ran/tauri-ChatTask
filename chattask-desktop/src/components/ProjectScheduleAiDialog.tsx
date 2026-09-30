import { useEffect, useMemo, useState } from "react";
import type { Goal, NonWorkingPeriod } from "../types";
import {
  buildProjectScheduleAiConsultationPrompt,
  buildProjectScheduleAiConsultationSummaryPrompt,
  buildProjectScheduleAiPrompt,
  parseProjectScheduleAiResponse,
  PROJECT_SCHEDULE_AI_MODE_LABELS,
  validateProjectScheduleAiResponse,
  type ProjectScheduleAiMode,
  type ProjectScheduleAiResponse,
  type ProjectScheduleAiConsultationTurn,
  type ProjectScheduleAiValidation,
} from "../services/projectScheduleAi";
import { todayValue } from "../utils";
import { Modal } from "./Modal";
import { MarkdownText } from "./MarkdownText";

interface AiPlanTreeWork {
  id: string;
  kind: "existing" | "new";
  title: string;
  currentTitle?: string;
  plannedHours: number;
  minHours: number;
  maxHours: number;
  startDate: string;
  endDate: string;
  confidence: "high" | "medium" | "low";
  basis: string;
}

interface AiPlanTreeGroup {
  id: string;
  kind: "existing" | "new" | "unassigned";
  title: string;
  dueDate: string;
  startDate: string;
  endDate: string;
  description: string;
  works: AiPlanTreeWork[];
}

type ProjectScheduleAiDialogTab = "consult" | "prompt" | "review";
interface ProjectScheduleAiDialogDraft {
  tab: ProjectScheduleAiDialogTab;
  mode: ProjectScheduleAiMode;
  constraints: string;
  responseText: string;
  response: ProjectScheduleAiResponse | null;
  answers: Record<string, string>;
  previousResponse: ProjectScheduleAiResponse | null;
  followUpAnswers: { question: string; answer: string }[];
  followUpNotes: string;
  consultationHistory: ProjectScheduleAiConsultationTurn[];
  consultationResponseText: string;
}

const dialogDraftKey = (projectId: string) => `chatTaskProjectScheduleAiDraft:${projectId}`;
const emptyDialogDraft = (): ProjectScheduleAiDialogDraft => ({
  tab: "consult", mode: "initial-plan", constraints: "", responseText: "", response: null,
  answers: {}, previousResponse: null, followUpAnswers: [], followUpNotes: "",
  consultationHistory: [], consultationResponseText: "",
});
const storedAiResponse = (value: unknown) => {
  if (!value) return null;
  try { return parseProjectScheduleAiResponse(JSON.stringify(value)); }
  catch { return null; }
};
export const parseProjectScheduleAiDialogDraft = (source: string | null): ProjectScheduleAiDialogDraft => {
  try {
    const parsed = JSON.parse(source || "null") as Record<string, unknown> | null;
    if (!parsed || (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3)) return emptyDialogDraft();
    const responseText = typeof parsed.responseText === "string" ? parsed.responseText : "";
    const response = parsed.responseReviewed && responseText ? parseProjectScheduleAiResponse(responseText) : null;
    const answers = parsed.answers && typeof parsed.answers === "object" && !Array.isArray(parsed.answers)
      ? Object.fromEntries(Object.entries(parsed.answers).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
    const followUpAnswers = Array.isArray(parsed.followUpAnswers) ? parsed.followUpAnswers.filter((item): item is { question: string; answer: string } => Boolean(item && typeof item === "object" && typeof (item as { question?: unknown }).question === "string" && typeof (item as { answer?: unknown }).answer === "string")) : [];
    const consultationHistory = Array.isArray(parsed.consultationHistory) ? parsed.consultationHistory.filter((item): item is ProjectScheduleAiConsultationTurn => Boolean(item && typeof item === "object" && typeof (item as { question?: unknown }).question === "string" && typeof (item as { answer?: unknown }).answer === "string")) : [];
    const mode = typeof parsed.mode === "string" && Object.prototype.hasOwnProperty.call(PROJECT_SCHEDULE_AI_MODE_LABELS, parsed.mode) ? parsed.mode as ProjectScheduleAiMode : "initial-plan";
    const storedConstraints = typeof parsed.constraints === "string" ? parsed.constraints : "";
    const legacyConsultationQuestion = typeof parsed.consultationQuestion === "string" ? parsed.consultationQuestion : "";
    return {
      tab: parsed.tab === "consult" || parsed.tab === "review" ? parsed.tab : "prompt", mode,
      constraints: [storedConstraints.trim(), legacyConsultationQuestion.trim()].filter(Boolean).join("\n"), responseText, response,
      answers, previousResponse: storedAiResponse(parsed.previousResponse), followUpAnswers,
      followUpNotes: typeof parsed.followUpNotes === "string" ? parsed.followUpNotes : "",
      consultationHistory,
      consultationResponseText: typeof parsed.consultationResponseText === "string" ? parsed.consultationResponseText : "",
    };
  } catch { return emptyDialogDraft(); }
};
const loadDialogDraft = (projectId: string): ProjectScheduleAiDialogDraft => {
  try { return parseProjectScheduleAiDialogDraft(localStorage.getItem(dialogDraftKey(projectId))); }
  catch { return emptyDialogDraft(); }
};

export const buildProjectScheduleAiPlanTree = (project: Goal, response: ProjectScheduleAiResponse): AiPlanTreeGroup[] => {
  const groups: AiPlanTreeGroup[] = [];
  const byId = new Map<string, AiPlanTreeGroup>();
  const addGroup = (group: AiPlanTreeGroup) => { groups.push(group); byId.set(group.id, group); };
  project.milestones.forEach((milestone) => addGroup({
    id: milestone.id, kind: "existing", title: milestone.title || "名称未設定のマイルストーン", dueDate: milestone.dueDate || "",
    startDate: milestone.targetWorkStartDate || "", endDate: milestone.targetWorkEndDate || "", description: milestone.description || "", works: [],
  }));
  response.proposedNewMilestones.forEach((milestone) => addGroup({
    id: milestone.proposalId, kind: "new", title: milestone.title, dueDate: milestone.dueDate,
    startDate: milestone.targetWorkStartDate, endDate: milestone.targetWorkEndDate, description: milestone.description || milestone.reason, works: [],
  }));
  const unassigned: AiPlanTreeGroup = { id: "__unassigned__", kind: "unassigned", title: "マイルストーン未割当", dueDate: "", startDate: "", endDate: "", description: "プロジェクト直属としてインポートされる作業", works: [] };
  response.workPlans.forEach((plan) => {
    const group = plan.milestoneId ? byId.get(plan.milestoneId) : undefined;
    (group || unassigned).works.push({
      id: plan.workId, kind: "existing", title: plan.proposedTitle, currentTitle: plan.proposedTitle !== plan.expectedTitle ? plan.expectedTitle : undefined,
      plannedHours: plan.plannedHours, minHours: plan.estimateRangeHours.min, maxHours: plan.estimateRangeHours.max,
      startDate: plan.startDate, endDate: plan.endDate, confidence: plan.confidence, basis: plan.estimationBasis,
    });
  });
  response.proposedNewWorkItems.forEach((item) => {
    const group = item.milestoneId ? byId.get(item.milestoneId) : undefined;
    (group || unassigned).works.push({
      id: item.proposalId, kind: "new", title: item.title, plannedHours: item.plannedHours,
      minHours: item.estimateRangeHours.min, maxHours: item.estimateRangeHours.max, startDate: item.startDate, endDate: item.endDate,
      confidence: item.confidence, basis: item.estimationBasis,
    });
  });
  if (unassigned.works.length) groups.push(unassigned);
  return groups.filter((group) => group.kind === "new" || group.works.length > 0);
};

export const humanizeProjectScheduleAiQuestion = (question: string, project: Goal, response: ProjectScheduleAiResponse) => {
  const labels = new Map<string, string>();
  const add = (id: string, label: string) => { if (id) labels.set(id, label); };
  add(project.id, `プロジェクト「${project.title}」`);
  project.milestones.forEach((item) => add(item.id, `マイルストーン「${item.title || "名称未設定"}」`));
  (project.workItems || []).forEach((item) => add(item.id, `作業「${item.title || "名称未設定"}」`));
  response.proposedNewMilestones.forEach((item) => add(item.proposalId, `マイルストーン「${item.title}」`));
  response.workPlans.forEach((item) => add(item.workId, `作業「${item.proposedTitle || item.expectedTitle}」`));
  response.proposedNewWorkItems.forEach((item) => add(item.proposalId, `作業「${item.title}」`));
  return [...labels.entries()].sort((left, right) => right[0].length - left[0].length)
    .reduce((result, [id, label]) => result.split(id).join(label), question);
};

export function ProjectScheduleAiDialog({ project, projects, periods, dailyCapacityHours, onApply, onClose }: {
  project: Goal;
  projects: Goal[];
  periods: NonWorkingPeriod[];
  dailyCapacityHours: number;
  onApply: (response: ProjectScheduleAiResponse) => string | null;
  onClose: () => void;
}) {
  const restoredDraft = useMemo(() => loadDialogDraft(project.id), [project.id]);
  const [tab, setTab] = useState<ProjectScheduleAiDialogTab>(restoredDraft.tab);
  const [mode, setMode] = useState<ProjectScheduleAiMode>(restoredDraft.mode);
  const [constraints, setConstraints] = useState(restoredDraft.constraints);
  const [copyStatus, setCopyStatus] = useState<"" | "consult" | "summary" | "plan" | "error">("");
  const [responseText, setResponseText] = useState(restoredDraft.responseText);
  const [response, setResponse] = useState<ProjectScheduleAiResponse | null>(restoredDraft.response);
  const [validation, setValidation] = useState<ProjectScheduleAiValidation | null>(() => restoredDraft.response
    ? validateProjectScheduleAiResponse({ response: restoredDraft.response, project, projects, periods, dailyCapacityHours }) : null);
  const [parseError, setParseError] = useState("");
  const [applyError, setApplyError] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>(restoredDraft.answers);
  const [previousResponse, setPreviousResponse] = useState<ProjectScheduleAiResponse | null>(restoredDraft.previousResponse);
  const [followUpAnswers, setFollowUpAnswers] = useState<{ question: string; answer: string }[]>(restoredDraft.followUpAnswers);
  const [followUpNotes, setFollowUpNotes] = useState(restoredDraft.followUpNotes);
  const [consultationHistory, setConsultationHistory] = useState<ProjectScheduleAiConsultationTurn[]>(restoredDraft.consultationHistory);
  const [consultationResponseText, setConsultationResponseText] = useState(restoredDraft.consultationResponseText);
  useEffect(() => {
    try {
      localStorage.setItem(dialogDraftKey(project.id), JSON.stringify({
        version: 3, tab, mode, constraints, responseText, responseReviewed: Boolean(response), answers,
        previousResponse, followUpAnswers, followUpNotes, consultationHistory, consultationResponseText,
      }));
    } catch { /* 保存できない環境でも相談機能は継続する */ }
  }, [answers, constraints, consultationHistory, consultationResponseText, followUpAnswers, followUpNotes, mode, previousResponse, project.id, response, responseText, tab]);
  const prompt = useMemo(() => buildProjectScheduleAiPrompt({
    project, projects, periods, dailyCapacityHours, mode, constraints, today: todayValue(), previousResponse, followUpAnswers, followUpNotes, consultationHistory,
  }), [constraints, consultationHistory, dailyCapacityHours, followUpAnswers, followUpNotes, mode, periods, previousResponse, project, projects]);
  const consultationPrompt = useMemo(() => buildProjectScheduleAiConsultationPrompt({
    project, projects, periods, dailyCapacityHours, mode, constraints, today: todayValue(), history: consultationHistory,
  }), [constraints, consultationHistory, dailyCapacityHours, mode, periods, project, projects]);
  const consultationSummaryPrompt = useMemo(() => buildProjectScheduleAiConsultationSummaryPrompt(mode), [mode]);
  const planTree = useMemo(() => response ? buildProjectScheduleAiPlanTree(project, response) : [], [project, response]);
  const questionLabels = useMemo(() => new Map((response?.questions || []).map((question) => [question, humanizeProjectScheduleAiQuestion(question, project, response!)])), [project, response]);
  const copyPrompt = async (value: string, target: "consult" | "summary" | "plan") => {
    try { await navigator.clipboard.writeText(value); setCopyStatus(target); }
    catch { setCopyStatus("error"); }
  };
  const saveConsultationSummary = () => {
    const answer = consultationResponseText.trim();
    if (!answer) return;
    setConsultationHistory((current) => [...current, { question: constraints.trim(), answer }]);
    setConsultationResponseText("");
    setCopyStatus("");
  };
  const reviewResponse = () => {
    setParseError("");
    try {
      const parsed = parseProjectScheduleAiResponse(responseText);
      const checked = validateProjectScheduleAiResponse({ response: parsed, project, projects, periods, dailyCapacityHours });
      setResponse(parsed);
      setValidation(checked);
      setMode(Object.keys(PROJECT_SCHEDULE_AI_MODE_LABELS).includes(parsed.mode) ? parsed.mode : mode);
      setAnswers(Object.fromEntries((parsed.questions || []).map((question) => [question, answers[question] || ""])));
      setFollowUpNotes("");
    } catch (error) {
      setResponse(null);
      setValidation(null);
      setParseError(error instanceof Error ? error.message : "AI回答を解析できませんでした。");
    }
  };
  const answeredQuestions = response?.questions.map((question) => ({ question: questionLabels.get(question) || question, answer: answers[question] || "" })).filter((item) => item.answer.trim()) || [];
  const prepareFollowUp = () => {
    if (!response || (!answeredQuestions.length && !followUpNotes.trim())) return;
    setPreviousResponse(response);
    setFollowUpAnswers(answeredQuestions);
    setCopyStatus("");
    setTab("prompt");
  };
  const applyResponse = () => {
    if (!response || !validation?.canProceed) return;
    setApplyError("");
    const error = onApply(response);
    if (error) setApplyError(error);
    else {
      try { localStorage.removeItem(dialogDraftKey(project.id)); } catch { /* noop */ }
      onClose();
    }
  };
  const severityLabel = { error: "エラー", warning: "要確認", info: "情報" } as const;
  const modeSelector = <fieldset><legend>相談内容</legend>{(Object.entries(PROJECT_SCHEDULE_AI_MODE_LABELS) as [ProjectScheduleAiMode, string][]).map(([value, label]) => <label className={mode === value ? "selected" : ""} key={value}><input type="radio" name="project-schedule-ai-mode" value={value} checked={mode === value} onChange={() => { setMode(value); setCopyStatus(""); setPreviousResponse(null); setFollowUpAnswers([]); setFollowUpNotes(""); }} /><span><strong>{label}</strong><small>{value === "initial-plan" ? "作業分解・工数見積もり・日程案を検討" : value === "validate-progress" ? "現在の工数・計画・負荷・期限を診断" : "残工数を再見積もりして日程と対策を相談"}</small></span></label>)}</fieldset>;
  const constraintsField = <label className="project-schedule-ai-constraints"><span>相談したいこと・追加条件 <small>任意</small></span><textarea rows={9} value={constraints} onChange={(event) => { setConstraints(event.target.value); setCopyStatus(""); }} placeholder={"例：この進め方で期限に間に合うか確認したい\n品質を優先して着手順を決めたい\n期限は変更不可\n要件整理は3時間で確定。再見積もりしない\n10/15は作業できない"} /><small>質問、重視したいこと、確定値、変更できない条件を入力してください。相談と作成案の両方へ反映されます。</small></label>;
  const dataSummary = <div className="project-schedule-ai-data-summary"><strong>プロンプトに含まれる情報</strong><span>マイルストーン {project.milestones.length}件</span><span>作業 {(project.workItems || []).length}件</span><span>他プロジェクト {Math.max(0, projects.length - 1)}件</span><span>非稼働設定 {periods.length}件</span><small>名称、説明、工数、実績、期限、他プロジェクトの負荷情報が含まれます。機密情報がある場合はコピー前に確認してください。</small></div>;
  const hasNewItems = Boolean(response && (response.proposedNewMilestones.length || response.proposedNewWorkItems.length));
  return <Modal title="AIに作業スケジュールを相談" onClose={onClose} wide>
    <div className="project-schedule-ai-dialog">
      <header><div><strong>{project.title}</strong><p>まず文章で方向性を相談し、合意した内容から新規マイルストーン・作業の作成案を生成します。入力内容はプロジェクトごとに自動保存されます。</p></div><nav><button type="button" className={tab === "consult" ? "active" : ""} onClick={() => setTab("consult")}>1. 方向性を相談</button><button type="button" className={tab === "prompt" ? "active" : ""} onClick={() => setTab("prompt")}>2. 作成案を生成</button><button type="button" className={tab === "review" ? "active" : ""} onClick={() => setTab("review")}>3. JSONを確認</button></nav></header>
      {tab === "consult" ? <>
        <section className="project-schedule-ai-settings">
          {modeSelector}
          {constraintsField}
          {dataSummary}
        </section>
        <section className="project-schedule-ai-consultation">
          <div className="project-schedule-ai-consult-prompt"><header><strong>相談用プロンプト</strong><span className="project-schedule-ai-prompt-actions"><span>{consultationPrompt.length.toLocaleString("ja-JP")}文字</span><button type="button" className="primary" onClick={() => void copyPrompt(consultationPrompt, "consult")}>{copyStatus === "consult" ? "コピー済み" : "相談用プロンプトをコピー"}</button></span></header><textarea readOnly spellCheck={false} value={consultationPrompt} aria-label="生成された方向性相談プロンプト" /></div>
          <div className="project-schedule-ai-summary-prompt"><header><strong>相談内容をまとめるプロンプト</strong><button type="button" onClick={() => void copyPrompt(consultationSummaryPrompt, "summary")}>{copyStatus === "summary" ? "コピー済み" : "まとめ用プロンプトをコピー"}</button></header><p>AI側で相談を深掘りし終えたら、同じチャットへこのプロンプトを送ってください。</p><textarea readOnly spellCheck={false} value={consultationSummaryPrompt} aria-label="相談内容をまとめるプロンプト" /></div>
          <div className="project-schedule-ai-consult-response"><header><strong>決定した方針・相談結果</strong><button type="button" className="primary" disabled={!consultationResponseText.trim()} onClick={saveConsultationSummary}>相談結果を保存</button></header><textarea spellCheck={false} value={consultationResponseText} onChange={(event) => setConsultationResponseText(event.target.value)} placeholder="まとめ用プロンプトに対するAIの回答を貼り付けてください" /><small>相談中の回答を一つずつ貼る必要はありません。最後に整理した内容だけを保存します。</small></div>
          {consultationHistory.length > 0 && <details className="project-schedule-ai-consult-history"><summary><strong>保存済みの相談結果</strong><span>{consultationHistory.length}件・クリックして展開</span></summary><div>{consultationHistory.map((turn, index) => <article key={`${index}-${turn.answer.slice(0, 20)}`}><header><b>相談結果 {index + 1}</b>{turn.question && <span>{turn.question}</span>}</header><MarkdownText text={turn.answer} /></article>)}</div></details>}
        </section>
        <footer><span role="status" className={copyStatus === "error" ? "error" : ""}>{copyStatus === "consult" ? "相談用プロンプトをコピーしました。" : copyStatus === "summary" ? "まとめ用プロンプトをコピーしました。同じAIチャットへ送ってください。" : copyStatus === "error" ? "コピーできませんでした。" : `相談結果 ${consultationHistory.length}件を自動保存しています。`}</span><button type="button" onClick={onClose}>閉じる</button>{consultationHistory.length > 0 && <button type="button" className="primary" onClick={() => setTab("prompt")}>保存した方針から作成案へ</button>}</footer>
      </> : tab === "prompt" ? <>
        <section className="project-schedule-ai-settings">
          {modeSelector}
          {constraintsField}
          {consultationHistory.length > 0 && <div className="project-schedule-ai-followup-ready"><strong>相談結果を反映</strong><span>保存済みの決定事項・方針 {consultationHistory.length}件を作成用プロンプトに含めています。</span><button type="button" onClick={() => setTab("consult")}>相談結果を確認</button></div>}
          {previousResponse && <div className="project-schedule-ai-followup-ready"><strong>再相談用プロンプト</strong><span>前回案、回答済みの質問 {followUpAnswers.length}件{followUpNotes.trim() ? "、追加条件・判明事項" : ""}を含めています。</span><button type="button" onClick={() => { setPreviousResponse(null); setFollowUpAnswers([]); setFollowUpNotes(""); setCopyStatus(""); }}>初回相談に戻す</button></div>}
          {dataSummary}
        </section>
        <section className="project-schedule-ai-prompt"><div><strong>インポート用JSON作成プロンプト</strong><span className="project-schedule-ai-prompt-actions"><span>{prompt.length.toLocaleString("ja-JP")}文字</span><button type="button" className="primary" onClick={() => void copyPrompt(prompt, "plan")}>{copyStatus === "plan" ? "コピー済み" : "作成用プロンプトをコピー"}</button></span></div><textarea readOnly spellCheck={false} value={prompt} aria-label="生成されたJSON作成プロンプト" /></section>
        <footer><span role="status" className={copyStatus === "error" ? "error" : ""}>{copyStatus === "plan" ? "作成用プロンプトをコピーしました。" : copyStatus === "error" ? "コピーできませんでした。テキストを選択してコピーしてください。" : "保存した相談結果から、新規項目の作成案を生成します。"}</span><button type="button" onClick={onClose}>閉じる</button><button type="button" onClick={() => setTab("consult")}>相談へ戻る</button></footer>
      </> : <>
        <section className="project-schedule-ai-response-input"><div><strong>AIのJSON回答</strong><button type="button" className="primary" disabled={!responseText.trim()} onClick={reviewResponse}>回答を解析・検証</button></div><textarea spellCheck={false} value={responseText} onChange={(event) => { setResponseText(event.target.value); setParseError(""); setResponse(null); setValidation(null); }} placeholder="AIが返したJSON全体を貼り付けてください" />{parseError && <p role="alert">{parseError}</p>}</section>
        <section className="project-schedule-ai-review">
          {!response || !validation ? <div className="project-schedule-ai-review-empty"><strong>まだ回答を解析していません</strong><span>JSONを貼り付け、「回答を解析・検証」を押してください。</span></div> : <>
            <div className={`project-schedule-ai-review-summary ${validation.canProceed ? "is-reviewable" : "has-errors"}`}><div><small>{response.assessment.verdict === "feasible" ? "実行可能" : response.assessment.verdict === "caution" ? "注意あり" : "実行困難"}</small><strong>推奨 {validation.totals.plannedHours}h</strong><span>見積範囲 {validation.totals.minHours}〜{validation.totals.maxHours}h</span></div><p>{response.assessment.summary}</p></div>
            {validation.issues.length ? <div className="project-schedule-ai-issues"><strong>検証結果</strong>{validation.issues.map((issue, index) => <p className={`severity-${issue.severity}`} key={`${issue.message}-${index}`}><b>{severityLabel[issue.severity]}</b><span>{issue.message}{issue.targetId && <small>ID: {issue.targetId}</small>}</span></p>)}</div> : <p className="project-schedule-ai-valid">入力形式・現在値・日付・負荷に問題は見つかりませんでした。</p>}
            <div className="project-schedule-ai-tree"><header><strong>マイルストーン・作業の構成</strong><span>新規項目だけを作成し、既存作業の提案はアドバイスとして表示します</span></header>{planTree.length ? planTree.map((group) => <section className={`project-schedule-ai-tree-group is-${group.kind}`} key={group.id}><header><i aria-hidden="true">{group.kind === "unassigned" ? "○" : "◆"}</i><div><small>{group.kind === "new" ? "新規マイルストーン" : group.kind === "existing" ? "既存マイルストーン" : "プロジェクト直属"}</small><strong>{group.title}</strong>{group.description && <p>{group.description}</p>}</div><aside>{group.dueDate && <b>期限 {group.dueDate}</b>}{group.startDate && group.endDate && <span>{group.startDate}〜{group.endDate}</span>}<small>作業 {group.works.length}件</small></aside></header><div className="project-schedule-ai-tree-works">{group.works.map((work) => <article key={`${work.kind}-${work.id}`}><i aria-hidden="true" /><div><header><span><small>{work.kind === "new" ? "新規作業・作成対象" : "既存作業・アドバイスのみ"}・確信度 {work.confidence === "high" ? "高" : work.confidence === "medium" ? "中" : "低"}</small><strong>{work.title}</strong>{work.currentTitle && <em>現在：{work.currentTitle}</em>}</span><b>{work.plannedHours}h <small>({work.minHours}〜{work.maxHours}h)</small></b></header><p>{work.startDate}〜{work.endDate}</p><small>{work.basis}</small></div></article>)}{!group.works.length && <p>このマイルストーンに付属する追加作業はありません。</p>}</div></section>) : <p className="project-schedule-ai-tree-empty">表示するマイルストーン・作業案はありません。</p>}</div>
            <div className="project-schedule-ai-questions"><header><strong>追加情報を反映して再相談</strong>{response.questions.length > 0 && <span>{answeredQuestions.length}/{response.questions.length}件回答</span>}</header>{response.questions.length > 0 && <div className="project-schedule-ai-question-list"><strong>AIからの追加質問</strong>{response.questions.map((question, index) => <label key={question}><span><b>{index + 1}</b>{questionLabels.get(question) || question}</span><textarea rows={2} value={answers[question] || ""} onChange={(event) => setAnswers((current) => ({ ...current, [question]: event.target.value }))} placeholder="わかる範囲で回答。不明の場合は「不明」と入力できます" /></label>)}</div>}<label className="project-schedule-ai-followup-notes"><span>質問以外の追加条件・新しく判明したこと <small>任意</small></span><textarea rows={4} value={followUpNotes} onChange={(event) => setFollowUpNotes(event.target.value)} placeholder={"例：中間レビューは11/8に決定した\n資料作成は4時間で確定。再見積もりしない\n10/15は別件のため作業できない"} /><small>AIから聞かれていない条件、確定した工数、利用できない日、計画上の希望などを入力できます。</small></label><button type="button" className="primary" disabled={!answeredQuestions.length && !followUpNotes.trim()} onClick={prepareFollowUp}>回答・追加条件を含む再相談プロンプトを作成</button></div>
          </>}
        </section>
        <footer><span className={applyError ? "error" : ""}>{applyError || (validation ? `エラー ${validation.issues.filter((item) => item.severity === "error").length}件・要確認 ${validation.issues.filter((item) => item.severity === "warning").length}件` : "解析するまではプロジェクトのデータは変更されません。")}</span><button type="button" onClick={onClose}>閉じる</button>{response && <button type="button" onClick={() => setTab("prompt")}>作成プロンプトへ戻る</button>}{response && validation && <button type="button" className="primary" disabled={!validation.canProceed || !hasNewItems} title={!hasNewItems ? "作成対象の新規項目がありません" : undefined} onClick={applyResponse}>新規項目を作成</button>}</footer>
      </>}
    </div>
  </Modal>;
}
