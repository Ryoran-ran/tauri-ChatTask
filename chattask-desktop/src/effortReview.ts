import { projectScheduleSource } from "./projectContext";
import { calculateEffortAccuracy, type EffortAccuracy } from "./taskProgress";
import type { Goal, NonWorkingPeriod, PlannedRange, Task } from "./types";
import { addDays, plannedRangeHoursForDate, todayValue } from "./utils";

export type EffortReviewPeriodDays = 7 | 30 | 90;

export interface EffortReviewEntry extends EffortAccuracy {
  id: string;
  taskId: string;
  taskTitle: string;
  scheduleTitle: string;
  completedDate: string;
  plannedHours: number;
  actualHours: number;
  projectId: string;
  kind: "completed-schedule" | "daily-work";
}

export interface EffortReviewTaskEntry extends EffortAccuracy {
  id: string;
  taskId: string;
  taskTitle: string;
  completedDate: string;
  scheduleTitles: string[];
  scheduleCount: number;
  measuredScheduleCount: number;
  plannedHours: number;
  actualHours: number;
  missingPlannedCount: number;
  missingActualCount: number;
  schedules: EffortReviewEntry[];
}

export interface EffortReviewSummary {
  startDate: string;
  endDate: string;
  entries: EffortReviewEntry[];
  measuredEntries: EffortReviewEntry[];
  taskEntries: EffortReviewTaskEntry[];
  plannedHours: number;
  actualHours: number;
  accuracy: EffortAccuracy;
  missingPlannedCount: number;
  missingActualCount: number;
}

const aggregateAccuracy = (entries: EffortReviewEntry[]): EffortAccuracy => {
  const measured = entries.filter((entry) => entry.reason === "ready");
  const planned = measured.reduce((sum, entry) => sum + entry.plannedHours, 0);
  const actual = measured.reduce((sum, entry) => sum + entry.actualHours, 0);
  if (measured.length === 0) return calculateEffortAccuracy(planned, actual);
  const absoluteVariance = measured.reduce((sum, entry) => sum + Math.abs(entry.varianceHours), 0);
  return {
    accuracyPercent: Math.max(0, Math.round(100 - absoluteVariance / planned * 100)),
    varianceHours: actual - planned,
    variancePercent: (actual - planned) / planned * 100,
    reason: "ready",
  };
};

