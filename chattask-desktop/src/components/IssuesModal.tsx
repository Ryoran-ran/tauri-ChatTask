import { useEffect, useState } from "react";
import type { AppIssue, AppIssueCategory, AppIssueStatus, Priority } from "../types";
import { generateId } from "../utils";
import { Modal } from "./Modal";

const STATUS_LABELS: Record<AppIssueStatus, string> = { open: "未対応", "in-progress": "対応中", "on-hold": "保留", resolved: "解決済み" };
const CATEGORY_LABELS: Record<AppIssueCategory, string> = { bug: "不具合", improvement: "改善", request: "要望", other: "その他" };

const newIssue = (): AppIssue => {
  const now = new Date().toISOString();
  return { id: generateId(), title: "新しい課題", category: "improvement", status: "open", priority: "B", description: "", createdAt: now, updatedAt: now };
};

export function IssuesModal({ issues, onSave, onClose }: { issues: AppIssue[]; onSave: (issues: AppIssue[]) => void; onClose: () => void }) {
  const [items, setItems] = useState(issues);
  const [selectedId, setSelectedId] = useState(issues[0]?.id || "");
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [search, setSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  useEffect(() => {
    onSave(items);
  }, [items]);
  const selected = items.find((item) => item.id === selectedId);
  const visible = items.filter((item) => (statusFilter === "all" || item.status !== "resolved") && (!search.trim() || `${item.title} ${item.description}`.toLowerCase().includes(search.trim().toLowerCase())));
  const update = (changes: Partial<AppIssue>) => setItems((current) => current.map((item) => item.id === selectedId ? { ...item, ...changes, updatedAt: new Date().toISOString() } : item));
  const add = () => { const issue = newIssue(); setItems((current) => [issue, ...current]); setSelectedId(issue.id); setDeleteConfirm(false); };
  const remove = () => { const next = items.filter((item) => item.id !== selectedId); setItems(next); setSelectedId(next[0]?.id || ""); setDeleteConfirm(false); };

  return <Modal title="アプリの課題一覧" onClose={onClose} wide><div className="issues-layout">
    <aside>
      <button className="primary full" onClick={add}>＋ 課題を追加</button>
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="課題を検索" />
      <div className="issue-filter"><button className={statusFilter === "active" ? "active" : ""} onClick={() => setStatusFilter("active")}>未解決</button><button className={statusFilter === "all" ? "active" : ""} onClick={() => setStatusFilter("all")}>すべて</button></div>
      <div className="issue-list">{visible.map((issue) => <button className={issue.id === selectedId ? "active" : ""} key={issue.id} onClick={() => { setSelectedId(issue.id); setDeleteConfirm(false); }}><span><i className={`priority priority-${issue.priority}`}>{issue.priority}</i>{issue.title}</span><small>{CATEGORY_LABELS[issue.category]}・{STATUS_LABELS[issue.status]}</small></button>)}{!visible.length && <p className="muted">該当する課題はありません。</p>}</div>
    </aside>
    <main>{selected ? <>
      <input className="issue-title" value={selected.title} onChange={(event) => update({ title: event.target.value })} />
      <div className="field-grid">
        <label>種類<select value={selected.category} onChange={(event) => update({ category: event.target.value as AppIssueCategory })}>{Object.entries(CATEGORY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>状態<select value={selected.status} onChange={(event) => update({ status: event.target.value as AppIssueStatus })}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>優先度<select value={selected.priority} onChange={(event) => update({ priority: event.target.value as Priority })}>{["A", "B", "C", "D"].map((value) => <option key={value}>{value}</option>)}</select></label>
      </div>
      <label className="issue-description">内容<textarea rows={12} value={selected.description} onChange={(event) => update({ description: event.target.value })} placeholder="再現手順、期待する動作、改善内容など" /></label>
      <small className="issue-updated">更新: {new Date(selected.updatedAt).toLocaleString("ja-JP")}</small>
      <div className="issue-footer">{deleteConfirm ? <div><span>この課題を削除しますか？</span><button onClick={() => setDeleteConfirm(false)}>キャンセル</button><button className="danger" onClick={remove}>削除する</button></div> : <button className="danger-text" onClick={() => setDeleteConfirm(true)}>課題を削除</button>}<span className="autosave-status">自動保存</span><button className="primary" onClick={onClose}>閉じる</button></div>
    </> : <div className="empty-list">課題を追加してください。</div>}</main>
  </div></Modal>;
}
