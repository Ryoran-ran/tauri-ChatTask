import { useMemo, useState } from "react";
import type { Task, WaitingKind } from "../types";
import { addDays, todayValue } from "../utils";
import { Modal } from "./Modal";
import { WorkDatePicker } from "./WorkDatePicker";

const WAITING_LABELS: Record<WaitingKind, string> = {
  go: "GO・承認待ち", confirmation: "内容確認待ち", reply: "返信待ち",
  material: "資料・データ待ち", work: "相手の作業待ち", other: "その他",
};

type UpdateTask = (id: string, changes: Partial<Task>, history?: string) => void;

export function WaitingBoxModal({ tasks, initialTaskId, onUpdateTask, onOpenTask, onClose }: {
  tasks: Task[];
  initialTaskId?: string;
  onUpdateTask: UpdateTask;
  onOpenTask: (id: string) => void;
  onClose: () => void;
}) {
  const today = todayValue();
  const waiting = useMemo(() => tasks.filter((task) => task.waitingFollowUp), [tasks]);
  const recentlyReleased = useMemo(() => tasks.filter((task) => !task.waitingFollowUp && task.lastReleasedWaitingFollowUp), [tasks]);
  const waitingHistory = useMemo(() => tasks.flatMap((task) => (task.waitingHistory || []).map((entry) => ({ task, entry }))).sort((a, b) => b.entry.releasedAt.localeCompare(a.entry.releasedAt)), [tasks]);
  const [editingId, setEditingId] = useState(initialTaskId || "");
  const editingTask = tasks.find((task) => task.id === editingId);
  const existing = editingTask?.waitingFollowUp;
  const [kind, setKind] = useState<WaitingKind>(existing?.kind || "go");
  const [party, setParty] = useState(existing?.party || "");
  const [reviewDate, setReviewDate] = useState(existing?.reviewDate || "");
  const [memo, setMemo] = useState(existing?.memo || "");
  const [tab, setTab] = useState<"current" | "history">("current");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyKind, setHistoryKind] = useState<"all" | WaitingKind>("all");
  const [historyReason, setHistoryReason] = useState<"all" | "go" | "status-change">("all");
  const [deletingHistoryId, setDeletingHistoryId] = useState("");
  const [deleteWaitingConfirm, setDeleteWaitingConfirm] = useState(false);
  const notify = (text: string) => window.dispatchEvent(new CustomEvent("chattask-drop-notice", { detail: { text } }));

  const beginEdit = (task: Task) => {
    setDeleteWaitingConfirm(false);
    setEditingId(task.id); setKind(task.waitingFollowUp?.kind || "go"); setParty(task.waitingFollowUp?.party || "");
    setReviewDate(task.waitingFollowUp?.reviewDate || ""); setMemo(task.waitingFollowUp?.memo || "");
  };
  const save = () => {
    if (!editingTask) return;
    const waitingStatus = editingTask.status.startsWith("waiting-") ? editingTask.status : "waiting-general";
    const waitingReason = waitingStatus === "waiting-client" ? "client" : waitingStatus === "waiting-team" ? "team" : waitingStatus === "waiting-pr" ? "pr" : "other";
    onUpdateTask(editingTask.id, {
      waitingFollowUp: { kind, party: party.trim(), reviewDate, memo: memo.trim(), startedAt: existing?.startedAt || today, lastCheckedAt: existing?.lastCheckedAt },
      lastReleasedWaitingFollowUp: undefined, lastReleasedWaitingStatus: undefined,
      status: waitingStatus, progressStatus: "waiting", waitingReason,
    }, `待ち箱へ追加しました。次に見る日：${reviewDate || "未設定"}`);
    notify(`「${editingTask.title}」を待ち箱へ保存しました。`);
    setEditingId("");
  };
  const deleteWaitingRegistration = () => {
    if (!editingTask?.waitingFollowUp) return;
    onUpdateTask(editingTask.id, {
      waitingFollowUp: undefined,
      lastReleasedWaitingFollowUp: undefined,
      lastReleasedWaitingStatus: undefined,
      status: editingTask.status.startsWith("waiting-") || editingTask.status === "pending" ? "todo" : editingTask.status,
      progressStatus: editingTask.status.startsWith("waiting-") || editingTask.status === "pending" ? "not-started" : editingTask.progressStatus,
      waitingReason: "none",
    }, "誤って登録した待ち箱の情報を削除しました。");
    notify(`「${editingTask.title}」の待ち登録を削除しました。`);
    setDeleteWaitingConfirm(false);
    setEditingId("");
  };
  const reschedule = (task: Task, days: number) => {
    const nextDate = addDays(today, days);
    onUpdateTask(task.id, { waitingFollowUp: { ...task.waitingFollowUp!, reviewDate: nextDate } }, `次に見る日を${nextDate}へ変更しました。`);
    notify(`「${task.title}」の次回確認を${days === 1 ? "明日" : days === 3 ? "3日後" : "1週間後"}（${nextDate}）へ変更しました。`);
  };
  const checked = (task: Task) => {
    onUpdateTask(task.id, { waitingFollowUp: { ...task.waitingFollowUp!, lastCheckedAt: new Date().toISOString(), reviewDate: addDays(today, 3) } }, "確認メッセージを送信し、3日後にもう一度見る設定にしました。");
    notify(`「${task.title}」の確認送信を記録し、次回確認を3日後へ変更しました。`);
  };
  const release = (task: Task) => {
    onUpdateTask(task.id, {
      waitingFollowUp: undefined, lastReleasedWaitingFollowUp: task.waitingFollowUp, lastReleasedWaitingStatus: task.status,
      waitingHistory: task.waitingFollowUp ? [...(task.waitingHistory || []), { id: crypto.randomUUID(), followUp: task.waitingFollowUp, status: task.status, releasedAt: new Date().toISOString(), reason: "go" }] : task.waitingHistory,
      status: task.status.startsWith("waiting-") || task.status === "pending" ? "todo" : task.status,
      progressStatus: "not-started", waitingReason: "none",
    }, "GOが出たため待ち状態を解除しました。");
    notify(`「${task.title}」の待ちを解除しました。下部の「最近解除した待ち」から取り消せます。`);
  };
  const restore = (task: Task) => {
    if (!task.lastReleasedWaitingFollowUp) return;
    const status = task.lastReleasedWaitingStatus || "waiting-general";
    const waitingReason = status === "waiting-client" ? "client" : status === "waiting-team" ? "team" : status === "waiting-pr" ? "pr" : "other";
    onUpdateTask(task.id, {
      waitingFollowUp: task.lastReleasedWaitingFollowUp,
      lastReleasedWaitingFollowUp: undefined,
      lastReleasedWaitingStatus: undefined,
      status,
      progressStatus: "waiting",
      waitingReason,
    }, "誤って解除した待ち状態を復元しました。");
    notify(`「${task.title}」の待ち状態を復元しました。`);
  };

  const groups = [
    { key: "today", title: "今日、確認してもよい", items: waiting.filter((task) => task.waitingFollowUp!.reviewDate && task.waitingFollowUp!.reviewDate <= today) },
    { key: "week", title: "今週", items: waiting.filter((task) => task.waitingFollowUp!.reviewDate > today && task.waitingFollowUp!.reviewDate <= addDays(today, 7)) },
    { key: "later", title: "後で", items: waiting.filter((task) => task.waitingFollowUp!.reviewDate > addDays(today, 7)) },
    { key: "none", title: "次に見る日なし", items: waiting.filter((task) => !task.waitingFollowUp!.reviewDate) },
  ];
  const normalizedHistoryQuery = historyQuery.trim().toLocaleLowerCase("ja");
  const filteredWaitingHistory = waitingHistory.filter(({ task, entry }) => {
    if (historyKind !== "all" && entry.followUp.kind !== historyKind) return false;
    if (historyReason !== "all" && entry.reason !== historyReason) return false;
    return !normalizedHistoryQuery || [task.title, entry.followUp.party, entry.followUp.memo].some((value) => String(value || "").toLocaleLowerCase("ja").includes(normalizedHistoryQuery));
  });
  const deleteHistoryEntry = (task: Task, entryId: string) => {
    onUpdateTask(task.id, { waitingHistory: (task.waitingHistory || []).filter((entry) => entry.id !== entryId) }, "誤って登録した待ち履歴を削除しました。");
    setDeletingHistoryId("");
    notify(`「${task.title}」の待ち履歴を1件削除しました。`);
  };

  return <Modal title="待ち箱" onClose={onClose} wide>
    <div className="waiting-box">
      <header className="waiting-box-intro"><div><strong>相手を待っている作業</strong><p>確認日は期限ではなく、もう一度見てもよい日です。</p></div>{tab === "current" && <button className="primary" onClick={() => { const candidate = tasks.find((task) => !task.waitingFollowUp && task.status !== "done"); if (candidate) beginEdit(candidate); }}>＋ 待ち項目を追加</button>}</header>
      <nav className="waiting-box-tabs" aria-label="待ち箱の表示"><button className={tab === "current" ? "active" : ""} onClick={() => setTab("current")}>現在の待ち <small>{waiting.length}</small></button><button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>待ち履歴 <small>{waitingHistory.length}</small></button></nav>
      {tab === "current" ? <div className="waiting-box-groups">{groups.map((group) => <section key={group.key}><header><h3>{group.title}</h3><span>{group.items.length}件</span></header><div>{group.items.map((task) => {
        const info = task.waitingFollowUp!;
        const elapsed = Math.max(0, Math.floor((new Date(`${today}T00:00:00`).getTime() - new Date(`${info.startedAt}T00:00:00`).getTime()) / 86400000));
        return <article className={group.key === "today" ? "is-reviewable" : ""} key={task.id}>
          <div className="waiting-card-main"><small>{WAITING_LABELS[info.kind]}</small><button className="waiting-card-edit" onClick={() => beginEdit(task)} title="待ち情報を編集">{task.title}<span>編集 ›</span></button><p>{info.party ? `${info.party}を待っています` : "相手は未設定です"}・{elapsed}日間待機中</p>{info.memo && <em>{info.memo}</em>}<time>{info.reviewDate ? `次に見る日 ${info.reviewDate}` : "次に見る日は決めていません"}</time><button className="waiting-task-open" onClick={() => { onOpenTask(task.id); onClose(); }}>元のタスクを開く ↗</button></div>
          <div className="waiting-card-actions waiting-card-action-select"><label><span>操作</span><select value="" aria-label={`${task.title}の待ち操作`} onChange={(event) => { const action = event.target.value; if (action === "tomorrow") reschedule(task, 1); else if (action === "three-days") reschedule(task, 3); else if (action === "week") reschedule(task, 7); else if (action === "checked") checked(task); else if (action === "release") release(task); }}><option value="" disabled>操作を選択…</option><optgroup label="次に見る日"><option value="tomorrow">明日に変更</option><option value="three-days">3日後に変更</option><option value="week">1週間後に変更</option></optgroup><optgroup label="状況"><option value="checked">確認送信を記録</option><option value="release">GOが出た・待ちを解除</option></optgroup></select></label></div>
        </article>;
      })}{!group.items.length && <p className="waiting-empty">該当する待ち項目はありません。</p>}</div></section>)}
      {recentlyReleased.length > 0 && <section className="waiting-released-section"><header><h3>最近解除した待ち</h3><span>{recentlyReleased.length}件</span></header><div>{recentlyReleased.map((task) => { const info = task.lastReleasedWaitingFollowUp!; return <article key={task.id}><div className="waiting-card-main"><small>解除済み・{WAITING_LABELS[info.kind]}</small><strong>{task.title}</strong><p>{info.party ? `${info.party}を待っていました` : "相手は未設定でした"}</p>{info.memo && <em>{info.memo}</em>}</div><div className="waiting-card-actions"><button onClick={() => { onOpenTask(task.id); onClose(); }}>元のタスクを開く</button><button className="waiting-undo" onClick={() => restore(task)}>解除を取り消す</button></div></article>; })}</div></section>}
      </div> : <div className="waiting-history-pane"><div className="waiting-history-filters"><label className="waiting-history-search">検索<input type="search" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="タスク名・相手・メモ" /></label><label>待ちの種類<select value={historyKind} onChange={(event) => setHistoryKind(event.target.value as typeof historyKind)}><option value="all">すべて</option>{Object.entries(WAITING_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>解除理由<select value={historyReason} onChange={(event) => setHistoryReason(event.target.value as typeof historyReason)}><option value="all">すべて</option><option value="go">GOによる解除</option><option value="status-change">ステータス変更</option></select></label><button type="button" onClick={() => { setHistoryQuery(""); setHistoryKind("all"); setHistoryReason("all"); }}>条件をクリア</button></div><div className="waiting-box-groups"><section className="waiting-history-section"><header><h3>抽出結果</h3><span>{filteredWaitingHistory.length}件</span></header><div>{filteredWaitingHistory.map(({ task, entry }) => <article key={entry.id}><div className="waiting-card-main"><small>{entry.reason === "go" ? "GOによる解除" : "ステータス変更による解除"}・{WAITING_LABELS[entry.followUp.kind]}</small><strong>{task.title}</strong><p>{entry.followUp.party ? `${entry.followUp.party}を待機` : "相手未設定"}・{entry.followUp.startedAt}から</p>{entry.followUp.memo && <em>{entry.followUp.memo}</em>}<time>解除：{new Date(entry.releasedAt).toLocaleString("ja-JP")}</time></div><div className="waiting-card-actions">{deletingHistoryId === entry.id ? <div className="waiting-history-delete-confirm"><span>この履歴だけ削除しますか？</span><button onClick={() => setDeletingHistoryId("")}>戻る</button><button className="danger" onClick={() => deleteHistoryEntry(task, entry.id)}>削除を実行</button></div> : <><button onClick={() => { onOpenTask(task.id); onClose(); }}>元のタスクを開く</button><button className="danger-text" onClick={() => setDeletingHistoryId(entry.id)}>履歴を削除</button></>}</div></article>)}{!filteredWaitingHistory.length && <p className="waiting-empty">条件に一致する待ち履歴はありません。</p>}</div></section></div></div>}
    </div>
    {editingTask && <div className="waiting-editor-backdrop" onPointerDown={(event) => event.target === event.currentTarget && setEditingId("")}><section className="waiting-editor" role="dialog" aria-modal="true" aria-label="待ち項目を設定"><header><div><small>WAITING</small><h3>{editingTask.title}</h3></div><button onClick={() => setEditingId("")}>×</button></header><div className="waiting-editor-fields"><label>待っているもの<select value={kind} onChange={(event) => setKind(event.target.value as WaitingKind)}>{Object.entries(WAITING_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>相手<input value={party} onChange={(event) => setParty(event.target.value)} placeholder="例：田中さん、取引先" /></label><label>次に見る日<WorkDatePicker ariaLabel="次に見る日" value={reviewDate} onChange={setReviewDate} /></label><div className="waiting-date-shortcuts"><button onClick={() => setReviewDate(addDays(today, 1))}>明日</button><button onClick={() => setReviewDate(addDays(today, 3))}>3日後</button><button onClick={() => setReviewDate(addDays(today, 7))}>1週間後</button><button onClick={() => setReviewDate("")}>決めない</button></div><label>メモ<textarea rows={3} value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="何を待っているか、GO後にすることなど" /></label></div><footer>{existing && (deleteWaitingConfirm ? <div className="waiting-editor-delete-confirm"><span>この待ち登録を削除しますか？</span><button onClick={() => setDeleteWaitingConfirm(false)}>戻る</button><button className="danger" onClick={deleteWaitingRegistration}>削除を実行</button></div> : <button className="danger-text waiting-editor-delete" onClick={() => setDeleteWaitingConfirm(true)}>待ち登録を削除</button>)}<span className="waiting-editor-footer-spacer" /><button onClick={() => setEditingId("")}>キャンセル</button><button className="primary" onClick={save}>待ち箱へ保存</button></footer></section></div>}
  </Modal>;
}
