import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { ProjectTag, TaskLink } from "../types";
import { randomTagColor, TAG_COLOR_PALETTE } from "../tagColors";
import { generateId, normalizeUrl } from "../utils";
import { addAttachment, removeAttachment } from "../services/attachments";
import { AttachmentsSection } from "./AttachmentsSection";
import { DocumentsModal } from "./DocumentsModal";
import { ImageCropModal } from "./ImageCropModal";
import { Modal } from "./Modal";
import { TagIcon } from "./TagIcon";

const tagAttachmentId = (tagId: string) => `project-tag:${tagId}`;
const EXTENDED_TAG_COLORS = [
  "#f8fafc", "#cbd5e1", "#64748b", "#334155", "#0f172a",
  "#fecaca", "#f87171", "#ef4444", "#b91c1c", "#7f1d1d",
  "#fed7aa", "#fb923c", "#f97316", "#c2410c", "#7c2d12",
  "#fef08a", "#facc15", "#eab308", "#a16207", "#713f12",
  "#d9f99d", "#84cc16", "#65a30d", "#3f6212", "#1a2e05",
  "#bbf7d0", "#4ade80", "#22c55e", "#15803d", "#14532d",
  "#99f6e4", "#2dd4bf", "#14b8a6", "#0f766e", "#134e4a",
  "#a5f3fc", "#22d3ee", "#06b6d4", "#0e7490", "#164e63",
  "#bfdbfe", "#60a5fa", "#3b82f6", "#1d4ed8", "#1e3a8a",
  "#c7d2fe", "#818cf8", "#6366f1", "#4338ca", "#312e81",
  "#e9d5ff", "#c084fc", "#a855f7", "#7e22ce", "#581c87",
  "#fbcfe8", "#f472b6", "#ec4899", "#be185d", "#831843",
];

