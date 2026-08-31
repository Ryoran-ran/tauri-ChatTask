import { useState } from "react";
import { STATUS_LABELS, isTerminalStatus } from "../data/constants";
import type { ActivityEvent, Goal, NonWorkingPeriod, ProjectTag, Task } from "../types";
import { addDays, formatDateTime, localDateValue, todayValue } from "../utils";
import { Modal } from "./Modal";
import { WorkDatePicker } from "./WorkDatePicker";

type Period = "daily" | "weekly" | "monthly" | "custom";
interface Props { tasks: Task[]; projects: Goal[]; tags: ProjectTag[]; activity: ActivityEvent[]; dailyNotes: Record<string, string>; nonWorkingPeriods: NonWorkingPeriod[]; onClose: () => void }

const hours = (value: number) => Number(value.toFixed(2));
const projectStatusLabel = (status: Goal["status"]) => ({ "not-started": "未着手", "in-progress": "進行中", paused: "保留", achieved: "達成", archived: "終了", cancelled: "中止" })[status];

export function ReportModal({ tasks, projects, tags, activity, dailyNotes, nonWorkingPeriods, onClose }: Props) {
  const [period, setPeriod] = useState<Period>("daily"), [base, setBase] = useState(todayValue()), [customStart, setCustomStart] = useState(todayValue()), [customEnd, setCustomEnd] = useState(todayValue()), [tag, setTag] = useState("all");
  const range = () => { if (period === "custom") return [customStart, customEnd]; if (period === "daily") return [base, base]; const date = new Date(`${base}T00:00:00Z`); if (period === "weekly") { const day = date.getUTCDay() || 7, start = addDays(base, 1 - day); return [start, addDays(start, 6)]; } const start = `${base.slice(0, 7)}-01`, end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10); return [start, end]; };
  const download = () => {
    const [from, to] = range(); if (!from || !to || to < from) return alert("期間を正しく指定してください。");
    const matchTag = (value: string) => tag === "all" || (tag === "none" ? !value : value === tag);
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const scopedTasks = tasks.filter((task) => matchTag(task.projectTagId));
    const events = activity.filter((item) => { const eventDate = localDateValue(item.timestamp); return eventDate >= from && eventDate <= to && matchTag(item.projectTagId); }).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const cancelledCompletionIds = new Set(activity.filter((item) => item.type === "task-completion-cancelled").map((item) => item.details?.completionEventId).filter((id): id is string => typeof id === "string"));
    const completionEvents = events.filter((item) => !cancelledCompletionIds.has(item.id) && item.type === "task-completed");
    const completionTaskIds = new Set(completionEvents.map((item) => item.taskId).filter(Boolean));
    const legacyDone = scopedTasks.filter((task) => task.status === "done" && !completionTaskIds.has(task.id) && task.completedAt && localDateValue(task.completedAt) >= from && localDateValue(task.completedAt) <= to);
    const stopped = scopedTasks.filter((task) => (task.status === "cancelled" || task.status === "handed-over") && task.completedAt && localDateValue(task.completedAt) >= from && localDateValue(task.completedAt) <= to);
    const completedSchedules = scopedTasks.flatMap((task) => task.plannedRanges.filter((range) => range.status === "completed" && ((range.completedAt && localDateValue(range.completedAt) >= from && localDateValue(range.completedAt) <= to) || (!range.completedAt && range.endDate >= from && range.endDate <= to))).map((range) => ({ task, range })));
    const recurrenceRecords = scopedTasks.flatMap((task) => task.recurrenceRecords.filter((record) => (record.actualDate || record.date) >= from && (record.actualDate || record.date) <= to).map((record) => ({ task, record })));
    const plannedHours = scopedTasks.reduce((sum, task) => sum + task.plannedRanges.filter((range) => range.startDate <= to && range.endDate >= from).reduce((rangeSum, range) => rangeSum + (Number(range.plannedHours) || 0), 0), 0);
    const actualHours = scopedTasks.reduce((sum, task) => sum + Object.entries(task.dailyActualHours || {}).filter(([date]) => date >= from && date <= to).reduce((daySum, [, value]) => daySum + (Number(value) || 0), 0), 0);
    const accuracy = plannedHours > 0 ? Math.max(0, Math.round((1 - Math.abs(actualHours - plannedHours) / plannedHours) * 100)) : null;
    const completedCount = completionEvents.length + legacyDone.length + completedSchedules.length + recurrenceRecords.filter(({ record }) => record.status === "done").length;
    const tagLabel = tag === "all" ? "すべて" : tag === "none" ? "タグなし" : tags.find((item) => item.id === tag)?.name || "不明";
    const lines = [`# ${period === "daily" ? "日次" : period === "weekly" ? "週次" : period === "monthly" ? "月次" : "期間"}まとめ`, `期間: ${from}〜${to}`, `案件タグ: ${tagLabel}`, "", "## サマリー", `- 完了・達成: ${completedCount}件`, `- 予定工数: ${hours(plannedHours)}h`, `- 実績工数: ${hours(actualHours)}h`, `- 見積精度: ${accuracy === null ? "算出対象外" : `${accuracy}%`}`, `- 中止・引き継ぎ: ${stopped.length}件`];

    lines.push("", "## 完了・達成したこと");
    const doneLines = [
      ...completionEvents.map((event) => { const task = event.taskId ? taskById.get(event.taskId) : undefined; return `- ${formatDateTime(event.timestamp)} **${event.taskTitle}**${task ? ` [優先度${task.priority}]` : ""}`; }),
      ...legacyDone.map((task) => `- ${formatDateTime(task.completedAt!)} **${task.title}** [優先度${task.priority}]`),
      ...completedSchedules.map(({ task, range }) => `- ${range.completedAt ? formatDateTime(range.completedAt) : range.endDate} **${task.title} / ${range.title || "予定"}**${range.description ? `: ${range.description}` : ""}`),
      ...recurrenceRecords.filter(({ record }) => record.status === "done").map(({ task, record }) => `- ${record.actualDate || record.date} **${task.title}**（定期タスク）${record.memo ? `: ${record.memo}` : ""}`),
    ];
    lines.push(...(doneLines.length ? doneLines : ["- 該当する完了・達成はありません。"]))

    lines.push("", "## 実施内容・作業記録");
    const workEvents = events.filter((item) => ["memo", "daily-plan-completed", "recurrence-done"].includes(item.type) || /タイマーの実績|実績.*記録|対応済み/.test(item.summary));
    lines.push(...(workEvents.length ? workEvents.map((item) => `- ${formatDateTime(item.timestamp)} **${item.taskTitle || "今日のページ"}**: ${typeof item.details?.text === "string" ? item.details.text : item.summary}`) : ["- 該当する作業記録はありません。"]))

    lines.push("", "## 中止・引き継ぎ");
    lines.push(...(stopped.length ? stopped.map((task) => `- ${formatDateTime(task.completedAt!)} **${task.title}**: ${STATUS_LABELS[task.status]}`) : ["- 該当するタスクはありません。"]))

    lines.push("", "## 保留・確認待ち（現在）");
    const waiting = scopedTasks.filter((task) => (task.status.startsWith("waiting") || task.status === "pending") && !isTerminalStatus(task.status));
    lines.push(...(waiting.length ? waiting.map((task) => `- **${task.title}** [優先度${task.priority}]: ${STATUS_LABELS[task.status]}`) : ["- 該当するタスクはありません。"]))

    lines.push("", "## 持ち越し・前倒し・予定変更");
    const moved = events.filter((item) => item.type === "recurrence-moved" || /持ち越|予定へ追加|前倒し|移動|日程.*変更/.test(item.summary));
    lines.push(...(moved.length ? moved.map((item) => `- ${formatDateTime(item.timestamp)} **${item.taskTitle}**: ${item.summary}`) : ["- 該当する予定変更はありません。"]))

    lines.push("", "## プロジェクト・マイルストーン状況");
    const scopedProjects = projects.filter((project) => matchTag(project.projectTagId) && (project.status !== "archived" || project.updatedAt.slice(0, 10) >= from));
    lines.push(...(scopedProjects.length ? scopedProjects.flatMap((project) => {
      const milestones = project.milestones || [], achieved = milestones.filter((item) => item.completed || item.status === "achieved").length;
      const works = project.workItems || [], projectPlanned = works.reduce((sum, item) => sum + (Number(item.plannedHours) || 0), 0), projectActual = works.reduce((sum, item) => sum + (Number(item.actualHours) || 0), 0);
      const projectAccuracy = project.status === "achieved" && Math.max(projectPlanned, projectActual) > 0 ? Math.round(Math.min(projectPlanned, projectActual) / Math.max(projectPlanned, projectActual) * 100) : null;
      return [`- **${project.title}** [優先度${project.priority || "未設定"}]: ${projectStatusLabel(project.status)} / マイルストーン ${achieved}/${milestones.length} / 予定 ${hours(projectPlanned)}h・実績 ${hours(projectActual)}h${projectAccuracy === null ? "" : `・見積精度 ${projectAccuracy}%`}`, ...milestones.filter((item) => item.status === "in-progress" || item.status === "achieved" || item.completed).map((item) => `  - ${item.completed || item.status === "achieved" ? "[x]" : "[ ]"} ${item.title}${item.dueDate ? `（期限 ${item.dueDate}）` : ""}`)];
    }) : ["- 該当するプロジェクトはありません。"]))

    lines.push("", "## 日別の対応予定・結果");
    const plans = scopedTasks.flatMap((task) => Object.keys({ ...task.dailyPlans, ...task.dailyPlanCompleted, ...(task.dailyPlanStatuses || {}) }).filter((date) => date >= from && date <= to).map((date) => ({ task, date }))).sort((a, b) => a.date.localeCompare(b.date));
    lines.push(...(plans.length ? plans.map(({ task, date }) => { const status = task.dailyPlanStatuses?.[date]; return `- ${task.dailyPlanCompleted[date] ? "[x]" : "[ ]"} ${date} **${task.title}**${status ? `（${STATUS_LABELS[status]}）` : ""}: ${task.dailyPlans[date] || "内容未入力"}${task.dailyActualHours?.[date] !== undefined ? ` / 実績 ${hours(Number(task.dailyActualHours[date]) || 0)}h` : ""}`; }) : ["- 日別の対応予定はありません。"]))

    lines.push("", "## 日次メモ"); const notes = Object.entries(dailyNotes).filter(([date, text]) => date >= from && date <= to && text.trim()); lines.push(...(notes.length ? notes.flatMap(([date, text]) => [`### ${date}`, text, ""]) : ["- 日次メモはありません。"]))
    lines.push("", "## 休暇・非稼働日", "- 土曜日・日曜日（自動設定）"); const holidays = nonWorkingPeriods.filter((item) => item.startDate <= to && item.endDate >= from); lines.push(...(holidays.length ? holidays.map((item) => `- ${item.startDate === item.endDate ? item.startDate : `${item.startDate}〜${item.endDate}`} ${item.type === "holiday" ? "祝日" : item.type === "vacation" ? "休暇" : "非稼働日"}${item.note ? `: ${item.note}` : ""}`) : ["- 手動設定された休暇・非稼働日はありません。"]))
    lines.push("", "## 変更履歴（参考）", ...(events.length ? events.map((item) => `- ${formatDateTime(item.timestamp)}${item.taskTitle ? ` **${item.taskTitle}**` : ""}: ${item.summary}`) : ["- 該当する履歴はありません。"]))
    lines.push("", "## AIへの依頼", "上記をもとに、成果、実施内容、工数と見積精度、課題・確認待ち、予定変更、プロジェクト進捗に整理してください。重複する記録は統合し、簡潔で読みやすい業務報告を作成してください。", "");
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" }), url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = `chattask_${period}_${from}_${to}.md`; anchor.click(); URL.revokeObjectURL(url); onClose();
  };
  const [from, to] = range();
  return <Modal title="まとめ出力" onClose={onClose}><div className="report-form"><label>期間<select value={period} onChange={(event) => setPeriod(event.target.value as Period)}><option value="daily">日次</option><option value="weekly">週次</option><option value="monthly">月次</option><option value="custom">任意期間</option></select></label>{period === "custom" ? <div className="inline-form"><WorkDatePicker ariaLabel="出力期間の開始日" value={customStart} onChange={setCustomStart} allowClear={false} /><span>〜</span><WorkDatePicker ariaLabel="出力期間の終了日" value={customEnd} min={customStart} onChange={setCustomEnd} allowClear={false} /></div> : <label>基準日<WorkDatePicker ariaLabel="出力の基準日" value={base} onChange={setBase} allowClear={false} /></label>}<label>案件タグ<select value={tag} onChange={(event) => setTag(event.target.value)}><option value="all">すべて</option><option value="none">タグなし</option>{tags.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><p className="report-range">出力範囲: {from}〜{to}</p><p className="muted">Markdown形式で、完了・終了区分、工数精度、予定変更、定期タスク、プロジェクト進捗、日次メモなどをまとめて出力します。</p><div className="modal-actions"><button onClick={onClose}>キャンセル</button><button className="primary" onClick={download}>Markdownを出力</button></div></div></Modal>;
}
