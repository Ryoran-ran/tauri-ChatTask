import { useState } from "react";
import { STATUS_GROUPS, STATUS_LABELS } from "../data/constants";
import type { AdvancedFilterCondition, AdvancedFilterField, AdvancedFilterOperator, AdvancedTaskFilter, Priority, ProjectTag, TaskStatus } from "../types";
import { generateId } from "../utils";
import { Modal } from "./Modal";

const FIELD_LABELS: Record<AdvancedFilterField, string> = {
  status: "ステータス", priority: "優先度", tag: "案件タグ", today: "今日すること", deadline: "期限", text: "文字列",
};
const blankCondition = (): AdvancedFilterCondition => ({ id: generateId(), field: "status", operator: "is", value: "todo" });

const selectedStatuses = (value: string) => value.split(",").filter((status): status is TaskStatus => status in STATUS_LABELS);

function StatusFilterModal({ value, onChange, onClose }: { value: string; onChange: (value: string) => void; onClose: () => void }) {
  const selected = selectedStatuses(value);
  const toggle = (status: TaskStatus) => onChange(selected.includes(status) ? selected.filter((item) => item !== status).join(",") : [...selected, status].join(","));
  const toggleGroup = (statuses: TaskStatus[]) => {
    const allSelected = statuses.every((status) => selected.includes(status));
    onChange(allSelected ? selected.filter((status) => !statuses.includes(status)).join(",") : [...new Set([...selected, ...statuses])].join(","));
  };
  return <Modal title="ステータスを選択" onClose={onClose} wide><div className="status-filter-picker">
    <header><div><strong>対象にするステータス</strong><p>カテゴリー単位または個別に複数選択できます。</p></div><div><button type="button" onClick={() => onChange(Object.keys(STATUS_LABELS).join(","))}>すべて選択</button><button type="button" onClick={() => onChange("")}>すべて解除</button></div></header>
    <div className="status-filter-groups">{STATUS_GROUPS.map((group) => {
      const checkedCount = group.values.filter((status) => selected.includes(status)).length;
      return <section key={group.label}><label className="status-filter-group-title"><input type="checkbox" checked={checkedCount === group.values.length} ref={(element) => { if (element) element.indeterminate = checkedCount > 0 && checkedCount < group.values.length; }} onChange={() => toggleGroup(group.values)} /><span>{group.label}</span><small>{checkedCount}/{group.values.length}</small></label><div>{group.values.map((status) => <label key={status}><input type="checkbox" checked={selected.includes(status)} onChange={() => toggle(status)} /><span>{STATUS_LABELS[status]}</span></label>)}</div></section>;
    })}</div>
    <div className="modal-actions"><span>{selected.length}件選択中</span><button type="button" className="primary" onClick={onClose}>選択を確定</button></div>
  </div></Modal>;
}

export function AdvancedFilterModal({ filter, tags, onApply, onClose }: {
  filter: AdvancedTaskFilter;
  tags: ProjectTag[];
  onApply: (filter: AdvancedTaskFilter) => void;
  onClose: () => void;
}) {
  const [statusConditionId, setStatusConditionId] = useState("");
  const update = (id: string, changes: Partial<AdvancedFilterCondition>) => onApply({ ...filter, conditions: filter.conditions.map((item) => item.id === id ? { ...item, ...changes } : item) });
  const changeField = (item: AdvancedFilterCondition, field: AdvancedFilterField) => {
    const defaults: Record<AdvancedFilterField, string> = { status: "todo", priority: "A", tag: tags[0]?.id || "none", today: "true", deadline: "true", text: "" };
    update(item.id, { field, operator: field === "text" ? "contains" : "is", value: defaults[field] });
  };
  const valueEditor = (item: AdvancedFilterCondition) => {
    if (item.field === "status") {
      const statuses = selectedStatuses(item.value);
      const label = statuses.length === 0 ? "未選択" : statuses.length === 1 ? STATUS_LABELS[statuses[0]] : `${statuses.length}件のステータス`;
      return <button type="button" className="status-filter-select" onClick={() => setStatusConditionId(item.id)}><span>{label}</span><small>選択画面を開く ›</small></button>;
    }
    if (item.field === "priority") return <select value={item.value} onChange={(event) => update(item.id, { value: event.target.value })}>{(["A", "B", "C", "D"] as Priority[]).map((value) => <option key={value}>{value}</option>)}</select>;
    if (item.field === "tag") return <select value={item.value} onChange={(event) => update(item.id, { value: event.target.value })}><option value="none">タグなし</option>{tags.map((tag) => <option value={tag.id} key={tag.id}>{tag.name}</option>)}</select>;
    if (item.field === "today" || item.field === "deadline") return <select value={item.value} onChange={(event) => update(item.id, { value: event.target.value })}><option value="true">あり</option><option value="false">なし</option></select>;
    return <input autoFocus={!item.value} value={item.value} onChange={(event) => update(item.id, { value: event.target.value })} placeholder="検索する文字列" />;
  };
  const statusCondition = filter.conditions.find((item) => item.id === statusConditionId && item.field === "status");
  return <><Modal title="条件検索" onClose={onClose} wide><div className="advanced-filter-builder">
    <header><div><strong>条件の組み合わせ</strong><p>以下の条件でタスクを検索します。ステータスを指定しない場合は未完了のタスクが対象です。</p></div><select value={filter.mode} onChange={(event) => onApply({ ...filter, mode: event.target.value as "and" | "or" })}><option value="and">すべて満たす（AND）</option><option value="or">いずれかを満たす（OR）</option></select></header>
    <div className="advanced-filter-list">{filter.conditions.map((item, index) => <div className="advanced-filter-row" key={item.id}><b>{index + 1}</b><select value={item.field} onChange={(event) => changeField(item, event.target.value as AdvancedFilterField)}>{Object.entries(FIELD_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><select value={item.operator} onChange={(event) => update(item.id, { operator: event.target.value as AdvancedFilterOperator })}>{item.field === "text" ? <><option value="contains">含む</option><option value="not-contains">含まない</option></> : <><option value="is">一致する</option><option value="is-not">一致しない</option></>}</select>{valueEditor(item)}<button type="button" aria-label={`${index + 1}番目の条件を削除`} onClick={() => onApply({ ...filter, conditions: filter.conditions.filter((condition) => condition.id !== item.id) })}>×</button></div>)}</div>
    <button type="button" className="advanced-filter-add" onClick={() => onApply({ ...filter, conditions: [...filter.conditions, blankCondition()] })}>＋ 条件を追加</button>
    <div className="modal-actions"><button type="button" className="danger-text" disabled={!filter.conditions.length} onClick={() => onApply({ mode: "and", conditions: [] })}>条件をすべて解除</button><button type="button" className="primary" onClick={onClose}>検索結果を表示</button></div>
  </div></Modal>{statusCondition && <StatusFilterModal value={statusCondition.value} onChange={(value) => update(statusCondition.id, { value })} onClose={() => setStatusConditionId("")} />}</>;
}
