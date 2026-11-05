import type { ActivityEvent, PlannedRange, Task } from "../types";

export type Occurrence = { task: Task; occurrenceDate: string };
export type ScheduledItem = { task: Task; range: PlannedRange; planKey: string; completionEvent?: ActivityEvent; carriedForward?: boolean };
export type ExecutionItem = { kind: "scheduled"; scheduled: ScheduledItem } | { kind: "recurring"; occurrence: Occurrence };
export type ExecutionGroup = { id: string; name: string; itemKeys: string[] };
export type ExecutionUnit = { key: string; group?: ExecutionGroup; items: ExecutionItem[] };

export function reorderExecutionGroupMembers(group: ExecutionGroup, visibleKeys: string[], sourceKey: string, targetKey: string): string[] | null {
  const sourceIndex = visibleKeys.indexOf(sourceKey);
  const targetIndex = visibleKeys.indexOf(targetKey);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return null;
  const nextVisible = [...visibleKeys];
  const [moving] = nextVisible.splice(sourceIndex, 1);
  nextVisible.splice(targetIndex, 0, moving);
  const visibleSet = new Set(visibleKeys);
  let nextIndex = 0;
  return group.itemKeys.map((key) => visibleSet.has(key) ? nextVisible[nextIndex++] : key);
}

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

// Edit a group's visible members while retaining members temporarily outside
// today's active queue (for example, items on hold).
export function editExecutionGroup(queueKeys: string[], groups: ExecutionGroup[], groupId: string, name: string, selectedKeys: string[]) {
  const group = groups.find((candidate) => candidate.id === groupId);
  const trimmedName = name.trim();
  if (!group || !trimmedName) return null;

  const activeKeys = new Set(queueKeys);
  const selected = new Set(selectedKeys.filter((key) => activeKeys.has(key)));
  const selectedActive = queueKeys.filter((key) => selected.has(key));
  const retainedInactive = group.itemKeys.filter((key) => !activeKeys.has(key));
  if (!selectedActive.length || selectedActive.length + retainedInactive.length < 2) return null;

  let activeIndex = 0;
  const itemKeys = group.itemKeys.flatMap((key) => {
    if (!activeKeys.has(key)) return [key];
    return activeIndex < selectedActive.length ? [selectedActive[activeIndex++]] : [];
  });
  itemKeys.push(...selectedActive.slice(activeIndex));

  const nextGroups = groups.flatMap((candidate) => {
    if (candidate.id === groupId) return [{ ...candidate, name: trimmedName, itemKeys }];
    const remaining = candidate.itemKeys.filter((key) => !selected.has(key));
    return remaining.length >= 2 ? [{ ...candidate, itemKeys: remaining }] : [];
  });
  const firstSelectedIndex = queueKeys.findIndex((key) => selected.has(key));
  const unselected = queueKeys.filter((key) => !selected.has(key));
  const reordered = [...unselected.slice(0, firstSelectedIndex), ...selectedActive, ...unselected.slice(firstSelectedIndex)];
  const groupByKey = new Map(nextGroups.flatMap((candidate) => candidate.itemKeys.map((key) => [key, candidate] as const)));
  const emitted = new Set<string>();
  const nextQueue = reordered.flatMap((key) => {
    const candidate = groupByKey.get(key);
    if (!candidate) return [key];
    if (emitted.has(candidate.id)) return [];
    emitted.add(candidate.id);
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
