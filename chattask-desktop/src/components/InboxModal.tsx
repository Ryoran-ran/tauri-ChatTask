import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { PRIORITIES, STATUS_GROUPS, STATUS_LABELS, isTerminalStatus } from "../data/constants";
import type { InboxItem, ProjectTag, Task } from "../types";
import { generateId } from "../utils";
import { Modal } from "./Modal";
import { WorkDatePicker } from "./WorkDatePicker";

export function InboxModal({ items, tags, tasks, initialItemId = "", onSave, onPromote, onOpenTask, onClose }: {
  items: InboxItem[];
  tags: ProjectTag[];
  tasks: Task[];
  initialItemId?: string;
  onSave: (items: InboxItem[]) => void;
  onPromote: (item: InboxItem, task: Pick<Task, "title" | "description" | "nextAction" | "projectTagId" | "priority" | "status" | "parentTaskId">) => string;
  onOpenTask: (id: string) => void;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState(() => items.some((item) => item.id === initialItemId) ? initialItemId : "");
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState("");
  const [promoteDraft, setPromoteDraft] = useState<Pick<Task, "title" | "description" | "nextAction" | "projectTagId" | "priority" | "status" | "parentTaskId"> | null>(null);
  const selected = items.find((item) => item.id === selectedId);
  const visible = useMemo(() => items
    .filter((item) => showArchived ? item.status !== "inbox" : item.status === "inbox")
    .filter((item) => !query.trim() || `${item.title}\n${item.body}`.toLocaleLowerCase("ja").includes(query.trim().toLocaleLowerCase("ja")))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [items, query, showArchived]);
  const update = (changes: Partial<InboxItem>) => selected && onSave(items.map((item) => item.id === selected.id ? { ...item, ...changes, updatedAt: new Date().toISOString() } : item));
  const create = () => {
    const now = new Date().toISOString();
    const item: InboxItem = { id: generateId(), title: "", body: "", projectTagId: "", status: "inbox", createdAt: now, updatedAt: now };
    onSave([item, ...items]); setSelectedId(item.id);
  };
  const openPromote = () => selected && setPromoteDraft({ title: selected.title.trim(), description: selected.body, nextAction: "", projectTagId: selected.projectTagId, priority: "B", status: "todo", parentTaskId: "" });
  const promote = () => {
    if (!selected || !promoteDraft?.title.trim()) return;
    const taskId = onPromote(selected, { ...promoteDraft, title: promoteDraft.title.trim() });
    onSave(items.map((item) => item.id === selected.id ? { ...item, status: "promoted", promotedTaskId: taskId, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : item));
    setPromoteDraft(null);
  };
  return <Modal title="Inbox" onClose={onClose} wide>
    <div className="inbox-layout">
      <aside className="inbox-list-pane">
        <div className="inbox-list-actions"><button className="primary" onClick={create}>＋ メモを追加</button><label><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />処理済み</label></div>
        <input className="inbox-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Inboxを検索..." />
        <div className="inbox-list">{visible.map((item) => <button key={item.id} className={item.id === selectedId ? "selected" : ""} onClick={() => { setSelectedId(item.id); setDeleteConfirmId(""); }}><strong>{item.title || "無題のメモ"}</strong><small>{tags.find((tag) => tag.id === item.projectTagId)?.name || "タグなし"}・{item.reviewDate ? `確認 ${item.reviewDate.replace(/-/g, "/")}` : new Date(item.updatedAt).toLocaleDateString("ja-JP")}</small><span>{item.body || "本文なし"}</span></button>)}{!visible.length && <p>該当するメモはありません。</p>}</div>
      </aside>
      <section className="inbox-editor-pane">{selected ? <>
        <input className="inbox-title" autoFocus value={selected.title} onChange={(event) => update({ title: event.target.value })} placeholder="タイトル" />
        <select value={selected.projectTagId} onChange={(event) => update({ projectTagId: event.target.value })}><option value="">案件タグなし</option>{tags.filter((tag) => tag.visible || tag.id === selected.projectTagId).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select>
        <label className="inbox-review-date"><span>確認日</span><WorkDatePicker ariaLabel="Inboxの確認日" value={selected.reviewDate || ""} onChange={(reviewDate) => update({ reviewDate: reviewDate || undefined, reviewedAt: undefined })} /><small>{selected.reviewedAt ? "確認済みです。日付を変更すると再表示されます。" : "その日に「今日のページ」で確認できます。"}</small></label>
        <textarea value={selected.body} onChange={(event) => update({ body: event.target.value })} placeholder="まだタスクにするほどではない情報、アイデア、気づきを記録..." />
        <footer>{selected.status === "inbox" ? <>{deleteConfirmId === selected.id ? <div className="inbox-delete-confirm"><strong>削除しますか？</strong><button onClick={() => setDeleteConfirmId("")}>戻る</button><button className="danger" onClick={() => { onSave(items.filter((item) => item.id !== selected.id)); setSelectedId(""); setDeleteConfirmId(""); }}>削除する</button></div> : <button className="danger-text" onClick={() => setDeleteConfirmId(selected.id)}>削除</button>}<span /><button onClick={() => update({ status: "archived", archivedAt: new Date().toISOString() })}>アーカイブ</button><button className="primary" disabled={!selected.title.trim()} onClick={openPromote}>タスクへ昇華</button></> : <><button onClick={() => update({ status: "inbox", archivedAt: undefined, promotedTaskId: undefined })}>Inboxへ戻す</button><span />{selected.promotedTaskId && <button className="primary" onClick={() => onOpenTask(selected.promotedTaskId!)}>作成したタスクを開く</button>}</>}</footer>
      </> : <div className="inbox-empty"><strong>Inbox</strong><p>左のメモを選ぶか、新しいメモを追加してください。</p></div>}</section>
    </div>
    {promoteDraft && createPortal(<div className="inbox-promote-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPromoteDraft(null)}><section className="inbox-promote-dialog" role="dialog" aria-modal="true" aria-label="Inboxをタスクへ昇華"><header><div><strong>タスクへ昇華</strong><small>タスクとして必要な情報を確認してください。</small></div><button onClick={() => setPromoteDraft(null)}>×</button></header><div className="inbox-promote-form">
      <label className="wide">タスク名<input autoFocus value={promoteDraft.title} onChange={(event) => setPromoteDraft({ ...promoteDraft, title: event.target.value })} /></label>
      <label className="wide">説明<textarea rows={4} value={promoteDraft.description} onChange={(event) => setPromoteDraft({ ...promoteDraft, description: event.target.value })} /></label>
      <label>優先度<select value={promoteDraft.priority} onChange={(event) => setPromoteDraft({ ...promoteDraft, priority: event.target.value as Task["priority"] })}>{PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>
      <label>ステータス<select value={promoteDraft.status} onChange={(event) => setPromoteDraft({ ...promoteDraft, status: event.target.value as Task["status"] })}>{STATUS_GROUPS.filter((group) => group.label !== "終了").map((group) => <optgroup key={group.label} label={group.label}>{group.values.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</optgroup>)}</select></label>
      <label>案件タグ<select value={promoteDraft.projectTagId} onChange={(event) => setPromoteDraft({ ...promoteDraft, projectTagId: event.target.value })}><option value="">設定しない</option>{tags.filter((tag) => tag.visible || tag.id === promoteDraft.projectTagId).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
      <label>親タスク<select value={promoteDraft.parentTaskId} onChange={(event) => setPromoteDraft({ ...promoteDraft, parentTaskId: event.target.value })}><option value="">親タスクなし</option>{tasks.filter((task) => !isTerminalStatus(task.status)).map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
    </div><footer><button onClick={() => setPromoteDraft(null)}>キャンセル</button><button className="primary" disabled={!promoteDraft.title.trim()} onClick={promote}>タスクを作成</button></footer></section></div>, document.body)}
  </Modal>;
}
