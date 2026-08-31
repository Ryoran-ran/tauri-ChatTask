import { useEffect, useMemo, useState } from "react";
import { attachmentNameParts, attachmentObjectUrl, copyAttachment, downloadAttachment, getAttachmentFile, openAttachment, renameAttachment, type Attachment } from "../services/attachments";
import { fileIcon } from "./fileIcon";
import { Modal } from "./Modal";

type PreviewKind = "image" | "pdf" | "text" | "video" | "audio" | "unsupported";

const previewKind = (attachment: Attachment): PreviewKind => {
  const mime = attachment.mimeType.toLowerCase();
  const extension = attachment.name.split(".").pop()?.toLowerCase() || "";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(extension)) return "image";
  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("text/") || ["txt", "md", "json", "csv", "tsv", "xml", "html", "css", "js", "ts", "tsx", "jsx", "sql", "log", "yaml", "yml"].includes(extension)) return "text";
  return "unsupported";
};

export function AttachmentPreviewModal({ attachment, onClose, onRenamed, quickLinked = false, onAddQuickLink }: { attachment: Attachment; onClose: () => void; onRenamed?: (name: string) => void; quickLinked?: boolean; onAddQuickLink?: () => void }) {
  const kind = useMemo(() => previewKind(attachment), [attachment]);
  const icon = useMemo(() => fileIcon(attachment.name), [attachment.name]);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(attachment.name);
  const [quickLinkAdded, setQuickLinkAdded] = useState(quickLinked);
  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  };
  const copy = async () => {
    try { await copyAttachment(attachment.id); showNotice("クリップボードへコピーしました"); }
    catch (reason) { setError(`コピーできませんでした: ${String(reason)}`); }
  };
  const download = async () => {
    try {
      const path = await downloadAttachment(attachment.id);
      showNotice(`Downloadsへ保存しました: ${path.split("/").pop() || attachment.name}`);
    } catch (reason) { setError(`ダウンロードできませんでした: ${String(reason)}`); }
  };
  const saveName = async () => {
    const nextName = name.trim();
    if (!nextName) return;
    try {
      const savedName = await renameAttachment(attachment.id, nextName, attachment.name);
      setEditingName(false);
      onRenamed?.(savedName);
      showNotice(`表示名を「${savedName}」へ変更しました`);
    } catch (reason) { setError(`表示名を変更できませんでした: ${String(reason)}`); }
  };

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setUrl(""); setText(""); setError("");
    if (kind === "unsupported") return;
    if (kind === "text") {
      void getAttachmentFile(attachment.id).then((file) => {
        if (active) setText(new TextDecoder().decode(new Uint8Array(file.data)));
      }).catch((reason) => setError(String(reason)));
    } else {
      void attachmentObjectUrl(attachment.id).then((value) => {
        objectUrl = value;
        if (active) setUrl(value); else URL.revokeObjectURL(value);
      }).catch((reason) => setError(String(reason)));
    }
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment.id, kind]);

  useEffect(() => { setQuickLinkAdded(quickLinked); }, [attachment.id, quickLinked]);

  const addQuickLink = () => {
    if (!onAddQuickLink || quickLinkAdded) return;
    onAddQuickLink();
    setQuickLinkAdded(true);
    showNotice("クイックリンクへ追加しました");
  };

  return <Modal title={attachment.name} onClose={onClose} wide><div className="attachment-preview">
    {error && <p className="attachment-error">プレビューを読み込めませんでした: {error}</p>}
    {!error && kind !== "unsupported" && !url && kind !== "text" && <p className="muted">読み込み中...</p>}
    {kind === "image" && url && <img src={url} alt={attachment.name} />}
    {kind === "pdf" && url && <iframe src={url} title={attachment.name} />}
    {kind === "video" && url && <video src={url} controls />}
    {kind === "audio" && url && <audio src={url} controls />}
    {kind === "text" && !error && <pre>{text || "読み込み中..."}</pre>}
    {kind === "unsupported" && <div className="preview-unsupported"><span className={`file-type-icon preview-file-type-icon file-type-${icon.type}`} aria-hidden="true">{icon.label}</span><p>このファイル形式はアプリ内プレビューに対応していません。</p></div>}
    {notice && <div className="attachment-preview-notice">{notice}</div>}
    {editingName && <div className="attachment-preview-name-editor"><div className="attachment-fixed-extension-input"><input autoFocus value={name} maxLength={255 - attachmentNameParts(attachment.name).extension.length} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); if (event.key === "Escape") setEditingName(false); }} />{attachmentNameParts(attachment.name).extension && <span>{attachmentNameParts(attachment.name).extension}</span>}</div><button type="button" onClick={() => setEditingName(false)}>取消</button><button type="button" className="primary" disabled={!name.trim()} onClick={() => void saveName()}>保存</button></div>}
    <div className="modal-actions"><button onClick={onClose}>閉じる</button><button title="表示名を変更" aria-label="表示名を変更" onClick={() => { setName(attachmentNameParts(attachment.name).baseName); setEditingName(true); }}>✎</button>{onAddQuickLink && <button className="attachment-preview-quick-link" disabled={quickLinkAdded} onClick={addQuickLink}>{quickLinkAdded ? "✓ クイックリンク追加済み" : "🔗 クイックリンクへ追加"}</button>}<button onClick={() => void copy()}>コピー</button><button onClick={() => void download()}>ダウンロード</button><button className="primary" onClick={() => void openAttachment(attachment.id).catch((reason) => setError(String(reason)))}>標準アプリで開く</button></div>
  </div></Modal>;
}
