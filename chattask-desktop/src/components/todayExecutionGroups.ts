import type { ActivityEvent, PlannedRange, Task } from "../types";

export type Occurrence = { task: Task; occurrenceDate: string };
export type ScheduledItem = { task: Task; range: PlannedRange; planKey: string; completionEvent?: ActivityEvent; carriedForward?: boolean };
export type ExecutionItem = { kind: "scheduled"; scheduled: ScheduledItem } | { kind: "recurring"; occurrence: Occurrence };
export type ExecutionGroup = { id: string; name: string; itemKeys: string[] };
export type ExecutionUnit = { key: string; group?: ExecutionGroup; items: ExecutionItem[] };

// Reassign individual work items to a new, flat group. An item can only belong
// to one group; remaining groups keep their own member order and stay contiguous.
export function regroupExecutionItems(queueKeys: string[], groups: ExecutionGroup[], group: ExecutionGroup) {
  const activeKeys = new Set(queueKeys);
  const selectedKeys = new Set(group.itemKeys.filter((key) => activeKeys.has(key)));
  if (selectedKeys.size < 2) return null;

  const selectedItems = queueKeys.filter((key) => selectedKeys.has(key));
  const nextGroup = { ...group, itemKeys: selectedItems };
  const remainingGroups = groups.flatMap((existing) => {
    if (!existing.itemKeys.some((key) => selectedKeys.has(key))) return [existing];
    const itemKeys = existing.itemKeys.filter((key) => !selectedKeys.has(key));
    // Match removing a group member: a remaining single item becomes ungrouped.
    return itemKeys.filter((key) => activeKeys.has(key)).length >= 2 ? [{ ...existing, itemKeys }] : [];
  });
  const nextGroups = [...remainingGroups, nextGroup];
  const firstSelectedIndex = queueKeys.findIndex((key) => selectedKeys.has(key));
  const unselectedItems = queueKeys.filter((key) => !selectedKeys.has(key));
  const reordered = [...unselectedItems.slice(0, firstSelectedIndex), ...selectedItems, ...unselectedItems.slice(firstSelectedIndex)];

  const groupByKey = new Map(nextGroups.flatMap((candidate) => candidate.itemKeys.map((key) => [key, candidate] as const)));
  const emittedGroups = new Set<string>();
  const nextQueue = reordered.flatMap((key) => {
    const candidate = groupByKey.get(key);
    if (!candidate) return [key];
    if (emittedGroups.has(candidate.id)) return [];
    emittedGroups.add(candidate.id);
    return candidate.itemKeys.filter((itemKey) => activeKeys.has(itemKey));
  });
  return { groups: nextGroups, queueKeys: nextQueue };
}

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
