import { Fragment, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { assessProjectWorkCapacity, type WorkCapacityAssessment } from "../projectCapacity";
import type { Goal, GoalMilestone, NonWorkingPeriod, ProjectWorkItem } from "../types";
import { addDays, getNonWorkingPeriod, rangeDates, todayValue } from "../utils";
import { WorkDatePicker } from "./WorkDatePicker";
import { ProjectWorkDateSyncButton, WorkDateSyncStatus } from "./WorkDateSyncButton";
import type { SyncWorkDates } from "../projectWorkDateSync";

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

interface WorkGroup {
  id: string;
  title: string;
  dueDate: string;
  kind: "milestone" | "direct";
  milestone?: GoalMilestone;
  works: ProjectWorkItem[];
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
  onSyncWorkDates,
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
  onSyncWorkDates: SyncWorkDates;
}) {
  const [draft, setDraft] = useState<{ workId: string; start: number; end: number } | null>(null);
  const [milestoneDraft, setMilestoneDraft] = useState<{ milestoneId: string; start: number; end: number } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
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
  const groups = useMemo<WorkGroup[]>(() => {
    const orderedMilestones = [...project.milestones].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const result: WorkGroup[] = orderedMilestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title || "名称未設定のマイルストーン",
      dueDate: milestone.dueDate || "",
      kind: "milestone",
      milestone,
      works: (project.workItems || []).filter((work) => work.milestoneId === milestone.id).sort((a, b) => a.sortOrder - b.sortOrder),
    }));
    const direct = (project.workItems || []).filter((work) => !work.milestoneId).sort((a, b) => a.sortOrder - b.sortOrder);
    if (direct.length) result.push({ id: "direct", title: "マイルストーン未割当", dueDate: project.dueDate || "", kind: "direct", works: direct });
    return result;
  }, [project]);
  const allWorks = useMemo(() => groups.flatMap((group) => group.works), [groups]);
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
  const shiftWindow = (days: number) => {
    setViewStart((current) => addDays(current, days));
    setViewEnd((current) => addDays(current, days));
  };
  const showToday = () => {
    const start = addDays(todayValue(), -3);
    setViewStart(start);
    setViewEnd(addDays(start, 44));
  };

  const indexAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(dates.length - 1, Math.floor((event.clientX - bounds.left) / DAY_WIDTH)));
  };
  const begin = (workId: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dates.length) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const index = indexAt(event);
    setDraft({ workId, start: index, end: index });
  };
  const move = (workId: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draft || draft.workId !== workId) return;
    setDraft({ ...draft, end: indexAt(event) });
  };
  const finish = (workId: string) => {
    if (!draft || draft.workId !== workId) return;
    const start = Math.min(draft.start, draft.end);
    const end = Math.max(draft.start, draft.end);
    onUpdateWork(workId, { targetWorkStartDate: dates[start], targetWorkEndDate: dates[end] });
    setDraft(null);
  };
  const beginMilestone = (milestoneId: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dates.length) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const index = indexAt(event);
    setMilestoneDraft({ milestoneId, start: index, end: index });
  };
  const moveMilestone = (milestoneId: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!milestoneDraft || milestoneDraft.milestoneId !== milestoneId) return;
    setMilestoneDraft({ ...milestoneDraft, end: indexAt(event) });
  };
  const finishMilestone = (milestoneId: string) => {
    if (!milestoneDraft || milestoneDraft.milestoneId !== milestoneId) return;
    const start = Math.min(milestoneDraft.start, milestoneDraft.end);
    const end = Math.max(milestoneDraft.start, milestoneDraft.end);
    onUpdateMilestone(milestoneId, { targetWorkStartDate: dates[start], targetWorkEndDate: dates[end] });
    setMilestoneDraft(null);
  };
  const updateStart = (work: ProjectWorkItem, targetWorkStartDate: string) => onUpdateWork(work.id, {
    targetWorkStartDate,
    ...(!targetWorkStartDate
      ? { targetWorkEndDate: "" }
      : work.targetWorkEndDate && work.targetWorkEndDate < targetWorkStartDate
        ? { targetWorkEndDate: targetWorkStartDate }
        : {}),
  });
  return <section className="project-capacity-planner is-work-planner">
    <header className="project-capacity-heading">
      <div><strong>作業スケジュール</strong><small>マイルストーンと作業を横になぞり、大まかな目標期間を決めます。◆はマイルストーン期限です。</small></div>
      <ProjectWorkDateSyncButton key={project.id} project={project} onSync={onSyncWorkDates} />
      <button type="button" className="project-capacity-add-milestone" onClick={onAddMilestone}>＋ マイルストーン</button>
      <label>1日の計画可能時間<input type="number" min="0.25" max="24" step="0.25" value={dailyHoursInput} onChange={(event) => setDailyHoursInput(event.target.value)} onBlur={commitDailyHours} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /><span>時間</span></label>
    </header>
    <div className="project-capacity-period-toolbar">
      <div className="project-capacity-range-fields"><strong>表示期間</strong><WorkDatePicker ariaLabel="表示期間の開始日" value={viewStart} max={viewEnd} showNonWorkingStatus={false} onChange={(value) => { if (!value) return; setViewStart(value); if (value > viewEnd) setViewEnd(addDays(value, 44)); }} /><span>〜</span><WorkDatePicker ariaLabel="表示期間の終了日" value={viewEnd} min={viewStart} showNonWorkingStatus={false} onChange={(value) => { if (value) setViewEnd(value); }} /></div>
      <div className="project-capacity-range-actions"><button type="button" onClick={() => shiftWindow(-28)}>← 4週</button><button type="button" onClick={showToday}>今日</button><button type="button" onClick={() => shiftWindow(28)}>4週 →</button><button type="button" onClick={() => { setViewStart(automaticWindow.start); setViewEnd(automaticWindow.end); }}>自動範囲</button></div>
    </div>
    {!allWorks.length
      ? <p className="project-capacity-empty">作業項目を追加すると、ここで目標作業期間を線として設定できます。</p>
      : <div className="project-capacity-scroll">
        <div className="project-capacity-grid" style={{ width: LABEL_WIDTH + dates.length * DAY_WIDTH }}>
          <div className="project-capacity-label-head">マイルストーン / 作業</div>
          <div className="project-capacity-calendar-head" style={{ gridTemplateColumns: `repeat(${dates.length}, ${DAY_WIDTH}px)` }}>
            {dates.map((date) => {
              const day = new Date(`${date}T00:00:00Z`).getUTCDay();
              const nonWorking = Boolean(getNonWorkingPeriod(date, periods));
              return <span key={date} className={`${nonWorking ? "is-non-working" : ""} ${date === todayValue() ? "is-today" : ""}`}><small>{["日", "月", "火", "水", "木", "金", "土"][day]}</small><b>{Number(date.slice(8, 10))}</b>{Number(date.slice(8, 10)) === 1 && <em>{Number(date.slice(5, 7))}月</em>}</span>;
            })}
          </div>
          {groups.map((group) => {
            const groupDueIndex = group.dueDate ? dateIndex.get(group.dueDate) : undefined;
            const groupHours = group.works.filter((work) => work.status !== "done").reduce((sum, work) => sum + (Number(work.plannedHours) || 0), 0);
            const collapsed = collapsedGroups.has(group.id);
            const drawnMilestone = group.milestone && (milestoneDraft?.milestoneId === group.id
              ? { start: Math.min(milestoneDraft.start, milestoneDraft.end), end: Math.max(milestoneDraft.start, milestoneDraft.end), draft: true }
              : group.milestone.targetWorkStartDate && group.milestone.targetWorkEndDate && dateIndex.has(group.milestone.targetWorkStartDate) && dateIndex.has(group.milestone.targetWorkEndDate)
                ? { start: dateIndex.get(group.milestone.targetWorkStartDate)!, end: dateIndex.get(group.milestone.targetWorkEndDate)!, draft: false }
                : null);
            return <Fragment key={group.id}>
              <div className="project-capacity-group-label"><button type="button" className="project-capacity-tree-toggle" aria-label={collapsed ? `${group.title}を展開` : `${group.title}を折りたたむ`} aria-expanded={!collapsed} onClick={() => setCollapsedGroups((current) => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}>{collapsed ? "▶" : "▼"}</button><span className={`project-capacity-group-kind is-${group.kind}`}>{group.kind === "milestone" ? "◆" : "◫"}</span><span className="project-capacity-group-text"><strong>{group.title}</strong><small>{group.works.length}件・未完了予定 {hours(groupHours)}{group.dueDate ? `・期限 ${group.dueDate}` : ""}{group.milestone?.targetWorkStartDate && group.milestone.targetWorkEndDate ? `・目標 ${group.milestone.targetWorkStartDate.slice(5).replace("-", "/")}〜${group.milestone.targetWorkEndDate.slice(5).replace("-", "/")}` : ""}</small></span>{group.milestone && <div className="project-capacity-group-actions"><button type="button" className="project-capacity-edit-milestone" onClick={() => onEditMilestone(group.milestone!.id)}><span aria-hidden="true">✎</span> 編集</button><button type="button" className="project-capacity-add-work" onClick={() => onAddWork(group.id)}>＋ 作業</button></div>}</div>
              <div className={`project-capacity-group-lane ${group.milestone ? "is-drawable" : ""}`} style={{ width: dates.length * DAY_WIDTH }} onPointerDown={group.milestone ? (event) => beginMilestone(group.id, event) : undefined} onPointerMove={group.milestone ? (event) => moveMilestone(group.id, event) : undefined} onPointerUp={group.milestone ? () => finishMilestone(group.id) : undefined} onPointerCancel={group.milestone ? () => setMilestoneDraft(null) : undefined} aria-label={group.milestone ? `${group.title}の大まかな目標期間。ドラッグして設定` : undefined}>
                {drawnMilestone && <span className={`project-target-line project-milestone-target-line ${drawnMilestone.draft ? "is-draft" : ""}`} style={{ left: drawnMilestone.start * DAY_WIDTH + 5, width: (drawnMilestone.end - drawnMilestone.start + 1) * DAY_WIDTH - 10 }}><i /><i /></span>}
                {group.milestone && !drawnMilestone && <span className="project-milestone-draw-hint">ドラッグして目標期間を設定</span>}
                {groupDueIndex !== undefined && <span className="project-milestone-marker is-group" style={{ left: groupDueIndex * DAY_WIDTH + DAY_WIDTH / 2 }}>◆<small>{group.dueDate.slice(5).replace("-", "/")}</small></span>}
              </div>
              {!collapsed && group.works.map((work, workIndex) => {
                const deadline = work.dueDate || group.dueDate || project.dueDate || "";
                const assessment = assessProjectWorkCapacity({ projectId: project.id, work, deadline, projects, periods, dailyCapacityHours });
                const drawn = draft?.workId === work.id
                  ? { start: Math.min(draft.start, draft.end), end: Math.max(draft.start, draft.end), draft: true }
                  : work.targetWorkStartDate && work.targetWorkEndDate && dateIndex.has(work.targetWorkStartDate) && dateIndex.has(work.targetWorkEndDate)
                    ? { start: dateIndex.get(work.targetWorkStartDate)!, end: dateIndex.get(work.targetWorkEndDate)!, draft: false }
                    : null;
                const dueIndex = work.dueDate ? dateIndex.get(work.dueDate) : undefined;
                return <div className={`project-capacity-row ${work.status === "done" ? "is-completed" : ""} ${workIndex === group.works.length - 1 ? "is-last-child" : ""}`} key={work.id}>
                  <div className="project-capacity-label">
                    <div><span className="project-capacity-work-kind" aria-label="作業">▣</span><strong>{work.title || "名称未設定"}</strong><button type="button" className="project-capacity-edit-work" onClick={() => onEditWork(work.id)}><span aria-hidden="true">✎</span> 編集</button><span className={`capacity-status status-${assessment.status} ${assessment.missingEstimateCount ? "has-missing" : ""}`}>{assessment.missingEstimateCount ? "見積未入力" : statusLabel[assessment.status]}</span></div>
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
                  <div className="project-capacity-lane" style={{ width: dates.length * DAY_WIDTH, backgroundSize: `${DAY_WIDTH}px 100%` }} onPointerDown={(event) => begin(work.id, event)} onPointerMove={(event) => move(work.id, event)} onPointerUp={() => finish(work.id)} onPointerCancel={() => setDraft(null)} aria-label={`${work.title}の目標作業期間。ドラッグして設定`}>
                    {dates.map((date, index) => getNonWorkingPeriod(date, periods) && <span className="capacity-non-working-column" key={date} style={{ left: index * DAY_WIDTH, width: DAY_WIDTH }} />)}
                    {dates.map((date, index) => date === todayValue() && <span className="capacity-today-line" key={date} style={{ left: index * DAY_WIDTH + DAY_WIDTH / 2 }} />)}
                    {drawn && <span className={`project-target-line status-${assessment.status} ${assessment.exceedsDeadline ? "exceeds-due" : ""} ${drawn.draft ? "is-draft" : ""}`} style={{ left: drawn.start * DAY_WIDTH + 5, width: (drawn.end - drawn.start + 1) * DAY_WIDTH - 10 }}><i /><i /></span>}
                    {dueIndex !== undefined && <span className="project-work-deadline" style={{ left: dueIndex * DAY_WIDTH + DAY_WIDTH / 2 }} title={`作業期限 ${work.dueDate}`} />}
                    {!drawn && <span className="project-capacity-draw-hint">ドラッグして作業期間を設定</span>}
                  </div>
                </div>;
              })}
            </Fragment>;
          })}
        </div>
      </div>}
    <footer className="project-capacity-note">作業工数は設定した期間の営業日へ均等配分します。同じ日にある他Projectの作業も利用可能時間から差し引きます。完了済み作業は計算対象外です。</footer>
  </section>;
}
