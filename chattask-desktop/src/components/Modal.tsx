import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

const ModalLayerContext = createContext(2200);

export function Modal({ title, children, onClose, wide = false, fullScreen = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; fullScreen?: boolean }) {
  const parentLayer = useContext(ModalLayerContext);
  const zIndex = parentLayer + 1;
  return <ModalLayerContext.Provider value={zIndex}>{createPortal(
    <div className="modal-backdrop" style={{ zIndex }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal ${wide ? "modal-wide" : ""} ${fullScreen ? "modal-fullscreen" : ""}`} role="dialog" aria-modal="true">
        <header className="modal-header"><h2>{title}</h2><button onClick={onClose} aria-label="閉じる">×</button></header>
        <div className="modal-body">{children}</div>
      </section>
    </div>,
    document.body,
  )}</ModalLayerContext.Provider>;
}
