import { Fragment, useEffect, useRef, useState } from "react";
import type { TaskChecklistItem, TaskCodeReviewTimelineEntry } from "../types";
import { canUndoReviewStatus, reviewStatusLabel } from "../reviewTimeline";
import { generateId } from "../utils";
import "./ReviewTimeline.css";

type Props = {
  items: TaskChecklistItem[];
  entries: TaskCodeReviewTimelineEntry[];
  filterItemId: string;
  onFilter: (itemId: string) => void;
  onBack: () => void;
  onChange: (entries: TaskCodeReviewTimelineEntry[], message: string) => void;
  onUndo: (entry: TaskCodeReviewTimelineEntry) => void;
};

const dateKey = (value: string) => new Date(value).toLocaleDateString("ja-JP");
const dateLabel = (value: string) => {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const label = date.toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" });
  if (dateKey(value) === dateKey(today.toISOString())) return `今日・${label}`;
  if (dateKey(value) === dateKey(yesterday.toISOString())) return `昨日・${label}`;
  return date.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
};

export function ReviewTimeline({ items, entries, filterItemId, onFilter, onBack, onChange, onUndo }: Props) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftItemId, setDraftItemId] = useState("");
  const [draftText, setDraftText] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingText, setEditingText] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const visible = entries.filter((entry) => !filterItemId || entry.itemId === filterItemId);
  const filteredItem = items.find((item) => item.id === filterItemId);
  const filteredTitle = filteredItem?.title || entries.find((entry) => entry.itemId === filterItemId)?.itemTitle;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [filterItemId, visible.length]);

  const addNote = () => {
    const item = items.find((candidate) => candidate.id === (filterItemId || draftItemId));
    const text = draftText.trim();
    if (!item || !text) return;
    onChange([...entries, { id: generateId(), kind: "note", itemId: item.id, itemTitle: item.title, text, createdAt: new Date().toISOString() }], "コードレビューのタイムラインにメモを追加しました。");
    setDraftText("");
    setDraftItemId("");
    setComposerOpen(false);
  };

  return <section className="verification-timeline review-timeline">
    <header>
      <div className="verification-timeline-title"><small>コードレビュー › タイムライン</small><strong>{filterItemId ? filteredTitle || "削除済みの指摘" : "すべての記録"}</strong>{filterItemId && <p>この指摘に関連する状態変更とメモ</p>}</div>
      <div className="verification-timeline-header-actions"><span>{visible.length}件</span><button type="button" className="primary verification-new-entry" onClick={() => { setDraftItemId(filterItemId); setComposerOpen(true); }}>＋ 新しい記録</button>{filterItemId && <button type="button" className="verification-show-all" onClick={() => onFilter("")}>すべて表示</button>}<button type="button" className="verification-back" onClick={onBack}>← チェックリスト</button></div>
    </header>
    <div className="verification-timeline-list" ref={listRef}>
      {!visible.length && <div className="verification-timeline-empty"><strong>{filterItemId ? "この指摘の記録はまだありません" : "記録はまだありません"}</strong><p>「新しい記録」から、対応の経緯を残せます。</p></div>}
      {visible.map((entry, index) => {
        const item = items.find((candidate) => candidate.id === entry.itemId);
        const undoable = canUndoReviewStatus(entry, item, entries);
        const editing = editingId === entry.id;
        const deleting = deletingId === entry.id;
        const showDate = index === 0 || dateKey(visible[index - 1].createdAt) !== dateKey(entry.createdAt);
        return <Fragment key={entry.id}>
          {showDate && <><div className="verification-timeline-date-anchor" aria-hidden="true" /><div className="verification-timeline-date"><span>{dateLabel(entry.createdAt)}</span></div></>}
          <article className={`timeline-kind-${entry.kind}`}>
            <div className="verification-timeline-marker" aria-hidden="true" />
            <div className="verification-timeline-entry">
              <header>
                <div className="verification-timeline-entry-title">{item ? <button type="button" onClick={() => onFilter(item.id)}>{item.title}<span aria-hidden="true">›</span></button> : <strong>{entry.itemTitle || "削除済みの指摘"}</strong>}</div>
                <div className="verification-timeline-entry-meta"><span>{entry.kind === "status" ? "状態変更" : "メモ"}</span><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</time></div>
                <div className="verification-timeline-entry-actions">
                  {undoable && <button type="button" className="review-timeline-undo" onClick={() => onUndo(entry)}>元に戻す</button>}
                  {entry.kind === "note" && (deleting ? <><small>削除しますか？</small><button type="button" onClick={() => setDeletingId("")}>戻る</button><button type="button" className="danger-text" onClick={() => { onChange(entries.filter((candidate) => candidate.id !== entry.id), "コードレビューのタイムラインのメモを削除しました。"); setDeletingId(""); }}>削除する</button></> : !editing && <><button type="button" onClick={() => { setEditingId(entry.id); setEditingText(entry.text); setDeletingId(""); }}>編集</button><button type="button" className="danger-text" onClick={() => setDeletingId(entry.id)}>削除</button></>)}
                </div>
              </header>
              {editing ? <div className="verification-timeline-editor review-timeline-editor"><textarea aria-label="メモを編集" value={editingText} onChange={(event) => setEditingText(event.target.value)} /><footer><button type="button" onClick={() => setEditingId("")}>キャンセル</button><button type="button" className="primary" disabled={!editingText.trim()} onClick={() => { onChange(entries.map((candidate) => candidate.id === entry.id ? { ...candidate, text: editingText.trim() } : candidate), "コードレビューのタイムラインのメモを編集しました。"); setEditingId(""); }}>変更を保存</button></footer></div> : <>
                {entry.kind === "status" && entry.fromStatus && entry.toStatus && <div className="verification-status-change"><small>状態変更</small><span>{reviewStatusLabel[entry.fromStatus]}</span><b>→</b><span>{reviewStatusLabel[entry.toStatus]}</span></div>}
                {entry.text && <div className="verification-timeline-body"><p>{entry.text}</p></div>}
              </>}
            </div>
          </article>
        </Fragment>;
      })}
    </div>
    {composerOpen && <div className="verification-timeline-composer review-timeline-composer">
      <header><div><small>コードレビュー › タイムライン › 新しい記録</small><strong>新しい記録を追加</strong><p>対応の経緯や確認結果を、指摘に関連付けて記録します。</p></div><button type="button" aria-label="投稿画面を閉じる" onClick={() => setComposerOpen(false)}>×</button></header>
      <div className="verification-timeline-form review-timeline-form">
        <label><span>関連する指摘</span><select aria-label="関連する指摘" value={filterItemId || draftItemId} disabled={Boolean(filterItemId)} onChange={(event) => setDraftItemId(event.target.value)}><option value="">選択してください</option>{items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label><span>内容</span><textarea autoFocus value={draftText} onChange={(event) => setDraftText(event.target.value)} placeholder="対応の経緯や確認結果を入力してください" /></label>
      </div>
      <footer><button type="button" className="verification-composer-cancel" onClick={() => setComposerOpen(false)}>キャンセル</button><button type="button" className="primary" disabled={!(filterItemId || draftItemId) || !draftText.trim()} onClick={addNote}>記録を追加</button></footer>
    </div>}
  </section>;
}
