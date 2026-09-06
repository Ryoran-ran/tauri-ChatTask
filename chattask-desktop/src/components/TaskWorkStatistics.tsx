import { useMemo, useState } from "react";
import type { NonWorkingPeriod, ProjectTag, Task } from "../types";
import { localDateValue, plannedRangeHoursForDate, rangeDates } from "../utils";
import { TagIcon } from "./TagIcon";

interface WorkStatistic {
  id: string;
  title: string;
  planned: number;
  actual: number;
  fallbackPlanned: number;
  fallbackActual: number;
  records: number;
  latestMemo: string;
}

interface TaskStatistic {
  task: Task;
  tag?: ProjectTag;
  works: WorkStatistic[];
  planned: number;
  actual: number;
}

const hoursLabel = (hours: number) => `${Number(hours.toFixed(2))}h`;
const accuracy = (planned: number, actual: number) => planned > 0 && actual > 0
  ? Math.round(Math.min(planned, actual) / Math.max(planned, actual) * 100)
  : null;

export function TaskWorkStatistics({ tasks, tags, periods, workingDateOverrides, start, end, onSelect }: {
  tasks: Task[];
  tags: ProjectTag[];
  periods: NonWorkingPeriod[];
  workingDateOverrides: string[];
  start: string;
  end: string;
  onSelect: (id: string) => void;
}) {
  const [tagId, setTagId] = useState("");
  const days = useMemo(() => rangeDates([{ id: "statistics-period", startDate: start, endDate: end }]), [start, end]);
  const rows = useMemo<TaskStatistic[]>(() => tasks.flatMap((task) => {
    const works = new Map<string, WorkStatistic>();
    const ensureWork = (id: string, title: string) => {
      const current = works.get(id) || { id, title, planned: 0, actual: 0, fallbackPlanned: 0, fallbackActual: 0, records: 0, latestMemo: "" };
      works.set(id, current);
      return current;
    };

    task.plannedRanges.forEach((range) => {
      const planned = days.reduce((sum, date) => sum + plannedRangeHoursForDate(range, date, periods, workingDateOverrides), 0);
      const actual = Object.entries(task.dailyActualHours || {}).filter(([planKey]) => {
        const date = planKey.slice(0, 10);
        if (date < start || date > end || !planKey.includes("::")) return false;
        return planKey.slice(planKey.indexOf("::") + 2) === range.id;
      }).reduce((sum, [, value]) => sum + (Number(value) || 0), 0);
      if (planned <= 0 && actual <= 0) return;
      const work = ensureWork(`range:${range.id}`, range.title?.trim() || range.description?.trim().split("\n")[0] || range.note?.trim().split("\n")[0] || "名称のない作業");
      work.planned += planned;
      work.actual += actual;
    });

    Object.entries(task.dailyActualHours || {}).forEach(([planKey, value]) => {
      const date = planKey.slice(0, 10);
      if (date < start || date > end || planKey.includes("::") || Number(value) <= 0) return;
      ensureWork("task:unassigned", "タスク全体の作業").actual += Number(value) || 0;
    });

    task.history.forEach((entry) => {
      if (entry.type !== "comment" || !entry.workTitle) return;
      const date = localDateValue(entry.timestamp);
      if (date < start || date > end) return;
      const matchingRange = task.plannedRanges.find((range) => range.title?.trim() === entry.workTitle?.trim());
      const work = ensureWork(matchingRange ? `range:${matchingRange.id}` : `history:${entry.workTitle.trim()}`, entry.workTitle.trim());
      work.records += 1;
      work.fallbackPlanned += Math.max(0, Number(entry.workPlannedHours) || 0);
      work.fallbackActual += Math.max(0, Number(entry.workActualHours) || 0);
      if (entry.text.trim()) work.latestMemo = entry.text.trim();
    });

    const normalizedWorks = [...works.values()].map((work) => ({
      ...work,
      planned: work.planned > 0 ? work.planned : work.fallbackPlanned,
      actual: work.actual > 0 ? work.actual : work.fallbackActual,
    })).filter((work) => work.planned > 0 || work.actual > 0 || work.records > 0)
      .sort((a, b) => b.actual - a.actual || b.planned - a.planned || a.title.localeCompare(b.title, "ja"));
    if (!normalizedWorks.length) return [];
    return [{
      task,
      tag: tags.find((tag) => tag.id === task.projectTagId),
      works: normalizedWorks,
      planned: normalizedWorks.reduce((sum, work) => sum + work.planned, 0),
      actual: normalizedWorks.reduce((sum, work) => sum + work.actual, 0),
    }];
  }).sort((a, b) => b.actual - a.actual || b.planned - a.planned || a.task.title.localeCompare(b.task.title, "ja")), [days, end, periods, start, tags, tasks, workingDateOverrides]);
  const visibleRows = rows.filter((row) => !tagId || row.tag?.id === tagId);
  const totalPlanned = visibleRows.reduce((sum, row) => sum + row.planned, 0);
  const totalActual = visibleRows.reduce((sum, row) => sum + row.actual, 0);
  const totalAccuracy = accuracy(totalPlanned, totalActual);
  const activeTags = tags.filter((tag) => rows.some((row) => row.tag?.id === tag.id));

  return <section className="achievement-work-statistics">
    <header><div><strong>対応内容・工数統計</strong><small>タスクを展開すると、期間内に対応した作業と見積結果を確認できます。</small></div><label>案件タグ<select value={tagId} onChange={(event) => setTagId(event.target.value)}><option value="">すべて</option>{activeTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label></header>
    <div className="achievement-effort-metrics"><span><small>予定</small><b>{hoursLabel(totalPlanned)}</b></span><span><small>実績</small><b>{hoursLabel(totalActual)}</b></span><span className={totalActual > totalPlanned && totalPlanned > 0 ? "over" : ""}><small>差分</small><b>{totalActual - totalPlanned > 0 ? "+" : ""}{hoursLabel(totalActual - totalPlanned)}</b></span><span><small>見積精度</small><b>{totalAccuracy === null ? "—" : `${totalAccuracy}%`}</b></span></div>
    <div className="achievement-task-work-list">{visibleRows.map((row) => <details key={row.task.id}>
      <summary><span className="achievement-task-work-title">{row.tag && <TagIcon tag={row.tag} />}<span><strong>{row.task.title || "名称のないタスク"}</strong><small>{row.works.length}作業</small></span></span><span className="achievement-task-work-totals"><small>予定 {hoursLabel(row.planned)}</small><small>実績 {hoursLabel(row.actual)}</small><b>{accuracy(row.planned, row.actual) === null ? "—" : `${accuracy(row.planned, row.actual)}%`}</b><button type="button" onClick={(event) => { event.preventDefault(); onSelect(row.task.id); }}>タスクを開く</button></span></summary>
      <div>{row.works.map((work) => <article key={work.id}><span><strong>{work.title}</strong>{work.latestMemo && <small>{work.latestMemo}</small>}{work.records > 0 && <em>記録 {work.records}件</em>}</span><dl><div><dt>予定</dt><dd>{hoursLabel(work.planned)}</dd></div><div><dt>実績</dt><dd>{hoursLabel(work.actual)}</dd></div><div><dt>差分</dt><dd className={work.actual > work.planned && work.planned > 0 ? "over" : ""}>{work.actual - work.planned > 0 ? "+" : ""}{hoursLabel(work.actual - work.planned)}</dd></div><div><dt>精度</dt><dd>{accuracy(work.planned, work.actual) === null ? "—" : `${accuracy(work.planned, work.actual)}%`}</dd></div></dl></article>)}</div>
    </details>)}{!visibleRows.length && <p>この期間には、工数または対象作業が記録されていません。</p>}</div>
  </section>;
}
