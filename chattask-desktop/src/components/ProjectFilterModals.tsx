import { useState } from "react";
import { PRIORITIES } from "../data/constants";
import type { GoalStatus, ProjectTag } from "../types";
import { generateId } from "../utils";
import { Modal } from "./Modal";

export type ProjectFilterField = "status" | "priority" | "tag" | "deadline" | "text";
export type ProjectFilterCondition = { id: string; field: ProjectFilterField; operator: "is" | "is-not" | "contains" | "not-contains"; value: string };
export type ProjectAdvancedFilter = { mode: "and" | "or"; conditions: ProjectFilterCondition[] };
export type ProjectSortKey = "priority" | "dueDate" | "status" | "progress" | "updatedAt" | "title";
export type ProjectSortRule = { id: string; key: ProjectSortKey; direction: "asc" | "desc" };

export const PROJECT_STATUS_LABELS: Record<GoalStatus, string> = {
  "not-started": "未着手", "in-progress": "進行中", paused: "一時停止",
  achieved: "達成", archived: "アーカイブ", cancelled: "中止（旧）",
};
const PROJECT_STATUS_GROUPS: { label: string; values: GoalStatus[] }[] = [
  { label: "開始前", values: ["not-started"] },
  { label: "対応中", values: ["in-progress", "paused"] },
  { label: "終了", values: ["achieved", "archived", "cancelled"] },
];
export const PROJECT_SORT_LABELS: Record<ProjectSortKey, string> = { priority: "優先度", dueDate: "期限", status: "ステータス", progress: "進捗率", updatedAt: "更新日", title: "プロジェクト名" };
export const blankProjectFilter = (): ProjectFilterCondition => ({ id: generateId(), field: "status", operator: "is", value: "in-progress" });