const localDateValue = (value: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const actualHoursForRange = (task: Task, rangeId: string) => Object.entries(task.dailyActualHours || {})
  .filter(([key]) => key.includes("::") && key.split("::")[1] === rangeId)
  .reduce((sum, [, hours]) => sum + Math.max(0, Number(hours) || 0), 0);

const completedDailyWork = (task: Task, rangeId: string) => Object.entries(task.dailyPlanCompleted || {}).flatMap(([key, completed]) => {
  const separator = key.indexOf("::");
  if (!completed || separator < 0 || key.slice(separator + 2) !== rangeId) return [];
  return [{ key, date: key.slice(0, separator) }];
});

const projectCompletion = (projects: Goal[], range: PlannedRange) => {
  for (const project of projects) {
    if (range.sourceType === "project-work" && range.sourceId) {
      const work = (project.workItems || []).find((item) => item.id === range.sourceId);
      if (work) return { completedAt: work.completedAt || "", projectId: project.id };
    }
    if (range.sourceType === "project-milestone" && range.sourceId) {
      const milestone = project.milestones.find((item) => item.id === range.sourceId);
      if (milestone) return { completedAt: milestone.completedAt || "", projectId: project.id };
    }
  }
  return { completedAt: "", projectId: "" };
};

export const buildEffortReview = (
  tasks: Task[],
  projects: Goal[],
  periodDays: EffortReviewPeriodDays,
  endDate = todayValue(),
  nonWorkingPeriods: NonWorkingPeriod[] = [],
  workingDateOverrides: string[] = [],
): EffortReviewSummary => {
  const startDate = addDays(endDate, -(periodDays - 1));
  const entries = tasks.flatMap((task) => [...task.plannedRanges, ...(task.unscheduledPlans || [])].flatMap((range) => {
    const source = projectScheduleSource(projects, task.id, range);
    const project = projectCompletion(projects, range);
    const scheduleCompleted = source ? source.status === "completed" : range.status === "completed";
    const scheduleTitle = range.title?.trim() || source?.title.trim() || "名称なしの予定";
    const projectId = source?.projectId || project.projectId;
    const entry = (id: string, completedDate: string, plannedHours: number, actualHours: number, kind: EffortReviewEntry["kind"]): EffortReviewEntry => ({
      id,
      taskId: task.id,
      taskTitle: task.title || "無題のタスク",
      scheduleTitle,
      completedDate,
      plannedHours,
      actualHours,
      projectId,
      kind,
      ...calculateEffortAccuracy(plannedHours, actualHours),
    });
    if (scheduleCompleted) {
      const completedDate = localDateValue(range.completedAt || project.completedAt || range.endDate);
      if (!completedDate || completedDate < startDate || completedDate > endDate) return [];
      return [entry(
        `${task.id}:${range.id}`,
        completedDate,
        Math.max(0, Number(range.plannedHours) || 0),
        actualHoursForRange(task, range.id),
        "completed-schedule",
      )];
    }
    return completedDailyWork(task, range.id)
      .filter(({ date }) => date >= startDate && date <= endDate)
      .map(({ key, date }) => entry(
        `${task.id}:${range.id}:${date}`,
        date,
        plannedRangeHoursForDate(range, date, nonWorkingPeriods, workingDateOverrides),
        Math.max(0, Number(task.dailyActualHours?.[key]) || 0),
        "daily-work",
      ));
  })).sort((a, b) => Math.abs(b.varianceHours) - Math.abs(a.varianceHours) || b.completedDate.localeCompare(a.completedDate));
  const measuredEntries = entries.filter((entry) => entry.reason === "ready");
  const plannedHours = measuredEntries.reduce((sum, entry) => sum + entry.plannedHours, 0);
  const actualHours = measuredEntries.reduce((sum, entry) => sum + entry.actualHours, 0);
  const taskEntries = [...new Set(entries.map((entry) => entry.taskId))].map((taskId): EffortReviewTaskEntry => {
    const taskSchedules = entries.filter((entry) => entry.taskId === taskId);
    const measuredSchedules = taskSchedules.filter((entry) => entry.reason === "ready");
    const taskAccuracy = aggregateAccuracy(taskSchedules);
    return {
      id: taskId,
      taskId,
      taskTitle: taskSchedules[0].taskTitle,
      completedDate: taskSchedules.reduce((latest, entry) => entry.completedDate > latest ? entry.completedDate : latest, ""),
      scheduleTitles: taskSchedules.map((entry) => entry.scheduleTitle),
      scheduleCount: taskSchedules.length,
      measuredScheduleCount: measuredSchedules.length,
      plannedHours: measuredSchedules.reduce((sum, entry) => sum + entry.plannedHours, 0),
      actualHours: measuredSchedules.reduce((sum, entry) => sum + entry.actualHours, 0),
      missingPlannedCount: taskSchedules.filter((entry) => entry.reason === "planned-missing").length,
      missingActualCount: taskSchedules.filter((entry) => entry.reason === "actual-missing").length,
      schedules: taskSchedules,
      ...taskAccuracy,
    };
  }).sort((a, b) => Math.abs(b.varianceHours) - Math.abs(a.varianceHours) || b.completedDate.localeCompare(a.completedDate));

  return {
    startDate,
    endDate,
    entries,
    measuredEntries,
    taskEntries,
    plannedHours,
    actualHours,
    accuracy: aggregateAccuracy(entries),
    missingPlannedCount: entries.filter((entry) => entry.reason === "planned-missing").length,
    missingActualCount: entries.filter((entry) => entry.reason === "actual-missing").length,
  };
};
