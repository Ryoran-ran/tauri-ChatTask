import type { PlannedRange, ProjectWorkItem, Task } from "./types";

type ProjectScheduleItem = Pick<ProjectWorkItem, "id" | "plannedRanges">;

export interface ProjectActualResult {
  start: string;
  end: string;
  dates: string[];
  hours: number;
}

/**
 * Calculates project-item actuals from the linked task's daily records.
 * Daily records are the source of truth; the value stored on a work item is
 * only a compatibility fallback when the linked task no longer exists.
 */
export const projectItemActual = (
  task: Task | undefined,
  item: ProjectScheduleItem,
  sourceType: PlannedRange["sourceType"],
): ProjectActualResult => {
  if (!task) return { start: "", end: "", dates: [], hours: 0 };

  const itemRanges = item.plannedRanges || [];
  const linkedRanges = task.plannedRanges
    .filter((range) => range.sourceType === sourceType && range.sourceId === item.id);
  const rangeIds = new Set([...linkedRanges, ...itemRanges].map((range) => range.id));
  const fallbackRanges = itemRanges.length ? itemRanges : linkedRanges;
  const entries = Object.entries(task.dailyActualHours || {}).filter(([planKey, value]) => {
    if (Number(value) <= 0) return false;
    const separator = planKey.indexOf("::");
    if (separator >= 0) return rangeIds.has(planKey.slice(separator + 2));
    return fallbackRanges.some((range) => range.startDate <= planKey && range.endDate >= planKey);
  });
  const carriedWorkDates = linkedRanges
    .flatMap((range) => Object.entries(range.carriedOverWork || {})
      .filter(([, worked]) => worked)
      .map(([date]) => date));
  const dates = [...new Set([
    ...entries.map(([planKey]) => planKey.split("::")[0]),
    ...carriedWorkDates,
  ])].sort();

  return {
    start: dates[0] || "",
    end: dates[dates.length - 1] || "",
    dates,
    hours: entries.reduce((sum, [, value]) => sum + (Number(value) || 0), 0),
  };
};

export const effectiveProjectWorkActualHours = (work: ProjectWorkItem, linkedTask: Task | undefined) =>
  linkedTask ? projectItemActual(linkedTask, work, "project-work").hours : Number(work.actualHours) || 0;