export function ProjectSortModal({ rules, onChange, onClose }: { rules: ProjectSortRule[]; onChange: (rules: ProjectSortRule[]) => void; onClose: () => void }) {
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return <Modal title="プロジェクトの並び替え" onClose={onClose} wide><div className="sort-editor-dialog">
    <header><div><strong>並び替え条件</strong><p>上にある条件から順番に適用します。</p></div></header>
    <div className="task-sort-rules">{rules.map((rule, index) => <div key={rule.id}>
      <b>{index + 1}</b>
      <select value={rule.key} onChange={(event) => onChange(rules.map((item) => item.id === rule.id ? { ...item, key: event.target.value as ProjectSortKey } : item))}>{Object.entries(PROJECT_SORT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select value={rule.direction} aria-label={`${PROJECT_SORT_LABELS[rule.key]}の方向`} onChange={(event) => onChange(rules.map((item) => item.id === rule.id ? { ...item, direction: event.target.value as "asc" | "desc" } : item))}><option value="asc">昇順</option><option value="desc">降順</option></select>
      <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" disabled={index === rules.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" aria-label={`${PROJECT_SORT_LABELS[rule.key]}を削除`} onClick={() => onChange(rules.filter((item) => item.id !== rule.id))}>×</button>
    </div>)}</div>
    {rules.length < Object.keys(PROJECT_SORT_LABELS).length && <button type="button" className="advanced-filter-add" onClick={() => { const key = (Object.keys(PROJECT_SORT_LABELS) as ProjectSortKey[]).find((candidate) => !rules.some((rule) => rule.key === candidate)); if (key) onChange([...rules, { id: generateId(), key, direction: key === "priority" || key === "dueDate" || key === "title" ? "asc" : "desc" }]); }}>＋ 並び替え条件を追加</button>}
    <footer><button type="button" className="primary" onClick={onClose}>設定を反映</button></footer>
  </div></Modal>;
}

function ProjectStatusFilterModal({ value, onChange, onClose }: { value: string; onChange: (value: string) => void; onClose: () => void }) {
  const selected = value.split(",").filter((status): status is GoalStatus => status in PROJECT_STATUS_LABELS);
  const toggle = (status: GoalStatus) => onChange(selected.includes(status) ? selected.filter((item) => item !== status).join(",") : [...selected, status].join(","));
  const toggleGroup = (statuses: GoalStatus[]) => {
    const allSelected = statuses.every((status) => selected.includes(status));
    onChange(allSelected ? selected.filter((status) => !statuses.includes(status)).join(",") : [...new Set([...selected, ...statuses])].join(","));
  };
  return <Modal title="プロジェクトのステータスを選択" onClose={onClose} wide><div className="status-filter-picker"><header><div><strong>対象にするステータス</strong><p>カテゴリー単位または個別に複数選択できます。</p></div><div><button type="button" onClick={() => onChange(Object.keys(PROJECT_STATUS_LABELS).join(","))}>すべて選択</button><button type="button" onClick={() => onChange("")}>すべて解除</button></div></header><div className="status-filter-groups project-status-filter-groups">{PROJECT_STATUS_GROUPS.map((group) => { const count = group.values.filter((status) => selected.includes(status)).length; return <section key={group.label}><label className="status-filter-group-title"><input type="checkbox" checked={count === group.values.length} ref={(element) => { if (element) element.indeterminate = count > 0 && count < group.values.length; }} onChange={() => toggleGroup(group.values)} /><span>{group.label}</span><small>{count}/{group.values.length}</small></label><div>{group.values.map((status) => <label key={status}><input type="checkbox" checked={selected.includes(status)} onChange={() => toggle(status)} /><span>{PROJECT_STATUS_LABELS[status]}</span></label>)}</div></section>; })}</div><div className="modal-actions"><span>{selected.length}件選択中</span><button type="button" className="primary" onClick={onClose}>選択を確定</button></div></div></Modal>;
}

export function ProjectAdvancedFilterModal({ filter, tags, onApply, onClose }: { filter: ProjectAdvancedFilter; tags: ProjectTag[]; onApply: (filter: ProjectAdvancedFilter) => void; onClose: () => void }) {
  const [statusConditionId, setStatusConditionId] = useState("");
  const update = (id: string, changes: Partial<ProjectFilterCondition>) => onApply({ ...filter, conditions: filter.conditions.map((item) => item.id === id ? { ...item, ...changes } : item) });
  const defaults: Record<ProjectFilterField, string> = { status: "in-progress", priority: "A", tag: tags[0]?.id || "none", deadline: "true", text: "" };
  const labels: Record<ProjectFilterField, string> = { status: "ステータス", priority: "優先度", tag: "案件タグ", deadline: "期限", text: "文字列" };
  const valueEditor = (item: ProjectFilterCondition) => {
    if (item.field === "status") { const values = item.value.split(",").filter((status): status is GoalStatus => status in PROJECT_STATUS_LABELS); return <button type="button" className="status-filter-select" onClick={() => setStatusConditionId(item.id)}><span>{values.length === 0 ? "未選択" : values.length === 1 ? PROJECT_STATUS_LABELS[values[0]] : `${values.length}件のステータス`}</span><small>選択画面を開く ›</small></button>; }
    if (item.field === "priority") return <select value={item.value} onChange={(event) => update(item.id, { value: event.target.value })}>{PRIORITIES.map((value) => <option key={value}>{value}</option>)}</select>;
    if (item.field === "tag") return <select value={item.value} onChange={(event) => update(item.id, { value: event.target.value })}><option value="none">タグなし</option>{tags.map((tag) => <option value={tag.id} key={tag.id}>{tag.name}</option>)}</select>;
    if (item.field === "deadline") return <select value={item.value} onChange={(event) => update(item.id, { value: event.target.value })}><option value="true">あり</option><option value="false">なし</option></select>;
    return <input value={item.value} onChange={(event) => update(item.id, { value: event.target.value })} placeholder="プロジェクト名・説明・達成条件" />;
  };
  const statusCondition = filter.conditions.find((item) => item.id === statusConditionId && item.field === "status");
  return <><Modal title="プロジェクトの条件検索" onClose={onClose} wide><div className="advanced-filter-builder"><header><div><strong>条件の組み合わせ</strong><p>プロジェクトを複数の条件で絞り込みます。</p></div><select value={filter.mode} onChange={(event) => onApply({ ...filter, mode: event.target.value as "and" | "or" })}><option value="and">すべて満たす（AND）</option><option value="or">いずれかを満たす（OR）</option></select></header><div className="advanced-filter-list">{filter.conditions.map((item, index) => <div className="advanced-filter-row" key={item.id}><b>{index + 1}</b><select value={item.field} onChange={(event) => { const field = event.target.value as ProjectFilterField; update(item.id, { field, operator: field === "text" ? "contains" : "is", value: defaults[field] }); }}>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><select value={item.operator} onChange={(event) => update(item.id, { operator: event.target.value as ProjectFilterCondition["operator"] })}>{item.field === "text" ? <><option value="contains">含む</option><option value="not-contains">含まない</option></> : <><option value="is">一致する</option><option value="is-not">一致しない</option></>}</select>{valueEditor(item)}<button type="button" aria-label="条件を削除" onClick={() => onApply({ ...filter, conditions: filter.conditions.filter((condition) => condition.id !== item.id) })}>×</button></div>)}</div><button type="button" className="advanced-filter-add" onClick={() => onApply({ ...filter, conditions: [...filter.conditions, blankProjectFilter()] })}>＋ 条件を追加</button><div className="modal-actions"><button type="button" disabled={!filter.conditions.length} onClick={() => onApply({ mode: "and", conditions: [] })}>条件をすべて解除</button><button type="button" className="primary" onClick={onClose}>検索結果を表示</button></div></div></Modal>{statusCondition && <ProjectStatusFilterModal value={statusCondition.value} onChange={(value) => update(statusCondition.id, { value })} onClose={() => setStatusConditionId("")} />}</>;
}
