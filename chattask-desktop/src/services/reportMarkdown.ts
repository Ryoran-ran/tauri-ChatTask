import { STATUS_LABELS, isTerminalStatus } from "../data/constants";
import type { ActivityEvent, Goal, NonWorkingPeriod, ProjectTag, Task } from "../types";
import { addDays, formatDateTime, localDateValue, plannedRangeHoursForDate, rangeDates } from "../utils";

export type ReportPeriod = "daily" | "weekly" | "monthly" | "custom";

interface ReportSource {
  period: ReportPeriod;
  from: string;
  to: string;
  tagId: string;
  tasks: Task[];
  projects: Goal[];
  tags: ProjectTag[];
  activity: ActivityEvent[];
  dailyNotes: Record<string, string>;
  nonWorkingPeriods: NonWorkingPeriod[];
}

interface WorkSummary {
  id: string;
  title: string;
  planned: number;
  actual: number;
  fallbackPlanned: number;
  fallbackActual: number;
  records: number;
  latestMemo: string;
}

interface TaskWorkSummary {
  task: Task;
  works: WorkSummary[];
  planned: number;
  actual: number;
}

const rounded = (value: number) => Number(value.toFixed(2));
const hours = (value: number) => `${rounded(value)}h`;
const accuracy = (planned: number, actual: number) => planned > 0 && actual > 0
  ? Math.round(Math.min(planned, actual) / Math.max(planned, actual) * 100)
  : null;
const difference = (planned: number, actual: number) => {
  const value = rounded(actual - planned);
  return `${value > 0 ? "+" : ""}${value}h`;
};
const projectStatus = (status: Goal["status"]) => ({
  "not-started": "未着手",
  "in-progress": "進行中",
  paused: "保留",
  achieved: "達成",
  archived: "終了",
  cancelled: "中止",
})[status];
const workStatus = (status: NonNullable<Goal["workItems"]>[number]["status"]) => ({
  "not-started": "未着手",
  "in-progress": "進行中",
  done: "完了",
})[status];
const periodLabel = (period: ReportPeriod) => ({
  daily: "日次",
  weekly: "週次",
  monthly: "月次",
  custom: "期間",
})[period];

