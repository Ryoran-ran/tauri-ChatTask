import { Fragment, useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from "react";
import type { ReviewIgnoredReasonCategory, TaskChecklistItem, TaskCodeReviewTimelineEntry } from "../types";
import { addAttachment, removeAttachment, type Attachment } from "../services/attachments";
import { reviewIgnoredReasonOptions } from "../reviewIgnoreDecisions";
import { canUndoReviewStatus, reviewEntryItemIds, reviewEntryItemTitles, reviewItemStatus, reviewStatusLabel } from "../reviewTimeline";
import { generateId } from "../utils";
import { AttachmentCards } from "./AttachmentCards";
import { Modal } from "./Modal";
import { TimelineItemPicker } from "./TimelineItemPicker";
import { ReviewTimelinePendingAttachments, type PendingAttachmentFailures } from "./reviewTimelinePendingAttachments";
import "./ReviewTimeline.css";

type Entry = TaskCodeReviewTimelineEntry;
type EditableKind = "note" | "issue" | "retest";
type Props = {
  taskId: string;
  items: TaskChecklistItem[];
  entries: Entry[];
  attachments: Attachment[];
  protectedAttachmentIds: string[];
  filterItemId: string;
  onFilter: (itemId: string) => void;
  onBack: () => void;
  onChange: (entries: Entry[], message: string) => void;
  onStatusChange: (itemId: string, status: NonNullable<TaskChecklistItem["reviewStatus"]>, ignoredReason?: { category: ReviewIgnoredReasonCategory; note: string }) => void;
  onUndo: (entry: Entry) => void;
  onAttachmentsChange: () => void;
  onCleanupError: (message: string) => void;
};
const kindLabels: Record<Entry["kind"], string> = { note: "メモ", issue: "不具合", retest: "再確認", status: "状態変更", system: "システム", reply: "返信" };
const dateKey = (value: string) => new Date(value).toLocaleDateString("ja-JP");
const dateLabel = (value: string) => {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const label = date.toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" });
  if (dateKey(value) === dateKey(today.toISOString())) return "今日・" + label;
  if (dateKey(value) === dateKey(yesterday.toISOString())) return "昨日・" + label;
  return date.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
};

const cleanupErrorMessage = (failures: PendingAttachmentFailures) =>
  failures.reply.length && failures.entry.length ? "新しい記録と返信の未投稿ファイルを一部削除できませんでした。"
    : failures.reply.length ? "返信の未投稿ファイルを一部削除できませんでした。"
      : failures.entry.length ? "新しい記録の未投稿ファイルを一部削除できませんでした。" : "";

export function ReviewTimeline({ taskId, items, entries, attachments, protectedAttachmentIds, filterItemId, onFilter, onBack, onChange, onStatusChange, onUndo, onAttachmentsChange, onCleanupError }: Props) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftKind, setDraftKind] = useState<EditableKind>("note");
  const [draftItemIds, setDraftItemIds] = useState<string[]>([]);
  const [draftText, setDraftText] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const [composerDragging, setComposerDragging] = useState(false);
  const [threadEntryId, setThreadEntryId] = useState("");
  const [replyText, setReplyText] = useState("");
  const [replyAttachments, setReplyAttachments] = useState<Attachment[]>([]);
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [replyDragging, setReplyDragging] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [editingKind, setEditingKind] = useState<EditableKind>("note");
  const [editingItemIds, setEditingItemIds] = useState<string[]>([]);
  const [editingText, setEditingText] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [previewItemId, setPreviewItemId] = useState("");
  const [ignoreDraft, setIgnoreDraft] = useState<{ itemId: string; category: ReviewIgnoredReasonCategory | ""; note: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  const cleanupErrorRef = useRef(onCleanupError);
  cleanupErrorRef.current = onCleanupError;
  const sessionRef = useRef<{ taskId: string; pending: ReviewTimelinePendingAttachments } | null>(null);
  const itemOptions = items.map((item) => ({ id: item.id, label: item.title, detail: [item.repositoryName, item.file || item.location].filter(Boolean).join("・") }));
  const visible = entries.filter((entry) => !entry.parentEntryId && (!filterItemId || reviewEntryItemIds(entry).includes(filterItemId)));
  const filteredItem = items.find((item) => item.id === filterItemId);
  const filteredEntry = entries.find((entry) => reviewEntryItemIds(entry).includes(filterItemId));
  const filteredTitle = filteredItem?.title || (filteredEntry ? reviewEntryItemTitles(filteredEntry)[reviewEntryItemIds(filteredEntry).indexOf(filterItemId)] : "");
  const threadEntry = entries.find((entry) => entry.id === threadEntryId && !entry.parentEntryId);
  const threadReplies = threadEntry ? entries.filter((entry) => entry.parentEntryId === threadEntry.id) : [];
  const previewItem = items.find((item) => item.id === previewItemId);

  const changeStatus = (item: TaskChecklistItem, status: NonNullable<TaskChecklistItem["reviewStatus"]>) => {
    if (status === "ignored") {
      setIgnoreDraft({ itemId: item.id, category: item.ignoredReasonCategory || "", note: item.ignoredReasonNote || "" });
      return;
    }
    if (status !== reviewItemStatus(item)) onStatusChange(item.id, status);
  };
  const saveIgnoreDecision = () => {
    if (!ignoreDraft?.category || (ignoreDraft.category === "other" && !ignoreDraft.note.trim())) return;
    onStatusChange(ignoreDraft.itemId, "ignored", { category: ignoreDraft.category, note: ignoreDraft.note });
    setIgnoreDraft(null);
  };

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [filterItemId, visible.length]);
  useEffect(() => {
    const session = { taskId, pending: new ReviewTimelinePendingAttachments(removeAttachment, (failures) => {
      const message = cleanupErrorMessage(failures);
      if (message) cleanupErrorRef.current(message);
      window.dispatchEvent(new CustomEvent("chattask-attachments-changed", { detail: { taskId } }));
    }) };
    sessionRef.current = session;
    setComposerOpen(false); setPendingAttachments([]); setAttachmentBusy(false); setAttachmentError("");
    setThreadEntryId(""); setReplyAttachments([]); setReplyBusy(false); setReplyError(""); setIgnoreDraft(null);
    return () => {
      if (sessionRef.current === session) sessionRef.current = null;
      void session.pending.dispose().then((failures) => {
        const message = cleanupErrorMessage(failures);
        if (message) cleanupErrorRef.current(message);
        window.dispatchEvent(new CustomEvent("chattask-attachments-changed", { detail: { taskId: session.taskId } }));
      });
    };
  }, [taskId]);

  const itemReferences = (ids: string[], original?: Entry) => {
    const oldIds = original ? reviewEntryItemIds(original) : [];
    const oldTitles = original ? reviewEntryItemTitles(original) : [];
    return { itemIds: ids, itemTitles: ids.map((id) => items.find((item) => item.id === id)?.title || oldTitles[oldIds.indexOf(id)] || "削除済みの指摘") };
  };
  const attached = (entry: Entry) => attachments.filter((attachment) => entry.attachmentIds?.includes(attachment.id));
  const uploadFiles = async (files: File[], reply: boolean) => {
    if (!files.length || attachmentBusy || replyBusy) return;
    const owner = sessionRef.current;
    if (!owner) return;
    const setBusy = reply ? setReplyBusy : setAttachmentBusy;
    const setError = reply ? setReplyError : setAttachmentError;
    const setPending = reply ? setReplyAttachments : setPendingAttachments;
    setBusy(true);
    setError("");
    const uploaded: Attachment[] = [];
    try {
      for (const file of files) {
        if (sessionRef.current !== owner) break;
        const attachment = await addAttachment(owner.taskId, file);
        if (owner.pending.track(attachment.id, reply ? "reply" : "entry")) uploaded.push(attachment);
      }
    } catch (reason) {
      if (sessionRef.current === owner) setError((uploaded.length ? String(uploaded.length) + "件は保存しましたが、残りの" : "") + "ファイルを保存できませんでした: " + String(reason));
    } finally {
      if (sessionRef.current === owner) {
        if (uploaded.length) { setPending((current) => [...current, ...uploaded]); onAttachmentsChange(); }
        setBusy(false);
        setComposerDragging(false);
        setReplyDragging(false);
      }
    }
  };
  const selectFiles = (event: ChangeEvent<HTMLInputElement>, reply: boolean) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    void uploadFiles(files, reply);
  };
  const pasteImages = (event: ClipboardEvent<HTMLTextAreaElement>, reply: boolean) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const files = Array.from(event.clipboardData.items).flatMap((item, index) => {
      const file = item.kind === "file" ? item.getAsFile() : null;
      if (!file || !file.type.startsWith("image/")) return [];
      const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
      return [new File([file], (reply ? "review-reply-" : "review-") + timestamp + "-" + (index + 1) + "." + extension, { type: file.type })];
    });
    if (files.length) { event.preventDefault(); void uploadFiles(files, reply); }
  };
  const dropFiles = (event: DragEvent<HTMLDivElement>, reply: boolean) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    if (files.length) void uploadFiles(files, reply);
    else if (reply) setReplyDragging(false);
    else setComposerDragging(false);
  };
  const removePending = async (attachment: Attachment, reply: boolean) => {
    const owner = sessionRef.current;
    if (!owner) return;
    const setBusy = reply ? setReplyBusy : setAttachmentBusy;
    const setError = reply ? setReplyError : setAttachmentError;
    const setPending = reply ? setReplyAttachments : setPendingAttachments;
    setBusy(true);
    try {
      const failures = await owner.pending.clear([attachment.id]);
      if (sessionRef.current === owner) {
        if (failures.entry.length || failures.reply.length) setError("ファイルを取り消せませんでした。");
        else { setPending((current) => current.filter((item) => item.id !== attachment.id)); onAttachmentsChange(); }
      }
    } finally { if (sessionRef.current === owner) setBusy(false); }
  };
  const clearUnposted = async (pending: Attachment[], source: "entry" | "reply") => {
    if (!pending.length) return;
    const owner = sessionRef.current;
    if (!owner) return;
    const failures = await owner.pending.clear(pending.map((attachment) => attachment.id));
    if (sessionRef.current === owner) {
      onAttachmentsChange();
      if (failures[source].length) {
        const message = cleanupErrorMessage(failures);
        if (source === "reply") setReplyError(message);
        else setAttachmentError(message);
        onCleanupError(message);
      }
    }
  };
  const cancelComposer = () => {
    const pending = pendingAttachments;
    setComposerOpen(false); setDraftText(""); setDraftKind("note"); setDraftItemIds([]); setPendingAttachments([]); setAttachmentError("");
    void clearUnposted(pending, "entry");
  };
  const closeThread = () => {
    const pending = replyAttachments;
    setThreadEntryId(""); setReplyText(""); setReplyAttachments([]); setReplyError(""); setEditingId(""); setDeletingId("");
    void clearUnposted(pending, "reply");
  };
  const addEntry = () => {
    const text = draftText.trim();
    if (!text && !pendingAttachments.length) return;
    const refs = itemReferences(draftItemIds);
    onChange([...entries, {
      id: generateId(), kind: draftKind, text,
      itemId: refs.itemIds[0] || "", itemTitle: refs.itemTitles[0] || "",
      ...refs, attachmentIds: pendingAttachments.map((attachment) => attachment.id), createdAt: new Date().toISOString(),
    }], "コードレビューのタイムラインに" + kindLabels[draftKind] + "を追加しました。");
    sessionRef.current?.pending.release(pendingAttachments.map((attachment) => attachment.id));
    setDraftText(""); setDraftItemIds(filterItemId ? [filterItemId] : []); setPendingAttachments([]); setComposerOpen(false);
  };
  const addReply = () => {
    if (!threadEntry) return;
    const text = replyText.trim();
    if (!text && !replyAttachments.length) return;
    const ids = reviewEntryItemIds(threadEntry);
    const titles = reviewEntryItemTitles(threadEntry);
    onChange([...entries, {
      id: generateId(), kind: "reply", parentEntryId: threadEntry.id, text,
      itemId: ids[0] || "", itemTitle: titles[0] || "", itemIds: ids, itemTitles: titles,
      attachmentIds: replyAttachments.map((attachment) => attachment.id), createdAt: new Date().toISOString(),
    }], "コードレビューのタイムラインに返信しました。");
    sessionRef.current?.pending.release(replyAttachments.map((attachment) => attachment.id));
    setReplyText(""); setReplyAttachments([]); setReplyError("");
  };
  const startEditing = (entry: Entry) => {
    setEditingId(entry.id); setEditingText(entry.text);
    setEditingKind(["note", "issue", "retest"].includes(entry.kind) ? entry.kind as EditableKind : "note");
    setEditingItemIds(reviewEntryItemIds(entry)); setDeletingId("");
  };
  const saveEdit = () => {
    const current = entries.find((entry) => entry.id === editingId);
    if (!current) return;
    const ids = filterItemId && !editingItemIds.includes(filterItemId) && current.kind !== "reply" && current.kind !== "status"
      ? [filterItemId, ...editingItemIds] : editingItemIds;
    const refs = itemReferences(ids, current);
    onChange(entries.map((entry) => entry.id === editingId ? {
      ...entry, kind: ["status", "system", "reply"].includes(entry.kind) ? entry.kind : editingKind, text: editingText.trim(),
      ...(entry.kind === "status" || entry.kind === "reply" ? {} : { itemId: refs.itemIds[0] || "", itemTitle: refs.itemTitles[0] || "", ...refs }),
    } : entry), "コードレビューのタイムラインの記録を編集しました。");
    setEditingId("");
  };
  const deleteEntry = async (entryId: string) => {
    const deleted = entries.filter((entry) => entry.id === entryId || entry.parentEntryId === entryId);
    const remaining = entries.filter((entry) => entry.id !== entryId && entry.parentEntryId !== entryId);
    const referenced = new Set([...remaining.flatMap((entry) => entry.attachmentIds || []), ...protectedAttachmentIds]);
    const toRemove = [...new Set(deleted.flatMap((entry) => entry.attachmentIds || []))].filter((id) => !referenced.has(id));
    onChange(remaining, "コードレビューのタイムラインの記録を削除しました。");
    setDeletingId("");
    if (threadEntryId === entryId) setThreadEntryId("");
    if (editingId === entryId) setEditingId("");
    if (!toRemove.length) return;
    const results = await Promise.allSettled(toRemove.map((id) => removeAttachment(id)));
    onAttachmentsChange();
    if (results.some((result) => result.status === "rejected")) setAttachmentError("記録は削除しましたが、一部の添付ファイルを削除できませんでした。");
  };
  const editForm = (entry: Entry, reply: boolean) => reply
    ? <div className="verification-thread-reply-editor"><textarea aria-label="返信を編集" value={editingText} onChange={(event) => setEditingText(event.target.value)} /><footer><button type="button" onClick={() => setEditingId("")}>キャンセル</button><button type="button" className="primary" onClick={saveEdit}>変更を保存</button></footer></div>
    : <div className="verification-timeline-editor review-timeline-editor">
      {entry.kind !== "status" && entry.kind !== "system" && <div><label>種類<select value={editingKind} onChange={(event) => setEditingKind(event.target.value as EditableKind)}><option value="note">メモ</option><option value="issue">不具合</option><option value="retest">再確認</option></select></label></div>}
      {entry.kind !== "status" && <section className="verification-timeline-edit-checks"><strong>関連する指摘</strong><TimelineItemPicker options={itemOptions} selectedIds={editingItemIds} lockedIds={filterItemId ? [filterItemId] : []} onChange={setEditingItemIds} itemLabel="指摘" searchPlaceholder="タイトル・ファイル名・リポジトリ名で検索" /></section>}
      <textarea aria-label="記録を編集" value={editingText} onChange={(event) => setEditingText(event.target.value)} />
      <footer><button type="button" onClick={() => setEditingId("")}>キャンセル</button><button type="button" className="primary" onClick={saveEdit}>変更を保存</button></footer>
    </div>;

  return <section className="verification-timeline review-timeline">
    <header>
      <div className="verification-timeline-title"><small>コードレビュー › タイムライン</small><strong>{filterItemId ? filteredTitle || "削除済みの指摘" : "すべての記録"}</strong>{filterItemId && <p>この指摘に関連する状態変更と記録</p>}{filteredItem && <div className="review-timeline-current-status"><label htmlFor="review-timeline-status">対応状態</label><select id="review-timeline-status" aria-label={`${filteredItem.title}の対応状態`} value={reviewItemStatus(filteredItem)} onChange={(event) => changeStatus(filteredItem, event.target.value as NonNullable<TaskChecklistItem["reviewStatus"]>)}>{Object.entries(reviewStatusLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>{reviewItemStatus(filteredItem) === "ignored" && <button type="button" onClick={() => changeStatus(filteredItem, "ignored")}>理由を編集</button>}</div>}</div>
      <div className="verification-timeline-header-actions"><span>{visible.length}件</span>{filteredItem && <button type="button" className="verification-show-card" onClick={() => setPreviewItemId(filteredItem.id)}>指摘を表示</button>}<button type="button" className="primary verification-new-entry" onClick={() => { setDraftItemIds(filterItemId ? [filterItemId] : []); setComposerOpen(true); }}>＋ 新しい記録</button>{filterItemId && <button type="button" className="verification-show-all" onClick={() => onFilter("")}>すべて表示</button>}<button type="button" className="verification-back" onClick={onBack}>← チェックリスト</button></div>
    </header>
    {attachmentError && !composerOpen && <p className="attachment-error" role="status">{attachmentError}</p>}
    <div className="verification-timeline-list" ref={listRef}>
      {!visible.length && <div className="verification-timeline-empty"><strong>{filterItemId ? "この指摘の記録はまだありません" : "記録はまだありません"}</strong><p>「新しい記録」から、対応の経緯を残せます。</p></div>}
      {visible.map((entry, index) => {
        const ids = reviewEntryItemIds(entry);
        const titles = reviewEntryItemTitles(entry);
        const item = items.find((candidate) => candidate.id === ids[0]);
        const undoable = canUndoReviewStatus(entry, item, entries);
        const editing = editingId === entry.id;
        const deleting = deletingId === entry.id;
        const replyCount = entries.filter((candidate) => candidate.parentEntryId === entry.id).length;
        const showDate = index === 0 || dateKey(visible[index - 1].createdAt) !== dateKey(entry.createdAt);
        return <Fragment key={entry.id}>
          {showDate && <><div className="verification-timeline-date-anchor" aria-hidden="true" /><div className="verification-timeline-date"><span>{dateLabel(entry.createdAt)}</span></div></>}
          <article className={"timeline-kind-" + entry.kind}><div className="verification-timeline-marker" aria-hidden="true" /><div className="verification-timeline-entry">
            <header>
              <div className="verification-timeline-entry-title">{titles.length ? (item ? <button type="button" onClick={() => setPreviewItemId(item.id)}>{titles[0]}<span aria-hidden="true">›</span></button> : <strong>{titles[0]}</strong>) : <strong>関連する指摘なし</strong>}{titles.length > 1 && <small>ほか{titles.length - 1}件</small>}</div>
              <div className="verification-timeline-entry-meta"><span>{kindLabels[entry.kind]}</span><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</time></div>
              <div className="verification-timeline-entry-actions">
                {undoable && <button type="button" className="review-timeline-undo" onClick={() => onUndo(entry)}>元に戻す</button>}
                {deleting ? <><small>削除しますか？</small><button type="button" onClick={() => setDeletingId("")}>戻る</button><button type="button" className="danger-text" onClick={() => void deleteEntry(entry.id)}>削除する</button></> : <><button type="button" className="reply" onClick={() => { setThreadEntryId(entry.id); setReplyError(""); setEditingId(""); setDeletingId(""); }}>返信{replyCount ? " " + replyCount : ""}</button><button type="button" onClick={() => startEditing(entry)}>編集</button>{entry.kind !== "status" && <button type="button" className="danger-text" onClick={() => { setDeletingId(entry.id); setEditingId(""); }}>削除</button>}</>}
              </div>
            </header>
            {editing ? editForm(entry, false) : <>{entry.kind === "status" && entry.fromStatus && entry.toStatus && <div className="verification-status-change"><small>状態変更</small><span>{reviewStatusLabel[entry.fromStatus]}</span><b>→</b><span>{reviewStatusLabel[entry.toStatus]}</span></div>}{entry.text && <div className="verification-timeline-body"><p>{entry.text}</p></div>}<AttachmentCards attachments={attached(entry)} /></>}
          </div></article>
        </Fragment>;
      })}
    </div>
    {threadEntry && <div className="verification-thread-screen">
      <header><div><small>コードレビュー › タイムライン › 返信</small><strong>記録への返信</strong><p>{threadReplies.length}件の返信</p></div><button type="button" className="verification-thread-back-button" disabled={replyBusy} onClick={closeThread}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>タイムラインへ戻る</button></header>
      <div className="verification-thread-list">
        <article className="verification-thread-parent"><header><span>{kindLabels[threadEntry.kind]}</span><time>{new Date(threadEntry.createdAt).toLocaleString("ja-JP")}</time><strong>親の記録</strong></header>{threadEntry.text && <p>{threadEntry.text}</p>}<AttachmentCards attachments={attached(threadEntry)} /></article>
        <section className="verification-thread-replies"><header><strong>返信</strong><span>{threadReplies.length}件</span></header>{threadReplies.length ? threadReplies.map((reply) => <article key={reply.id}><header><span>返信</span><time>{new Date(reply.createdAt).toLocaleString("ja-JP")}</time><div>{deletingId === reply.id ? <><small>削除しますか？</small><button type="button" onClick={() => setDeletingId("")}>戻る</button><button type="button" className="danger-text" onClick={() => void deleteEntry(reply.id)}>削除する</button></> : <><button type="button" onClick={() => startEditing(reply)}>編集</button><button type="button" className="danger-text" onClick={() => { setDeletingId(reply.id); setEditingId(""); }}>削除</button></>}</div></header>{editingId === reply.id ? editForm(reply, true) : <>{reply.text && <p>{reply.text}</p>}<AttachmentCards attachments={attached(reply)} /></>}</article>) : <p className="verification-thread-empty">返信はまだありません。</p>}</section>
      </div>
      <div className={"verification-reply-composer" + (replyDragging ? " dragging" : "")} onDragEnter={(event) => { event.preventDefault(); setReplyDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setReplyDragging(false); }} onDrop={(event) => dropFiles(event, true)}>
        <textarea value={replyText} onChange={(event) => setReplyText(event.target.value)} onPaste={(event) => pasteImages(event, true)} placeholder="返信を入力…（画像の貼り付け、ファイルのドロップ可）" />
        <AttachmentCards attachments={replyAttachments} onRemove={(attachment) => void removePending(attachment, true)} />
        {replyError && <p className="attachment-error">{replyError}</p>}
        <footer><small>親の添付ファイルは返信へ引き継がれません。</small><button type="button" className="verification-reply-attachment-button" onClick={() => replyFileInputRef.current?.click()} disabled={replyBusy}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.5 11.5-8.7 8.7a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7L9.9 17.5a2 2 0 0 1-2.8-2.8l8.5-8.5" /></svg>{replyBusy ? "保存中…" : "ファイルを追加"}</button><input ref={replyFileInputRef} hidden type="file" multiple onChange={(event) => selectFiles(event, true)} /><button type="button" className="primary" disabled={replyBusy || (!replyText.trim() && !replyAttachments.length)} onClick={addReply}>返信する</button></footer>
        {replyDragging && <div className="verification-timeline-drop">ここにファイルをドロップ</div>}
      </div>
    </div>}
    {composerOpen && <div className={"verification-timeline-composer review-timeline-composer" + (composerDragging ? " dragging" : "")} onDragEnter={(event) => { event.preventDefault(); setComposerDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setComposerDragging(false); }} onDrop={(event) => dropFiles(event, false)}>
      <header><div><small>コードレビュー › タイムライン › 新しい記録</small><strong>新しい記録を追加</strong><p>対応の経緯や確認結果を、指摘に関連付けて記録します。</p></div><button type="button" aria-label="投稿画面を閉じる" disabled={attachmentBusy} onClick={cancelComposer}>×</button></header>
      <div className="verification-timeline-form review-timeline-form">
        <label><span>種類</span><select value={draftKind} onChange={(event) => setDraftKind(event.target.value as EditableKind)}><option value="note">メモ</option><option value="issue">不具合</option><option value="retest">再確認</option></select></label>
        <div className="verification-timeline-check-field"><span>関連する指摘</span><div><TimelineItemPicker options={itemOptions} selectedIds={draftItemIds} lockedIds={filterItemId ? [filterItemId] : []} onChange={setDraftItemIds} itemLabel="指摘" searchPlaceholder="タイトル・ファイル名・リポジトリ名で検索" />{filterItemId && <small className="verification-auto-linked">現在開いている指摘を自動で関連付けています。</small>}</div></div>
        <label className="verification-timeline-description"><span>内容</span><textarea autoFocus value={draftText} onChange={(event) => setDraftText(event.target.value)} onPaste={(event) => pasteImages(event, false)} placeholder="対応内容、不具合の再現手順、補足などを入力してください。画像は貼り付け・ドロップできます。" /></label>
        <div className="verification-timeline-attachment-row"><span>添付ファイル</span><div><button type="button" onClick={() => fileInputRef.current?.click()} disabled={attachmentBusy}>{attachmentBusy ? "ファイルを保存中…" : "ファイルを選択"}</button><small>画像・PDF・テキスト・ログなどを添付できます。画像は貼り付けにも対応しています。</small><input ref={fileInputRef} hidden type="file" multiple onChange={(event) => selectFiles(event, false)} /></div></div>
        <AttachmentCards attachments={pendingAttachments} onRemove={(attachment) => void removePending(attachment, false)} />
        {attachmentError && <p className="attachment-error">{attachmentError}</p>}
      </div>
      <footer><button type="button" className="verification-composer-cancel" disabled={attachmentBusy} onClick={cancelComposer}>キャンセル</button><button type="button" className="primary" disabled={attachmentBusy || (!draftText.trim() && !pendingAttachments.length)} onClick={addEntry}>記録を追加</button></footer>
      {composerDragging && <div className="verification-timeline-drop">ここにファイルをドロップ</div>}
    </div>}
    {previewItem && <Modal title="コードレビュー指摘" wide onClose={() => setPreviewItemId("")}><div className="review-timeline-preview"><strong>{previewItem.title}</strong><p>{[previewItem.repositoryName, previewItem.file || previewItem.location].filter(Boolean).join("・")}</p><p>{previewItem.details}</p><footer><button type="button" onClick={() => { onFilter(previewItem.id); setPreviewItemId(""); }}>この指摘の記録を表示</button><button type="button" className="primary" onClick={() => setPreviewItemId("")}>閉じる</button></footer></div></Modal>}
    {ignoreDraft && <Modal title="「対応しない」の理由" onClose={() => setIgnoreDraft(null)}><div className="review-ignore-dialog"><p>次回以降のレビューで、この判断と変更内容を照合します。近い理由を1つ選んでください。</p><div className="review-ignore-options">{reviewIgnoredReasonOptions.map(([value, label]) => <button type="button" className={ignoreDraft.category === value ? "selected" : ""} aria-pressed={ignoreDraft.category === value} onClick={() => setIgnoreDraft({ ...ignoreDraft, category: value })} key={value}>{label}</button>)}</div><label><span>補足 {ignoreDraft.category === "other" ? <b>必須</b> : <small>任意</small>}</span><textarea rows={4} value={ignoreDraft.note} onChange={(event) => setIgnoreDraft({ ...ignoreDraft, note: event.target.value })} placeholder={ignoreDraft.category === "separate-task" ? "例：タスク名や対応予定を入力" : "必要な場合だけ、判断の前提や条件を入力"} /></label></div><div className="modal-actions"><button type="button" onClick={() => setIgnoreDraft(null)}>キャンセル</button><button type="button" className="primary" disabled={!ignoreDraft.category || (ignoreDraft.category === "other" && !ignoreDraft.note.trim())} onClick={saveIgnoreDecision}>対応しないにする</button></div></Modal>}
  </section>;
}
