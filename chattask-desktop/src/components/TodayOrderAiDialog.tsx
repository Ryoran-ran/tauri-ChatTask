import { useEffect, useId, useState } from "react";
import {
  buildTodayOrderConsultationPrompt, buildTodayOrderFilePrompt, collectTodayOrderAiSupplementTargets, parseTodayOrderAiDraft,
  parseTodayOrderAiPlan, resolveTodayOrderAiUnits, todayOrderAiRequestId, validateTodayOrderAiPlan,
  type TodayOrderAiAdvice, type TodayOrderAiPlan, type TodayOrderAiProposedGroup, type TodayOrderAiRequest, type TodayOrderAiSnapshot, type TodayOrderAiTab,
} from "../services/todayOrderAi";
import { Modal } from "./Modal";

interface Props {
  snapshot: TodayOrderAiSnapshot;
  disabled: boolean;
  onApply: (plan: TodayOrderAiPlan, request: TodayOrderAiRequest) => string | null;
  onClose: () => void;
}

const draftKey = (date: string) => {
  let environment = "production";
  try { if (localStorage.getItem("chatTaskActiveEnvironment") === "test") environment = "test"; } catch { /* use default */ }
  return `chatTaskTodayOrderAiDraft:${environment}:${date}`;
};
const loadDraft = (key: string) => {
  try { return parseTodayOrderAiDraft(localStorage.getItem(key)); }
  catch { return parseTodayOrderAiDraft(null); }
};
const TABS: { id: TodayOrderAiTab; label: string }[] = [
  { id: "consult", label: "1. 相談" },
  { id: "file", label: "2. JSON作成" },
  { id: "review", label: "3. 取り込み・確認" },
];

export function TodayOrderAiGroupingPreview({ groups, snapshot }: { groups: TodayOrderAiProposedGroup[]; snapshot: TodayOrderAiSnapshot }) {
  if (!groups.length) return null;
  const units = new Map(snapshot.units.map(unit => [unit.id, unit]));
  return <section className="today-order-ai-grouping-preview">
    <h5>新しくまとめるグループ</h5>
    {groups.map(group => <article key={group.proposalId}>
      <strong>{group.name}</strong><p>{group.reason}</p>
      <ul>{group.unitIds.map(id => {
        const unit = units.get(id)!;
        return <li key={id}>{unit.title}{unit.grouped && <small>（既存グループの中の作業をまとめて移動）</small>}</li>;
      })}</ul>
    </article>)}
    <p>上記のグループ化と対応順を一緒に反映します。グループは同じ階層に並びます。</p>
  </section>;
}

