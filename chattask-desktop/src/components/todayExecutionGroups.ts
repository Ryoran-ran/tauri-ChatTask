import type { ActivityEvent, PlannedRange, Task } from "../types";

export type Occurrence = { task: Task; occurrenceDate: string };
export type ScheduledItem = { task: Task; range: PlannedRange; planKey: string; completionEvent?: ActivityEvent; carriedForward?: boolean };
export type ExecutionItem = { kind: "scheduled"; scheduled: ScheduledItem } | { kind: "recurring"; occurrence: Occurrence };
export type ExecutionGroup = { id: string; name: string; itemKeys: string[] };
export type ExecutionUnit = { key: string; group?: ExecutionGroup; items: ExecutionItem[] };

const executionGroupsStorageKey = (date: string) => `chatTaskTodayExecutionGroups:${date}`;

export const readExecutionGroups = (date: string): ExecutionGroup[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(executionGroupsStorageKey(date)) || "[]");
    return Array.isArray(stored) ? stored.filter((group) => group && typeof group.id === "string" && typeof group.name === "string" && Array.isArray(group.itemKeys)) : [];
  } catch {
    return [];
  }
};

export const saveExecutionGroups = (date: string, groups: ExecutionGroup[]) => {
  localStorage.setItem(executionGroupsStorageKey(date), JSON.stringify(groups));
};
