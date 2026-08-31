import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Modal } from "./Modal";

const CROP_SIZE = 280;
const OUTPUT_SIZE = 512;

export function ImageCropModal({ source, title, shape = "square", onApply, onClose }: { source: string; title: string; shape?: "circle" | "square"; onApply: (file: File) => void; onClose: () => void }) {
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const baseScale = imageSize.width && imageSize.height ? Math.max(CROP_SIZE / imageSize.width, CROP_SIZE / imageSize.height) : 1;
  const clampOffset = (x: number, y: number, nextZoom = zoom) => {
    const maxX = Math.max(0, (imageSize.width * baseScale * nextZoom - CROP_SIZE) / 2);
    const maxY = Math.max(0, (imageSize.height * baseScale * nextZoom - CROP_SIZE) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) };
  };
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y };
  };
  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    setOffset(clampOffset(dragRef.current.offsetX + event.clientX - dragRef.current.x, dragRef.current.offsetY + event.clientY - dragRef.current.y));
  };
  const apply = async () => {
    const image = imageRef.current;
    if (!image || !imageSize.width || !imageSize.height) return;
    const scale = baseScale * zoom;
    const sourceSize = CROP_SIZE / scale;
    const sourceX = Math.max(0, -((CROP_SIZE - imageSize.width * scale) / 2 + offset.x) / scale);
    const sourceY = Math.max(0, -((CROP_SIZE - imageSize.height * scale) / 2 + offset.y) / scale);
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE; canvas.height = OUTPUT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", .92));
    if (blob) onApply(new File([blob], "logo.png", { type: "image/png" }));
  };
  return <Modal title={title} onClose={onClose}>
    <div className="avatar-crop-editor">
      <p>画像をドラッグして、{shape === "square" ? "正方形" : "円"}の中に表示したい範囲を合わせてください。</p>
      <div className={`avatar-crop-stage ${shape === "square" ? "square" : ""}`} onPointerDown={startDrag} onPointerMove={drag} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
        <img ref={imageRef} draggable={false} src={source} alt="" onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} style={{ width: imageSize.width ? imageSize.width * baseScale * zoom : "auto", height: imageSize.height ? imageSize.height * baseScale * zoom : "auto", transform: `translate(${offset.x}px, ${offset.y}px)` }} />
        <span className="avatar-crop-guide horizontal" /><span className="avatar-crop-guide vertical" />
      </div>
      <label className="avatar-crop-zoom"><span>縮小</span><input type="range" min="1" max="3" step=".01" value={zoom} onChange={(event) => { const value = Number(event.target.value); setZoom(value); setOffset((current) => clampOffset(current.x, current.y, value)); }} /><span>拡大</span></label>
      <div className="modal-actions"><button onClick={onClose}>キャンセル</button><button className="primary" disabled={!imageSize.width} onClick={() => void apply()}>この範囲で決定</button></div>
    </div>
  </Modal>;
}
