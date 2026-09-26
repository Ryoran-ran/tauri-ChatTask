import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GoalMilestone } from "../types";
import { Modal } from "./Modal";

type TargetSnapshot = Pick<GoalMilestone, "id" | "targetWorkStartDate" | "targetWorkEndDate">;
export function clearMilestoneTargetChanges(current: GoalMilestone, expected: TargetSnapshot) {
  if (current.id !== expected.id || current.targetWorkStartDate !== expected.targetWorkStartDate || current.targetWorkEndDate !== expected.targetWorkEndDate) {
    throw new Error("確認中に目標期間が変更されました。閉じて内容を確認し直してください。");
  }
  // 明示的な空欄として保存し、旧データ補完で期間を復活させない。
  return { targetWorkStartDate: "", targetWorkEndDate: "" };
}

export function MilestoneTargetMenu({ milestone, onClear }: {
  milestone: GoalMilestone;
  onClear: (changes: ReturnType<typeof clearMilestoneTargetChanges>) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [confirmation, setConfirmation] = useState<TargetSnapshot | null>(null);
  const [error, setError] = useState("");
  const hasTarget = Boolean(milestone.targetWorkStartDate || milestone.targetWorkEndDate);
  const close = () => { setPosition(null); setConfirmation(null); setError(""); triggerRef.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!position) return;
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) setPosition(null);
    };
    const hide = () => setPosition(null);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [position]);
  return <>
    <button ref={triggerRef} type="button" className="project-capacity-milestone-more" aria-label={`${milestone.title || "マイルストーン"}のその他の操作`} aria-haspopup="menu" aria-expanded={Boolean(position)} onClick={() => {
      if (position) { setPosition(null); return; }
      const rect = triggerRef.current!.getBoundingClientRect();
      setPosition({ top: Math.max(8, Math.min(rect.bottom + 5, window.innerHeight - 60)), left: Math.max(8, Math.min(rect.right - 190, window.innerWidth - 198)) });
    }}>…</button>
    {position && createPortal(<div ref={menuRef} role="menu" aria-label="マイルストーンの操作" className="project-capacity-milestone-menu" style={position} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } if (event.key === "Tab") setPosition(null); }}>
      <button autoFocus type="button" role="menuitem" aria-disabled={!hasTarget} onClick={() => {
        if (!hasTarget) return;
        setPosition(null); setError("");
        setConfirmation({ id: milestone.id, targetWorkStartDate: milestone.targetWorkStartDate, targetWorkEndDate: milestone.targetWorkEndDate });
      }}>目標期間をクリア</button>
    </div>, document.body)}
    {confirmation && <Modal title="目標期間をクリア" onClose={close}>
      <div className="project-milestone-clear-confirm" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
        <p>「{milestone.title || "マイルストーン"}」の目標期間（青い線）をクリアしますか？</p>
        <p className="project-milestone-clear-dates">{confirmation.targetWorkStartDate || "未設定"} 〜 {confirmation.targetWorkEndDate || "未設定"}</p>
        <p>マイルストーン自体と期限（◆）、配下の作業の期間・作業日は変更しません。</p>
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions"><button autoFocus type="button" onClick={close}>キャンセル</button><button type="button" className="primary" onClick={() => {
          try { onClear(clearMilestoneTargetChanges(milestone, confirmation)); close(); }
          catch (failure) { setError(failure instanceof Error ? failure.message : "クリアできませんでした。"); }
        }}>目標期間をクリア</button></div>
      </div>
    </Modal>}
  </>;
}
