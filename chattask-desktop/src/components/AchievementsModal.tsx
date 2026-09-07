import { useMemo, useState } from "react";
import { STATUS_LABELS } from "../data/constants";
import type { ActivityEvent, Goal, NonWorkingPeriod, ProjectTag, Task } from "../types";
import { addDays, getNonWorkingPeriod, todayValue } from "../utils";
import { Modal } from "./Modal";
import { TaskWorkStatistics } from "./TaskWorkStatistics";

type Period = "day" | "week" | "month" | "quarter" | "half-year" | "year";

const dateValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const fromDateValue = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};
const shiftDate = (value: string, amount: number) => {
  const date = fromDateValue(value);
  date.setDate(date.getDate() + amount);
  return dateValue(date);
};
const periodRange = (base: string, period: Period): [string, string] => {
  if (period === "day") return [base, base];
  const date = fromDateValue(base);
  if (period === "week") {
    const mondayOffset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - mondayOffset);
    const start = dateValue(date);
    return [start, shiftDate(start, 6)];
  }
  if (period === "month") return [dateValue(new Date(date.getFullYear(), date.getMonth(), 1)), dateValue(new Date(date.getFullYear(), date.getMonth() + 1, 0))];
  const monthSpan = period === "quarter" ? 3 : period === "half-year" ? 6 : 12;
  const startMonth = Math.floor(date.getMonth() / monthSpan) * monthSpan;
  return [dateValue(new Date(date.getFullYear(), startMonth, 1)), dateValue(new Date(date.getFullYear(), startMonth + monthSpan, 0))];
};
const shiftPeriod = (base: string, period: Period, direction: -1 | 1) => {
  if (period === "day") return shiftDate(base, direction);
  if (period === "week") return shiftDate(base, direction * 7);
  const monthSpan = period === "month" ? 1 : period === "quarter" ? 3 : period === "half-year" ? 6 : 12;
  const date = fromDateValue(base);
  return dateValue(new Date(date.getFullYear(), date.getMonth() + direction * monthSpan, 1));
};
const rangeDates = (start: string, end: string) => {
  const dates: string[] = [];
  for (let date = start; date <= end; date = shiftDate(date, 1)) dates.push(date);
  return dates;
};
const localDate = (timestamp: string) => dateValue(new Date(timestamp));
const hoursLabel = (hours: number) => Number.isInteger(hours) ? `${hours}h` : `${Math.round(hours * 10) / 10}h`;
const actualHoursForDate = (task: Task, date: string) => Object.entries(task.dailyActualHours || {})
  .filter(([planKey]) => planKey === date || planKey.startsWith(`${date}::`))
  .reduce((sum, [, hours]) => sum + (Number(hours) || 0), 0);

