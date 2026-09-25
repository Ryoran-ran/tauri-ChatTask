import type { AppData, Goal, PlannedRange, Task } from "./types";
import { rangeDates } from "./utils";

export type ProjectScheduleRelease = {
  sourceType: NonNullable<PlannedRange["sourceType"]>;
  sourceId: string;
  snapshot: PlannedRange[];
};

/** Schedules owned by the Task itself, before a Project starts managing one. */
export const standaloneTaskScheduleSnapshot = (task: Task | undefined): PlannedRange[] =>
  task?.plannedRanges.filter((range) => !range.sourceType && !range.sourceId).map((range) => ({ ...range })) || [];

/** Move a record key without overwriting either value when the destination is occupied. */
export const remapRecordKeysWithoutOverwrite = <T,>(
  record: Record<string, T> | undefined,
  destinationFor: (key: string) => string,
): Record<string, T> => {
  const source = record || {};
  const result = { ...source };
  Object.entries(source).forEach(([key, value]) => {
    const destination = destinationFor(key);
    if (destination === key || Object.prototype.hasOwnProperty.call(result, destination)) return;
    result[destination] = value;
    delete result[key];
  });
  return result;
};

const scheduleHours = (ranges: PlannedRange[]) => ranges.reduce(
  (sum, range) => sum + (Number(range.plannedHours) || 0), 0,
);

const scheduleSignature = (ranges: PlannedRange[]) => JSON.stringify([...ranges].sort((a, b) =>
  a.startDate.localeCompare(b.startDate)
  || a.endDate.localeCompare(b.endDate)
  || (a.sourceType || "").localeCompare(b.sourceType || "")
  || (a.sourceId || "").localeCompare(b.sourceId || "")
  || a.id.localeCompare(b.id)));

export const syncProjectScheduleOnTask = (
  task: Task,
  plannedRanges: PlannedRange[],
  sourceType: NonNullable<PlannedRange["sourceType"]>,
  sourceId: string,
): Partial<Task> | null => {
  const transferredRangeIds = new Set(plannedRanges.map((range) => range.id));
  const transferredRangeKeys = new Set(plannedRanges.map((range) => JSON.stringify([
    range.startDate, range.endDate, (range.title || "").trim(),
    Number(range.plannedHours) || 0, range.status || "not-started",
  ])));
  const preserved = task.plannedRanges.filter((range) => !(range.sourceType === sourceType && range.sourceId === sourceId)
    && !transferredRangeIds.has(range.id)
    && !(!range.sourceId && transferredRangeKeys.has(JSON.stringify([
      range.startDate, range.endDate, (range.title || "").trim(),
      Number(range.plannedHours) || 0, range.status || "not-started",
    ]))));
  const projectRanges = plannedRanges.map((range) => ({ ...range, sourceType, sourceId }));
  const nextRanges = [...preserved, ...projectRanges];
  const nextPlannedHours = scheduleHours(nextRanges);
  if (scheduleSignature(nextRanges) === scheduleSignature(task.plannedRanges)
    && Number(task.plannedHours) === nextPlannedHours) return null;

  const managedKeyByDate = new Map(projectRanges.flatMap((range) =>
    rangeDates([range]).map((date) => [date, `${date}::${range.id}`] as const)));
  const migrate = <T,>(record: Record<string, T> | undefined) =>
    remapRecordKeysWithoutOverwrite(record, (key) => managedKeyByDate.get(key) || key);
  return {
    plannedRanges: nextRanges,
    plannedHours: nextPlannedHours,
    dailyPlans: migrate(task.dailyPlans),
    dailyPlanCompleted: migrate(task.dailyPlanCompleted),
    dailyPlanStatuses: migrate(task.dailyPlanStatuses),
    dailyActualHours: migrate(task.dailyActualHours),
  };
};

export const releaseProjectSchedulesFromTask = (
  task: Task,
  releases: ProjectScheduleRelease[],
): Partial<Task> | null => {
  if (!releases.length) return null;
  const releaseKeys = new Set(releases.map((release) => `${release.sourceType}\u0000${release.sourceId}`));
  const isReleased = (range: PlannedRange) => Boolean(range.sourceType && range.sourceId
    && releaseKeys.has(`${range.sourceType}\u0000${range.sourceId}`));
  const releasedRangeIds = new Set(task.plannedRanges.filter(isReleased).map((range) => range.id));
  const unrelatedRanges = task.plannedRanges.filter((range) => !isReleased(range));
  const unrelatedIds = new Set(unrelatedRanges.map((range) => range.id));
  const restoredIds = new Set<string>();
  const restoredTransferredRanges = releases.flatMap((release) => {
    const sourceRangeIds = new Set(task.plannedRanges
      .filter((range) => range.sourceType === release.sourceType && range.sourceId === release.sourceId)
      .map((range) => range.id));
    return release.snapshot
      .filter((range) => sourceRangeIds.has(range.id) && !unrelatedIds.has(range.id) && !restoredIds.has(range.id))
      .map((range) => {
        restoredIds.add(range.id);
        const restored = { ...range };
        delete restored.sourceType;
        delete restored.sourceId;
        return restored;
      });
  });
  const restored = [...unrelatedRanges, ...restoredTransferredRanges];
  const restoreKey = (key: string) => {
    const separator = key.indexOf("::");
    return separator >= 0 && releasedRangeIds.has(key.slice(separator + 2)) ? key.slice(0, separator) : key;
  };
  const restore = <T,>(record: Record<string, T> | undefined) =>
    remapRecordKeysWithoutOverwrite(record, restoreKey);
  return {
    plannedRanges: restored,
    plannedHours: scheduleHours(restored),
    dailyPlans: restore(task.dailyPlans),
    dailyPlanCompleted: restore(task.dailyPlanCompleted),
    dailyPlanStatuses: restore(task.dailyPlanStatuses),
    dailyActualHours: restore(task.dailyActualHours),
  };
};

export const changedProjectFields = (before: Goal, after: Goal): Partial<Goal> => {
  const changes: Partial<Goal> = {};
  (Object.keys(after) as (keyof Goal)[]).forEach((key) => {
    if (key === "id" || key === "createdAt" || key === "updatedAt") return;
    if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) Object.assign(changes, { [key]: after[key] });
  });
  return changes;
};

export const effectiveProjectChanges = (project: Goal, changes: Partial<Goal>): Partial<Goal> =>
  Object.fromEntries(Object.entries(changes).filter(([key, value]) =>
    JSON.stringify(project[key as keyof Goal]) !== JSON.stringify(value))) as Partial<Goal>;

export const ganttProjectWorkItems = (project: Goal) => {
  const validMilestoneIds = new Set(project.milestones.map((milestone) => milestone.id));
  return (project.workItems || []).filter((item) => !item.milestoneId || validMilestoneIds.has(item.milestoneId));
};

export const deleteProjectReferences = (data: AppData, projectId: string): AppData => ({
  ...data,
  goals: data.goals.filter((project) => project.id !== projectId),
  habits: data.habits.map((habit) => habit.projectId === projectId
    ? { ...habit, projectId: "", updatedAt: new Date().toISOString() }
    : habit),
});