export function TodayOrderAiDialog({ snapshot, disabled, onApply, onClose }: Props) {
  const [storageKey] = useState(() => draftKey(snapshot.date));
  const [restored] = useState(() => loadDraft(storageKey));
  const [tab, setTab] = useState<TodayOrderAiTab>(restored.tab);
  const tabId = useId();
  const [availableHours, setAvailableHours] = useState(restored.availableHours);
  const [supplementary, setSupplementary] = useState(restored.supplementary);
  const [taskSupplements, setTaskSupplements] = useState(restored.taskSupplements);
  const [responseText, setResponseText] = useState(restored.responseText);
  const snapshotJson = JSON.stringify(snapshot);
  const [baselineSnapshot, setBaselineSnapshot] = useState(restored.snapshotJson || snapshotJson);
  const [review, setReview] = useState<{ plan: TodayOrderAiPlan; requestId: string; source: string } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const stale = baselineSnapshot !== snapshotJson;
  const hours = availableHours.trim() ? Number(availableHours) : null;
  const hoursValid = hours === null || (Number.isFinite(hours) && hours >= 0 && hours <= 24);
  const supplementTargets = collectTodayOrderAiSupplementTargets(snapshot);
  const request: TodayOrderAiRequest = { snapshot, availableHours: hours, supplementary, taskSupplements };
  const requestId = todayOrderAiRequestId(request);
  const consultationPrompt = buildTodayOrderConsultationPrompt(request);
  const filePrompt = buildTodayOrderFilePrompt(request);
  const fileReady = hoursValid && !stale && snapshot.units.length > 0;
  const reviewedPlan = review?.requestId === requestId && review.source === responseText && !stale ? review.plan : null;
  const previewUnits = reviewedPlan ? resolveTodayOrderAiUnits(snapshot, reviewedPlan.groups) : snapshot.units;
  const units = new Map(previewUnits.map(unit => [unit.id, { unit, index: snapshot.units.findIndex(original => original.id === unit.id) }]));

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, tab, availableHours, supplementary, taskSupplements, responseText, snapshotJson: baselineSnapshot }));
    } catch { /* The consultation also works when draft storage is unavailable. */ }
  }, [tab, availableHours, supplementary, taskSupplements, responseText, baselineSnapshot, storageKey]);

  const changeTab = (next: TodayOrderAiTab) => {
    setTab(next); setError(""); setMessage("");
  };

  const restart = () => {
    setBaselineSnapshot(snapshotJson); setResponseText(""); setReview(null); setError(""); setMessage("");
    setTab("consult");
  };
  const copyPrompt = async (kind: "consult" | "file") => {
    setError(""); setMessage("");
    try {
      await navigator.clipboard.writeText(kind === "consult" ? consultationPrompt : filePrompt);
      if (kind === "consult" && stale) restart();
      setMessage(kind === "consult" ? "相談用プロンプトをコピーしました。AIチャットに貼り付けて相談してください。" : "ファイル作成用プロンプトをコピーしました。確定した相談と同じAIチャットに貼り付けてください。");
    } catch {
      setError("コピーできませんでした。「プロンプトを表示」からテキストを選択してコピーしてください。");
    }
  };
  const preview = (source = responseText) => {
    setError(""); setMessage(""); setReview(null);
    try {
      if (stale) throw new Error("予定が変わっています。最新の予定で相談し直してください。");
      const plan = parseTodayOrderAiPlan(source);
      validateTodayOrderAiPlan(plan, request);
      setReview({ plan, requestId, source });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "提案を確認できませんでした。"); }
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const source = await file.text();
      setResponseText(source); preview(source);
    } catch { setError("ファイルを読み取れませんでした。JSONの内容を貼り付けてください。"); }
  };
  const apply = () => {
    if (!reviewedPlan || disabled || !fileReady) return;
    const result = onApply(reviewedPlan, request);
    if (result) setError(result);
  };
  const previewList = (items: TodayOrderAiAdvice[], offset: number) => <ol start={offset + 1} className="today-order-ai-preview-list">{items.map((item, index) => {
    const entry = units.get(item.unitId)!;
    return <li key={item.unitId}>
      <header><b>{offset + index + 1}. {entry.unit.title}</b><small>{entry.index < 0 ? "新規グループ" : `現在 ${entry.index + 1}番目${entry.unit.grouped ? "・グループ" : ""}`}</small></header>
      {entry.unit.grouped && <ul>{entry.unit.items.map(work => <li key={work.id}>{work.title}</li>)}</ul>}
      <p>{item.reason}</p>{item.firstStep && <p className="today-order-ai-first-step">最初の一歩：{item.firstStep}</p>}
    </li>;
  })}</ol>;

  return <Modal title="AIに着手順を相談" onClose={onClose} wide>
    <div className="today-order-ai">
      <p className="today-order-ai-intro">{snapshot.date}の対応順を、普段使っているAIチャットで相談します。補足情報と取り込み用JSONはこの端末に保存されます。</p>
      <details className="today-order-ai-targets"><summary>相談する予定：{snapshot.units.length}項目・{snapshot.units.reduce((sum, unit) => sum + unit.items.length, 0)}件の作業</summary>
        <ol>{snapshot.units.map(unit => <li key={unit.id}><strong>{unit.title}</strong>{unit.grouped && <span>（グループ）</span>}<ul>{unit.items.map(work => <li key={work.id}>{work.title} · 予定 {work.plannedHours === null ? "工数未設定" : `${work.plannedHours}h`} · {work.status}</li>)}</ul></li>)}</ol>
        {Boolean(snapshot.tasks?.length) && <details className="today-order-ai-task-contexts">
          <summary>AIに渡すTask情報（{snapshot.tasks!.length}件）</summary>
          {snapshot.tasks!.map(task => <article key={task.id}>
            <strong>{task.title}</strong>
            <small>{task.status} · {task.progressStatus} · 優先度 {task.priority} · {task.tag} · 期限 {task.dueDate || "未設定"}</small>
            {task.description && <p>{task.description}</p>}
            {task.nextAction && <p>次のアクション：{task.nextAction}</p>}
            {task.waitingFollowUp && <p>待ち相手：{task.waitingFollowUp.party || "未設定"} · {task.waitingFollowUp.memo}</p>}
            {task.parentTasks.length > 0 && <small>上位Task：{task.parentTasks.map(parent => parent.title).join(" › ")}</small>}
            {task.relatedTasks.length > 0 && <small>関連Task：{task.relatedTasks.map(related => related.title).join("、")}</small>}
          </article>)}
        </details>}
        <p>現在の対応順が対象です。一時待ち・順番未設定の作業を相談に含めるには、先に対応順へ戻してください。</p>
      </details>
      {stale && <div className="today-order-ai-notice" role="status">相談後に予定や対応順が変わりました。最新の相談用プロンプトで相談し直してください。<button type="button" onClick={restart}>最新の予定で相談し直す</button></div>}
      {disabled && <p className="today-order-ai-notice">確定済みの日や非稼働日には対応順を反映できません。</p>}

      <div className="today-order-ai-tabs" role="tablist" aria-label="AI相談の手順">
        {TABS.map((item, index) => <button type="button" key={item.id} id={`${tabId}-${item.id}-tab`} role="tab" aria-selected={tab === item.id} aria-controls={`${tabId}-${item.id}-panel`} tabIndex={tab === item.id ? 0 : -1}
          onClick={() => changeTab(item.id)} onKeyDown={event => {
            let nextIndex: number;
            if (event.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
            else if (event.key === "ArrowLeft") nextIndex = (index + TABS.length - 1) % TABS.length;
            else if (event.key === "Home") nextIndex = 0;
            else if (event.key === "End") nextIndex = TABS.length - 1;
            else return;
            event.preventDefault();
            changeTab(TABS[nextIndex].id);
            document.getElementById(`${tabId}-${TABS[nextIndex].id}-tab`)?.focus();
          }}>{item.label}</button>)}
      </div>

      <section className="today-order-ai-step" id={`${tabId}-consult-panel`} role="tabpanel" aria-labelledby={`${tabId}-consult-tab`} hidden={tab !== "consult"} tabIndex={0}>
        <h3>1. 補足を入力して相談する</h3>
        <label>今日、この後に使える時間（任意）<div className="today-order-ai-hours"><input type="number" min="0" max="24" step="0.25" value={availableHours} onChange={event => { setAvailableHours(event.target.value); setMessage(""); }} placeholder="例：3" />時間</div></label>
        {!hoursValid && <p className="today-order-ai-error">利用可能時間は0〜24時間で入力してください。</p>}
        <fieldset className="today-order-ai-task-supplements">
          <legend>タスクごとの補足情報（任意）</legend>
          <p>同じタスクの作業は補足を共有します。AI相談用の補足で、登録済みのタスクの説明や作業メモは変更しません。</p>
          {supplementTargets.map((target, index) => <label key={target.taskId} htmlFor={`${tabId}-supplement-${index}`}>
            <strong>{target.title}</strong>
            <small>対象作業：{target.workTitles.join("、")}</small>
            <textarea id={`${tabId}-supplement-${index}`} rows={3} value={typeof taskSupplements[target.taskId] === "string" ? taskSupplements[target.taskId] : ""}
              onChange={event => { const value = event.target.value; setTaskSupplements(previous => ({ ...previous, [target.taskId]: value })); setMessage(""); }}
              placeholder="このタスクの約束・期限、先に必要な確認、気になっていることなど" />
          </label>)}
          {!supplementTargets.length && <p>現在の対応順に相談対象のタスクはありません。</p>}
        </fieldset>
        <details className="today-order-ai-common-notes" open={supplementary.trim() ? true : undefined}>
          <summary>全体の補足（任意）</summary>
          <textarea rows={2} aria-label="全体の補足" value={supplementary} onChange={event => { setSupplementary(event.target.value); setMessage(""); }} placeholder="動かせない予定、今の集中力など、全タスクに共通すること" />
        </details>
        <p>相談用プロンプトをAIに貼り付け、着手順や、まとめて進められる作業のグループ化を相談します。順番・グループ名・対象・理由に納得できたら、同じチャットの最後にファイル作成用プロンプトを貼り付けます。</p>
        <button type="button" className="primary" disabled={!hoursValid || !snapshot.units.length} onClick={() => void copyPrompt("consult")}>相談用プロンプトをコピー</button>
        <details><summary>相談用プロンプトを表示</summary><textarea readOnly aria-label="相談用プロンプト" rows={8} value={consultationPrompt} /></details>
        <footer className="today-order-ai-navigation"><button type="button" onClick={() => changeTab("file")}>ファイル出力の指示へ →</button></footer>
      </section>

      <section className="today-order-ai-step" id={`${tabId}-file-panel`} role="tabpanel" aria-labelledby={`${tabId}-file-tab`} hidden={tab !== "file"} tabIndex={0}>
        <h3>2. 会話の最後にファイル出力を依頼する</h3>
        <p>着手順やグループ化の相談がまとまったら、下のプロンプトを相談していた同じAIチャットの最後に貼り付けてください。会話で最後に合意した内容から、JSONファイルを作成します。</p>
        <p>サマリーをここに貼り付ける必要はありません。未確定の点があれば、AIとの会話で確認してから出力を依頼してください。</p>
        <button type="button" className="primary" disabled={!fileReady} onClick={() => void copyPrompt("file")}>ファイル作成用プロンプトをコピー</button>
        {fileReady && <details><summary>ファイル作成用プロンプトを表示</summary><textarea readOnly aria-label="ファイル作成用プロンプト" rows={8} value={filePrompt} /></details>}
        <footer className="today-order-ai-navigation"><button type="button" onClick={() => changeTab("consult")}>← 相談へ</button><button type="button" onClick={() => changeTab("review")}>JSONの取り込みへ →</button></footer>
      </section>

      <section className="today-order-ai-step" id={`${tabId}-review-panel`} role="tabpanel" aria-labelledby={`${tabId}-review-tab`} hidden={tab !== "review"} tabIndex={0}>
        <h3>3. 提案を確認して反映する</h3>
        {!fileReady && <p className="today-order-ai-notice">「相談」タブで利用可能時間と最新の予定を確認してください。相談後は「JSON作成」タブのプロンプトを同じAIチャットへ貼り付け、JSONを作成してください。</p>}
        <label className="today-order-ai-file">AIが作ったJSONファイル<input type="file" accept=".json,application/json" disabled={!fileReady} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void importFile(file); }} /></label>
        <label>またはJSONを貼り付け<textarea rows={5} value={responseText} onChange={event => { setResponseText(event.target.value); setReview(null); setError(""); }} placeholder="JSONまたはJSONコードブロック全体を貼り付け" /></label>
        <button type="button" disabled={!fileReady || !responseText.trim()} onClick={() => preview()}>内容を確認</button>
        {review && !reviewedPlan && <p className="today-order-ai-notice">入力内容が変わりました。最新のプロンプトで作成したJSONを再確認してください。</p>}
        {reviewedPlan && <div className="today-order-ai-preview">
          <h4>反映する対応順</h4><p>{reviewedPlan.summary}</p>
          <TodayOrderAiGroupingPreview groups={reviewedPlan.groups || []} snapshot={snapshot} />
          {reviewedPlan.order.length > 0 && <><h5>着手する順番</h5>{previewList(reviewedPlan.order, 0)}</>}
          {reviewedPlan.later.length > 0 && <><h5>後回し（対応順の末尾）</h5>{previewList(reviewedPlan.later, reviewedPlan.order.length)}</>}
          <p>{reviewedPlan.groups?.length ? "提案されたグループ化と対応順を変更します。" : "対応順だけを変更します。"}後回しの作業も本日の対応順に残ります。</p>
          <button type="button" className="primary" disabled={disabled || !fileReady} onClick={apply}>{reviewedPlan.groups?.length ? "グループ化と対応順を反映" : "この対応順を反映"}</button>
        </div>}
        <footer className="today-order-ai-navigation"><button type="button" onClick={() => changeTab("file")}>← JSON作成へ</button></footer>
      </section>
      <div className="today-order-ai-feedback" aria-live="polite">{message && <p role="status">{message}</p>}{error && <p className="today-order-ai-error" role="alert">{error}</p>}</div>
    </div>
  </Modal>;
}
