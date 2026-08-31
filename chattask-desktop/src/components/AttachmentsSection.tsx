import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { addAttachment, attachmentNameParts, getAttachmentFile, listAttachments, openAttachment, removeAttachment, renameAttachment, type Attachment } from "../services/attachments";
import { formatDateTime } from "../utils";
import { AttachmentPreviewModal } from "./AttachmentPreviewModal";

const formatSize = (size: number) => size < 1024
  ? `${size} B`
  : size < 1024 * 1024
    ? `${(size / 1024).toFixed(1)} KB`
    : `${(size / 1024 / 1024).toFixed(1)} MB`;

interface Props {
  taskId: string;
  refreshKey?: number;
  onHistory?: (text: string) => void;
  onChanged?: () => void;
  readOnly?: boolean;
  title?: string;
  copyToTaskId?: string;
  quickLinkedAttachmentIds?: ReadonlySet<string>;
  onQuickLink?: (attachment: Attachment) => void;
}

export function AttachmentsSection({ taskId, refreshKey = 0, onHistory, onChanged, readOnly = false, title = "添付ファイル", copyToTaskId, quickLinkedAttachmentIds, onQuickLink }: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [preview, setPreview] = useState<Attachment | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const openFilePicker = () => {
    const input = inputRef.current;
    if (!input || busy) return;
    // 同じファイルを続けて選んだ場合も、必ずchangeイベントを発生させる。
    input.value = "";
    input.click();
  };

  const reload = async () => {
    try { setAttachments(await listAttachments(taskId)); setError(""); }
    catch (reason) { setError(String(reason)); }
  };
  useEffect(() => { void reload(); }, [taskId, refreshKey]);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    setBusy(true); setError("");
    try {
      for (const file of files) await addAttachment(taskId, file);
      await reload();
      onChanged?.();
      onHistory?.(`添付ファイルを${files.length}件追加しました。`);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };

  const saveName = async (attachment: Attachment) => {
    const baseName = editingName.trim();
    if (!baseName) return;
    setBusy(true); setError("");
    try {
      const name = await renameAttachment(attachment.id, baseName, attachment.name);
      setAttachments((current) => current.map((item) => item.id === attachment.id ? { ...item, name } : item));
      setPreview((current) => current?.id === attachment.id ? { ...current, name } : current);
      setEditingId(null);
      onHistory?.(`添付ファイルの表示名を「${name}」へ変更しました。`);
      onChanged?.();
    } catch (reason) { setError(`表示名を変更できませんでした: ${String(reason)}`); }
    finally { setBusy(false); }
  };

  const copyToTask = async (attachment: Attachment) => {
    if (!copyToTaskId || busy) return;
    setBusy(true); setError("");
    try {
      const source = await getAttachmentFile(attachment.id);
      const file = new File([new Uint8Array(source.data)], source.name, { type: source.mimeType });
      await addAttachment(copyToTaskId, file);
      window.dispatchEvent(new CustomEvent("chattask-attachments-changed", { detail: { taskId: copyToTaskId } }));
      onHistory?.(`親タスクのファイル「${source.name}」を固定コピーしました。`);
    } catch (reason) { setError(`固定コピーできませんでした: ${String(reason)}`); }
    finally { setBusy(false); }
  };

  return <details><summary>{title} <small>{attachments.length}件</small></summary><div className="attachments-editor">
    {!readOnly && <div className="attachment-toolbar"><button type="button" className="primary" disabled={busy} onClick={openFilePicker}>{busy ? "追加中..." : "ファイルを追加"}</button><span>複数選択可・1ファイル50MBまで</span><input ref={inputRef} hidden type="file" multiple onChange={upload} /></div>}
    {error && <p className="attachment-error">{error}</p>}
    <div className="attachment-list">{attachments.map((attachment) => <div className="attachment-row" key={attachment.id}>
      {editingId === attachment.id
        ? <div className="attachment-name-editor"><div className="attachment-fixed-extension-input"><input autoFocus value={editingName} maxLength={255 - attachmentNameParts(attachment.name).extension.length} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); if (event.key === "Escape") setEditingId(null); }} />{attachmentNameParts(attachment.name).extension && <span>{attachmentNameParts(attachment.name).extension}</span>}</div><small>拡張子は変更できません。</small></div>
        : <div><strong title={attachment.name}>{attachment.name}</strong><small>{formatSize(attachment.size)}・{formatDateTime(attachment.createdAt)}</small></div>}
      {!readOnly && editingId === attachment.id
        ? <div className="attachment-edit-actions"><button type="button" onClick={() => setEditingId(null)}>取消</button><button type="button" className="primary" disabled={busy || !editingName.trim()} onClick={() => void saveName(attachment)}>保存</button></div>
        : !readOnly && deleteId === attachment.id
          ? <div className="attachment-delete-confirm"><button type="button" onClick={() => setDeleteId(null)}>取消</button><button type="button" className="danger" onClick={async () => { setBusy(true); setError(""); try { await removeAttachment(attachment.id); setAttachments((current) => current.filter((item) => item.id !== attachment.id)); setDeleteId(null); onHistory?.(`添付ファイル「${attachment.name}」を削除しました。`); onChanged?.(); } catch (reason) { setError(`削除できませんでした: ${String(reason)}`); } finally { setBusy(false); await reload(); } }}>削除する</button></div>
          : <><button type="button" className="attachment-icon-button" title="プレビュー" aria-label={`${attachment.name}をプレビュー`} onClick={() => setPreview(attachment)}>▣</button><button type="button" className="attachment-icon-button" title="標準アプリで開く" aria-label={`${attachment.name}を開く`} onClick={() => void openAttachment(attachment.id).catch((reason) => setError(String(reason)))}>↗</button>{copyToTaskId && <button type="button" className="attachment-icon-button attachment-inherit-copy" title="子タスクのファイルへ固定コピー" aria-label={`${attachment.name}を子タスクへ固定コピー`} disabled={busy} onClick={() => void copyToTask(attachment)}>⊕</button>}{!readOnly && <><button type="button" className="attachment-icon-button" title="表示名を変更" aria-label={`${attachment.name}の表示名を変更`} disabled={busy} onClick={() => { setDeleteId(null); setEditingId(attachment.id); setEditingName(attachmentNameParts(attachment.name).baseName); }}>✎</button><button type="button" className="attachment-icon-button danger-text" title="削除" aria-label={`${attachment.name}を削除`} disabled={busy} onClick={() => { setEditingId(null); setDeleteId(attachment.id); }}>×</button></>}</>}
    </div>)}{!attachments.length && !error && <p className="muted">添付ファイルはありません。</p>}</div>
  </div>{preview && <AttachmentPreviewModal attachment={preview} quickLinked={quickLinkedAttachmentIds?.has(preview.id)} onAddQuickLink={onQuickLink ? () => onQuickLink(preview) : undefined} onRenamed={(name) => { setAttachments((current) => current.map((item) => item.id === preview.id ? { ...item, name } : item)); setPreview({ ...preview, name }); onHistory?.(`添付ファイルの表示名を「${name}」へ変更しました。`); onChanged?.(); }} onClose={() => setPreview(null)} />}</details>;
}
