import { Fragment, useMemo, useState } from "react";
import type { NonWorkingPeriod, ProjectTag, Task } from "../types";
import { addDays, getNonWorkingPeriod, isRecurringDue, plannedHoursForDate, plannedRangeHoursForDate, todayValue } from "../utils";
import { Modal } from "./Modal";
import { TagIcon } from "./TagIcon";
import { WorkDatePicker } from "./WorkDatePicker";

const dateObject = (value: string) => new Date(`${value}T12:00:00`);
const weekStart = (value: string) => {
  const date = dateObject(value);
  const offset = (date.getDay() + 6) % 7;
  return addDays(value, -offset);
};
const hoursLabel = (value: number) => `${Number.isInteger(value) ? value : Math.round(value * 10) / 10}h`;
const dateLabel = (value: string) => {
  const date = dateObject(value);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};
const weekdayLabel = (value: string) => ["日", "月", "火", "水", "木", "金", "土"][dateObject(value).getDay()];
const loadTone = (hours: number, capacity: number) => hours > capacity ? "over" : hours >= capacity * .8 ? "high" : hours > 0 ? "normal" : "empty";
type LoadDisplay = "work" | "task";
type LoadWorkRow = { id: string; title: string; period: string; daily: number[]; total: number };

export function WeeklyLoadModal({ tasks, tags, periods, onSelect, onClose }: {
  tasks: Task[];
  tags: ProjectTag[];
  periods: NonWorkingPeriod[];
  onSelect: (taskId: string) => void;
  onClose: () => void;
}) {
  const [anchor, setAnchor] = useState(() => weekStart(todayValue()));
  const [tagId, setTagId] = useState("");
  const [display, setDisplay] = useState<LoadDisplay>(() => localStorage.getItem("chatTaskWeeklyLoadDisplay") === "task" ? "task" : "work");
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(() => new Set());
  const [capacity, setCapacity] = useState(() => {
    const stored = Number(localStorage.getItem("chatTaskWeeklyLoadCapacity"));
    return stored > 0 ? stored : 8;
  });
  const workingDateOverrides = useMemo(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("chatTaskWorkingDateOverrides") || "[]");
      return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : [];
    } catch { return []; }
  }, []);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(anchor, index)), [anchor]);
  const visibleTasks = useMemo(() => tasks.filter((task) => !tagId || task.projectTagId === tagId), [tagId, tasks]);
  const rows = useMemo(() => visibleTasks.map((task) => {
    const daily = days.map((date) => task.status === "recurring"
      ? (isRecurringDue(task, date, periods, workingDateOverrides) ? Math.max(0, Number(task.plannedHours) || 0) : 0)
      : plannedHoursForDate(task, date, periods, workingDateOverrides));
    const total = daily.reduce((sum, value) => sum + value, 0);
    let works: LoadWorkRow[] = task.status === "recurring" ? [{
      id: `${task.id}:recurring`, title: "定期作業", period: "定期予定", daily, total,
    }] : task.plannedRanges.map((range) => {
      const workDaily = days.map((date) => plannedRangeHoursForDate(range, date, periods, workingDateOverrides));
      return {
        id: range.id,
        title: range.title?.trim() || "名称未設定の作業",
        period: range.startDate === range.endDate ? range.startDate : `${range.startDate}〜${range.endDate}`,
        daily: workDaily,
        total: workDaily.reduce((sum, value) => sum + value, 0),
      };
    }).filter((work) => work.total > 0);
    if (total > 0 && works.length === 0) works = [{
      id: `${task.id}:fallback`, title: "名称未設定の作業", period: "タスク全体の予定工数", daily, total,
    }];
    return { task, daily, total, works };
  }).filter((row) => row.total > 0).sort((a, b) => b.total - a.total || a.task.title.localeCompare(b.task.title, "ja")), [days, periods, visibleTasks, workingDateOverrides]);
  const dailyTotals = days.map((_, index) => rows.reduce((sum, row) => sum + row.daily[index], 0));
  const workingDays = days.filter((date) => !getNonWorkingPeriod(date, periods, workingDateOverrides)).length;
  const total = dailyTotals.reduce((sum, value) => sum + value, 0);
  const weeklyCapacity = workingDays * capacity;
  const peak = Math.max(...dailyTotals);
  const workCount = rows.reduce((sum, row) => sum + row.works.length, 0);
  const today = todayValue();

  const changeCapacity = (next: number) => {
    const normalized = Math.min(24, Math.max(.5, next || 8));
    setCapacity(normalized);
    localStorage.setItem("chatTaskWeeklyLoadCapacity", String(normalized));
  };
  const changeDisplay = (next: LoadDisplay) => {
    setDisplay(next);
    localStorage.setItem("chatTaskWeeklyLoadDisplay", next);
  };
  const toggleTask = (taskId: string) => setCollapsedTaskIds((current) => {
    const next = new Set(current);
    next.has(taskId) ? next.delete(taskId) : next.add(taskId);
    return next;
  });

  return <Modal title="週間予定" wide onClose={onClose}>
    <div className="weekly-load-view">
      <div className="weekly-load-controls">
        <div className="weekly-load-date-nav"><button type="button" onClick={() => setAnchor(addDays(anchor, -7))}>← 前週</button><label className="weekly-load-start-date"><span>開始日</span><WorkDatePicker value={anchor} onChange={setAnchor} ariaLabel="週間予定の開始日" allowClear={false} /></label><strong>〜 {dateLabel(days[6])}</strong><button type="button" onClick={() => setAnchor(weekStart(today))}>今週</button><button type="button" onClick={() => setAnchor(addDays(anchor, 7))}>次週 →</button></div>
        <div className="weekly-load-filters"><div className="weekly-load-display-switch"><button type="button" className={display === "work" ? "active" : ""} onClick={() => changeDisplay("work")}>作業</button><button type="button" className={display === "task" ? "active" : ""} onClick={() => changeDisplay("task")}>タスク</button></div><label>案件タグ<select value={tagId} onChange={(event) => setTagId(event.target.value)}><option value="">すべて</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label><label>1日の上限<input type="number" min="0.5" max="24" step="0.5" value={capacity} onChange={(event) => changeCapacity(Number(event.target.value))} />h</label></div>
      </div>

      <section className="weekly-load-summary">
        <article><small>週間予定</small><strong>{hoursLabel(total)}</strong><span>稼働日 {workingDays}日</span></article>
        <article className={total > weeklyCapacity ? "over" : ""}><small>週間上限</small><strong>{hoursLabel(weeklyCapacity)}</strong><span>{total > weeklyCapacity ? `${hoursLabel(total - weeklyCapacity)}超過` : `${hoursLabel(weeklyCapacity - total)}の余裕`}</span></article>
        <article className={peak > capacity ? "over" : ""}><small>最も多い日</small><strong>{hoursLabel(peak)}</strong><span>{dateLabel(days[dailyTotals.indexOf(peak)])}</span></article>
        <article><small>{display === "work" ? "予定作業" : "予定タスク"}</small><strong>{display === "work" ? workCount : rows.length}<em>件</em></strong><span>この週に予定あり</span></article>
      </section>

      <section className="weekly-load-days">
        {days.map((date, index) => {
          const nonWorking = getNonWorkingPeriod(date, periods, workingDateOverrides);
          const tone = nonWorking ? "off" : loadTone(dailyTotals[index], capacity);
          const ratio = nonWorking ? 0 : Math.min(100, dailyTotals[index] / capacity * 100);
          return <article key={date} className={`${tone} ${date === today ? "today" : ""}`}>
            <header><span>{weekdayLabel(date)}曜日</span><strong>{dateLabel(date)}</strong></header>
            <b>{nonWorking ? "休み" : hoursLabel(dailyTotals[index])}</b>
            <div><i style={{ width: `${ratio}%` }} /></div>
            <small>{nonWorking ? nonWorking.note || "非稼働日" : dailyTotals[index] > capacity ? `${hoursLabel(dailyTotals[index] - capacity)}超過` : `${hoursLabel(capacity - dailyTotals[index])}空き`}</small>
          </article>;
        })}
      </section>

      <section className="weekly-load-table-panel">
        <header><div><strong>{display === "work" ? "タスク ＞ 作業の予定配分" : "タスク別の予定配分"}</strong><small>{display === "work" ? "タスク行で作業を開閉できます。タスク名を選ぶと編集画面を開きます。" : "タスク名を選ぶと編集画面を開きます。"}</small></div><span>{display === "work" ? `${workCount}作業` : `${rows.length}件`}</span></header>
        <div className="weekly-load-table-scroll">
          <table className="weekly-load-table">
            <thead><tr><th>タスク</th>{days.map((date) => <th key={date}><span>{weekdayLabel(date)}</span><small>{dateLabel(date)}</small></th>)}<th>合計</th></tr><tr className="weekly-load-total-row"><th>合計</th>{dailyTotals.map((value, index) => <th key={days[index]} className={value > capacity ? "over" : value >= capacity * .8 ? "high" : ""}><strong>{hoursLabel(value)}</strong><small>{getNonWorkingPeriod(days[index], periods, workingDateOverrides) ? "休み" : value > capacity ? `${hoursLabel(value - capacity)}超過` : `${hoursLabel(capacity - value)}空き`}</small></th>)}<th><strong>{hoursLabel(total)}</strong><small>週間</small></th></tr></thead>
            <tbody>{rows.map((row) => {
              const tag = tags.find((item) => item.id === row.task.projectTagId);
              const collapsed = collapsedTaskIds.has(row.task.id);
              const taskRow = <tr className={display === "work" ? "weekly-load-task-group" : ""}><th><span className="weekly-load-task-heading">{display === "work" && <button type="button" className="weekly-load-collapse" aria-label={`${row.task.title}の作業を${collapsed ? "開く" : "閉じる"}`} onClick={() => toggleTask(row.task.id)}>{collapsed ? "▶" : "▼"}</button>}<button type="button" className="weekly-load-task-link" onClick={() => onSelect(row.task.id)}>{tag && <TagIcon tag={tag} />}<span><strong>{row.task.title || "名称のないタスク"}</strong>{tag && <small>{tag.name}</small>}</span></button>{display === "work" && <em>{row.works.length}作業</em>}</span></th>{row.daily.map((value, index) => <td key={days[index]} className={value > capacity ? "over" : value >= capacity * .8 ? "high" : ""}>{value > 0 ? hoursLabel(value) : "—"}</td>)}<td><strong>{hoursLabel(row.total)}</strong></td></tr>;
              if (display === "task") return <Fragment key={row.task.id}>{taskRow}</Fragment>;
              return <Fragment key={row.task.id}>{taskRow}{!collapsed && row.works.map((work) => <tr className="weekly-load-work-row" key={`${row.task.id}:${work.id}`}><th><span><i>└</i><button type="button" title="この作業の予定を調整" onClick={() => onSelect(row.task.id)}><strong>{work.title}</strong><small>{work.period}</small></button></span></th>{work.daily.map((value, index) => <td key={days[index]}>{value > 0 ? hoursLabel(value) : "—"}</td>)}<td><strong>{hoursLabel(work.total)}</strong></td></tr>)}</Fragment>;
            })}</tbody>
          </table>
          {!rows.length && <p className="weekly-load-empty">この週に予定工数が設定されたタスクはありません。</p>}
        </div>
      </section>
      <footer className="weekly-load-legend"><span className="normal">余裕あり</span><span className="high">上限の80%以上</span><span className="over">上限超過</span><small>作業の予定工数を稼働日へ均等に配分します。作業工数がない場合はタスク全体の予定工数を表示します。</small></footer>
    </div>
  </Modal>;
}
