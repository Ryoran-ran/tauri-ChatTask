import { useMemo, useState } from "react";
import type { ProjectTag, Task, TaskReflectionAiAnalysis } from "../types";
import { groupedReflectionThemeLabels, REFLECTION_THEME_GROUPS, type TaskReflectionThemeGroup } from "../reflectionThemes";
import { Modal } from "./Modal";
import { TagIcon } from "./TagIcon";

const KIND_LABELS = { success: "成功・うまくいった", "large-task": "大きなタスク", incident: "問題・やらかし", rework: "手戻り", estimate: "見積もり・工数", "branch-split": "ブランチ分割", other: "その他" } as const;
const BRANCH_LABELS = { "should-have-split": "分けるべきだった", appropriate: "分け方は適切", unsure: "判断できない", "not-applicable": "未評価" } as const;

interface Props {
  tasks: Task[];
  tags: ProjectTag[];
  onUpdateTask: (id: string, changes: Partial<Task>, historyText?: string) => void;
  onOpenTask: (id: string) => void;
  onClose: () => void;
}

function ReflectionAiRecord({ analysis }: { analysis: TaskReflectionAiAnalysis }) {
  return <section className="reflection-record-ai">
    <header><div><span>AI</span><strong>原因・対策の分析</strong></div><time>{new Date(analysis.importedAt).toLocaleString("ja-JP")}</time></header>
    {analysis.summary && <p className="reflection-record-ai-summary">{analysis.summary}</p>}
    <div>
      {analysis.successFactors?.length ? <section><small>成功要因</small><ul>{analysis.successFactors.map((factor, index) => <li key={`${factor.text}-${index}`}><b>{factor.reproducibility === "high" ? "再現 高" : factor.reproducibility === "medium" ? "再現 中" : factor.reproducibility === "low" ? "再現 低" : "未評価"}</b><span>{factor.text}{factor.evidence && <em>根拠：{factor.evidence}</em>}{factor.continuation && <em>続け方：{factor.continuation}</em>}</span></li>)}</ul></section> : null}
      <section><small>原因仮説</small>{analysis.causes.length ? <ul>{analysis.causes.map((cause, index) => <li key={`${cause.text}-${index}`}><b>{cause.confidence === "high" ? "確度 高" : cause.confidence === "medium" ? "確度 中" : "確度 低"}</b><span>{cause.text}{cause.evidence && <em>根拠：{cause.evidence}</em>}</span></li>)}</ul> : <p>原因仮説なし</p>}</section>
      <section><small>再現性</small>{analysis.reproducibility ? <><p><strong>{analysis.reproducibility.level === "high" ? "高い" : analysis.reproducibility.level === "medium" ? "中程度" : analysis.reproducibility.level === "low" ? "低い" : "判断材料不足"}</strong>{analysis.reproducibility.reason && `・${analysis.reproducibility.reason}`}</p>{analysis.reproducibility.conditions.length > 0 && <ul>{analysis.reproducibility.conditions.map((condition) => <li key={condition}><span>再発条件：{condition}</span></li>)}</ul>}{analysis.reproducibility.verification && <p>確認方法：{analysis.reproducibility.verification}</p>}</> : <p>未分析</p>}</section>
      <section><small>根本原因</small>{analysis.rootCause ? <><p><strong>{analysis.rootCause.identified === true ? "特定" : analysis.rootCause.identified === false ? "未特定" : "判断保留"}</strong>{analysis.rootCause.text && `・${analysis.rootCause.text}`}</p>{analysis.rootCause.reasoning && <p>判断根拠：{analysis.rootCause.reasoning}</p>}{analysis.rootCause.missingEvidence.length > 0 && <ul>{analysis.rootCause.missingEvidence.map((evidence) => <li key={evidence}><span>不足情報：{evidence}</span></li>)}</ul>}</> : <p>未分析</p>}</section>
      <section><small>対策案</small>{analysis.countermeasures.length ? <ul>{analysis.countermeasures.map((measure, index) => <li key={`${measure.text}-${index}`}><b>{measure.priority === "high" ? "優先 高" : measure.priority === "medium" ? "優先 中" : "優先 低"}</b><span>{measure.text}{measure.verification && <em>確認条件：{measure.verification}</em>}</span></li>)}</ul> : <p>対策案なし</p>}</section>
    </div>
  </section>;
}

