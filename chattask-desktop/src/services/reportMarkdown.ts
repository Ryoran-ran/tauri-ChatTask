import { STATUS_LABELS, isTerminalStatus } from "../data/constants";
import { calculateEffortAccuracy } from "../taskProgress";
import type { ActivityEvent, Goal, NonWorkingPeriod, ProjectTag, Task } from "../types";
import { addDays, formatDateTime, localDateValue, plannedRangeHoursForDate, rangeDates } from "../utils";

export type ReportPeriod = "daily" | "weekly" | "monthly" | "custom";
export type ReportPurpose = "business-report" | "effort-analysis";
export type ReportAnalysisScope = "effort" | "schedule" | "workload" | "task-management";

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
  purpose?: ReportPurpose;
  anonymizeTaskNames?: boolean;
  analysisScopes?: ReportAnalysisScope[];
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
const accuracy = (planned: number, actual: number) => calculateEffortAccuracy(planned, actual).accuracyPercent;
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
  purpose = "business-report",
  anonymizeTaskNames = false,
  analysisScopes = ["effort", "schedule", "workload", "task-management"],
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
  const taskAliases = new Map(scopedTasks.map((task, index) => [task.id, `タスク${String(index + 1).padStart(3, "0")}`]));
  const taskTokens = new Map(scopedTasks.map((task, index) => [task.id, `[[CHATTASK_ANON_${index + 1}]]`]));
  const taskLabel = (task: Task | undefined) => {
    if (!task) return anonymizeTaskNames ? "タスク（匿名）" : "名称のないタスク";
    return anonymizeTaskNames ? taskTokens.get(task.id) || "タスク（匿名）" : task.title || "名称のないタスク";
  };
  const eventTaskLabel = (event: ActivityEvent) => {
    if (!anonymizeTaskNames) return event.taskTitle || "";
    return event.taskId ? taskTokens.get(event.taskId) || "タスク（匿名）" : event.taskTitle ? "タスク（匿名）" : "";
  };
  const markdownCell = (value: string) => value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const anonymizeOutput = (content: string) => {
    if (!anonymizeTaskNames) return content;
    const tokenized = [...scopedTasks]
      .filter((task) => task.title.trim())
      .sort((a, b) => b.title.length - a.title.length)
      .reduce((result, task) => result.split(task.title).join(taskTokens.get(task.id) || "[[CHATTASK_ANON]]"), content);
    return scopedTasks.reduce((result, task) => result.split(taskTokens.get(task.id) || "[[CHATTASK_ANON]]").join(taskAliases.get(task.id) || "タスク（匿名）"), tokenized);
  };

  if (purpose === "effort-analysis") {
    const scopes = new Set(analysisScopes);
    const today = localDateValue(new Date().toISOString());
    const reportDays = rangeDates([{ id: "analysis-period", startDate: from, endDate: to }]);
    const taskWorkById = new Map(workRows.map((row) => [row.task.id, row]));
    const scheduleRows = scopedTasks.flatMap((task) => task.plannedRanges
      .filter((range) => range.startDate <= to && range.endDate >= from)
      .map((range) => {
        const work = taskWorkById.get(task.id)?.works.find((item) => item.id === `range:${range.id}`);
        const completed = range.status === "completed" || (isTerminalStatus(task.status) && task.status === "done");
        const status = completed ? "完了"
          : range.status === "in-progress" ? "進行中"
          : range.endDate < today ? "遅延"
          : range.startDate <= today ? "進行中" : "未着手";
        return {
          task,
          title: range.title?.trim() || range.description?.trim().split("\n")[0] || "名称のない予定",
          startDate: range.startDate,
          endDate: range.endDate,
          status,
          planned: work?.planned || 0,
          actual: work?.actual || 0,
        };
      }));
    const workloadRows = reportDays.map((date) => {
      const relatedTaskIds = new Set<string>();
      let planned = 0;
      let actual = 0;
      scopedTasks.forEach((task) => {
        const taskPlanned = task.plannedRanges.reduce((sum, range) => sum + plannedRangeHoursForDate(range, date, nonWorkingPeriods, workingDateOverrides()), 0);
        const taskActual = Object.entries(task.dailyActualHours || {})
          .filter(([key]) => key.slice(0, 10) === date)
          .reduce((sum, [, value]) => sum + Math.max(0, Number(value) || 0), 0);
        if (taskPlanned > 0 || taskActual > 0) relatedTaskIds.add(task.id);
        planned += taskPlanned;
        actual += taskActual;
      });
      return { date, planned, actual, taskCount: relatedTaskIds.size };
    }).filter((row) => row.planned > 0 || row.actual > 0);
    const analysisLines = [
      "# AI仕事分析データ",
      "",
      `- 出力日時: ${new Date().toLocaleString("ja-JP")}`,
      `- 対象期間: ${from}〜${to}`,
      `- 案件タグ: ${tagLabel}`,
      `- タスク名: ${anonymizeTaskNames ? "匿名化済み（同じタスクは同じID）" : "実名"}`,
      `- 分析対象: ${analysisScopes.map((scope) => ({ effort: "工数", schedule: "スケジュール進行", workload: "仕事量", "task-management": "タスク管理" })[scope]).join("・")}`,
      "",
    ];
    if (scopes.has("effort")) analysisLines.push(
      "## 工数・見積精度",
      `- 予定工数: ${hours(plannedHours)}`,
      `- 実績工数: ${hours(actualHours)}`,
      `- 差分: ${difference(plannedHours, actualHours)}`,
      `- 見積精度: ${totalAccuracy === null ? "算出対象外" : `${totalAccuracy}%`}`,
      "",
      "| タスク | 案件タグ | 状態 | 優先度 | 階層 | 予定 | 実績 | 差分 | 精度 |",
      "|---|---|---|---|---|---:|---:|---:|---:|",
      ...workRows.map((row) => {
        const rowAccuracy = accuracy(row.planned, row.actual);
        const taskTag = tagById.get(row.task.projectTagId)?.name || "タグなし";
        return `| ${markdownCell(taskLabel(row.task))} | ${markdownCell(taskTag)} | ${STATUS_LABELS[row.task.status]} | ${row.task.priority} | ${row.task.parentTaskId ? "子タスク" : "ルート"} | ${hours(row.planned)} | ${hours(row.actual)} | ${difference(row.planned, row.actual)} | ${rowAccuracy === null ? "—" : `${rowAccuracy}%`} |`;
      }),
      "",
      "### 作業別",
      "| タスク | 作業名 | 予定 | 実績 | 差分 | 精度 | 記録数 |",
      "|---|---|---:|---:|---:|---:|---:|",
      ...workRows.flatMap((row) => row.works.map((work) => {
        const workAccuracy = accuracy(work.planned, work.actual);
        return `| ${markdownCell(taskLabel(row.task))} | ${markdownCell(work.title)} | ${hours(work.planned)} | ${hours(work.actual)} | ${difference(work.planned, work.actual)} | ${workAccuracy === null ? "—" : `${workAccuracy}%`} | ${work.records} |`;
      })),
      "",
    );
    if (scopes.has("schedule")) {
      const completedSchedulesCount = scheduleRows.filter((row) => row.status === "完了").length;
      analysisLines.push(
        "## スケジュール進行",
        `- 対象予定: ${scheduleRows.length}件 / 完了: ${completedSchedulesCount}件 / 進行率: ${scheduleRows.length ? Math.round(completedSchedulesCount / scheduleRows.length * 100) : 0}%`,
        `- 遅延: ${scheduleRows.filter((row) => row.status === "遅延").length}件 / 進行中: ${scheduleRows.filter((row) => row.status === "進行中").length}件 / 未着手: ${scheduleRows.filter((row) => row.status === "未着手").length}件`,
        "",
        "| タスク | 予定名 | 開始 | 終了 | 状態 | 予定工数 | 実績工数 |",
        "|---|---|---|---|---|---:|---:|",
        ...scheduleRows.map((row) => `| ${markdownCell(taskLabel(row.task))} | ${markdownCell(row.title)} | ${row.startDate} | ${row.endDate} | ${row.status} | ${hours(row.planned)} | ${hours(row.actual)} |`),
        "",
      );
    }
    if (scopes.has("workload")) analysisLines.push(
      "## 日別の仕事量",
      "| 日付 | タスク数 | 予定工数 | 実績工数 | 差分 |",
      "|---|---:|---:|---:|---:|",
      ...(workloadRows.length ? workloadRows.map((row) => `| ${row.date} | ${row.taskCount} | ${hours(row.planned)} | ${hours(row.actual)} | ${difference(row.planned, row.actual)} |`) : ["| 対象データなし | 0 | 0h | 0h | 0h |"]),
      "",
    );
    if (scopes.has("task-management")) {
      const activeTasks = scopedTasks.filter((task) => !isTerminalStatus(task.status));
      const overdueTasks = activeTasks.filter((task) => (task.dueDate || task.reminderDate) && (task.dueDate || task.reminderDate) < today);
      analysisLines.push(
        "## タスク管理状況",
        `- 全タスク: ${scopedTasks.length}件 / 対応中: ${activeTasks.length}件 / 完了・終了: ${scopedTasks.length - activeTasks.length}件`,
        `- 期限超過: ${overdueTasks.length}件 / 待ち: ${activeTasks.filter((task) => task.waitingFollowUp || task.status.startsWith("waiting")).length}件 / 期限未設定: ${activeTasks.filter((task) => !(task.dueDate || task.reminderDate)).length}件`,
        "",
        "| タスク | 案件タグ | 状態 | 優先度 | 期限 | 子タスク数 | 予定数 |",
        "|---|---|---|---|---|---:|---:|",
        ...activeTasks.map((task) => `| ${markdownCell(taskLabel(task))} | ${markdownCell(tagById.get(task.projectTagId)?.name || "タグなし")} | ${STATUS_LABELS[task.status]} | ${task.priority} | ${task.dueDate || task.reminderDate || "未設定"} | ${scopedTasks.filter((candidate) => candidate.parentTaskId === task.id).length} | ${task.plannedRanges.length} |`),
        "",
        "### プロジェクト状況",
        "| プロジェクト | 状態 | 優先度 | マイルストーン完了 | 作業完了 |",
        "|---|---|---|---:|---:|",
        ...projects.filter((project) => matchesTag(project.projectTagId)).map((project) => `| ${markdownCell(project.title)} | ${projectStatus(project.status)} | ${project.priority || "未設定"} | ${project.milestones.filter((milestone) => milestone.completed || milestone.status === "achieved").length}/${project.milestones.length} | ${(project.workItems || []).filter((work) => work.status === "done").length}/${(project.workItems || []).length} |`),
        "",
      );
    }
    analysisLines.push(
      "## AIへの分析依頼",
      "あなたは、業務改善とタスク管理を支援するデータアナリストです。上記データから、現在の仕事の状態と改善策を分析してください。",
      "",
      "### 分析の原則",
      "- 表に記載された数値を再計算し、不明な値や記録されていない事情を推測で補完しない",
      "- 完了済みの結果と進行中の暫定値を分け、進行中の実績不足を過少工数と断定しない",
      "- 相関や傾向を因果関係として断定せず、確認が必要な点を明記する",
      "- データが3件未満の傾向はデータ不足、3〜4件は参考値、5件以上は比較可能として扱う",
      anonymizeTaskNames ? "- タスク名は匿名IDのため、予定名・作業名・案件タグを中心に分析する" : "- タスク名だけで同一作業と断定せず、予定名・作業名・案件タグも確認する",
      "",
      "### 分析してほしいこと",
      ...(scopes.has("effort") ? ["- 作業名の表記揺れを整理し、案件タグ・作業分類別の見積倍率、中央値、次回の推奨工数を示す"] : []),
      ...(scopes.has("schedule") ? ["- 遅延や停滞が起きている予定、予定期間に対して進行が遅いタスク、その共通点を示す"] : []),
      ...(scopes.has("workload") ? ["- 日別の仕事量の偏り、過密日・余裕日、平準化できる候補を示す"] : []),
      ...(scopes.has("task-management") ? ["- 期限超過、待ち、未着手、期限未設定、タスク分解の不足など管理上のリスクを優先順に示す"] : []),
      "",
      "### 回答形式",
      "以下の順番で、日本語のMarkdownとして回答してください。",
      "",
      "1. **要約**：重要な発見を3〜5件",
      "2. **数値で確認できる事実**：件数・日付・倍率・対象タスクIDなどの根拠を併記",
      "3. **リスク**：高・中・低の優先度と、放置した場合の影響",
      "4. **改善提案**：今日行うこと、今週行うこと、運用ルールの改善に分ける",
      "5. **見積もりへの反映**：推奨工数または補正倍率と、その根拠となる標本数",
      "6. **データ不足・確認事項**：判断できない点と、今後記録するとよい項目",
      "",
      "事実と提案を明確に分け、一般論ではなく、このデータから確認できる内容を優先してください。",
      "",
    );
    return anonymizeOutput(analysisLines.join("\n"));
  }
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
        `### ${taskLabel(row.task)}`,
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
      return `- ${formatDateTime(event.timestamp)} **${eventTaskLabel(event)}**${task ? ` [優先度${task.priority}]` : ""}`;
    }),
    ...legacyDone.map((task) => `- ${formatDateTime(task.completedAt!)} **${taskLabel(task)}** [優先度${task.priority}]`),
    ...completedSchedules.map(({ task, range }) => `- ${range.completedAt ? formatDateTime(range.completedAt) : range.endDate} **${taskLabel(task)} ＞ ${range.title || "予定"}**${range.description ? `: ${range.description}` : ""}`),
    ...recurrenceRecords.filter(({ record }) => record.status === "done")
      .map(({ task, record }) => `- ${record.actualDate || record.date} **${taskLabel(task)} ＞ 定期タスク**${record.memo ? `: ${record.memo}` : ""}`),
  ];
  lines.push(...(completed.length ? completed : ["- 該当する完了はありません。"]));

  lines.push("", "## 作業メモ・実施記録");
  const workEvents = events.filter((event) => ["memo", "daily-plan-completed", "recurrence-done"].includes(event.type)
    || /タイマーの実績|実績.*記録|対応済み/.test(event.summary));
  lines.push(...(workEvents.length
    ? workEvents.map((event) => `- ${formatDateTime(event.timestamp)} **${eventTaskLabel(event) || "今日のページ"}**: ${typeof event.details?.text === "string" ? event.details.text : event.summary}`)
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
    return `- **${taskLabel(task)}** [優先度${task.priority}]: ${STATUS_LABELS[task.status]}${detail ? `（${detail}）` : ""}`;
  }) : ["- 進行中・保留・確認待ちのタスクはありません。"]));

  lines.push("", "## 中止・引き継ぎ");
  lines.push(...(stopped.length
    ? stopped.map((task) => `- ${formatDateTime(task.completedAt!)} **${taskLabel(task)}**: ${STATUS_LABELS[task.status]}`)
    : ["- 該当するタスクはありません。"]));

  lines.push("", "## 持ち越し・前倒し・予定変更");
  const moved = events.filter((event) => event.type === "recurrence-moved" || /持ち越|予定へ追加|前倒し|移動|日程.*変更/.test(event.summary));
  lines.push(...(moved.length
    ? moved.map((event) => `- ${formatDateTime(event.timestamp)} **${eventTaskLabel(event)}**: ${event.summary}`)
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
    return `- ${task.dailyPlanCompleted[key] ? "[x]" : "[ ]"} ${key.slice(0, 10)} **${taskLabel(task)}**${status ? `（${STATUS_LABELS[status]}）` : ""}: ${task.dailyPlans[key] || "内容未入力"}${task.dailyActualHours?.[key] !== undefined ? ` / 実績 ${hours(Number(task.dailyActualHours[key]) || 0)}` : ""}`;
  }) : ["- 日別の対応予定はありません。"]));

  lines.push("", "## 関連ブランチ（現在）");
  const branches = scopedTasks.flatMap((task) => task.repositoryBranches.flatMap((group) => {
    const repository = tagById.get(task.projectTagId)?.githubRepositories?.find((item) => item.id === group.repositoryId);
    return group.branchNames.map((branch) => `- **${taskLabel(task)}** ＞ ${repository?.name || "リポジトリ未設定"}: \`${branch}\``);
  }));
  lines.push(...(branches.length ? branches : ["- 関連ブランチは登録されていません。"]));

  lines.push("", "## 日次メモ");
  const notes = Object.entries(dailyNotes).filter(([date, text]) => date >= from && date <= to && text.trim());
  lines.push(...(notes.length ? notes.flatMap(([date, text]) => [`### ${date}`, text, ""]) : ["- 日次メモはありません。"]));

  lines.push("", "## 休暇・非稼働日");
  const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];
  const weekendRules = nonWorkingPeriods.filter((item) => item.type === "weekend" && item.startDate <= to && (!item.endDate || item.endDate >= from));
  lines.push(...(weekendRules.length ? weekendRules.map((item) => `- ${item.startDate}から 定休日：${(item.weekdays || []).map((day) => `${weekdayLabels[day]}曜`).join("・") || "なし"}`) : ["- 土曜日・日曜日（初期設定）"]));
  const holidays = nonWorkingPeriods.filter((item) => item.type !== "weekend" && item.startDate <= to && item.endDate >= from);
  lines.push(...(holidays.length ? holidays.map((item) => `- ${item.startDate === item.endDate ? item.startDate : `${item.startDate}〜${item.endDate}`} ${item.type === "holiday" ? "祝日" : item.type === "vacation" ? "休暇" : "非稼働日"}${item.note ? `: ${item.note}` : ""}`) : ["- 手動設定された休暇・非稼働日はありません。"]));

  lines.push("", "## 変更履歴（参考）");
  lines.push(...(events.length
    ? events.map((event) => `- ${formatDateTime(event.timestamp)}${event.taskTitle ? ` **${eventTaskLabel(event)}**` : ""}: ${event.summary}`)
    : ["- 該当する履歴はありません。"]));
  lines.push(
    "",
    "## AIへの依頼",
    "上記をもとに、成果、タスクごとの実施作業、工数と見積精度、課題・確認待ち、予定変更、プロジェクト進捗に整理してください。タスクと作業の階層を保ち、重複する記録は統合して、簡潔で読みやすい業務報告を作成してください。",
    "",
  );
  return anonymizeOutput(lines.join("\n"));
};
