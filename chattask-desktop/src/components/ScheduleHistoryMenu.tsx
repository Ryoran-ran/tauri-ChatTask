import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function ScheduleHistoryMenu({ onOpen }: { onOpen: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const close = () => { setPosition(null); button.current?.focus(); };
  useEffect(() => {
    if (!position) return;
    const outside = (event: PointerEvent) => { if (!button.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setPosition(null); };
    const hide = () => setPosition(null);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); };
  }, [position]);
  return <>
    <button ref={button} type="button" className="project-capacity-milestone-more" aria-label="作業スケジュールのその他の操作" aria-haspopup="menu" aria-expanded={Boolean(position)} onClick={() => {
      if (position) { close(); return; }
      const rect = button.current!.getBoundingClientRect();
      setPosition({ top: Math.max(8, Math.min(rect.bottom + 5, window.innerHeight - 65)), left: Math.max(8, Math.min(rect.right - 190, window.innerWidth - 198)) });
    }}>…</button>
    {position && createPortal(<div ref={menu} role="menu" aria-label="作業スケジュールの操作" className="project-capacity-milestone-menu" style={position} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } if (event.key === "Tab") setPosition(null); }}>
      <button autoFocus type="button" role="menuitem" onClick={() => { close(); onOpen(); }}>変更履歴</button>
    </div>, document.body)}
  </>;
}
