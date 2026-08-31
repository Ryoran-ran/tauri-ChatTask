import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface TimerSession {
  taskId: string;
  taskTitle: string;
  date: string;
  planKey: string;
  durationMinutes: number;
  plannedMinutes?: number | null;
  overrunNotifiedAt?: number;
  startedAt: number | null;
  elapsedMs: number;
}

const elapsedFor = (timer: TimerSession, now = Date.now()) => timer.elapsedMs + (timer.startedAt === null ? 0 : Math.max(0, now - timer.startedAt));
const clock = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours ? `${hours}:` : ""}${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
};

type TimerPosition = { x: number; y: number };
const loadTimerPosition = (): TimerPosition | null => {
  try {
    const value = JSON.parse(localStorage.getItem("chatTaskTimerPosition") || "null");
    return Number.isFinite(value?.x) && Number.isFinite(value?.y) ? value : null;
  } catch {
    return null;
  }
};

export function ActiveTimerBar({ timer, onPause, onResume, onOverrun, onFinish, onOpenTask }: {
  timer: TimerSession;
  onPause: () => void;
  onResume: () => void;
  onOverrun: () => void;
  onFinish: () => void;
  onOpenTask: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [position, setPosition] = useState<TimerPosition | null>(loadTimerPosition);
  const [compact, setCompact] = useState(() => localStorage.getItem("chatTaskTimerCompact") === "true");
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (timer.startedAt === null) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [timer.startedAt]);
  const elapsed = elapsedFor(timer, now);
  const plannedMilliseconds = typeof timer.plannedMinutes === "number" ? timer.plannedMinutes * 60_000 : timer.durationMinutes * 60_000;
  const overPlanned = typeof timer.plannedMinutes === "number" && elapsed > plannedMilliseconds;
  const reminderThreshold = (typeof timer.plannedMinutes === "number" ? timer.plannedMinutes * 2 : 180) * 60_000;
  useEffect(() => {
    if (!timer.overrunNotifiedAt && elapsed >= reminderThreshold) onOverrun();
  }, [elapsed, onOverrun, reminderThreshold, timer.overrunNotifiedAt]);
  const moveTimer = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const bar = event.currentTarget.closest<HTMLElement>(".active-timer-bar");
    if (!drag || drag.pointerId !== event.pointerId || !bar) return;
    setPosition({
      x: Math.max(8, Math.min(window.innerWidth - bar.offsetWidth - 8, event.clientX - drag.offsetX)),
      y: Math.max(8, Math.min(window.innerHeight - bar.offsetHeight - 8, event.clientY - drag.offsetY)),
    });
  };
  const finishMovingTimer = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setPosition((current) => {
      if (current) localStorage.setItem("chatTaskTimerPosition", JSON.stringify(current));
      return current;
    });
  };
  return createPortal(<aside className={`active-timer-bar ${overPlanned ? "is-over-planned" : ""} ${compact ? "is-compact" : ""}`} style={position ? { left: position.x, top: position.y, right: "auto", bottom: "auto" } : undefined} aria-live="polite">
    <button type="button" className="active-timer-drag" aria-label="タイマーを移動。ダブルクリックでサイズ変更" title="ドラッグして移動・ダブルクリックでサイズ変更" onDoubleClick={() => setCompact((current) => { const next = !current; localStorage.setItem("chatTaskTimerCompact", String(next)); return next; })} onPointerDown={(event) => { const bar = event.currentTarget.closest<HTMLElement>(".active-timer-bar"); if (!bar) return; const rect = bar.getBoundingClientRect(); dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={moveTimer} onPointerUp={finishMovingTimer} onPointerCancel={finishMovingTimer}>⠿</button>
    <button type="button" className="active-timer-task" onClick={onOpenTask}><small>{timer.startedAt === null ? "一時停止中" : overPlanned ? "予定目安を超過" : typeof timer.plannedMinutes === "number" ? `予定 ${timer.plannedMinutes}分` : "予定工数なし"}</small><strong>{timer.taskTitle}</strong></button>
    <time>{clock(elapsed)}</time>
    <div>
      {timer.startedAt === null
        ? <button type="button" onClick={onResume}>再開</button>
        : <button type="button" onClick={onPause}>一時停止</button>}
      <button type="button" className="primary" onClick={onFinish}>終了</button>
    </div>
  </aside>, document.body);
}

export function TimerFinishDialog({ timer, initialMemo, onSave, onDiscard, onClose }: {
  timer: TimerSession;
  initialMemo: string;
  onSave: (hours: number, memo: string, result: "pending" | "achieved") => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const measuredHours = Math.max(0.01, Math.round((elapsedFor(timer) / 3_600_000) * 100) / 100);
  const [hours, setHours] = useState(String(measuredHours));
  const [memo, setMemo] = useState(initialMemo);
  const [result, setResult] = useState<"pending" | "achieved">("pending");
  return createPortal(<div className="timer-dialog-backdrop" onPointerDown={onClose}>
    <section className="timer-finish-dialog" role="dialog" aria-modal="true" aria-label="タイマーを終了" onPointerDown={(event) => event.stopPropagation()}>
      <header><div><small>作業タイマーを終了</small><strong>{timer.taskTitle}</strong></div><button type="button" onClick={onClose}>×</button></header>
      <label>実績工数（時間）<input autoFocus type="number" min="0" step="0.01" value={hours} onChange={(event) => setHours(event.target.value)} /></label>
      <label>この日にすること（「記録」と共通）<textarea rows={3} value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="「記録」で入力する同じ内容です" /><small>今日のページの「記録」と同じ内容を表示・更新します。</small></label>
      <label>今日のページの達成状況<select value={result} onChange={(event) => setResult(event.target.value as typeof result)}><option value="pending">未達成のまま</option><option value="achieved">達成にする</option></select></label>
      <footer><button type="button" className="danger-text" onClick={onDiscard}>記録せず破棄</button><span /><button type="button" onClick={onClose}>戻る</button><button type="button" className="primary" disabled={Number(hours) < 0} onClick={() => onSave(Math.max(0, Number(hours) || 0), memo, result)}>実績へ保存</button></footer>
    </section>
  </div>, document.body);
}
