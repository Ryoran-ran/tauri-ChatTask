import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";
import { avatarObjectUrl, removeAvatar, saveAvatar } from "../services/profile";
import type { UserProfile } from "../types";
import { Modal } from "./Modal";

const CROP_SIZE = 280;
const OUTPUT_SIZE = 512;

export function ProfileModal({ profile, onSave, onClose }: { profile: UserProfile; onSave: (profile: UserProfile) => void; onClose: () => void }) {
  const [name, setName] = useState(profile.displayName);
  const [preview, setPreview] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cropSource, setCropSource] = useState("");
  const [cropOpen, setCropOpen] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    let url = "", active = true;
    if (profile.avatarUpdatedAt) void avatarObjectUrl().then((value) => { url = value; if (active) setPreview(value); else URL.revokeObjectURL(value); }).catch(() => undefined);
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [profile.avatarUpdatedAt]);

  const baseScale = imageSize.width && imageSize.height ? Math.max(CROP_SIZE / imageSize.width, CROP_SIZE / imageSize.height) : 1;
  const clampOffset = (x: number, y: number, nextZoom = zoom) => {
    const maxX = Math.max(0, (imageSize.width * baseScale * nextZoom - CROP_SIZE) / 2);
    const maxY = Math.max(0, (imageSize.height * baseScale * nextZoom - CROP_SIZE) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  };
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    if (!selected.type.startsWith("image/") || selected.size > 5 * 1024 * 1024) { setError("JPEG・PNG・WebP・GIF画像（5MB以下）を選択してください。"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setCropSource(String(reader.result || ""));
      setImageSize({ width: 0, height: 0 });
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setCropOpen(true);
      setError("");
    };
    reader.onerror = () => setError("画像を読み込めませんでした。");
    reader.readAsDataURL(selected);
  };
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y };
  };
  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    setOffset(clampOffset(dragRef.current.offsetX + event.clientX - dragRef.current.x, dragRef.current.offsetY + event.clientY - dragRef.current.y));
  };
  const finishDrag = () => { dragRef.current = null; };
  const applyCrop = async () => {
    const image = cropImageRef.current;
    if (!image || !imageSize.width || !imageSize.height) return;
    const scale = baseScale * zoom;
    const displayWidth = imageSize.width * scale;
    const displayHeight = imageSize.height * scale;
    const imageLeft = (CROP_SIZE - displayWidth) / 2 + offset.x;
    const imageTop = (CROP_SIZE - displayHeight) / 2 + offset.y;
    const sourceX = Math.max(0, -imageLeft / scale);
    const sourceY = Math.max(0, -imageTop / scale);
    const sourceSize = CROP_SIZE / scale;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", .92));
    if (!blob) { setError("画像を切り抜けませんでした。"); return; }
    const cropped = new File([blob], "avatar.png", { type: "image/png" });
    if (preview.startsWith("blob:")) URL.revokeObjectURL(preview);
    setFile(cropped);
    setPreview(URL.createObjectURL(cropped));
    setRemove(false);
    setCropOpen(false);
  };
  const submit = async () => {
    const displayName = name.trim();
    if (!displayName) { setError("ユーザー名を入力してください。"); return; }
    setBusy(true); setError("");
    try {
      if (remove) await removeAvatar();
      if (file) await saveAvatar(file);
      onSave({ displayName, avatarUpdatedAt: remove && !file ? "" : file ? new Date().toISOString() : profile.avatarUpdatedAt });
      onClose();
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };

  return <Modal title="プロフィール設定" onClose={onClose}>
    <div className="profile-settings">
      <div className="profile-avatar-preview">{preview && !remove ? <img src={preview} alt="プロフィール画像" /> : <span>{name.trim().slice(0, 1).toUpperCase() || "U"}</span>}</div>
      <div className="profile-image-actions"><button type="button" onClick={() => { if (!inputRef.current) return; inputRef.current.value = ""; inputRef.current.click(); }}>画像を選択</button>{(preview || profile.avatarUpdatedAt) && !remove && <button type="button" className="danger-text" onClick={() => { setRemove(true); setFile(null); setPreview(""); }}>画像を削除</button>}<input ref={inputRef} hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={choose} /></div>
      <label>ユーザー名<input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder="表示する名前" /></label>
      <small>JPEG・PNG・WebP・GIF、5MBまで</small>
      {error && <p className="attachment-error">{error}</p>}
      <div className="modal-actions"><button onClick={onClose}>キャンセル</button><button className="primary" disabled={busy} onClick={submit}>{busy ? "保存中..." : "保存"}</button></div>
    </div>
    {cropOpen && <Modal title="プロフィール画像を調整" onClose={() => setCropOpen(false)}>
      <div className="avatar-crop-editor">
        <p>画像をドラッグして、四角の中に表示したい範囲を合わせてください。</p>
        <div className="avatar-crop-stage square" onPointerDown={startDrag} onPointerMove={drag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
          <img ref={cropImageRef} draggable={false} src={cropSource} alt="トリミング対象" onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} style={{ width: imageSize.width ? imageSize.width * baseScale * zoom : "auto", height: imageSize.height ? imageSize.height * baseScale * zoom : "auto", transform: `translate(${offset.x}px, ${offset.y}px)` }} />
          <span className="avatar-crop-guide horizontal" />
          <span className="avatar-crop-guide vertical" />
        </div>
        <label className="avatar-crop-zoom"><span>縮小</span><input type="range" min="1" max="3" step=".01" value={zoom} onChange={(event) => { const value = Number(event.target.value); setZoom(value); setOffset((current) => clampOffset(current.x, current.y, value)); }} /><span>拡大</span></label>
        <div className="modal-actions"><button type="button" onClick={() => setCropOpen(false)}>キャンセル</button><button type="button" className="primary" disabled={!imageSize.width} onClick={() => void applyCrop()}>この範囲で決定</button></div>
      </div>
    </Modal>}
  </Modal>;
}
