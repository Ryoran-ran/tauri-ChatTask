import { Fragment, useEffect, useState } from "react";
import type { Goal, Task, TaskReflection, TaskReflectionKind, TaskReflectionTheme } from "../types";
import { REFLECTION_THEME_GROUPS } from "../reflectionThemes";
import { buildReflectionAnalysisPrompt, parseReflectionAnalysis } from "../services/reflectionAi";
import { generateId, todayValue } from "../utils";
import { Modal } from "./Modal";
import { WorkDatePicker } from "./WorkDatePicker";

const KIND_LABELS: Record<TaskReflectionKind, string> = {
  success: "成功・うまくいった",
  "large-task": "大きなタスク",
  incident: "問題・やらかし",
  rework: "手戻り",
  estimate: "見積もり・工数",
  "branch-split": "ブランチ分割",
  other: "その他",
};
interface Props {
  task: Task;
  allTasks: Task[];
  projects: Goal[];
  onChange: (reflections: TaskReflection[], historyText?: string) => void;
  onCreateTask: (reflectionId: string, todoId: string) => void;
  onOpenTask: (taskId: string) => void;
  onClose: () => void;
}

type ReflectionTab = "reflection" | "ai" | "actions";

export function TaskReflectionsModal({ task, allTasks, projects, onChange, onCreateTask, onOpenTask, onClose }: Props) {
  const reflections = task.reflections || [];
  const [selectedId, setSelectedId] = useState(reflections[0]?.id || "");
  const tabStorageKey = `chatTaskReflectionTabs:${task.id}`;
  const [tabsByReflection, setTabsByReflection] = useState<Record<string, ReflectionTab>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(tabStorageKey) || "{}") as Record<string, unknown>;
      return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, ReflectionTab] => ["reflection", "ai", "actions"].includes(String(entry[1]))));
    } catch { return {}; }
  });
  const [todoText, setTodoText] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [aiInputOpen, setAiInputOpen] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);
  const [importVisible, setImportVisible] = useState(false);
  const [importText, setImportText] = useState("");
  const [aiMessage, setAiMessage] = useState("");
  const [promptCopied, setPromptCopied] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState({ success: false, improvement: false });
  const selected = reflections.find((reflection) => reflection.id === selectedId);
  const activeTab = tabsByReflection[selectedId] || "reflection";
  const setActiveTab = (tab: ReflectionTab) => setTabsByReflection((current) => {
    const next = { ...current, [selectedId]: tab };
    localStorage.setItem(tabStorageKey, JSON.stringify(next));
    return next;
  });
  useEffect(() => { setAiInputOpen(false); setPromptVisible(false); setImportVisible(false); setImportText(""); setAiMessage(""); setPromptCopied(false); }, [selectedId]);
  const update = (changes: Partial<TaskReflection>, historyText?: string) => {
    if (!selected) return;
    onChange(reflections.map((reflection) => reflection.id === selected.id ? { ...reflection, ...changes, updatedAt: new Date().toISOString() } : reflection), historyText);
  };
  const addReflection = () => {
    const now = new Date().toISOString();
    const reflection: TaskReflection = {
      id: generateId(), title: "振り返り", kind: "incident", summary: "", impact: "", cause: "", lesson: "",
      accomplishment: "", successReason: "", keepDoing: "",
      branchSplitAssessment: "not-applicable", themes: [], otherTheme: "", todos: [], reviewDate: "", createdAt: now, updatedAt: now,
    };
    onChange([reflection, ...reflections], "振り返りを追加しました。");
    setSelectedId(reflection.id);
    setDeleteConfirm(false);
  };
  const addTodo = () => {
    if (!selected || !todoText.trim()) return;
    const now = new Date().toISOString();
    update({ todos: [...selected.todos, { id: generateId(), text: todoText.trim(), completed: false, createdAt: now }] }, "振り返りに対策ToDoを追加しました。");
    setTodoText("");
  };
  const linkedTaskFor = (todo: TaskReflection["todos"][number]) => todo.linkedTaskId ? allTasks.find((item) => item.id === todo.linkedTaskId) : undefined;
  const todoCompleted = (todo: TaskReflection["todos"][number]) => todo.completed || ["done", "cancelled", "handed-over"].includes(linkedTaskFor(todo)?.status || "");
  const remove = () => {
    if (!selected) return;
    const next = reflections.filter((reflection) => reflection.id !== selected.id);
    onChange(next, "振り返りを削除しました。");
    setSelectedId(next[0]?.id || "");
    setDeleteConfirm(false);
  };
  const incompleteTotal = reflections.reduce((sum, reflection) => sum + reflection.todos.filter((todo) => !todoCompleted(todo)).length, 0);
  const orderedReflections = [...reflections].sort((a, b) => {
    const kindOrder = Number(b.kind === "success") - Number(a.kind === "success");
    if (kindOrder) return kindOrder;
    const openOrder = Number(b.todos.some((todo) => !todoCompleted(todo))) - Number(a.todos.some((todo) => !todoCompleted(todo)));
    if (openOrder) return openOrder;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  const prompt = selected ? buildReflectionAnalysisPrompt(task, selected, allTasks, projects) : "";
  const copyPrompt = async () => {
    try { await navigator.clipboard.writeText(prompt); setPromptCopied(true); setAiMessage("分析用プロンプトをコピーしました。"); }
    catch { setAiMessage("プロンプトをコピーできませんでした。"); }
  };
  const importAnalysis = () => {
    if (!selected || !importText.trim()) return;
    try {
      update({ aiAnalysis: parseReflectionAnalysis(importText) }, "振り返りにAI分析を取り込みました。");
      setImportText(""); setAiInputOpen(false); setAiMessage("AI分析を取り込みました。本人の記録と比較できます。");
    } catch (error) { setAiMessage(error instanceof Error ? error.message : "AI回答を取り込めませんでした。"); }
  };
  const addAiCountermeasure = (text: string) => {
    if (!selected || selected.todos.some((todo) => todo.text.trim() === text.trim())) return;
    const now = new Date().toISOString();
    const measure = selected.aiAnalysis?.countermeasures.find((item) => item.text.trim() === text.trim());
    update({ todos: [...selected.todos, { id: generateId(), title: measure?.title?.trim() || undefined, text, completed: false, createdAt: now }] }, `AIが提案した対策「${measure?.title || text}」をToDoへ追加しました。`);
  };
  const updateFollowUpAnswer = (question: string, answer: string) => {
    if (!selected) return;
    const now = new Date().toISOString();
    const current = selected.followUpAnswers || [];
    const exists = current.some((item) => item.question === question);
    update({
      followUpAnswers: exists
        ? current.map((item) => item.question === question ? { ...item, answer, updatedAt: now } : item)
        : [...current, { question, answer, updatedAt: now }],
    });
  };
  const answeredFollowUpCount = selected?.aiAnalysis?.additionalQuestions.filter((question) => selected.followUpAnswers?.find((item) => item.question === question)?.answer.trim()).length || 0;

  return <Modal title={`振り返り・${task.title || "無題のタスク"}`} onClose={onClose} wide>
    <div className="task-reflections-layout">
      <aside className="task-reflections-list">
        <header><div><strong>振り返り記録</strong><small>{reflections.length}件・未対応 {incompleteTotal}件</small></div><button type="button" className="primary" onClick={addReflection}>＋ 追加</button></header>
        <div>{orderedReflections.map((reflection, index) => {
          const remaining = reflection.todos.filter((todo) => !todoCompleted(todo)).length;
          const reflectionReady = Boolean((reflection.summary.trim() && reflection.cause.trim()) || (reflection.accomplishment?.trim() && reflection.successReason?.trim()));
          const analysisReady = Boolean(reflection.aiAnalysis);
          const actionsReady = reflection.todos.length > 0;
          const actionsDone = actionsReady && remaining === 0;
          const stageLabel = !reflectionReady ? "入力中" : !analysisReady ? "次：AI分析" : !actionsReady ? "次：対策設定" : !actionsDone ? `対策実行中 ${remaining}件` : "完了";
          const tone = reflection.kind === "success" ? "success" : ["incident", "rework"].includes(reflection.kind) ? "problem" : "neutral";
          const startsGroup = index === 0 || (orderedReflections[index - 1].kind === "success") !== (reflection.kind === "success");
          const groupCount = orderedReflections.filter((item) => (item.kind === "success") === (reflection.kind === "success")).length;
          const groupKey = reflection.kind === "success" ? "success" : "improvement";
          const collapsed = collapsedGroups[groupKey];
          return <Fragment key={reflection.id}>{startsGroup && <h3 className={groupKey}><button type="button" aria-expanded={!collapsed} onClick={() => setCollapsedGroups((current) => ({ ...current, [groupKey]: !current[groupKey] }))}><span>{reflection.kind === "success" ? "✓" : "!"}</span><b>{reflection.kind === "success" ? "よかったこと" : "改善したいこと"}</b><small>{groupCount}件</small><i>{collapsed ? "⌄" : "⌃"}</i></button></h3>}{!collapsed && <button type="button" className={`${reflection.id === selectedId ? "active " : ""}reflection-${tone}`} onClick={() => { setSelectedId(reflection.id); setDeleteConfirm(false); }}><span><b>{reflection.title || "振り返り"}</b><small>{KIND_LABELS[reflection.kind]}・{new Date(reflection.createdAt).toLocaleDateString("ja-JP")}</small><span className="task-reflection-list-progress" aria-label={`進捗：${stageLabel}`}><i className={reflectionReady ? "done" : "current"} /><i className={analysisReady ? "done" : reflectionReady ? "current" : ""} /><i className={actionsDone ? "done" : analysisReady ? "current" : ""} /></span></span><em className={actionsDone ? "completed" : remaining ? "has-todos" : ""}>{stageLabel}</em></button>}</Fragment>;
        })}{!reflections.length && <div className="task-reflections-empty"><strong>振り返りはまだありません</strong><p>大きなタスクや問題が発生したときだけ記録します。</p><button type="button" className="primary" onClick={addReflection}>最初の振り返りを追加</button></div>}</div>
      </aside>
      <section className={`task-reflection-editor tab-${activeTab} ${selected?.aiAnalysis?.additionalQuestions.length ? "has-ai-questions " : ""}${selected?.kind === "success" ? "reflection-success" : ["incident", "rework"].includes(selected?.kind || "") ? "reflection-problem" : "reflection-neutral"}`}>
        {selected ? <>
          <header><div><small>REFLECTION</small><input value={selected.title} onChange={(event) => update({ title: event.target.value })} placeholder="振り返りの題名" /></div><label>種類<select value={selected.kind} onChange={(event) => update({ kind: event.target.value as TaskReflectionKind })}>{Object.entries(KIND_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></header>
          <nav className="task-reflection-tabs" aria-label="振り返りの編集項目"><button type="button" className={activeTab === "reflection" ? "active" : ""} onClick={() => setActiveTab("reflection")}><span>1</span><b>振り返り</b><small>{selected.summary || selected.cause ? "入力あり" : "未入力"}</small></button><button type="button" className={activeTab === "ai" ? "active" : ""} onClick={() => setActiveTab("ai")}><span>2</span><b>AI分析</b><small>{selected.aiAnalysis ? "分析済み" : "未分析"}</small></button><button type="button" className={activeTab === "actions" ? "active" : ""} onClick={() => setActiveTab("actions")}><span>3</span><b>対策ToDo</b><small>{selected.todos.filter(todoCompleted).length}/{selected.todos.length}件</small></button></nav>
          <div className={`task-reflection-fields ${selected.kind === "success" ? "success-fields" : "problem-fields"}`}>
            {selected.kind === "success" ? <>
              <label className="task-reflection-positive">できたこと<textarea rows={3} value={selected.accomplishment || ""} onChange={(event) => update({ accomplishment: event.target.value })} placeholder="完了できたこと、良い判断、前進したこと" /></label>
              <label className="task-reflection-positive">うまくいった理由<textarea rows={3} value={selected.successReason || ""} onChange={(event) => update({ successReason: event.target.value })} placeholder="役立った条件、準備、工程、周囲の支援など" /></label>
              <label className="task-reflection-positive">次回も続けること<textarea rows={3} value={selected.keepDoing || ""} onChange={(event) => update({ keepDoing: event.target.value })} placeholder="再現したい行動や、残しておきたい仕組み" /></label>
            </> : <>
              <label className="task-reflection-positive">できたこと（任意）<textarea rows={3} value={selected.accomplishment || ""} onChange={(event) => update({ accomplishment: event.target.value })} placeholder="問題の中でも完了できたこと、良かった判断や前進" /></label>
              <label>起きたこと<textarea rows={3} value={selected.summary} onChange={(event) => update({ summary: event.target.value })} placeholder="事実を簡潔に記録" /></label>
              <label>影響<textarea rows={2} value={selected.impact} onChange={(event) => update({ impact: event.target.value })} placeholder="手戻り、遅延、品質への影響など" /></label>
              <label>原因<textarea rows={3} value={selected.cause} onChange={(event) => update({ cause: event.target.value })} placeholder="なぜ起きたか。個人ではなく仕組みや判断条件を中心に記録" /></label>
              <label>次回に活かすこと<textarea rows={3} value={selected.lesson} onChange={(event) => update({ lesson: event.target.value })} placeholder="次回の判断基準や再発防止策" /></label>
            </>}
          </div>
          <section className="task-reflection-themes"><header><strong>問題・改善テーマ</strong><small>必要な大分類だけを選択できます</small></header><div>{REFLECTION_THEME_GROUPS.map((group) => { const checked = group.themes.some((theme) => (selected.themes || []).includes(theme)); return <label className={checked ? "selected" : ""} key={group.id}><input type="checkbox" checked={checked} onChange={(event) => { const current = selected.themes || []; const themes: TaskReflectionTheme[] = event.target.checked ? [...current, group.defaultTheme] : current.filter((theme) => !group.themes.includes(theme)); update({ themes: [...new Set(themes)], ...(!themes.includes("branch-split") ? { branchSplitAssessment: "not-applicable" as const } : {}) }); }} /><span>{group.label}</span></label>; })}</div><label className={`task-reflection-other-theme ${(selected.themes || []).includes("other") ? "selected" : ""}`}><input type="checkbox" checked={(selected.themes || []).includes("other")} onChange={(event) => { const current = selected.themes || []; update({ themes: event.target.checked ? [...current, "other"] : current.filter((theme) => theme !== "other"), ...(!event.target.checked ? { otherTheme: "" } : {}) }); }} /><span>その他</span></label>{(selected.themes || []).includes("other") && <input value={selected.otherTheme || ""} onChange={(event) => update({ otherTheme: event.target.value })} placeholder="テーマを自由入力" />}</section>
          <div className="task-reflection-meta">
            {(selected.kind === "branch-split" || (selected.themes || []).includes("branch-split")) && <label>ブランチ分割の振り返り<select value={selected.branchSplitAssessment} onChange={(event) => update({ branchSplitAssessment: event.target.value as TaskReflection["branchSplitAssessment"] })}><option value="not-applicable">まだ評価していない</option><option value="should-have-split">分けるべきだった</option><option value="appropriate">今回の分け方で適切</option><option value="unsure">判断できない</option></select></label>}
            <label>対策の確認日<WorkDatePicker ariaLabel="振り返り対策の確認日" value={selected.reviewDate} min={todayValue()} onChange={(reviewDate) => update({ reviewDate })} /></label>
          </div>
          <div className="task-reflection-ai-launch"><div><strong>AI分析</strong><small>プロンプトの作成と回答の取り込みは別ウィンドウで行います</small></div><button type="button" className="primary" onClick={() => setAiInputOpen(true)}>{selected.aiAnalysis ? "AI分析を更新" : "AI分析を作成"}</button></div>
          <section className="task-reflection-ai"><header><div><strong>AIによる原因・対策分析</strong><small>本人の考えを残したまま、再現性と根本原因まで比較します</small></div><div><button type="button" onClick={() => setPromptVisible((value) => !value)}>{promptVisible ? "プロンプトを閉じる" : "プロンプトを表示"}</button><button type="button" onClick={() => void copyPrompt()}>{promptCopied ? "コピー済み" : "プロンプトをコピー"}</button><button type="button" className="primary" onClick={() => setImportVisible((value) => !value)}>{importVisible ? "取り込みを閉じる" : "AI回答を取り込む"}</button></div></header>{promptVisible && <div className="task-reflection-prompt"><textarea readOnly rows={12} value={prompt} /><small>タスク名は含めず、振り返り内容と工数・状態だけを出力します。</small></div>}{importVisible && <div className="task-reflection-ai-import"><textarea rows={10} value={importText} onChange={(event) => { setImportText(event.target.value); setAiMessage(""); }} placeholder="AIが返したJSONを貼り付けてください" spellCheck={false} /><div><button type="button" onClick={() => { setImportVisible(false); setImportText(""); }}>キャンセル</button><button type="button" className="primary" disabled={!importText.trim()} onClick={importAnalysis}>分析結果を取り込む</button></div></div>}{aiMessage && <p className="task-reflection-ai-message">{aiMessage}</p>}{selected.aiAnalysis ? <div className="task-reflection-comparison"><article className="self"><header><span>本人</span><strong>自分の考え</strong></header><section><small>原因</small><p>{selected.cause || "未記入"}</p></section><section><small>次回に活かすこと</small><p>{selected.lesson || "未記入"}</p></section><section><small>対策ToDo</small>{selected.todos.length ? <ul>{selected.todos.map((todo) => <li key={todo.id}><b>{todo.completed ? "✓" : "○"}</b><span><strong>{todo.title || todo.text}</strong>{todo.title && <em>{todo.text}</em>}</span></li>)}</ul> : <p>未登録</p>}</section></article><article className="ai"><header><span>AI</span><strong>分析結果</strong><time>{new Date(selected.aiAnalysis.importedAt).toLocaleString("ja-JP")}</time></header>{selected.aiAnalysis.summary && <section><small>要約</small><p>{selected.aiAnalysis.summary}</p></section>}<section><small>原因仮説</small>{selected.aiAnalysis.causes.length ? <ul>{selected.aiAnalysis.causes.map((cause, index) => <li key={`${cause.text}-${index}`}><b className={`confidence-${cause.confidence}`}>{cause.confidence === "high" ? "高" : cause.confidence === "medium" ? "中" : "低"}</b><span>{cause.text}{cause.evidence && <em>根拠：{cause.evidence}</em>}</span></li>)}</ul> : <p>原因仮説なし</p>}</section>{selected.aiAnalysis.reproducibility && <section className="task-reflection-ai-assessment"><small>再現性</small><p><b>{selected.aiAnalysis.reproducibility.level === "high" ? "高い" : selected.aiAnalysis.reproducibility.level === "medium" ? "中程度" : selected.aiAnalysis.reproducibility.level === "low" ? "低い" : "判断材料不足"}</b>{selected.aiAnalysis.reproducibility.reason && <span>{selected.aiAnalysis.reproducibility.reason}</span>}</p>{selected.aiAnalysis.reproducibility.conditions.length > 0 && <ul>{selected.aiAnalysis.reproducibility.conditions.map((condition) => <li key={condition}>再発条件：{condition}</li>)}</ul>}{selected.aiAnalysis.reproducibility.verification && <em>確認方法：{selected.aiAnalysis.reproducibility.verification}</em>}</section>}{selected.aiAnalysis.rootCause && <section className="task-reflection-ai-assessment"><small>根本原因</small><p><b>{selected.aiAnalysis.rootCause.identified === true ? "特定" : selected.aiAnalysis.rootCause.identified === false ? "未特定" : "判断保留"}</b><span>{selected.aiAnalysis.rootCause.text || "根本原因を断定できる情報がありません。"}</span></p>{selected.aiAnalysis.rootCause.reasoning && <em>判断根拠：{selected.aiAnalysis.rootCause.reasoning}</em>}{selected.aiAnalysis.rootCause.missingEvidence.length > 0 && <ul>{selected.aiAnalysis.rootCause.missingEvidence.map((evidence) => <li key={evidence}>不足情報：{evidence}</li>)}</ul>}</section>}<section><small>対策案</small>{selected.aiAnalysis.countermeasures.length ? <div className="task-reflection-ai-measures">{selected.aiAnalysis.countermeasures.map((measure, index) => { const added = selected.todos.some((todo) => todo.text.trim() === measure.text.trim()); return <div key={`${measure.text}-${index}`}><span><b>{measure.priority === "high" ? "高" : measure.priority === "medium" ? "中" : "低"}</b><strong>{measure.title || measure.text}</strong>{measure.title && <small>{measure.text}</small>}{measure.verification && <small>確認条件：{measure.verification}</small>}</span><button type="button" disabled={added} onClick={() => addAiCountermeasure(measure.text)}>{added ? "追加済み" : "ToDoに追加"}</button></div>; })}</div> : <p>対策案なし</p>}</section>{selected.aiAnalysis.branchAssessment.reason && <section><small>ブランチ分割</small><p>{selected.aiAnalysis.branchAssessment.needed === true ? "分けるべきだった" : selected.aiAnalysis.branchAssessment.needed === false ? "分けなくてよかった" : "判断対象外・不明"}：{selected.aiAnalysis.branchAssessment.reason}</p></section>}{selected.aiAnalysis.additionalQuestions.length > 0 && <section><small>追加で確認したいこと</small><ul>{selected.aiAnalysis.additionalQuestions.map((question) => <li key={question}>{question}</li>)}</ul></section>}</article></div> : <div className="task-reflection-ai-empty"><strong>AI分析はまだありません</strong><span>プロンプトをAIへ渡し、JSON回答を取り込むと本人の考えと並べて表示します。</span></div>}</section>
          {(selected.accomplishment || selected.successReason || selected.keepDoing || selected.aiAnalysis?.successFactors?.length) ? <section className="task-reflection-success-analysis"><header><div><strong>できたこと・再現したい成功</strong><small>改善するときにも、うまくいった条件を失わないように確認します</small></div></header><div className="task-reflection-success-columns"><article><small>本人の記録</small><strong>{selected.accomplishment || "未記入"}</strong>{selected.successReason && <p>うまくいった理由：{selected.successReason}</p>}{selected.keepDoing && <p>次回も続けること：{selected.keepDoing}</p>}</article><article><small>AIが見つけた成功要因</small>{selected.aiAnalysis?.successFactors?.length ? selected.aiAnalysis.successFactors.map((factor, index) => <div key={`${factor.text}-${index}`}><header><strong>{factor.text}</strong><span>{factor.reproducibility === "high" ? "再現性 高" : factor.reproducibility === "medium" ? "再現性 中" : factor.reproducibility === "low" ? "再現性 低" : "未評価"}</span></header>{factor.evidence && <p>根拠：{factor.evidence}</p>}{factor.continuation && <p>続け方：{factor.continuation}</p>}</div>) : <p>再分析すると、成功要因の再現性が表示されます。</p>}</article></div></section> : null}
          {selected.aiAnalysis?.countermeasures.length ? <section className="task-reflection-countermeasure-robustness"><header><div><strong>対策の再現性</strong><small>担当者が変わっても同じように失敗を防げるかを確認します</small></div></header><div>{selected.aiAnalysis.countermeasures.map((measure, index) => { const robustness = measure.robustness; const level = robustness?.level === "high" ? "高い" : robustness?.level === "medium" ? "中程度" : robustness?.level === "low" ? "低い" : "未評価"; return <article key={`${measure.text}-${index}`}><header><b>{index + 1}</b><strong>{measure.title || measure.text}</strong><span className={`level-${robustness?.level || "unknown"}`}>{level}</span></header>{robustness ? <div><p><small>評価理由</small>{robustness.reason || "判断理由がありません"}</p><p><small>属人性</small>{robustness.dependsOnPerson === true ? "人の注意・判断に依存しています" : robustness.dependsOnPerson === false ? "特定の人には依存しません" : "判断材料が不足しています"}</p><p><small>標準化</small>{robustness.standardization || "標準化方法は未提案です"}</p>{robustness.failureModes.length > 0 && <p><small>機能しない条件</small>{robustness.failureModes.join("／")}</p>}</div> : <p className="empty">旧形式の分析です。再分析すると対策の再現性を確認できます。</p>}</article>; })}</div></section> : null}
          {selected.aiAnalysis?.additionalQuestions.length ? <section className="task-reflection-follow-up"><header><div><strong>追加の確認</strong><small>AIの質問に回答すると、原因と対策をもう一段深く分析できます</small></div><span>{answeredFollowUpCount}/{selected.aiAnalysis.additionalQuestions.length}件回答</span></header><div>{selected.aiAnalysis.additionalQuestions.map((question, index) => { const answer = selected.followUpAnswers?.find((item) => item.question === question)?.answer || ""; return <label key={question}><span><b>{index + 1}</b>{question}</span><textarea rows={2} value={answer} onChange={(event) => updateFollowUpAnswer(question, event.target.value)} placeholder="わかる範囲で回答してください。わからない場合は「不明」と入力できます" /></label>; })}</div><footer><small>回答は自動保存され、再分析用プロンプトへ追加されます。</small><button type="button" className="primary" disabled={answeredFollowUpCount === 0} onClick={() => setAiInputOpen(true)}>回答を含めて再分析</button></footer></section> : null}
          <section className="task-reflection-todos task-reflection-actions">
            <header><div><strong>対策ToDo</strong><small>短い対策はチェックで完了し、時間がかかる対策は通常タスクとして計画します</small></div><div className="task-reflection-actions-summary"><span>{selected.todos.filter(todoCompleted).length}/{selected.todos.length}件</span></div></header>
            <div className="task-reflection-todo-add"><input value={todoText} onChange={(event) => setTodoText(event.target.value)} placeholder="例：機能追加とリファクタリングを別ブランチにする" /><button type="button" className="primary" disabled={!todoText.trim()} onClick={addTodo}>追加</button></div>
            <div className="task-reflection-todo-list">{selected.todos.map((todo) => {
              const linkedTask = linkedTaskFor(todo);
              const completed = todoCompleted(todo);
              return <div className={completed ? "completed" : ""} key={todo.id}>
                <label><input type="checkbox" checked={completed} disabled={Boolean(linkedTask)} title={linkedTask ? "作成したタスクの状態と連動します" : undefined} onChange={(event) => { const completed = event.target.checked; update({ todos: selected.todos.map((item) => item.id === todo.id ? { ...item, completed, completedAt: completed ? new Date().toISOString() : undefined } : item) }, completed ? `振り返りの対策「${todo.title || todo.text}」を完了しました。` : `振り返りの対策「${todo.title || todo.text}」を未完了に戻しました。`); }} /><span><strong>{todo.title || todo.text}</strong>{todo.title && <small>{todo.text}</small>}{linkedTask && <small>{linkedTask.title}と連動</small>}</span></label>
                <div className="task-reflection-todo-actions"><small>{linkedTask ? linkedTask.status === "done" ? "完了" : linkedTask.status === "doing" ? "進行中" : "タスクで管理中" : todo.scheduledDate ? `簡易予定 ${todo.scheduledDate.replace(/-/g, "/")}` : "未計画"}</small>{linkedTask ? <button type="button" onClick={() => { onClose(); onOpenTask(linkedTask.id); }}>タスクを開く</button> : <button type="button" className="primary" onClick={() => { onCreateTask(selected.id, todo.id); onClose(); }}>タスクとして計画</button>}<button type="button" className="task-reflection-todo-delete" aria-label={`${todo.title || todo.text}を削除`} onClick={() => update({ todos: selected.todos.filter((item) => item.id !== todo.id) })}>削除</button></div>
              </div>;
            })}{!selected.todos.length && <p>対策ToDoはまだありません。</p>}</div>
          </section>
          <footer><small>入力内容は自動保存されます</small>{deleteConfirm ? <div><span>この振り返りを削除しますか？</span><button type="button" onClick={() => setDeleteConfirm(false)}>戻る</button><button type="button" className="danger" onClick={remove}>削除する</button></div> : <button type="button" className="danger-text" onClick={() => setDeleteConfirm(true)}>振り返りを削除</button>}</footer>
        </> : <div className="task-reflection-editor-empty"><span>↺</span><strong>記録を選択してください</strong></div>}
      </section>
    </div>
    {aiInputOpen && selected && <Modal title="AI分析を作成・取り込む" onClose={() => setAiInputOpen(false)} wide><div className="task-reflection-ai-window"><header><strong>{selected.title || "振り返り"}</strong><p>生成したプロンプトをAIへ渡し、返されたJSONを下の入力欄から取り込みます。</p></header><section><div><strong>1. 分析用プロンプト</strong><button type="button" className="primary" onClick={() => void copyPrompt()}>{promptCopied ? "コピー済み" : "プロンプトをコピー"}</button></div><textarea readOnly rows={16} value={prompt} /><small>タスク名は含めず、振り返り内容と工数・状態だけを出力します。</small></section><section><div><strong>2. AIの出力結果</strong><small>JSON形式</small></div><textarea rows={16} value={importText} onChange={(event) => { setImportText(event.target.value); setAiMessage(""); }} placeholder="AIが返したJSON全体を貼り付けてください" spellCheck={false} />{aiMessage && <p className="task-reflection-ai-message">{aiMessage}</p>}</section><footer><button type="button" onClick={() => setAiInputOpen(false)}>戻る</button><button type="button" className="primary" disabled={!importText.trim()} onClick={importAnalysis}>分析結果を取り込む</button></footer></div></Modal>}
  </Modal>;
}
