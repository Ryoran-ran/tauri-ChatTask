import type { PlannedRange, ProjectWorkItem, Task } from "./types";
import { standaloneTaskScheduleSnapshot } from "./projectDataProtection";

export const batchRelatedTaskCandidates = (workItems: ProjectWorkItem[], milestoneId?: string) => workItems.filter((work) =>
  !work.linkedTaskId
  && Boolean(work.title.trim())
  && (milestoneId === undefined || work.milestoneId === milestoneId));

export const effectiveRelatedTaskId = (
  workId: string,
  defaultTaskId: string,
  individualWorkIds: string[],
  individualTaskIds: Record<string, string>,
) => individualWorkIds.includes(workId) ? individualTaskIds[workId] || "" : defaultTaskId;

const taskStatusForWork = (status: ProjectWorkItem["status"]): Task["status"] =>
  status === "done" ? "done" : status === "in-progress" ? "doing" : "todo";

export const plannedRangesForRelatedTask = (work: ProjectWorkItem, generateId: () => string): PlannedRange[] => {
  const stored = (work.plannedRanges || []).slice(0, 1);
  const ranges = stored.length ? stored : work.targetWorkStartDate ? [{
    id: generateId(),
    startDate: work.targetWorkStartDate,
    endDate: work.targetWorkEndDate && work.targetWorkEndDate >= work.targetWorkStartDate
      ? work.targetWorkEndDate : work.targetWorkStartDate,
    title: work.title.trim(),
    description: work.description,
    plannedHours: Math.max(0, Number(work.plannedHours) || 0),
  }] : [];
  return ranges.map((range) => ({
    ...range,
    title: work.title.trim(),
    plannedHours: Math.max(0, Number(work.plannedHours) || Number(range.plannedHours) || 0),
    status: work.status === "done" ? "completed" : work.status,
    completedAt: work.status === "done" ? work.completedAt : undefined,
  }));
};

export const relatedTaskChangesForWork = (
  work: ProjectWorkItem,
  projectTagId: string,
  plannedRanges: PlannedRange[],
): Partial<Task> => ({
  description: work.description,
  status: taskStatusForWork(work.status),
  priority: work.priority,
  projectTagId,
  reminderDate: work.dueDate || work.targetWorkEndDate || "",
  dueDate: work.dueDate || work.targetWorkEndDate || "",
  plannedHours: Math.max(0, Number(work.plannedHours) || 0),
  plannedRanges: plannedRanges.map((range) => ({ ...range, sourceType: "project-work", sourceId: work.id })),
});

export const linkedWorkChanges = (
  work: ProjectWorkItem,
  linkedTaskId: string,
  plannedRanges: PlannedRange[],
  now: string,
  linkedTask?: Task,
): ProjectWorkItem => ({
  ...work,
  linkedTaskId,
  plannedRanges,
  baselinePlannedRanges: work.baselinePlannedRanges?.length ? work.baselinePlannedRanges : plannedRanges,
  baselinePlannedHours: Number(work.baselinePlannedHours) > 0
    ? work.baselinePlannedHours : Math.max(0, Number(work.plannedHours) || 0),
  linkedTaskScheduleSnapshot: standaloneTaskScheduleSnapshot(linkedTask),
  linkedTaskPlannedHoursSnapshot: Number(linkedTask?.plannedHours) || 0,
  updatedAt: now,
});
