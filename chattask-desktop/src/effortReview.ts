import { projectScheduleSource } from "./projectContext";
import { calculateEffortAccuracy, type EffortAccuracy } from "./taskProgress";
import type { Goal, PlannedRange, Task } from "./types";
import { addDays, todayValue } from "./utils";

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
}

export interface EffortReviewSummary {
  startDate: string;
  endDate: string;
  entries: EffortReviewEntry[];
  measuredEntries: EffortReviewEntry[];
  plannedHours: number;
  actualHours: number;
  accuracy: EffortAccuracy;
  missingPlannedCount: number;
  missingActualCount: number;
}

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
): EffortReviewSummary => {
  const startDate = addDays(endDate, -(periodDays - 1));
  const entries = tasks.flatMap((task) => [...task.plannedRanges, ...(task.unscheduledPlans || [])].flatMap((range) => {
    const source = projectScheduleSource(projects, task.id, range);
    const project = projectCompletion(projects, range);
    const completed = source ? source.status === "completed" : range.status === "completed";
    const completedDate = localDateValue(range.completedAt || project.completedAt || range.endDate);
    if (!completed || !completedDate || completedDate < startDate || completedDate > endDate) return [];
    const plannedHours = Math.max(0, Number(range.plannedHours) || 0);
    const actualHours = actualHoursForRange(task, range.id);
    const accuracy = calculateEffortAccuracy(plannedHours, actualHours);
    return [{
      id: `${task.id}:${range.id}`,
      taskId: task.id,
      taskTitle: task.title || "無題のタスク",
      scheduleTitle: range.title?.trim() || source?.title.trim() || "名称なしの予定",
      completedDate,
      plannedHours,
      actualHours,
      projectId: source?.projectId || project.projectId,
      ...accuracy,
    }];
  })).sort((a, b) => Math.abs(b.varianceHours) - Math.abs(a.varianceHours) || b.completedDate.localeCompare(a.completedDate));
  const measuredEntries = entries.filter((entry) => entry.reason === "ready");
  const plannedHours = measuredEntries.reduce((sum, entry) => sum + entry.plannedHours, 0);
  const actualHours = measuredEntries.reduce((sum, entry) => sum + entry.actualHours, 0);
  const totalVariance = actualHours - plannedHours;
  const absoluteVariance = measuredEntries.reduce((sum, entry) => sum + Math.abs(entry.varianceHours), 0);
  const accuracy: EffortAccuracy = measuredEntries.length === 0
    ? calculateEffortAccuracy(plannedHours, actualHours)
    : {
      accuracyPercent: Math.max(0, Math.round(100 - absoluteVariance / plannedHours * 100)),
      varianceHours: totalVariance,
      variancePercent: totalVariance / plannedHours * 100,
      reason: "ready",
    };

  return {
    startDate,
    endDate,
    entries,
    measuredEntries,
    plannedHours,
    actualHours,
    accuracy,
    missingPlannedCount: entries.filter((entry) => entry.reason === "planned-missing").length,
    missingActualCount: entries.filter((entry) => entry.reason === "actual-missing").length,
  };
};