export function TagSettingsModal({ tags, onSave, onClose }: { tags: ProjectTag[]; onSave: (tags: ProjectTag[]) => void; onClose: () => void }) {
  const [items, setItems] = useState<ProjectTag[]>(tags.map((tag) => ({ ...tag, color: tag.color || randomTagColor(), sharedLinks: tag.sharedLinks || [], sharedDocuments: tag.sharedDocuments || [] })));
  const [selectedId, setSelectedId] = useState(tags[0]?.id || "");
  const [documentsTagId, setDocumentsTagId] = useState("");
  const [name, setName] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [editingLinkId, setEditingLinkId] = useState("");
  const [editingLinkLabel, setEditingLinkLabel] = useState("");
  const [editingLinkUrl, setEditingLinkUrl] = useState("");
  const [logoFiles, setLogoFiles] = useState<Record<string, File>>({});
  const [logoPreviews, setLogoPreviews] = useState<Record<string, string>>({});
  const [cropSource, setCropSource] = useState("");
  const [extendedColorsOpen, setExtendedColorsOpen] = useState(false);
  const [colorCode, setColorCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const logoInputRef = useRef<HTMLInputElement>(null);
  const logoPreviewsRef = useRef<Record<string, string>>({});
  const selected = items.find((tag) => tag.id === selectedId);
  useEffect(() => { setColorCode(selected?.color || "#3b82f6"); }, [selectedId, selected?.color]);
  useEffect(() => { logoPreviewsRef.current = logoPreviews; }, [logoPreviews]);
  useEffect(() => () => Object.values(logoPreviewsRef.current).forEach((url) => URL.revokeObjectURL(url)), []);
  const updateSelected = (changes: Partial<ProjectTag>) => setItems((current) => current.map((tag) => tag.id === selectedId ? { ...tag, ...changes } : tag));
  const moveInGroup = (tagId: string, delta: number) => {
    const index = items.findIndex((tag) => tag.id === tagId);
    if (index < 0) return;
    const group = items.map((tag, itemIndex) => ({ tag, itemIndex })).filter(({ tag }) => tag.visible === items[index].visible);
    const groupIndex = group.findIndex(({ tag }) => tag.id === tagId);
    const target = group[groupIndex + delta]?.itemIndex;
    if (target === undefined) return;
    const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; setItems(next);
  };
  const addTag = () => {
    if (!name.trim()) return;
    const tag: ProjectTag = { id: generateId(), name: name.trim(), visible: true, color: randomTagColor(), sharedLinks: [], sharedDocuments: [] };
    setItems((current) => [...current, tag]);
    setSelectedId(tag.id);
    setName("");
  };
  const addLink = () => {
    if (!selected || !linkUrl.trim()) return;
    const url = normalizeUrl(linkUrl);
    if (!url) return;
    const link: TaskLink = { id: generateId(), label: linkLabel.trim() || new URL(url).hostname, url };
    updateSelected({ sharedLinks: [...(selected.sharedLinks || []), link] });
    setLinkLabel("");
    setLinkUrl("");
  };
  const removeTag = (tagId: string) => {
    const next = items.filter((tag) => tag.id !== tagId);
    setItems(next);
    if (selectedId === tagId) setSelectedId(next[0]?.id || "");
  };
  const beginEditLink = (link: TaskLink) => {
    setEditingLinkId(link.id);
    setEditingLinkLabel(link.label);
    setEditingLinkUrl(link.url);
  };
  const saveEditedLink = () => {
    if (!selected || !editingLinkId || !editingLinkUrl.trim()) return;
    const url = normalizeUrl(editingLinkUrl);
    if (!url) {
      window.alert("正しいURLを入力してください。");
      return;
    }
    const label = editingLinkLabel.trim() || new URL(url).hostname;
    updateSelected({ sharedLinks: (selected.sharedLinks || []).map((link) => link.id === editingLinkId ? { ...link, label, url } : link) });
    setEditingLinkId("");
  };
  const chooseLogo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      setError("JPEG・PNG・WebP・GIF画像（5MB以下）を選択してください。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setCropSource(String(reader.result || "")); setError(""); };
    reader.onerror = () => setError("画像を読み込めませんでした。");
    reader.readAsDataURL(file);
  };
  const applyLogo = (file: File) => {
    if (!selected) return;
    if (logoPreviews[selected.id]) URL.revokeObjectURL(logoPreviews[selected.id]);
    setLogoFiles((current) => ({ ...current, [selected.id]: file }));
    setLogoPreviews((current) => ({ ...current, [selected.id]: URL.createObjectURL(file) }));
    updateSelected({ iconType: "image" });
    setCropSource("");
  };
  const applyColorCode = () => {
    const value = colorCode.trim();
    const normalized = value.startsWith("#") ? value : `#${value}`;
    if (!/^#[0-9a-f]{6}$/i.test(normalized)) {
      setError("カラーコードは #RRGGBB 形式で入力してください。");
      return;
    }
    updateSelected({ color: normalized.toLowerCase() });
    setColorCode(normalized.toLowerCase());
    setError("");
  };
  const save = async () => {
    setBusy(true); setError("");
    try {
      const removedTags = tags.filter((original) => !items.some((item) => item.id === original.id));
      await Promise.all(removedTags.map((tag) => tag.logoAttachmentId ? removeAttachment(tag.logoAttachmentId).catch(() => undefined) : Promise.resolve()));
      const saved: ProjectTag[] = [];
      for (const tag of items) {
        const original = tags.find((item) => item.id === tag.id);
        let logoAttachmentId = tag.logoAttachmentId;
        if (logoFiles[tag.id]) {
          if (original?.logoAttachmentId) await removeAttachment(original.logoAttachmentId).catch(() => undefined);
          logoAttachmentId = (await addAttachment(`project-tag-logo:${tag.id}`, logoFiles[tag.id])).id;
        }
        saved.push({ ...tag, logoAttachmentId, logoUpdatedAt: logoFiles[tag.id] ? new Date().toISOString() : tag.logoUpdatedAt });
      }
      onSave(saved);
      onClose();
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  const documentsTag = items.find((tag) => tag.id === documentsTagId);
  const visibleItems = items.filter((tag) => tag.visible);
  const hiddenItems = items.filter((tag) => !tag.visible);
  const tagRow = (tag: ProjectTag, groupItems: ProjectTag[]) => {
    const groupIndex = groupItems.findIndex((item) => item.id === tag.id);
    return <div className={`tag-setting-row ${tag.id === selectedId ? "active" : ""} ${tag.visible ? "" : "is-hidden"}`} key={tag.id} onClick={() => { setSelectedId(tag.id); setEditingLinkId(""); }}>
      {logoPreviews[tag.id] ? <span className="tag-visual-icon tag-visual-logo tag-setting-icon" style={{ backgroundColor: tag.color }}><img src={logoPreviews[tag.id]} alt="" /></span> : <TagIcon tag={tag} className="tag-setting-icon" />}
      <input value={tag.name} aria-label={`${tag.name}のタグ名`} onClick={(event) => event.stopPropagation()} onChange={(event) => setItems(items.map((item) => item.id === tag.id ? { ...item, name: event.target.value } : item))} />
      <button type="button" className={`tag-visibility-button ${tag.visible ? "is-visible" : ""}`} title={tag.visible ? "非表示に移動" : "表示中に戻す"} aria-label={tag.visible ? `${tag.name}を非表示にする` : `${tag.name}を表示する`} aria-pressed={tag.visible} onClick={(event) => { event.stopPropagation(); setItems(items.map((item) => item.id === tag.id ? { ...item, visible: !item.visible } : item)); }}><span aria-hidden="true" /></button>
      <button type="button" title="上へ" aria-label={`${tag.name}を上へ移動`} disabled={groupIndex === 0} onClick={(event) => { event.stopPropagation(); moveInGroup(tag.id, -1); }}>↑</button>
      <button type="button" title="下へ" aria-label={`${tag.name}を下へ移動`} disabled={groupIndex === groupItems.length - 1} onClick={(event) => { event.stopPropagation(); moveInGroup(tag.id, 1); }}>↓</button>
      <button type="button" className="danger-text tag-delete-button" title="削除" aria-label={`${tag.name}を削除`} onClick={(event) => { event.stopPropagation(); removeTag(tag.id); }}>×</button>
    </div>;
  };
  return <><Modal title="案件タグ設定・共通資料" onClose={onClose} wide><div className="tag-resource-layout">
    <aside className="tag-settings">
      <div className="inline-form"><input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addTag(); }} placeholder="新しいタグ名" /><button className="primary" onClick={addTag}>追加</button></div>
      <section className="tag-setting-group"><header><strong>表示中</strong><span>{visibleItems.length}件</span></header><div>{visibleItems.map((tag) => tagRow(tag, visibleItems))}{!visibleItems.length && <p>表示中のタグはありません。</p>}</div></section>
      <section className="tag-setting-group tag-setting-hidden-group"><header><strong>非表示</strong><span>{hiddenItems.length}件</span></header><div>{hiddenItems.map((tag) => tagRow(tag, hiddenItems))}{!hiddenItems.length && <p>非表示のタグはありません。</p>}</div></section>
    </aside>
    <main className="tag-resources">{selected ? <>
      <header><div><small>案件タグの共通資料</small><h3>{logoPreviews[selected.id] ? <span className="tag-visual-icon tag-visual-logo" style={{ backgroundColor: selected.color }}><img src={logoPreviews[selected.id]} alt="" /></span> : <TagIcon tag={selected} />}{selected.name}</h3></div><p>このタグを設定したすべてのタスクから参照できます。</p></header>
      <section className="tag-icon-settings"><h4>タグアイコン</h4><div className="tag-icon-mode"><button type="button" className={selected.iconType !== "image" ? "active" : ""} onClick={() => updateSelected({ iconType: "color" })}>単色</button><button type="button" className={selected.iconType === "image" ? "active" : ""} onClick={() => { updateSelected({ iconType: "image" }); if (!selected.logoAttachmentId && !logoFiles[selected.id]) logoInputRef.current?.click(); }}>画像</button></div><div className="tag-color-control"><span>背景色</span><div className="tag-color-palette">{TAG_COLOR_PALETTE.map((color) => <button type="button" key={color} className={selected.color === color ? "active" : ""} style={{ backgroundColor: color }} aria-label={`背景色 ${color}`} aria-pressed={selected.color === color} onClick={() => updateSelected({ color })} />)}<div className="tag-custom-color"><button type="button" className={extendedColorsOpen ? "active" : ""} title="その他の背景色" aria-label="その他の背景色" aria-expanded={extendedColorsOpen} onClick={() => setExtendedColorsOpen((open) => !open)}>＋</button>{extendedColorsOpen && <div className="tag-extended-palette">{EXTENDED_TAG_COLORS.map((color) => <button type="button" key={color} className={selected.color === color ? "active" : ""} style={{ backgroundColor: color }} aria-label={`背景色 ${color}`} onClick={() => { updateSelected({ color }); setExtendedColorsOpen(false); }} />)}</div>}</div></div><div className="tag-color-code"><input value={colorCode} maxLength={7} spellCheck={false} aria-label="背景色のカラーコード" placeholder="#3b82f6" onChange={(event) => setColorCode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyColorCode(); }} /><button type="button" onClick={applyColorCode}>適用</button></div><button type="button" onClick={() => logoInputRef.current?.click()}>画像を変更</button></div><small>背景色を変更しても画像は保持されます。画像の透明部分には、選択した背景色が表示されます。</small><input ref={logoInputRef} hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={chooseLogo} /></section>
      <section><h4>共通URL</h4><div className="inline-form tag-link-form"><input value={linkLabel} onChange={(event) => setLinkLabel(event.target.value)} placeholder="表示名（任意）" /><input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://..." /><button className="primary" onClick={addLink}>追加</button></div>
        <div className="tag-shared-links">{(selected.sharedLinks || []).map((link) => editingLinkId === link.id
          ? <div className="tag-shared-link-editor" key={link.id}><label>表示名<input autoFocus value={editingLinkLabel} onChange={(event) => setEditingLinkLabel(event.target.value)} /></label><label>URL<input value={editingLinkUrl} onChange={(event) => setEditingLinkUrl(event.target.value)} /></label><div><button type="button" onClick={() => setEditingLinkId("")}>キャンセル</button><button type="button" className="primary" disabled={!editingLinkUrl.trim()} onClick={saveEditedLink}>保存</button></div></div>
          : <div key={link.id}><a href={link.url} target="_blank" rel="noreferrer">{link.label}</a><small>{link.url}</small><span className="tag-shared-link-actions"><button type="button" onClick={() => beginEditLink(link)}>編集</button><button type="button" className="danger-text" onClick={() => updateSelected({ sharedLinks: (selected.sharedLinks || []).filter((item) => item.id !== link.id) })}>削除</button></span></div>)}{!(selected.sharedLinks || []).length && <p className="muted">共通URLはありません。</p>}</div>
      </section>
      <section className="tag-shared-documents"><div><h4>共通ドキュメント</h4><p>手順書やチェックリストを、この案件タグのタスクで共有できます。</p></div><button type="button" onClick={() => setDocumentsTagId(selected.id)}>ドキュメントを開く <small>{(selected.sharedDocuments || []).length}件</small></button></section>
      <section><h4>共通ファイル</h4><AttachmentsSection taskId={tagAttachmentId(selected.id)} title="ファイル一覧" /></section>
    </> : <div className="empty-list">案件タグを追加してください。</div>}</main>
  </div>{error && <p className="attachment-error">{error}</p>}<div className="modal-actions"><button onClick={onClose}>キャンセル</button><button className="primary" disabled={busy} onClick={() => void save()}>{busy ? "保存中..." : "保存"}</button></div></Modal>{documentsTag && <DocumentsModal title={`${documentsTag.name}・共通資料`} documents={documentsTag.sharedDocuments || []} onSave={(sharedDocuments) => setItems((current) => { const next = current.map((tag) => tag.id === documentsTag.id ? { ...tag, sharedDocuments } : tag); onSave(next); return next; })} onClose={() => setDocumentsTagId("")} />}{cropSource && <ImageCropModal source={cropSource} title="画像を調整" shape="square" onApply={applyLogo} onClose={() => setCropSource("")} />}</>;
}
