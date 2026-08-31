import { useEffect, useState } from "react";
import { attachmentNameParts, attachmentObjectUrl, copyAttachment, renameAttachment, type Attachment } from "../services/attachments";
import { AttachmentPreviewModal } from "./AttachmentPreviewModal";
import { fileIcon } from "./fileIcon";

export function AttachmentCard({ attachment, onRemove, onPreview, onRenamed }: { attachment: Attachment; onRemove?: () => void; onPreview: () => void; onRenamed?: (name: string) => void }) {
  const [imageUrl, setImageUrl] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(attachment.name);
  const isImage = attachment.mimeType.startsWith("image/");
  const icon = fileIcon(attachment.name);

  useEffect(() => {
    if (!isImage) return;
    let active = true;
    let url = "";
    void attachmentObjectUrl(attachment.id).then((value) => { url = value; if (active) setImageUrl(value); else URL.revokeObjectURL(value); }).catch((reason) => setError(String(reason)));
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [attachment.id, isImage]);
  const copy = async () => {
    setError("");
    try {
      await copyAttachment(attachment.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (reason) {
      setError(`コピーできませんでした: ${String(reason)}`);
    }
  };
  const saveName = async () => {
    const nextName = name.trim();
    if (!nextName) return;
    setError("");
    try {
      const savedName = await renameAttachment(attachment.id, nextName, attachment.name);
      setEditing(false);
      onRenamed?.(savedName);
    } catch (reason) {
      setError(`表示名を変更できませんでした: ${String(reason)}`);
    }
  };

  return <div className={`memo-attachment-card ${isImage ? "image-card" : "file-card"}`}>
    <button type="button" className="attachment-open-card" onClick={onPreview} title={`${attachment.name}をプレビュー`}>
      {isImage && imageUrl ? <img src={imageUrl} alt={attachment.name} /> : <span className={`file-type-icon file-type-${icon.type}`} aria-hidden="true">{icon.label}</span>}
      <span>{attachment.name}</span>
    </button>
    {editing ? <div className="memo-attachment-name-editor"><div className="attachment-fixed-extension-input"><input autoFocus value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); if (event.key === "Escape") setEditing(false); }} />{attachmentNameParts(attachment.name).extension && <span>{attachmentNameParts(attachment.name).extension}</span>}</div><button type="button" title="保存" aria-label="表示名を保存" onClick={() => void saveName()}>✓</button><button type="button" title="取消" aria-label="表示名の変更を取り消す" onClick={() => setEditing(false)}>×</button></div> : <div className="memo-attachment-card-actions"><button type="button" className="attachment-card-icon" title="コピー" aria-label={`${attachment.name}をコピー`} onClick={copy}>{copied ? "✓" : "⧉"}</button><button type="button" className="attachment-card-icon" title="表示名を変更" aria-label={`${attachment.name}の表示名を変更`} onClick={() => { setName(attachmentNameParts(attachment.name).baseName); setEditing(true); }}>✎</button></div>}
    {onRemove && <button type="button" className="attachment-remove-card" aria-label={`${attachment.name}を取り消す`} onClick={onRemove}>×</button>}
    {error && <small>{error}</small>}
  </div>;
}

export function AttachmentCards({ attachments, onRemove, onRenamed, quickLinkedAttachmentIds, onQuickLink }: { attachments: Attachment[]; onRemove?: (attachment: Attachment) => void; onRenamed?: (attachment: Attachment, name: string) => void; quickLinkedAttachmentIds?: ReadonlySet<string>; onQuickLink?: (attachment: Attachment) => void }) {
  const [preview, setPreview] = useState<Attachment | null>(null);
  if (!attachments.length) return null;
  const images = attachments.filter((attachment) => attachment.mimeType.startsWith("image/"));
  const files = attachments.filter((attachment) => !attachment.mimeType.startsWith("image/"));
  const renderCard = (attachment: Attachment) => <AttachmentCard key={attachment.id} attachment={attachment} onPreview={() => setPreview(attachment)} onRenamed={(name) => { onRenamed?.(attachment, name); setPreview((current) => current?.id === attachment.id ? { ...current, name } : current); }} onRemove={onRemove ? () => onRemove(attachment) : undefined} />;
  return <><div className="memo-attachments">
    {!!images.length && <section className="memo-attachment-group image-group" aria-label="画像">
      <div className="memo-attachment-group-heading"><strong>画像</strong><span>{images.length}件</span></div>
      <div className="memo-attachment-cards">{images.map(renderCard)}</div>
    </section>}
    {!!files.length && <section className="memo-attachment-group file-group" aria-label="ファイル">
      <div className="memo-attachment-group-heading"><strong>ファイル</strong><span>{files.length}件</span></div>
      <div className="memo-attachment-cards">{files.map(renderCard)}</div>
    </section>}
  </div>{preview && <AttachmentPreviewModal attachment={preview} quickLinked={quickLinkedAttachmentIds?.has(preview.id)} onAddQuickLink={onQuickLink ? () => onQuickLink(preview) : undefined} onRenamed={(name) => { onRenamed?.(preview, name); setPreview({ ...preview, name }); }} onClose={() => setPreview(null)} />}</>;
}
