import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const ModalLayerContext = createContext(2200);
let modalSequence = 0;
const activeModalIds = new Set<number>();

export function Modal({ title, children, onClose, wide = false, fullScreen = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; fullScreen?: boolean }) {
  const [modalId] = useState(() => ++modalSequence);
  const parentLayer = useContext(ModalLayerContext);
  const zIndex = parentLayer + 1;
  const hasPreviousScreen = [...activeModalIds].some((id) => id < modalId);
  useLayoutEffect(() => {
    activeModalIds.add(modalId);
    return () => { activeModalIds.delete(modalId); };
  }, [modalId]);
  return <ModalLayerContext.Provider value={zIndex}>{createPortal(
    <div className="modal-backdrop" style={{ zIndex }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal ${wide ? "modal-wide" : ""} ${fullScreen ? "modal-fullscreen" : ""}`} role="dialog" aria-modal="true">
        <header className={`modal-header ${hasPreviousScreen ? "has-previous-screen" : ""}`}>{hasPreviousScreen && <button className="modal-back-button" onClick={onClose} aria-label="前の画面に戻る" title="前の画面に戻る">←</button>}<h2>{title}</h2>{!hasPreviousScreen && <button onClick={onClose} aria-label="閉じる">×</button>}</header>
        <div className="modal-body">{children}</div>
      </section>
    </div>,
    document.body,
  )}</ModalLayerContext.Provider>;
}
