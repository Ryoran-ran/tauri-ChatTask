import { STATUS_LABELS } from "../data/constants";
import type { Task } from "../types";
import { generateId } from "../utils";

interface Props {
  task: Task;
  allTasks: Task[];
  pendingWaitingStatus: Task["status"] | null;
  pendingLeavingWaitingStatus: Task["status"] | null;
  deleteConfirm: boolean;
  onUpdate: (changes: Partial<Task>, historyText?: string) => void;
  onDelete: () => void;
  onCancelWaiting: () => void;
  onCancelLeavingWaiting: () => void;
  onCancelDelete: () => void;
}

export function TaskStatusPrompts({ task, allTasks, pendingWaitingStatus, pendingLeavingWaitingStatus, deleteConfirm, onUpdate, onDelete, onCancelWaiting, onCancelLeavingWaiting, onCancelDelete }: Props) {
  const changeWaitingStatus = (includeInWaitingBox: boolean) => {
    if (!pendingWaitingStatus) return;
    const status = pendingWaitingStatus;
    onCancelWaiting();
    onUpdate({ status, waitingFollowUp: undefined }, `ステータスを「${STATUS_LABELS[status]}」へ変更しました。`);
    if (includeInWaitingBox) window.setTimeout(() => window.dispatchEvent(new CustomEvent("chattask-open-waiting", { detail: { taskId: task.id } })), 0);
  };

  const leaveWaiting = (release: boolean) => {
    if (!pendingLeavingWaitingStatus || !task.waitingFollowUp) return;
    const status = pendingLeavingWaitingStatus;
    const info = task.waitingFollowUp;
    onCancelLeavingWaiting();
    if (!release) {
      onUpdate({ status, waitingFollowUp: info }, `ステータスを「${STATUS_LABELS[status]}」へ変更し、待ち箱には残しました。`);
      return;
    }
    const releasedAt = new Date().toISOString();
    onUpdate({
      status,
      waitingFollowUp: undefined,
      lastReleasedWaitingFollowUp: info,
      lastReleasedWaitingStatus: task.status,
      waitingHistory: [...(task.waitingHistory || []), { id: generateId(), followUp: info, status: task.status, releasedAt, reason: "status-change" }],
    }, `ステータスを「${STATUS_LABELS[status]}」へ変更し、待ち箱を解除しました。`);
    window.dispatchEvent(new CustomEvent("chattask-drop-notice", { detail: { text: `「${task.title}」の待ちを解除しました。待ち箱から取り消せます。` } }));
  };

  return <>
    {pendingWaitingStatus && <div className="task-waiting-choice" role="alertdialog" aria-label="待ち箱への登録を選択">
      <div><strong>「{STATUS_LABELS[pendingWaitingStatus]}」へ変更します</strong><span>このタスクを待ち箱にも入れますか？</span></div>
      <div><button type="button" onClick={onCancelWaiting}>変更をやめる</button><button type="button" onClick={() => changeWaitingStatus(false)}>ステータスだけ変更</button><button type="button" className="primary" onClick={() => changeWaitingStatus(true)}>待ち箱にも入れる</button></div>
    </div>}
    {pendingLeavingWaitingStatus && task.waitingFollowUp && <div className="task-waiting-choice" role="alertdialog" aria-label="待ち箱の解除を選択">
      <div><strong>「{STATUS_LABELS[pendingLeavingWaitingStatus]}」へ変更します</strong><span>現在の待ち情報をどうしますか？</span></div>
      <div><button type="button" onClick={onCancelLeavingWaiting}>変更をやめる</button><button type="button" onClick={() => leaveWaiting(false)}>待ち箱には残す</button><button type="button" className="primary" onClick={() => leaveWaiting(true)}>待ち箱を解除する</button></div>
    </div>}
    {deleteConfirm && <div className="task-delete-confirm" role="alert"><span>「{task.title || "無題のタスク"}」を削除しますか？{allTasks.some((item) => item.parentTaskId === task.id) && " 子タスクは親なしに移動します。"}</span><div><button onClick={onCancelDelete}>キャンセル</button><button className="danger" onClick={onDelete}>削除する</button></div></div>}
  </>;
}
