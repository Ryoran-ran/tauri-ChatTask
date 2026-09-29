import { Fragment, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { assessProjectDailyCapacity, assessProjectWorkCapacity, type WorkCapacityAssessment } from "../projectCapacity";
import { ProjectDailyLoad } from "./ProjectDailyLoad";
import type { Goal, GoalMilestone, NonWorkingPeriod, ProjectWorkItem } from "../types";
import { addDays, getNonWorkingPeriod, rangeDates, todayValue } from "../utils";
import { WorkDatePicker } from "./WorkDatePicker";
import { ProjectTargetLine } from "./ProjectTargetLine";
import { ProjectScheduleDeadline } from "./ProjectScheduleDeadline";
import { MilestoneTargetMenu } from "./MilestoneTargetMenu";
import { ScheduleHistoryMenu } from "./ScheduleHistoryMenu";
import { BatchScheduleMoveDialog } from "./BatchScheduleMoveDialog";
import type { MoveScheduleWorks } from "../projectScheduleBatchMove";
import { sameStartScheduleWorks } from "../projectScheduleOrder";
import { projectScheduleVisibility } from "../projectScheduleVisibility";
import { ProjectWorkDateSyncButton, WorkDateSyncStatus } from "./WorkDateSyncButton";
import type { SyncWorkDates } from "../projectWorkDateSync";
import { calculateScheduleDrag, visibleScheduleRange, type ScheduleDragMode, type ScheduleRange } from "../projectScheduleDrag";
import { buildProjectScheduleAiPrompt, PROJECT_SCHEDULE_AI_MODE_LABELS, type ProjectScheduleAiMode } from "../services/projectScheduleAi";
import { Modal } from "./Modal";

const DAY_WIDTH = 30;
const LABEL_WIDTH = 320;
const statusLabel: Record<WorkCapacityAssessment["status"], string> = {
  unset: "期間未設定",
  invalid: "期間を確認",
  completed: "完了",
  comfortable: "余裕あり",
  feasible: "実行可能",
  tight: "余裕わずか",
  over: "工数超過",
};
const hours = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)}h`;

const SHOW_COMPLETED_KEY = "chatTaskScheduleShowCompleted";

interface ScheduleDraft {
  projectId: string;
  kind: "work" | "milestone";
  id: string;
  pointerId: number;
  mode: ScheduleDragMode;
  anchorX: number;
  original: ScheduleRange;
  storedStart?: string;
  storedEnd?: string;
  range: ScheduleRange;
  error?: string;
}

export function ProjectSchedulePlanner({
  project,
  projects,
  periods,
  dailyCapacityHours,
  onDailyCapacityHoursChange,
  onAddMilestone,
  onEditMilestone,
  onAddWork,
  onEditWork,
  onUpdateMilestone,
  onUpdateWork,
  onReorderWork,
  onSyncWorkDates,
  showSyncSuccessNotice = true,
  onMoveScheduleWorks,
  onOpenHistory,
}: {
  project: Goal;
  projects: Goal[];
  periods: NonWorkingPeriod[];
  dailyCapacityHours: number;
  onDailyCapacityHoursChange: (hours: number) => void;
  onAddMilestone: () => void;
  onEditMilestone: (id: string) => void;
  onAddWork: (milestoneId: string) => void;
  onEditWork: (id: string) => void;
  onUpdateMilestone: (id: string, changes: Partial<GoalMilestone>) => void;
  onUpdateWork: (id: string, changes: Partial<ProjectWorkItem>) => void;
  onReorderWork: (id: string, direction: -1 | 1, includeCompleted?: boolean) => void;
  onSyncWorkDates: SyncWorkDates;
  showSyncSuccessNotice?: boolean;
  onMoveScheduleWorks?: MoveScheduleWorks;
  onOpenHistory?: () => void;
}) {
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const dragRef = useRef<ScheduleDraft | null>(null);
  const [dragError, setDragError] = useState("");
  const [movingMilestoneId, setMovingMilestoneId] = useState<string | null>(null);
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const [aiMode, setAiMode] = useState<ProjectScheduleAiMode>("initial-plan");
  const [aiConstraints, setAiConstraints] = useState("");
  const [aiCopyStatus, setAiCopyStatus] = useState<"" | "copied" | "error">("");
  const cancelDrag = () => { dragRef.current = null; setDraft(null); };
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [showCompleted, setShowCompleted] = useState(() => {
    try { return localStorage.getItem(SHOW_COMPLETED_KEY) === "true"; } catch { return false; }
  });
  const toggleCompleted = (show: boolean) => {
    cancelDrag();
    setShowCompleted(show);
    try { localStorage.setItem(SHOW_COMPLETED_KEY, String(show)); } catch { /* 保存不可でも画面内では切り替え可能 */ }
  };
  const [dailyHoursInput, setDailyHoursInput] = useState(() => String(dailyCapacityHours));
  useEffect(() => { setDailyHoursInput(String(dailyCapacityHours)); }, [dailyCapacityHours]);
  const commitDailyHours = () => {
    const parsed = Number(dailyHoursInput);
    const next = Number.isFinite(parsed) && parsed > 0
      ? Math.min(24, Math.max(0.25, parsed))
      : dailyCapacityHours;
    setDailyHoursInput(String(next));
    if (next !== dailyCapacityHours) onDailyCapacityHoursChange(next);
  };
  const { groups, hiddenMilestoneCount, hiddenWorkCount } = useMemo(() => projectScheduleVisibility(project, showCompleted), [project, showCompleted]);
  // 絞り込みを切り替えても自動範囲や保存済みの期間は変更しない。
  const allWorks = project.workItems || [];
  const automaticWindow = useMemo(() => {
    const values = [
      todayValue(), project.dueDate,
      ...project.milestones.flatMap((milestone) => [milestone.targetWorkStartDate || "", milestone.targetWorkEndDate || "", milestone.dueDate || ""]),
      ...allWorks.flatMap((work) => [work.targetWorkStartDate || "", work.targetWorkEndDate || "", work.dueDate || ""]),
    ].filter(Boolean).sort();
    const start = addDays(values[0] || todayValue(), -3);
    const latest = values[values.length - 1] || addDays(start, 41);
    const end = addDays(latest < addDays(start, 41) ? addDays(start, 41) : latest, 3);
    return { start, end };
  }, [allWorks, project.dueDate, project.milestones]);
  const [viewStart, setViewStart] = useState(automaticWindow.start);
  const [viewEnd, setViewEnd] = useState(automaticWindow.end);
  const dates = useMemo(() => rangeDates([{ id: "project-capacity-window", startDate: viewStart, endDate: viewEnd }], 730), [viewEnd, viewStart]);
  const dateIndex = useMemo(() => new Map(dates.map((date, index) => [date, index])), [dates]);
  const dailyLoad = useMemo(() => assessProjectDailyCapacity({ projects, periods, dates, dailyCapacityHours, currentProjectId: project.id }), [projects, periods, dates, dailyCapacityHours, project.id]);
  const shiftWindow = (days: number) => {
    setViewStart((current) => addDays(current, days));
    setViewEnd((current) => addDays(current, days));
  };
  const showToday = () => {
    const start = addDays(todayValue(), -3);
    setViewStart(start);
    setViewEnd(addDays(start, 44));
  };

  const pointerX = (event: ReactPointerEvent<HTMLDivElement>) => event.clientX - event.currentTarget.getBoundingClientRect().left;
  const begin = (kind: ScheduleDraft["kind"], item: ProjectWorkItem | GoalMilestone, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dates.length || event.button !== 0 || dragRef.current) return;
    const x = pointerX(event);
    const date = dates[Math.max(0, Math.min(dates.length - 1, Math.floor(x / DAY_WIDTH)))];
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-schedule-drag]") : null;
    const mode = (target?.dataset.scheduleDrag || "draw") as ScheduleDragMode;
    if (mode !== "draw" && (!item.targetWorkStartDate || !item.targetWorkEndDate)) return;
    const original = mode === "draw" ? { start: date, end: date } : { start: item.targetWorkStartDate!, end: item.targetWorkEndDate! };
    const next: ScheduleDraft = { projectId: project.id, kind, id: item.id, pointerId: event.pointerId, mode, anchorX: x, original,
      storedStart: item.targetWorkStartDate, storedEnd: item.targetWorkEndDate, range: original };
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragError("");
    dragRef.current = next;
    setDraft(next);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const x = pointerX(event);
    const delta = current.mode === "draw"
      ? Math.max(0, Math.min(dates.length - 1, Math.floor(x / DAY_WIDTH))) - Math.floor(current.anchorX / DAY_WIDTH)
      : Math.round((x - current.anchorX) / DAY_WIDTH);
    const result = calculateScheduleDrag(current.mode, current.original, delta, periods);
    // 成功時には前のエラーを残さない。PointerUpでもこの最新値を使う。
    const next = { ...current, range: result.range, error: result.error };
    dragRef.current = next;
    setDraft(next);
  };
  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    move(event);
    const current = dragRef.current!;
    cancelDrag();
    if (current.error) { setDragError(current.error); return; }
    const latest = current.kind === "work" ? project.workItems?.find((work) => work.id === current.id) : project.milestones.find((milestone) => milestone.id === current.id);
    if (project.id !== current.projectId || !latest || latest.targetWorkStartDate !== current.storedStart || latest.targetWorkEndDate !== current.storedEnd) {
      setDragError("操作中に目標期間が変更されたため保存しませんでした。もう一度操作してください。");
      return;
    }
    if (current.range.start === current.storedStart && current.range.end === current.storedEnd) return;
    const changes = { targetWorkStartDate: current.range.start, targetWorkEndDate: current.range.end };
    if (current.kind === "work") onUpdateWork(current.id, changes);
    else onUpdateMilestone(current.id, changes);
  };
  const drawnRange = (kind: ScheduleDraft["kind"], item: ProjectWorkItem | GoalMilestone) => {
    const active = draft?.kind === kind && draft.id === item.id;
    const range = active ? draft.range : item.targetWorkStartDate && item.targetWorkEndDate ? { start: item.targetWorkStartDate, end: item.targetWorkEndDate } : null;
    const visible = visibleScheduleRange(range, dates);
    return visible ? { ...visible, draft: active } : null;
  };
  const updateStart = (work: ProjectWorkItem, targetWorkStartDate: string) => onUpdateWork(work.id, {
    targetWorkStartDate,
    ...(!targetWorkStartDate
      ? { targetWorkEndDate: "" }
      : work.targetWorkEndDate && work.targetWorkEndDate < targetWorkStartDate
        ? { targetWorkEndDate: targetWorkStartDate }
        : {}),
  });
  const scheduleHelp = "空白をなぞって期間を設定します。線の中央は営業日数を保って移動し、両端は開始・終了日を変更します。◆は期限日の終わりです。";
  const hiddenCompletedLabel = !showCompleted && (hiddenWorkCount || hiddenMilestoneCount)
    ? `（作業 ${hiddenWorkCount}・マイルストーン ${hiddenMilestoneCount}）`
    : "";
  const aiPrompt = useMemo(() => buildProjectScheduleAiPrompt({
    project, projects, periods, dailyCapacityHours, mode: aiMode, constraints: aiConstraints, today: todayValue(),
  }), [aiConstraints, aiMode, dailyCapacityHours, periods, project, projects]);
  const copyAiPrompt = async () => {
    try {
      await navigator.clipboard.writeText(aiPrompt);
      setAiCopyStatus("copied");
    } catch {
      setAiCopyStatus("error");
    }
  };
  return <section className="project-capacity-planner is-work-planner" onKeyDown={(event) => { if (event.key === "Escape" && dragRef.current) { event.stopPropagation(); cancelDrag(); } }}>
    <header className="project-capacity-heading">
      <div className="project-capacity-heading-title"><strong>作業スケジュール</strong><span className="project-capacity-help" tabIndex={0} aria-label={scheduleHelp} title="操作方法">i<span aria-hidden="true">{scheduleHelp}</span></span></div>
      <ProjectWorkDateSyncButton key={project.id} project={project} onSync={onSyncWorkDates} showSuccessNotice={showSyncSuccessNotice} />
      <button type="button" className="project-schedule-ai-button" onClick={() => { cancelDrag(); setAiCopyStatus(""); setAiPromptOpen(true); }}>AIに相談</button>
      <button type="button" className="project-capacity-add-milestone" onClick={onAddMilestone}>＋ マイルストーン</button>
      <label>1日の計画可能時間<input type="number" min="0.25" max="24" step="0.25" value={dailyHoursInput} onChange={(event) => setDailyHoursInput(event.target.value)} onBlur={commitDailyHours} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /><span>時間</span></label>
      {onOpenHistory && <ScheduleHistoryMenu onOpen={() => { cancelDrag(); onOpenHistory(); }} />}
    </header>
    <div className="project-capacity-period-toolbar">
      <div className="project-capacity-range-fields"><strong>表示期間</strong><WorkDatePicker ariaLabel="表示期間の開始日" value={viewStart} max={viewEnd} showNonWorkingStatus={false} onChange={(value) => { if (!value) return; setViewStart(value); if (value > viewEnd) setViewEnd(addDays(value, 44)); }} /><span>〜</span><WorkDatePicker ariaLabel="表示期間の終了日" value={viewEnd} min={viewStart} showNonWorkingStatus={false} onChange={(value) => { if (value) setViewEnd(value); }} /></div>
      <div className="project-capacity-toolbar-actions">
        <label className="project-schedule-completed-toggle" title={hiddenCompletedLabel ? `非表示中：作業 ${hiddenWorkCount}件・マイルストーン ${hiddenMilestoneCount}件` : undefined}><input type="checkbox" checked={showCompleted} onChange={event => toggleCompleted(event.target.checked)} />完了済みを表示{hiddenCompletedLabel && <span>{hiddenCompletedLabel}</span>}</label>
        <div className="project-capacity-range-actions"><button type="button" onClick={() => shiftWindow(-28)}>← 4週</button><button type="button" onClick={showToday}>今日</button><button type="button" onClick={() => shiftWindow(28)}>4週 →</button><button type="button" onClick={() => { setViewStart(automaticWindow.start); setViewEnd(automaticWindow.end); }}>自動範囲</button></div>
      </div>
    </div>
    {!groups.length && <p className="project-capacity-empty">{hiddenWorkCount || hiddenMilestoneCount ? "表示対象の項目はありません。「完了済みを表示」で再表示できます。" : "作業項目を追加すると、ここで目標作業期間を線として設定できます。"}</p>}
    <div className="project-capacity-scroll">
        <div className="project-capacity-grid" style={{ width: LABEL_WIDTH + dates.length * DAY_WIDTH }}>
          <div className="project-capacity-label-head">マイルストーン / 作業</div>
          <div className="project-capacity-calendar-head" style={{ gridTemplateColumns: `repeat(${dates.length}, ${DAY_WIDTH}px)` }}>
            {dates.map((date) => {
              const day = new Date(`${date}T00:00:00Z`).getUTCDay();
              const nonWorking = Boolean(getNonWorkingPeriod(date, periods));
              return <span key={date} className={`${nonWorking ? "is-non-working" : ""} ${date === todayValue() ? "is-today" : ""}`}><small>{["日", "月", "火", "水", "木", "金", "土"][day]}</small><b>{Number(date.slice(8, 10))}</b>{Number(date.slice(8, 10)) === 1 && <em>{Number(date.slice(5, 7))}月</em>}</span>;
            })}
          </div>
          <div className="project-daily-load-label"><strong>日別の負荷（全プロジェクト）</strong><span>予定 ／ 確保（h）　<span className="project-daily-load-legend">赤：超過</span>・?：工数未入力</span></div>
          <ProjectDailyLoad days={dailyLoad.days} dayWidth={DAY_WIDTH} />
          {groups.map((group) => {
            const groupDueIndex = group.dueDate ? dateIndex.get(group.dueDate) : undefined;
            const groupHours = group.works.filter((work) => work.status !== "done").reduce((sum, work) => sum + (Number(work.plannedHours) || 0), 0);
            const collapsed = collapsedGroups.has(group.id);
            const drawnMilestone = group.milestone && drawnRange("milestone", group.milestone);
            return <Fragment key={group.id}>
              <div className="project-capacity-group-label">
                <button type="button" className="project-capacity-tree-toggle" aria-label={collapsed ? `${group.title}を展開` : `${group.title}を折りたたむ`} aria-expanded={!collapsed} onClick={() => setCollapsedGroups((current) => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}>{collapsed ? "▶" : "▼"}</button>
                <span className={`project-capacity-group-kind is-${group.kind}`}>{group.kind === "milestone" ? "◆" : "◫"}</span>
                <span className="project-capacity-group-text"><strong>{group.title}</strong><small>{group.works.length < group.totalWorkCount ? `表示 ${group.works.length} / 全${group.totalWorkCount}件` : `${group.works.length}件`}・未完了予定 {hours(groupHours)}{group.dueDate ? `・期限 ${group.dueDate}` : ""}{group.milestone?.targetWorkStartDate && group.milestone.targetWorkEndDate ? `・目標 ${group.milestone.targetWorkStartDate.slice(5).replace("-", "/")}〜${group.milestone.targetWorkEndDate.slice(5).replace("-", "/")}` : ""}</small></span>
                {group.milestone && <div className="project-capacity-group-actions">
                  <button type="button" className="project-capacity-edit-milestone" onClick={() => onEditMilestone(group.milestone!.id)}><span aria-hidden="true">✎</span> 編集</button>
                  <button type="button" className="project-capacity-add-work" onClick={() => onAddWork(group.id)}>＋ 作業</button>
                  <MilestoneTargetMenu key={`${project.id}:${group.id}`} milestone={group.milestone} onClear={changes => { cancelDrag(); onUpdateMilestone(group.id, changes); }} onMoveWorks={onMoveScheduleWorks ? () => { cancelDrag(); setMovingMilestoneId(group.id); } : undefined} />
                </div>}
              </div>
              <div className={`project-capacity-group-lane ${group.milestone ? "is-drawable" : ""}`} style={{ width: dates.length * DAY_WIDTH }} tabIndex={group.milestone ? 0 : undefined} onPointerDown={group.milestone ? (event) => begin("milestone", group.milestone!, event) : undefined} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} aria-label={group.milestone ? `${group.title}の大まかな目標期間。中央で移動、両端で伸縮、空白で新規設定` : undefined}>
                {drawnMilestone && <ProjectTargetLine {...drawnMilestone} dayWidth={DAY_WIDTH} className={`project-milestone-target-line ${drawnMilestone.draft ? "is-draft" : ""}`} />}
                {group.milestone && !drawnMilestone && <span className="project-milestone-draw-hint">ドラッグして目標期間を設定</span>}
                {groupDueIndex !== undefined && <ProjectScheduleDeadline date={group.dueDate} index={groupDueIndex} dayWidth={DAY_WIDTH} lastColumn={groupDueIndex === dates.length - 1} milestone />}
              </div>
              {!collapsed && group.works.map((work, workIndex) => {
                const deadline = work.dueDate || group.dueDate || project.dueDate || "";
                const assessment = assessProjectWorkCapacity({ projectId: project.id, work, deadline, projects, periods, dailyCapacityHours });
                const drawn = drawnRange("work", work);
                const dueIndex = work.dueDate ? dateIndex.get(work.dueDate) : undefined;
                const peers = sameStartScheduleWorks(group.works, work);
                const peerIndex = peers.findIndex(item => item.id === work.id);
                return <div className={`project-capacity-row ${work.status === "done" ? "is-completed" : ""} ${workIndex === group.works.length - 1 ? "is-last-child" : ""}`} key={work.id}>
                  <div className="project-capacity-label">
                    <div>
                      <span className="project-capacity-work-kind" aria-label="作業">▣</span>
                      <strong title={work.title || "名称未設定"}>{work.title || "名称未設定"}</strong>
                      {peers.length > 1 && <div className="project-schedule-order" role="group" aria-label={`${work.title}の同じ開始日内の並び替え`}>
                        <button type="button" disabled={peerIndex === 0} aria-label={`${work.title}を上へ`} title="同じマイルストーン・開始日の中で上へ" onClick={() => onReorderWork(work.id, -1, showCompleted)}>↑</button>
                        <button type="button" disabled={peerIndex === peers.length - 1} aria-label={`${work.title}を下へ`} title="同じマイルストーン・開始日の中で下へ" onClick={() => onReorderWork(work.id, 1, showCompleted)}>↓</button>
                      </div>}
                      <button type="button" className="project-capacity-edit-work" onClick={() => onEditWork(work.id)}><span aria-hidden="true">✎</span> 編集</button>
                      <span className={`capacity-status status-${assessment.status} ${assessment.missingEstimateCount ? "has-missing" : ""}`}>{assessment.missingEstimateCount ? "見積未入力" : statusLabel[assessment.status]}</span>
                    </div>
                    <div className="project-capacity-metrics">
                      {assessment.status === "unset" || assessment.status === "invalid" || assessment.status === "completed"
                        ? <span>予定 {hours(assessment.requiredHours)}</span>
                        : <><span>{assessment.workingDates.length}営業日</span><span>必要 {hours(assessment.requiredHours)}</span><span>枠 {hours(assessment.grossCapacityHours)}</span>{assessment.competingHours > 0 && <span>他作業 {hours(assessment.competingHours)}</span>}<span>利用可能 {hours(assessment.availableHours)}</span></>}
                    </div>
                    {assessment.shortageHours > 0 && assessment.status === "over" && <small className="capacity-shortage">{hours(assessment.shortageHours)}不足・約{assessment.estimatedExtensionDays}営業日の延長が必要</small>}
                    {assessment.missingEstimateCount > 0 && <small className="capacity-missing">予定工数を入力してください</small>}
                    {assessment.exceedsDeadline && <small className="capacity-shortage">目標期間が期限を超えています</small>}
                    <div className="project-capacity-date-inputs">
                      <WorkDatePicker ariaLabel={`${work.title}の目標作業開始日`} value={work.targetWorkStartDate || ""} max={work.targetWorkEndDate || undefined} onChange={(value) => updateStart(work, value)} />
                      <span>〜</span>
                      <WorkDatePicker ariaLabel={`${work.title}の目標作業終了日`} value={work.targetWorkEndDate || ""} min={work.targetWorkStartDate || undefined} disabled={!work.targetWorkStartDate} onChange={(targetWorkEndDate) => onUpdateWork(work.id, { targetWorkEndDate })} />
                    </div>
                    <WorkDateSyncStatus work={work} />
                  </div>
                  <div className="project-capacity-lane" style={{ width: dates.length * DAY_WIDTH, backgroundSize: `${DAY_WIDTH}px 100%` }} tabIndex={0} onPointerDown={(event) => begin("work", work, event)} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} aria-label={`${work.title}の目標作業期間。中央で移動、両端で伸縮、空白で新規設定`}>
                    {dates.map((date, index) => getNonWorkingPeriod(date, periods) && <span className="capacity-non-working-column" key={date} style={{ left: index * DAY_WIDTH, width: DAY_WIDTH }} />)}
                    {dates.map((date, index) => date === todayValue() && <span className="capacity-today-line" key={date} style={{ left: index * DAY_WIDTH + DAY_WIDTH / 2 }} />)}
                    {drawn && <ProjectTargetLine {...drawn} dayWidth={DAY_WIDTH} className={`status-${assessment.status} ${assessment.exceedsDeadline ? "exceeds-due" : ""} ${drawn.draft ? "is-draft" : ""}`} />}
                    {dueIndex !== undefined && <ProjectScheduleDeadline date={work.dueDate!} index={dueIndex} dayWidth={DAY_WIDTH} lastColumn={dueIndex === dates.length - 1} />}
                    {!drawn && <span className="project-capacity-draw-hint">ドラッグして作業期間を設定</span>}
                  </div>
                </div>;
              })}
            </Fragment>;
          })}
        </div>
      </div>
    {movingMilestoneId && onMoveScheduleWorks && <BatchScheduleMoveDialog key={`${project.id}:${movingMilestoneId}`} project={project} projects={projects} milestoneId={movingMilestoneId} periods={periods} dailyCapacityHours={dailyCapacityHours} onApply={onMoveScheduleWorks} onClose={() => setMovingMilestoneId(null)} />}
    {aiPromptOpen && <Modal title="AIに作業スケジュールを相談" onClose={() => setAiPromptOpen(false)} wide>
      <div className="project-schedule-ai-dialog">
        <header><strong>{project.title}</strong><p>相談内容を選び、生成したプロンプトをChatGPTなどのAIへ貼り付けてください。この画面ではスケジュールを変更しません。</p></header>
        <section className="project-schedule-ai-settings">
          <fieldset><legend>相談内容</legend>{(Object.entries(PROJECT_SCHEDULE_AI_MODE_LABELS) as [ProjectScheduleAiMode, string][]).map(([value, label]) => <label className={aiMode === value ? "selected" : ""} key={value}><input type="radio" name="project-schedule-ai-mode" value={value} checked={aiMode === value} onChange={() => { setAiMode(value); setAiCopyStatus(""); }} /><span><strong>{label}</strong><small>{value === "initial-plan" ? "作業分解・工数見積もり・日程案を作成" : value === "validate-progress" ? "現在の工数・計画・負荷・期限を診断" : "残工数を再見積もりして日程と対策を提案"}</small></span></label>)}</fieldset>
          <label className="project-schedule-ai-constraints"><span>追加条件・AIに伝えたいこと <small>任意</small></span><textarea rows={6} value={aiConstraints} onChange={(event) => { setAiConstraints(event.target.value); setAiCopyStatus(""); }} placeholder="例：毎週水曜はレビューに2時間確保する／期限変更は不可／作業Aの後に作業Bを行う" /></label>
          <div className="project-schedule-ai-data-summary"><strong>プロンプトに含まれる情報</strong><span>マイルストーン {project.milestones.length}件</span><span>作業 {(project.workItems || []).length}件</span><span>他プロジェクト {Math.max(0, projects.length - 1)}件</span><span>非稼働設定 {periods.length}件</span><small>プロジェクト名、作業名、説明、工数、実績、期限、他プロジェクトの負荷情報が含まれます。機密情報がある場合はコピー前に内容を確認してください。</small></div>
        </section>
        <section className="project-schedule-ai-prompt"><div><strong>生成されたプロンプト</strong><span>{aiPrompt.length.toLocaleString("ja-JP")}文字</span></div><textarea readOnly spellCheck={false} value={aiPrompt} aria-label="生成されたAI相談プロンプト" /></section>
        <footer><span role="status" className={aiCopyStatus === "error" ? "error" : ""}>{aiCopyStatus === "copied" ? "プロンプトをコピーしました。" : aiCopyStatus === "error" ? "コピーできませんでした。テキストを選択してコピーしてください。" : "AIの回答取り込みは次の段階で対応予定です。"}</span><button type="button" onClick={() => setAiPromptOpen(false)}>閉じる</button><button type="button" className="primary" onClick={() => void copyAiPrompt()}>{aiCopyStatus === "copied" ? "コピー済み" : "プロンプトをコピー"}</button></footer>
      </div>
    </Modal>}
    <footer className="project-capacity-note">
      {dailyLoad.unscheduledWorkCount > 0 && <p className="capacity-missing">全プロジェクトに、目標期間が未設定・不正または営業日がない未完了作業が{dailyLoad.unscheduledWorkCount}件あります。日別の負荷には含まれていません。</p>}
      {(draft || dragError) && <p role="status">{draft?.error || dragError || `${draft!.range.start} 〜 ${draft!.range.end}（指を離して確定・Escでキャンセル）`}</p>}
      作業工数は設定した期間の営業日へ均等配分します。同じ日にある他Projectの作業も利用可能時間から差し引きます。完了済み作業は計算対象外です。
    </footer>
  </section>;
}