export function ReflectionRecordsModal({ tasks, tags, onUpdateTask, onOpenTask, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<"all" | "other" | TaskReflectionThemeGroup>("all");
  const [todoFilter, setTodoFilter] = useState<"all" | "open" | "completed" | "none">("all");
  const todoCompleted = (todo: NonNullable<Task["reflections"]>[number]["todos"][number]) => todo.completed || (todo.linkedTaskId ? ["done", "cancelled", "handed-over"].includes(tasks.find((task) => task.id === todo.linkedTaskId)?.status || "") : false);
  const records = useMemo(() => tasks.flatMap((task) => (task.reflections || []).map((reflection) => ({ task, reflection }))).sort((a, b) => {
    const kindOrder = Number(b.reflection.kind === "success") - Number(a.reflection.kind === "success");
    if (kindOrder) return kindOrder;
    const openOrder = Number(b.reflection.todos.some((todo) => !todoCompleted(todo))) - Number(a.reflection.todos.some((todo) => !todoCompleted(todo)));
    if (openOrder) return openOrder;
    return b.reflection.updatedAt.localeCompare(a.reflection.updatedAt);
  }), [tasks]);
  const openTodos = records.reduce((sum, record) => sum + record.reflection.todos.filter((todo) => !todoCompleted(todo)).length, 0);
  const completedTodos = records.reduce((sum, record) => sum + record.reflection.todos.filter(todoCompleted).length, 0);
  const visible = records.filter(({ task, reflection }) => {
    const text = [
      task.title, reflection.title, reflection.accomplishment, reflection.successReason, reflection.keepDoing, reflection.summary, reflection.impact, reflection.cause, reflection.lesson, reflection.otherTheme,
      reflection.aiAnalysis?.summary,
      ...(reflection.aiAnalysis?.successFactors?.flatMap((factor) => [factor.text, factor.evidence, factor.continuation]) || []),
      ...(reflection.aiAnalysis?.causes.flatMap((cause) => [cause.text, cause.evidence]) || []),
      ...(reflection.aiAnalysis?.countermeasures.flatMap((measure) => [measure.title, measure.text, measure.verification]) || []),
      reflection.aiAnalysis?.reproducibility?.reason,
      ...(reflection.aiAnalysis?.reproducibility?.conditions || []),
      reflection.aiAnalysis?.rootCause?.text,
      reflection.aiAnalysis?.rootCause?.reasoning,
      ...(reflection.aiAnalysis?.rootCause?.missingEvidence || []),
      ...reflection.todos.flatMap((todo) => [todo.title, todo.text]),
    ].filter(Boolean).join(" ").toLocaleLowerCase("ja");
    if (query.trim() && !text.includes(query.trim().toLocaleLowerCase("ja"))) return false;
    if (theme === "other" && !(reflection.themes || []).includes("other")) return false;
    if (theme !== "all" && theme !== "other") {
      const group = REFLECTION_THEME_GROUPS.find((item) => item.id === theme);
      if (!group?.themes.some((item) => (reflection.themes || []).includes(item))) return false;
    }
    const remaining = reflection.todos.filter((todo) => !todoCompleted(todo)).length;
    if (todoFilter === "open" && remaining === 0) return false;
    if (todoFilter === "completed" && (!reflection.todos.length || remaining > 0)) return false;
    if (todoFilter === "none" && reflection.todos.length > 0) return false;
    return true;
  });
  const setTodoCompleted = (task: Task, reflectionId: string, todoId: string, completed: boolean) => {
    const reflection = (task.reflections || []).find((item) => item.id === reflectionId);
    const todo = reflection?.todos.find((item) => item.id === todoId);
    if (!reflection || !todo) return;
    const now = new Date().toISOString();
    onUpdateTask(task.id, {
      reflections: (task.reflections || []).map((item) => item.id === reflectionId ? {
        ...item,
        updatedAt: now,
        todos: item.todos.map((entry) => entry.id === todoId ? {
          ...entry,
          completed,
          completedAt: completed ? now : undefined,
        } : entry),
      } : item),
    }, completed ? `振り返りの対策「${todo.text}」を完了しました。` : `振り返りの対策「${todo.text}」を未対応に戻しました。`);
  };

  return <Modal title="振り返り記録" onClose={onClose} wide>
    <div className="reflection-records">
      <section className="reflection-record-summary"><div><span>振り返り</span><strong>{records.length}</strong><small>件</small></div><div><span>対象タスク</span><strong>{new Set(records.map(({ task }) => task.id)).size}</strong><small>件</small></div><div className={openTodos ? "has-open" : ""}><span>未対応ToDo</span><strong>{openTodos}</strong><small>件</small></div><div><span>対応済み</span><strong>{completedTodos}</strong><small>件</small></div></section>
      <section className="reflection-record-filters"><label className="reflection-record-search">検索<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タスク名・原因・対策を検索" /></label><label>改善テーマ<select value={theme} onChange={(event) => setTheme(event.target.value as typeof theme)}><option value="all">すべて</option>{REFLECTION_THEME_GROUPS.map((group) => <option value={group.id} key={group.id}>{group.label}</option>)}<option value="other">その他</option></select></label><label>対策ToDo<select value={todoFilter} onChange={(event) => setTodoFilter(event.target.value as typeof todoFilter)}><option value="all">すべて</option><option value="open">未対応あり</option><option value="completed">すべて対応済み</option><option value="none">ToDoなし</option></select></label><button type="button" onClick={() => { setQuery(""); setTheme("all"); setTodoFilter("all"); }}>条件をクリア</button></section>
      <div className="reflection-record-list">{visible.map(({ task, reflection }) => {
        const tag = tags.find((item) => item.id === task.projectTagId);
        const remaining = reflection.todos.filter((todo) => !todoCompleted(todo)).length;
        const themeLabels = groupedReflectionThemeLabels(reflection.themes || [], reflection.otherTheme);
        return <details key={`${task.id}:${reflection.id}`} className={remaining ? "has-open-todos" : ""}><summary><div className="reflection-record-heading"><span>{KIND_LABELS[reflection.kind]}</span><strong>{reflection.title || "振り返り"}</strong><small>{task.title || "無題のタスク"}</small></div><div className="reflection-record-meta">{tag && <span className="reflection-record-tag"><TagIcon tag={tag} />{tag.name}</span>}<time>{new Date(reflection.updatedAt).toLocaleDateString("ja-JP")}</time><b>{remaining ? `未対応 ${remaining}` : reflection.todos.length ? "対応済み" : "ToDoなし"}</b><i>⌄</i></div></summary><div className="reflection-record-body"><div className="reflection-record-themes">{themeLabels.map((label) => <span key={label}>{label}</span>)}{!themeLabels.length && <span>テーマ未設定</span>}</div><div className="reflection-record-fields">{reflection.summary && <section><small>起きたこと</small><p>{reflection.summary}</p></section>}{reflection.impact && <section><small>影響</small><p>{reflection.impact}</p></section>}{reflection.cause && <section><small>原因</small><p>{reflection.cause}</p></section>}{reflection.lesson && <section><small>次回に活かすこと</small><p>{reflection.lesson}</p></section>}</div>{(reflection.kind === "branch-split" || (reflection.themes || []).includes("branch-split")) && <p className="reflection-record-branch">ブランチ分割：<strong>{BRANCH_LABELS[reflection.branchSplitAssessment]}</strong></p>}{reflection.aiAnalysis && <ReflectionAiRecord analysis={reflection.aiAnalysis} />}<section className="reflection-record-todos"><header><strong>対策ToDo</strong><small>{reflection.todos.filter((todo) => todo.completed).length}/{reflection.todos.length}件</small></header>{reflection.todos.length ? <div>{reflection.todos.map((todo) => <label className={todo.completed ? "completed" : ""} key={todo.id}><input type="checkbox" checked={todo.completed} onChange={(event) => setTodoCompleted(task, reflection.id, todo.id, event.target.checked)} /><span>{todo.text}</span><em>{todo.completed ? "対応済み" : "未対応"}</em></label>)}</div> : <p className="empty">対策ToDoはありません。</p>}</section><footer>{reflection.reviewDate && <span>確認日 {reflection.reviewDate.replace(/-/g, "/")}</span>}<button type="button" className="primary" onClick={() => { onOpenTask(task.id); onClose(); }}>元のタスクを開く</button></footer></div></details>;
      })}{!visible.length && <div className="reflection-record-empty"><span>↺</span><strong>{records.length ? "条件に一致する振り返りはありません" : "振り返りはまだありません"}</strong><small>{records.length ? "絞り込み条件を変更してください。" : "大きなタスクや問題が発生したときに、タスクメニューから記録できます。"}</small></div>}</div>
    </div>
  </Modal>;
}