const workingDateOverrides = () => {
  try {
    const stored = JSON.parse(localStorage.getItem("chatTaskWorkingDateOverrides") || "[]");
    return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
};

export const reportPeriodRange = (
  period: ReportPeriod,
  base: string,
  customStart: string,
  customEnd: string,
): [string, string] => {
  if (period === "custom") return [customStart, customEnd];
  if (period === "daily") return [base, base];
  const date = new Date(`${base}T00:00:00Z`);
  if (period === "weekly") {
    const weekday = date.getUTCDay() || 7;
    const start = addDays(base, 1 - weekday);
    return [start, addDays(start, 6)];
  }
  const start = `${base.slice(0, 7)}-01`;
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return [start, end];
};

const summarizeTaskWork = (
  tasks: Task[],
  from: string,
  to: string,
  periods: NonWorkingPeriod[],
): TaskWorkSummary[] => {
  const days = rangeDates([{ id: "report-period", startDate: from, endDate: to }]);
  const dateOverrides = workingDateOverrides();

  return tasks.flatMap((task) => {
    const works = new Map<string, WorkSummary>();
    const ensureWork = (id: string, title: string) => {
      const current = works.get(id) || {
        id,
        title,
        planned: 0,
        actual: 0,
        fallbackPlanned: 0,
        fallbackActual: 0,
        records: 0,
        latestMemo: "",
      };
      works.set(id, current);
      return current;
    };

    task.plannedRanges.forEach((range) => {
      const planned = days.reduce(
        (sum, date) => sum + plannedRangeHoursForDate(range, date, periods, dateOverrides),
        0,
      );
      const actual = Object.entries(task.dailyActualHours || {})
        .filter(([key]) => key.slice(0, 10) >= from
          && key.slice(0, 10) <= to
          && key.includes("::")
          && key.slice(key.indexOf("::") + 2) === range.id)
        .reduce((sum, [, value]) => sum + (Number(value) || 0), 0);
      if (planned <= 0 && actual <= 0) return;
      const title = range.title?.trim()
        || range.description?.trim().split("\n")[0]
        || range.note?.trim().split("\n")[0]
        || "名称のない作業";
      const work = ensureWork(`range:${range.id}`, title);
      work.planned += planned;
      work.actual += actual;
    });

    Object.entries(task.dailyActualHours || {}).forEach(([key, value]) => {
      const date = key.slice(0, 10);
      if (date < from || date > to || key.includes("::") || Number(value) <= 0) return;
      ensureWork("task:unassigned", "タスク全体の作業").actual += Number(value) || 0;
    });

    task.history.forEach((entry) => {
      if (entry.type !== "comment" || !entry.workTitle) return;
      const date = localDateValue(entry.timestamp);
      if (date < from || date > to) return;
      const matchingRange = task.plannedRanges.find((range) => range.title?.trim() === entry.workTitle?.trim());
      const title = entry.workTitle.trim();
      const work = ensureWork(matchingRange ? `range:${matchingRange.id}` : `history:${title}`, title);
      work.records += 1;
      work.fallbackPlanned += Math.max(0, Number(entry.workPlannedHours) || 0);
      work.fallbackActual += Math.max(0, Number(entry.workActualHours) || 0);
      if (entry.text.trim()) work.latestMemo = entry.text.trim();
    });

    const normalizedWorks = [...works.values()]
      .map((work) => ({
        ...work,
        planned: work.planned > 0 ? work.planned : work.fallbackPlanned,
        actual: work.actual > 0 ? work.actual : work.fallbackActual,
      }))
      .filter((work) => work.planned > 0 || work.actual > 0 || work.records > 0)
      .sort((a, b) => b.actual - a.actual || b.planned - a.planned || a.title.localeCompare(b.title, "ja"));
    if (!normalizedWorks.length) return [];
    return [{
      task,
      works: normalizedWorks,
      planned: normalizedWorks.reduce((sum, work) => sum + work.planned, 0),
      actual: normalizedWorks.reduce((sum, work) => sum + work.actual, 0),
    }];
  }).sort((a, b) => b.actual - a.actual || b.planned - a.planned || a.task.title.localeCompare(b.task.title, "ja"));
};

export const buildReportMarkdown = ({
  period,
  from,
  to,
  tagId,
  tasks,
  projects,
  tags,
  activity,
  dailyNotes,
  nonWorkingPeriods,
}: ReportSource) => {
  const matchesTag = (value: string) => tagId === "all" || (tagId === "none" ? !value : value === tagId);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const tagById = new Map(tags.map((tag) => [tag.id, tag]));
  const scopedTasks = tasks.filter((task) => matchesTag(task.projectTagId));
  const events = activity.filter((event) => {
    const date = localDateValue(event.timestamp);
    return date >= from && date <= to && matchesTag(event.projectTagId);
  }).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const cancelledCompletionIds = new Set(activity
    .filter((event) => event.type === "task-completion-cancelled")
    .map((event) => event.details?.completionEventId)
    .filter((id): id is string => typeof id === "string"));
  const completionEvents = events.filter((event) => event.type === "task-completed" && !cancelledCompletionIds.has(event.id));
  const completionTaskIds = new Set(completionEvents.map((event) => event.taskId).filter(Boolean));
  const legacyDone = scopedTasks.filter((task) => task.status === "done"
    && !completionTaskIds.has(task.id)
    && task.completedAt
    && localDateValue(task.completedAt) >= from
    && localDateValue(task.completedAt) <= to);
  const stopped = scopedTasks.filter((task) => (task.status === "cancelled" || task.status === "handed-over")
    && task.completedAt
    && localDateValue(task.completedAt) >= from
    && localDateValue(task.completedAt) <= to);
  const completedSchedules = scopedTasks.flatMap((task) => task.plannedRanges
    .filter((range) => range.status === "completed"
      && ((range.completedAt && localDateValue(range.completedAt) >= from && localDateValue(range.completedAt) <= to)
        || (!range.completedAt && range.endDate >= from && range.endDate <= to)))
    .map((range) => ({ task, range })));
  const recurrenceRecords = scopedTasks.flatMap((task) => task.recurrenceRecords
    .filter((record) => (record.actualDate || record.date) >= from && (record.actualDate || record.date) <= to)
    .map((record) => ({ task, record })));
  const workRows = summarizeTaskWork(scopedTasks, from, to, nonWorkingPeriods);
  const plannedHours = workRows.reduce((sum, row) => sum + row.planned, 0);
  const actualHours = workRows.reduce((sum, row) => sum + row.actual, 0);
  const totalAccuracy = accuracy(plannedHours, actualHours);
  const tagLabel = tagId === "all" ? "すべて" : tagId === "none" ? "タグなし" : tagById.get(tagId)?.name || "不明";
  const lines = [
    `# ${periodLabel(period)}まとめ`,
    "",
    `- 出力日時: ${new Date().toLocaleString("ja-JP")}`,
    `- 期間: ${from}〜${to}`,
    `- 案件タグ: ${tagLabel}`,
    "",
    "## サマリー",
    `- 完了したタスク: ${completionEvents.length + legacyDone.length}件`,
    `- 完了した作業・定期予定: ${completedSchedules.length + recurrenceRecords.filter(({ record }) => record.status === "done").length}件`,
    `- 予定工数: ${hours(plannedHours)}`,
    `- 実績工数: ${hours(actualHours)}`,
    `- 差分: ${difference(plannedHours, actualHours)}`,
    `- 見積精度: ${totalAccuracy === null ? "算出対象外" : `${totalAccuracy}%`}`,
    `- 中止・引き継ぎ: ${stopped.length}件`,
    "",
    "## 対応内容・工数（タスク ＞ 作業）",
  ];

  if (workRows.length) {
    workRows.forEach((row) => {
      const rowAccuracy = accuracy(row.planned, row.actual);
      const taskTag = tagById.get(row.task.projectTagId)?.name;
      lines.push(
        `### ${row.task.title || "名称のないタスク"}`,
        `- 状態: ${STATUS_LABELS[row.task.status]} / 優先度: ${row.task.priority}${taskTag ? ` / 案件: ${taskTag}` : ""}`,
        `- 合計: 予定 ${hours(row.planned)} / 実績 ${hours(row.actual)} / 差分 ${difference(row.planned, row.actual)} / 精度 ${rowAccuracy === null ? "—" : `${rowAccuracy}%`}`,
      );
      row.works.forEach((work) => {
        const workAccuracy = accuracy(work.planned, work.actual);
        lines.push(`  - **${work.title}**: 予定 ${hours(work.planned)} / 実績 ${hours(work.actual)} / 差分 ${difference(work.planned, work.actual)} / 精度 ${workAccuracy === null ? "—" : `${workAccuracy}%`}${work.records ? ` / 記録 ${work.records}件` : ""}`);
        if (work.latestMemo) lines.push(`    - 最新記録: ${work.latestMemo.replace(/\n/g, " ")}`);
      });
      lines.push("");
    });
  } else {
    lines.push("- この期間には、工数または対象作業が記録されていません。");
  }

  lines.push("", "## 完了したこと");
  const completed = [
    ...completionEvents.map((event) => {
      const task = event.taskId ? taskById.get(event.taskId) : undefined;
      return `- ${formatDateTime(event.timestamp)} **${event.taskTitle}**${task ? ` [優先度${task.priority}]` : ""}`;
    }),
    ...legacyDone.map((task) => `- ${formatDateTime(task.completedAt!)} **${task.title}** [優先度${task.priority}]`),
    ...completedSchedules.map(({ task, range }) => `- ${range.completedAt ? formatDateTime(range.completedAt) : range.endDate} **${task.title} ＞ ${range.title || "予定"}**${range.description ? `: ${range.description}` : ""}`),
    ...recurrenceRecords.filter(({ record }) => record.status === "done")
      .map(({ task, record }) => `- ${record.actualDate || record.date} **${task.title} ＞ 定期タスク**${record.memo ? `: ${record.memo}` : ""}`),
  ];
  lines.push(...(completed.length ? completed : ["- 該当する完了はありません。"]));

  lines.push("", "## 作業メモ・実施記録");
  const workEvents = events.filter((event) => ["memo", "daily-plan-completed", "recurrence-done"].includes(event.type)
    || /タイマーの実績|実績.*記録|対応済み/.test(event.summary));
  lines.push(...(workEvents.length
    ? workEvents.map((event) => `- ${formatDateTime(event.timestamp)} **${event.taskTitle || "今日のページ"}**: ${typeof event.details?.text === "string" ? event.details.text : event.summary}`)
    : ["- 該当する作業記録はありません。"]));

  lines.push("", "## 現在の対応状況");
  const currentTasks = scopedTasks
    .filter((task) => !isTerminalStatus(task.status)
      && (task.status === "doing" || task.status.startsWith("waiting") || task.status === "pending" || task.waitingFollowUp))
    .sort((a, b) => a.priority.localeCompare(b.priority) || a.title.localeCompare(b.title, "ja"));
  lines.push(...(currentTasks.length ? currentTasks.map((task) => {
    const waiting = task.waitingFollowUp;
    const detail = waiting
      ? [waiting.party && `相手 ${waiting.party}`, waiting.reviewDate && `次に見る日 ${waiting.reviewDate}`, waiting.memo].filter(Boolean).join(" / ")
      : "";
    return `- **${task.title}** [優先度${task.priority}]: ${STATUS_LABELS[task.status]}${detail ? `（${detail}）` : ""}`;
  }) : ["- 進行中・保留・確認待ちのタスクはありません。"]));

  lines.push("", "## 中止・引き継ぎ");
  lines.push(...(stopped.length
    ? stopped.map((task) => `- ${formatDateTime(task.completedAt!)} **${task.title}**: ${STATUS_LABELS[task.status]}`)
    : ["- 該当するタスクはありません。"]));

  lines.push("", "## 持ち越し・前倒し・予定変更");
  const moved = events.filter((event) => event.type === "recurrence-moved" || /持ち越|予定へ追加|前倒し|移動|日程.*変更/.test(event.summary));
  lines.push(...(moved.length
    ? moved.map((event) => `- ${formatDateTime(event.timestamp)} **${event.taskTitle}**: ${event.summary}`)
    : ["- 該当する予定変更はありません。"]));

  lines.push("", "## プロジェクト状況（プロジェクト ＞ マイルストーン ＞ 作業）");
  const scopedProjects = projects.filter((project) => matchesTag(project.projectTagId)
    && (project.status !== "archived" || project.updatedAt.slice(0, 10) >= from));
  if (scopedProjects.length) {
    scopedProjects.forEach((project) => {
      const milestones = project.milestones || [];
      const works = project.workItems || [];
      const achieved = milestones.filter((milestone) => milestone.completed || milestone.status === "achieved").length;
      const projectPlanned = works.reduce((sum, work) => sum + (Number(work.plannedHours) || 0), 0);
      const projectActual = works.reduce((sum, work) => sum + (Number(work.actualHours) || 0), 0);
      const projectAccuracy = accuracy(projectPlanned, projectActual);
      lines.push(
        `### ${project.title}`,
        `- 状態: ${projectStatus(project.status)} / 優先度: ${project.priority || "未設定"}`,
        `- マイルストーン: ${achieved}/${milestones.length} / 予定 ${hours(projectPlanned)} / 実績 ${hours(projectActual)} / 精度 ${projectAccuracy === null ? "—" : `${projectAccuracy}%`}`,
      );
      milestones.forEach((milestone) => {
        lines.push(`  - ${milestone.completed || milestone.status === "achieved" ? "[x]" : "[ ]"} **${milestone.title}**${milestone.dueDate ? `（期限 ${milestone.dueDate}）` : ""}`);
        works.filter((work) => work.milestoneId === milestone.id).forEach((work) => {
          lines.push(`    - ${work.status === "done" ? "[x]" : "[ ]"} ${work.title}（${workStatus(work.status)} / 予定 ${hours(work.plannedHours)} / 実績 ${hours(work.actualHours)}）`);
        });
      });
      works.filter((work) => !milestones.some((milestone) => milestone.id === work.milestoneId)).forEach((work) => {
        lines.push(`  - ${work.status === "done" ? "[x]" : "[ ]"} ${work.title}（マイルストーン未指定 / 予定 ${hours(work.plannedHours)} / 実績 ${hours(work.actualHours)}）`);
      });
      lines.push("");
    });
  } else {
    lines.push("- 該当するプロジェクトはありません。");
  }

  lines.push("", "## 日別の対応予定・結果");
  const plans = scopedTasks.flatMap((task) => Object.keys({
    ...task.dailyPlans,
    ...task.dailyPlanCompleted,
    ...(task.dailyPlanStatuses || {}),
  }).filter((key) => key.slice(0, 10) >= from && key.slice(0, 10) <= to).map((key) => ({ task, key })))
    .sort((a, b) => a.key.localeCompare(b.key));
  lines.push(...(plans.length ? plans.map(({ task, key }) => {
    const status = task.dailyPlanStatuses?.[key];
    return `- ${task.dailyPlanCompleted[key] ? "[x]" : "[ ]"} ${key.slice(0, 10)} **${task.title}**${status ? `（${STATUS_LABELS[status]}）` : ""}: ${task.dailyPlans[key] || "内容未入力"}${task.dailyActualHours?.[key] !== undefined ? ` / 実績 ${hours(Number(task.dailyActualHours[key]) || 0)}` : ""}`;
  }) : ["- 日別の対応予定はありません。"]));

  lines.push("", "## 関連ブランチ（現在）");
  const branches = scopedTasks.flatMap((task) => task.repositoryBranches.flatMap((group) => {
    const repository = tagById.get(task.projectTagId)?.githubRepositories?.find((item) => item.id === group.repositoryId);
    return group.branchNames.map((branch) => `- **${task.title}** ＞ ${repository?.name || "リポジトリ未設定"}: \`${branch}\``);
  }));
  lines.push(...(branches.length ? branches : ["- 関連ブランチは登録されていません。"]));

  lines.push("", "## 日次メモ");
  const notes = Object.entries(dailyNotes).filter(([date, text]) => date >= from && date <= to && text.trim());
  lines.push(...(notes.length ? notes.flatMap(([date, text]) => [`### ${date}`, text, ""]) : ["- 日次メモはありません。"]));

  lines.push("", "## 休暇・非稼働日", "- 土曜日・日曜日（自動設定）");
  const holidays = nonWorkingPeriods.filter((item) => item.startDate <= to && item.endDate >= from);
  lines.push(...(holidays.length ? holidays.map((item) => `- ${item.startDate === item.endDate ? item.startDate : `${item.startDate}〜${item.endDate}`} ${item.type === "holiday" ? "祝日" : item.type === "vacation" ? "休暇" : "非稼働日"}${item.note ? `: ${item.note}` : ""}`) : ["- 手動設定された休暇・非稼働日はありません。"]));

  lines.push("", "## 変更履歴（参考）");
  lines.push(...(events.length
    ? events.map((event) => `- ${formatDateTime(event.timestamp)}${event.taskTitle ? ` **${event.taskTitle}**` : ""}: ${event.summary}`)
    : ["- 該当する履歴はありません。"]));
  lines.push(
    "",
    "## AIへの依頼",
    "上記をもとに、成果、タスクごとの実施作業、工数と見積精度、課題・確認待ち、予定変更、プロジェクト進捗に整理してください。タスクと作業の階層を保ち、重複する記録は統合して、簡潔で読みやすい業務報告を作成してください。",
    "",
  );
  return lines.join("\n");
};
