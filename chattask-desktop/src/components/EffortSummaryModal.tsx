import { useMemo, useState } from "react";
import type { Goal, ProjectTag, Task } from "../types";
import { Modal } from "./Modal";
import { TagIcon } from "./TagIcon";

type EffortDetail = { id: string; taskTitle: string; scheduleTitle: string; hours: number; carried: boolean };
type EffortRow = { task: Task; tag?: ProjectTag; dailyHours: number; totalHours: number; details: EffortDetail[] };

const formatHours = (hours: number) => Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

export function EffortSummaryModal({ tasks, projects, tags, date, onClose }: { tasks: Task[]; projects: Goal[]; tags: ProjectTag[]; date: string; onClose: () => void }) {
  const [tagId, setTagId] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedTaskId, setCopiedTaskId] = useState("");
  const rows = useMemo<EffortRow[]>(() => {
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const rootOf = (task: Task) => {
      let current = task;
      const visited = new Set([task.id]);
      while (current.parentTaskId) {
        const parent = taskById.get(current.parentTaskId);
        if (!parent || visited.has(parent.id)) break;
        visited.add(parent.id);
        current = parent;
      }
      return current;
    };
    const sourceTitle = (sourceType?: string, sourceId?: string) => {
      if (!sourceId) return "";
      for (const project of projects) {
        if (sourceType === "project-work") {
          const work = (project.workItems || []).find((item) => item.id === sourceId);
          if (work) return work.title;
        }
        if (sourceType === "project-milestone") {
          const milestone = project.milestones.find((item) => item.id === sourceId);
          if (milestone) return milestone.title;
        }
      }
      return "";
    };
    const groups = new Map<string, EffortRow>();
    tasks.forEach((task) => {
      Object.entries(task.dailyActualHours || {}).forEach(([key, rawHours]) => {
        if (key !== date && !key.startsWith(`${date}::`)) return;
        const hours = Number(rawHours) || 0;
        if (hours <= 0) return;
        const rangeId = key.includes("::") ? key.slice(key.indexOf("::") + 2) : "";
        const range = rangeId ? task.plannedRanges.find((item) => item.id === rangeId) : undefined;
        const root = rootOf(task);
        const current = groups.get(root.id) || {
          task: root,
          tag: tags.find((tag) => tag.id === (root.projectTagId || task.projectTagId)),
          dailyHours: 0,
          totalHours: 0,
          details: [],
        };
        current.dailyHours += hours;
        current.details.push({
          id: `${task.id}:${key}`,
          taskTitle: task.title,
          scheduleTitle: range?.title?.trim() || sourceTitle(range?.sourceType, range?.sourceId) || range?.description?.trim().split("\n")[0] || task.title,
          hours,
          carried: Boolean(range?.carriedOverFrom || range?.carriedOverDates?.length),
        });
        groups.set(root.id, current);
      });
    });
    groups.forEach((row) => {
      const members = tasks.filter((task) => rootOf(task).id === row.task.id);
      row.totalHours = members.reduce((sum, task) => sum + Object.values(task.dailyActualHours || {}).reduce((taskSum, hours) => taskSum + (Number(hours) || 0), 0), 0);
    });
    return [...groups.values()].sort((a, b) => (a.tag?.name || "タグなし").localeCompare(b.tag?.name || "タグなし", "ja") || b.dailyHours - a.dailyHours || a.task.title.localeCompare(b.task.title, "ja"));
  }, [date, projects, tags, tasks]);
  const visibleRows = rows.filter((row) => !tagId || row.tag?.id === tagId);
  const dailyTotal = visibleRows.reduce((sum, row) => sum + row.dailyHours, 0);
  const activeTags = tags.filter((tag) => rows.some((row) => row.tag?.id === tag.id));
  const tableText = [
    ["日付", "案件タグ", "タスク", "当日の実績(h)", "累計実績(h)", "内訳"],
    ...visibleRows.map((row) => [date, row.tag?.name || "タグなし", row.task.title, formatHours(row.dailyHours), formatHours(row.totalHours), row.details.map((detail) => `${detail.scheduleTitle} ${formatHours(detail.hours)}h`).join(" / ")]),
    ["", "", "合計", formatHours(dailyTotal), "", ""],
  ].map((columns) => columns.join("\t")).join("\n");
  const copyTable = async () => {
    await navigator.clipboard.writeText(tableText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const copyTaskTitle = async (task: Task) => {
    await navigator.clipboard.writeText(task.title);
    setCopiedTaskId(task.id);
    window.setTimeout(() => setCopiedTaskId((current) => current === task.id ? "" : current), 1600);
  };
  const exportCsv = () => {
    const csv = [
      ["日付", "案件タグ", "タスク", "当日の実績(h)", "累計実績(h)", "内訳"],
      ...visibleRows.map((row) => [date, row.tag?.name || "タグなし", row.task.title, formatHours(row.dailyHours), formatHours(row.totalHours), row.details.map((detail) => `${detail.scheduleTitle} ${formatHours(detail.hours)}h`).join(" / ")]),
      ["", "", "合計", formatHours(dailyTotal), "", ""],
    ].map((columns) => columns.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `工数集計_${date}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return <Modal title={`工数集計・${date.replace(/-/g, "/")}`} onClose={onClose} wide>
    <div className="effort-summary">
      <header className="effort-summary-head"><div><small>当日の実績工数</small><strong>{formatHours(dailyTotal)}h</strong><span>{visibleRows.length}タスク</span></div><label>案件タグ<select value={tagId} onChange={(event) => setTagId(event.target.value)}><option value="">すべて</option>{activeTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label><div><button type="button" onClick={() => void copyTable()}>{copied ? "コピーしました" : "表をコピー"}</button><button type="button" className="primary" onClick={exportCsv}>CSV出力</button></div></header>
      <div className={`effort-summary-table ${visibleRows.length ? "has-rows" : "is-empty"}`}><div className="effort-summary-table-head"><span>案件タグ</span><span>タスク</span><span>当日</span><span>累計</span></div>{visibleRows.map((row) => <details key={row.task.id} className="effort-summary-row"><summary><span>{row.tag ? <><TagIcon tag={row.tag} /><b>{row.tag.name}</b></> : <><i /><b>タグなし</b></>}</span><span className="effort-summary-task-title"><strong>{row.task.title}</strong><button type="button" className={copiedTaskId === row.task.id ? "copied" : ""} aria-label={`${row.task.title}をコピー`} title={copiedTaskId === row.task.id ? "コピーしました" : "タスク名をコピー"} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void copyTaskTitle(row.task); }}>{copiedTaskId === row.task.id ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4L19 7" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="10" height="11" rx="2" /><path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2" /></svg>}</button></span><b>{formatHours(row.dailyHours)}h</b><small>{formatHours(row.totalHours)}h</small></summary><div>{row.details.map((detail) => <div key={detail.id}><span><strong>{detail.scheduleTitle}</strong>{detail.taskTitle !== row.task.title && <small>関連Task：{detail.taskTitle}</small>}</span>{detail.carried && <em>持ち越し</em>}<b>{formatHours(detail.hours)}h</b></div>)}</div></details>)}{!visibleRows.length && <p className="effort-summary-empty">この日に記録された実績工数はありません。</p>}</div>
      <footer><span>実績工数の日付を基準に集計しています。未完了・持ち越し作業も含まれます。</span><strong>合計 {formatHours(dailyTotal)}h</strong></footer>
    </div>
  </Modal>;
}
