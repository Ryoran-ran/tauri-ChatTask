import { useEffect, useState } from "react";

/** レイアウトを動かさず、直前の操作を取り消せる一時通知。 */
export function ScheduleUndoToast({ message, error = false, onUndo, onDismiss, revision }: {
  message: string;
  error?: boolean;
  onUndo?: () => void;
  onDismiss: () => void;
  revision: unknown;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (hovered || focused) return;
    const timer = window.setTimeout(onDismiss, 10000);
    return () => window.clearTimeout(timer);
  }, [revision, hovered, focused, onDismiss]);
  return <div className={`schedule-undo-toast ${error ? "is-error" : ""}`}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
    <span role={error ? "alert" : "status"} aria-atomic="true">{message}</span>
    {onUndo && <button type="button" className="schedule-undo-toast-action" onClick={onUndo}>元に戻す</button>}
    <button type="button" className="schedule-undo-toast-close" aria-label="操作の通知を閉じる" onClick={onDismiss}>×</button>
  </div>;
}