export function AchievementsModal({ tasks, projects, tags, activity, nonWorkingPeriods, onSelect, onClose }: {
  tasks: Task[];
  projects: Goal[];
  tags: ProjectTag[];
  activity: ActivityEvent[];
  nonWorkingPeriods: NonWorkingPeriod[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [period, setPeriod] = useState<Period>("week");
  const [base, setBase] = useState(todayValue());
  const [selectedChartDate, setSelectedChartDate] = useState<string | null>(null);
  const selectPeriod = (nextPeriod: Period) => { setPeriod(nextPeriod); setSelectedChartDate(null); };
  const [showNonWorkingDays, setShowNonWorkingDays] = useState(() => localStorage.getItem("chatTaskAchievementShowNonWorkingDays") !== "false");
  const workingDateOverrides = useMemo(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("chatTaskWorkingDateOverrides") || "[]");
      return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : [];
    } catch {
      return [];
    }
  }, []);
  const [start, end] = periodRange(base, period);
  const days = rangeDates(start, end);
  const nonWorkingDates = useMemo(() => new Set(days.filter((date) => getNonWorkingPeriod(date, nonWorkingPeriods, workingDateOverrides))), [days, nonWorkingPeriods, workingDateOverrides]);
  const cancelledCompletionIds = useMemo(() => new Set(activity
    .filter((event) => event.type === "task-completion-cancelled")
    .map((event) => event.details?.completionEventId)
    .filter((id): id is string => typeof id === "string")), [activity]);
  const completionEvents = activity.filter((event) =>
    localDate(event.timestamp) >= start &&
    localDate(event.timestamp) <= end &&
    !cancelledCompletionIds.has(event.id) &&
    (event.type === "task-completed" || event.type === "daily-plan-completed" || event.type === "recurrence-done"));
  const taskCompletionEvents = completionEvents.filter((event) => event.type === "task-completed");
  const legacyCompleted = tasks.filter((task) =>
    task.status === "done" &&
    task.completedAt &&
    localDate(task.completedAt) >= start &&
    localDate(task.completedAt) <= end &&
    !taskCompletionEvents.some((event) => event.taskId === task.id));
  const recurringTaskIds = new Set([
    ...tasks.filter((task) => task.taskKind === "recurring" || task.status === "recurring").map((task) => task.id),
    ...activity.filter((event) => event.type === "task-deleted" && event.details?.snapshot && typeof event.details.snapshot === "object")
      .flatMap((event) => { const snapshot = event.details!.snapshot as Task; return snapshot.taskKind === "recurring" || snapshot.status === "recurring" ? [snapshot.id] : []; }),
  ]);
  const createdEvents = activity.filter((event) => event.type === "task-created" && !recurringTaskIds.has(event.taskId || "") && localDate(event.timestamp) >= start && localDate(event.timestamp) <= end);
  const createdIds = new Set(createdEvents.map((event) => event.taskId).filter(Boolean));
  const legacyCreated = tasks.filter((task) => task.taskKind !== "recurring" && task.status !== "recurring" && localDate(task.createdAt) >= start && localDate(task.createdAt) <= end && !createdIds.has(task.id));
  const createdCount = createdEvents.length + legacyCreated.length;
  const completedTaskCount = taskCompletionEvents.length + legacyCompleted.length;
  const dailyCompleted = tasks.flatMap((task) => Object.entries(task.dailyPlanCompleted || {})
    .filter(([sourceKey, completed]) => completed && sourceKey.slice(0, 10) >= start && sourceKey.slice(0, 10) <= end)
    .map(([sourceKey]) => ({ task, date: sourceKey.slice(0, 10) })));
  const recurrenceCompleted = tasks.flatMap((task) => (task.recurrenceRecords || [])
    .filter((record) => record.status === "done" && record.date >= start && record.date <= end)
    .map((record) => ({ task, date: record.date })));
  const projectAchievements = projects.flatMap((project) => [
    ...project.milestones.filter((milestone) => milestone.completedAt && localDate(milestone.completedAt) >= start && localDate(milestone.completedAt) <= end)
      .map((milestone) => ({ id: `milestone-${project.id}-${milestone.id}`, title: milestone.title, date: localDate(milestone.completedAt!), kind: "マイルストーン達成", taskId: milestone.linkedTaskId || null })),
    ...(project.workItems || []).filter((work) => work.completedAt && localDate(work.completedAt) >= start && localDate(work.completedAt) <= end)
      .map((work) => ({ id: `work-${project.id}-${work.id}`, title: work.title, date: localDate(work.completedAt!), kind: "作業項目達成", taskId: work.linkedTaskId || null })),
  ]);
  const completedResponses = dailyCompleted.length + recurrenceCompleted.length + projectAchievements.length;
  const actualHours = tasks.reduce((sum, task) => sum + Object.entries(task.dailyActualHours || {})
    .filter(([date]) => date >= start && date <= end)
    .reduce((subtotal, [, hours]) => subtotal + (Number(hours) || 0), 0), 0);
  const carryovers = activity.filter((event) => {
    const date = localDate(event.timestamp);
    return date >= start && date <= end && (event.summary.includes("持ち越") || event.type === "recurrence-moved");
  });
  const net = completedTaskCount - createdCount;
  const daily = days.map((date) => ({
    date,
    created: createdEvents.filter((event) => localDate(event.timestamp) === date).length + legacyCreated.filter((task) => localDate(task.createdAt) === date).length,
    completed: taskCompletionEvents.filter((event) => localDate(event.timestamp) === date).length + legacyCompleted.filter((task) => localDate(task.completedAt!) === date).length,
    responses: dailyCompleted.filter((item) => item.date === date).length + recurrenceCompleted.filter((item) => item.date === date).length + projectAchievements.filter((item) => item.date === date).length,
    hours: tasks.reduce((sum, task) => sum + actualHoursForDate(task, date), 0),
  }));
  const deletedTaskSnapshots = activity.flatMap((event) => {
    if (event.type !== "task-deleted" || !event.details?.snapshot || typeof event.details.snapshot !== "object") return [];
    return [{ deletedAt: event.timestamp, task: event.details.snapshot as Task }];
  });
  const currentTaskIds = new Set(tasks.map((task) => task.id));
  const taskEntities = [
    ...tasks.map((task) => ({ task, deletedAt: "" })),
    ...deletedTaskSnapshots.filter(({ task }) => !currentTaskIds.has(task.id)),
  ];
  const excludedFromTaskTotal = new Set<Task["status"]>(["done", "cancelled", "handed-over", "pending"]);
  const statusAtEndOfDate = (task: Task, deletedAt: string, date: string) => {
    let status = task.status;
    activity.filter((event) => event.taskId === task.id && localDate(event.timestamp) > date && (!deletedAt || event.timestamp <= deletedAt))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .forEach((event) => {
        if (event.type === "task-completion-cancelled") { status = "done"; return; }
        if (typeof event.details?.fromStatus === "string" && event.details.fromStatus in STATUS_LABELS) status = event.details.fromStatus as Task["status"];
      });
    return status;
  };
  const activeTaskCountForDate = (date: string) => taskEntities.filter(({ task, deletedAt }) => localDate(task.createdAt) <= date && (!deletedAt || localDate(deletedAt) > date) && task.taskKind !== "recurring" && task.status !== "recurring" && !excludedFromTaskTotal.has(statusAtEndOfDate(task, deletedAt, date))).length;
  const activeTaskSeries = days.map((date) => {
    if (date > todayValue()) return { date, count: null };
    return { date, count: activeTaskCountForDate(date) };
  });
  const dailyChartItems = daily.map((item, index) => ({
    ...item,
    rangeLabel: item.date,
    axisLabel: item.date.slice(5).replace("-", "/"),
    activeCount: activeTaskSeries[index]?.count ?? null,
    nonWorking: nonWorkingDates.has(item.date),
  }));
  const chartItems = (() => {
    if (period === "day" || period === "week" || period === "month") {
      return showNonWorkingDays ? dailyChartItems : dailyChartItems.filter((item) => !item.nonWorking);
    }
    const groups = new Map<string, typeof dailyChartItems>();
    dailyChartItems.forEach((item, index) => {
      const key = period === "quarter" ? String(Math.floor(index / 7)) : item.date.slice(0, 7);
      groups.set(key, [...(groups.get(key) || []), item]);
    });
    return [...groups.values()].flatMap((calendarItems) => {
      const included = showNonWorkingDays ? calendarItems : calendarItems.filter((item) => !item.nonWorking);
      if (!included.length) return [];
      const first = calendarItems[0];
      const last = calendarItems[calendarItems.length - 1];
      const lastActive = [...included].reverse().find((item) => item.activeCount !== null)?.activeCount ?? null;
      return [{
        date: last.date,
        rangeLabel: period === "quarter" ? `${first.date}〜${last.date}` : first.date.slice(0, 7),
        axisLabel: period === "quarter" ? `${first.date.slice(5).replace("-", "/")}〜` : `${Number(first.date.slice(5, 7))}月`,
        created: included.reduce((sum, item) => sum + item.created, 0),
        completed: included.reduce((sum, item) => sum + item.completed, 0),
        responses: included.reduce((sum, item) => sum + item.responses, 0),
        hours: included.reduce((sum, item) => sum + item.hours, 0),
        activeCount: lastActive,
        nonWorking: false,
      }];
    });
  })();
  const chartMax = Math.max(1, ...chartItems.map((item) => Math.max(item.completed, item.responses, item.created)));
  let previousChartDate = addDays(start, -1);
  if (!showNonWorkingDays) {
    for (let offset = 0; offset < 366 && getNonWorkingPeriod(previousChartDate, nonWorkingPeriods, workingDateOverrides); offset += 1) previousChartDate = addDays(previousChartDate, -1);
  }
  const previousTaskTotal = previousChartDate <= todayValue() ? { date: previousChartDate, count: activeTaskCountForDate(previousChartDate), previous: true as const } : null;
  const visibleTaskTotals = [
    ...(previousTaskTotal ? [previousTaskTotal] : []),
    ...chartItems.filter((item): item is typeof item & { activeCount: number } => item.activeCount !== null).map((item) => ({ date: item.date, count: item.activeCount, previous: false as const })),
  ];
  const taskTotalMin = Math.max(0, (visibleTaskTotals.length ? Math.min(...visibleTaskTotals.map((item) => item.count)) : 0) - 1);
  const taskTotalMax = Math.max(1, (visibleTaskTotals.length ? Math.max(...visibleTaskTotals.map((item) => item.count)) : 0) + 1);
  const taskTotalRange = Math.max(1, taskTotalMax - taskTotalMin);
  // 長期は週・月単位へ集約し、1年表示でも線と棒の間隔を保つ。
  const chartWidth = period === "month" ? 1600 : period === "day" ? 500 : 1000;
  const chartSlotCount = chartItems.length + (previousTaskTotal ? 1 : 0);
  const chartX = (index: number) => chartSlotCount <= 1 ? chartWidth / 2 : 34 + index / (chartSlotCount - 1) * (chartWidth - 68);
  const taskTotalPoints = visibleTaskTotals.map((item) => ({
    ...item,
    x: chartX(item.previous ? 0 : chartItems.findIndex((day) => day.date === item.date) + (previousTaskTotal ? 1 : 0)),
    y: 142 - (item.count - taskTotalMin) / taskTotalRange * 104,
  }));
  const taskTotalPath = taskTotalPoints.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const selectedChartIndex = selectedChartDate ? chartItems.findIndex((item) => item.date === selectedChartDate) : -1;
  const displayedChartDay = selectedChartIndex >= 0 ? chartItems[selectedChartIndex] : null;
  const displayedActiveTotal = displayedChartDay?.activeCount;
  const completedTaskItems = [
    ...taskCompletionEvents.map((event) => ({ id: event.id, taskId: event.taskId, title: event.taskTitle, date: localDate(event.timestamp), kind: "タスク完了" })),
    ...legacyCompleted.map((task) => ({ id: `legacy-${task.id}`, taskId: task.id, title: task.title, date: localDate(task.completedAt!), kind: "タスク完了" })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const completedResponseItems = [
    ...dailyCompleted.map(({ task, date }) => ({ id: `daily-${task.id}-${date}`, taskId: task.id, title: task.title, date, kind: "今日の対応を達成" })),
    ...recurrenceCompleted.map(({ task, date }) => ({ id: `recurrence-${task.id}-${date}`, taskId: task.id, title: task.title, date, kind: "定期タスクを実施" })),
    ...projectAchievements,
  ].sort((a, b) => b.date.localeCompare(a.date));
  return <Modal title="頑張りの記録" wide onClose={onClose}>
    <div className="achievement-view">
      <header className="achievement-controls">
        <div className="achievement-period-switch">
          <button className={period === "day" ? "active" : ""} onClick={() => selectPeriod("day")}>今日</button>
          <button className={period === "week" ? "active" : ""} onClick={() => selectPeriod("week")}>今週</button>
          <button className={period === "month" ? "active" : ""} onClick={() => selectPeriod("month")}>今月</button>
          <button className={period === "quarter" ? "active" : ""} onClick={() => selectPeriod("quarter")}>3か月</button>
          <button className={period === "half-year" ? "active" : ""} onClick={() => selectPeriod("half-year")}>半年</button>
          <button className={period === "year" ? "active" : ""} onClick={() => selectPeriod("year")}>1年</button>
        </div>
        <div className="achievement-date-nav"><button onClick={() => setBase(shiftPeriod(base, period, -1))}>←</button><strong>{start === end ? start : `${start}〜${end}`}</strong><button onClick={() => setBase(shiftPeriod(base, period, 1))}>→</button><button onClick={() => setBase(todayValue())}>今日</button></div>
      </header>
      <section className="achievement-metrics">
        <article className="complete"><small>完了したタスク</small><strong>{completedTaskCount}<span>件</span></strong></article>
        <article className="response"><small>達成した対応</small><strong>{completedResponses}<span>件</span></strong></article>
        <article className="created"><small>新しく追加（通常タスク）</small><strong>{createdCount}<span>件</span></strong></article>
        <article className={net >= 0 ? "net positive" : "net"}><small>タスクの差し引き</small><strong>{net > 0 ? "−" : net < 0 ? "＋" : "±"}{Math.abs(net)}<span>件</span></strong><p>{net > 0 ? "未完了を減らしました" : net < 0 ? "取り組みが増えました" : "追加と完了が同数です"}</p></article>
        <article className="hours"><small>対応した時間</small><strong>{hoursLabel(actualHours)}</strong></article>
        <article className="carry"><small>持ち越し・移動</small><strong>{carryovers.length}<span>件</span></strong></article>
      </section>
      <section className="achievement-chart-panel">
        <header><div><strong>{period === "quarter" ? "週ごと" : period === "half-year" || period === "year" ? "月ごと" : "日ごと"}の成果と稼働タスク</strong><small>完了・対応達成・追加と、終了・保留・定期タスクを除いた稼働タスク総数を表示します。</small></div><div className="achievement-chart-options"><label><input type="checkbox" checked={showNonWorkingDays} onChange={(event) => { const checked = event.target.checked; setShowNonWorkingDays(checked); localStorage.setItem("chatTaskAchievementShowNonWorkingDays", String(checked)); setSelectedChartDate(null); }} />非稼働日を表示</label><div className="achievement-legend"><span className="done">タスク完了</span><span className="response">対応達成</span><span className="created">追加</span><span className="active-total">稼働タスク総数</span></div></div></header>
        <div className={`achievement-chart-selection${displayedChartDay ? " has-selection" : ""}`}>{displayedChartDay ? <><strong>{displayedChartDay.rangeLabel}</strong><span className="done">完了 <b>{displayedChartDay.completed}</b></span><span className="response">対応達成 <b>{displayedChartDay.responses}</b></span><span className="created">追加 <b>{displayedChartDay.created}</b></span><span className="active">稼働タスク <b>{displayedActiveTotal ?? "—"}</b></span><span>実績 <b>{hoursLabel(displayedChartDay.hours)}</b></span></> : <small>グラフにカーソルを合わせると、緑・紫・オレンジの内訳を表示します</small>}</div>
        <div className="achievement-combined-chart" onMouseLeave={() => setSelectedChartDate(null)}>
          <svg viewBox={`0 0 ${chartWidth} 190`} role="img" aria-label="期間ごとのタスク完了、対応達成、追加、稼働タスク総数">
            <line x1="24" y1="155" x2={chartWidth - 24} y2="155" className="axis" />
            {previousTaskTotal && <text className="date-label previous-date-label" x={chartX(0)} y="178">{previousTaskTotal.date.slice(5).replace("-", "/")}</text>}
            {chartItems.map((item, index) => { const chartIndex = index + (previousTaskTotal ? 1 : 0), x = chartX(chartIndex), slotWidth = Math.max(20, (chartWidth - 68) / Math.max(1, chartSlotCount - 1)), doneHeight = item.completed / chartMax * 88, responseHeight = item.responses / chartMax * 88, createdHeight = item.created / chartMax * 88, nonWorking = item.nonWorking; return <g key={item.date} className={nonWorking ? "non-working-day" : undefined}>
              <title>{`${item.rangeLabel} タスク完了 ${item.completed}件 / 対応達成 ${item.responses}件 / 追加 ${item.created}件 / 稼働タスク ${item.activeCount ?? "—"}件 / ${hoursLabel(item.hours)}`}</title>
              {nonWorking && <rect className="non-working-day-background" x={x - slotWidth / 2} y="20" width={slotWidth} height="145" />}
              {selectedChartIndex === index && <line className="selected-day-guide" x1={x} y1="25" x2={x} y2="158" />}
              <rect className="done-bar" x={x - 15} y={155 - doneHeight} width="8" height={doneHeight} rx="2" />
              <rect className="response-bar" x={x - 4} y={155 - responseHeight} width="8" height={responseHeight} rx="2" />
              <rect className="created-bar" x={x + 7} y={155 - createdHeight} width="8" height={createdHeight} rx="2" />
              {(period !== "month" || index % 5 === 0 || index === chartItems.length - 1) && <text className="date-label" x={x} y="178">{item.axisLabel}</text>}
              <rect className="day-hit-area" x={x - Math.max(10, (chartWidth - 68) / Math.max(1, chartSlotCount - 1) / 2)} y="20" width={Math.max(20, (chartWidth - 68) / Math.max(1, chartSlotCount - 1))} height="145" tabIndex={0} aria-label={`${item.rangeLabel}の内容を表示`} onMouseEnter={() => setSelectedChartDate(item.date)} onFocus={() => setSelectedChartDate(item.date)} />
            </g>; })}
            {taskTotalPath && <path d={taskTotalPath} className="active-task-line" />}
            {taskTotalPoints.map((point) => {
              const nonWorking = nonWorkingDates.has(point.date);
              const labelWidth = String(point.count).length > 2 ? 24 : 20;
              const chartItem = point.previous ? null : chartItems.find((item) => item.date === point.date);
              const tallestBarTop = chartItem ? 155 - Math.max(chartItem.completed, chartItem.responses, chartItem.created) / chartMax * 88 : 155;
              const labelBaseline = Math.min(point.y - 12, tallestBarTop - 6);
              return <g className={`active-task-point${nonWorking ? " is-non-working" : ""}${point.previous ? " is-previous" : ""}`} key={point.date}>
                <title>{`${point.date} 稼働タスク ${point.count}件${point.previous ? "（表示期間の直前）" : ""}`}</title>
                <circle cx={point.x} cy={point.y} r={nonWorking ? "2.5" : "4"} />
                <rect className="active-task-value-background" x={point.x - labelWidth / 2} y={labelBaseline - 11} width={labelWidth} height="15" rx="7.5" />
                <text x={point.x} y={labelBaseline}>{point.count}</text>
              </g>;
            })}
          </svg>
        </div>
      </section>
      <TaskWorkStatistics tasks={tasks} tags={tags} periods={nonWorkingPeriods} workingDateOverrides={workingDateOverrides} start={start} end={end} onSelect={onSelect} />
      <section className="achievement-recent">
        <header><strong>この期間に完了したタスク</strong><small>{completedTaskItems.length ? "内容を選ぶとタスクを開きます。" : "この期間に完了したタスクはありません。"}</small></header>
        <div>{completedTaskItems.map((item) => <button key={item.id} disabled={!item.taskId} onClick={() => item.taskId && onSelect(item.taskId)}><span><b>{item.title || "名称のないタスク"}</b><small>{item.kind}</small></span><time>{item.date}</time></button>)}</div>
      </section>
      <section className="achievement-recent achievement-response-list">
        <header><strong>この期間に達成した対応</strong><small>{completedResponseItems.length ? "日別対応・定期タスク・プロジェクト成果の記録です。" : "この期間の対応達成はありません。"}</small></header>
        <div>{completedResponseItems.map((item) => <button key={item.id} disabled={!item.taskId} onClick={() => item.taskId && onSelect(item.taskId)}><span><b>{item.title || "名称のない対応"}</b><small>{item.kind}</small></span><time>{item.date}</time></button>)}</div>
      </section>
    </div>
  </Modal>;
}
