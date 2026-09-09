import type { AppData, HistoryEntry, Task } from "./types";
import { isActiveProjectScheduleSource } from "./projectContext";
import { generateId } from "./utils";

export const createTask = (parent?: Task): Task => {
  const now = new Date().toISOString();
  return {
    id: generateId(), title: "新規タスク", description: "", priority: "B", status: "todo",
    progressStatus: "not-started", waitingReason: "none", taskKind: "normal",
    projectTagId: parent?.projectTagId || "", parentTaskId: parent?.id || "", repositoryBranches: [], links: [], relatedTasks: [], nextAction: "",
    reminderDate: "", dueDate: "", isToday: false, plannedRanges: [], recurrence: null, recurrenceMemoTemplate: "", recurrenceRecords: [], dailyPlans: {},
    dailyPlanCompleted: {}, plannedHours: 0, actualHours: 0, dailyActualHours: {}, documents: [], createdAt: now, updatedAt: now, completedAt: null,
    history: [],
  };
};

export const appendHistory = (task: Task, text: string): HistoryEntry[] => [
  ...task.history,
  { id: generateId(), type: "system", text, timestamp: new Date().toISOString() },
];

export const jumpToTaskMatch = (query: string) => {
  window.setTimeout(() => {
    const root = document.querySelector<HTMLElement>(".detail");
    if (!root || !query) return;
    const normalized = query.toLocaleLowerCase("ja");
    const field = Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"))
      .find((element) => element.value.toLocaleLowerCase("ja").includes(normalized));
    if (field) {
      const start = field.value.toLocaleLowerCase("ja").indexOf(normalized);
      field.scrollIntoView({ block: "center" });
      field.focus();
      field.setSelectionRange(start, start + query.length);
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent || "";
      const start = text.toLocaleLowerCase("ja").indexOf(normalized);
      if (start >= 0) {
        const element = node.parentElement;
        if (!element) return;
        element.scrollIntoView({ block: "center" });
        element.classList.add("full-search-task-hit");
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, Math.min(text.length, start + query.length));
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        window.setTimeout(() => element.classList.remove("full-search-task-hit"), 2400);
        return;
      }
      node = walker.nextNode();
    }
  }, 80);
};

const scheduleDuplicateKey = (range: Task["plannedRanges"][number]) => JSON.stringify([
  range.startDate,
  range.endDate,
  (range.title || "").trim(),
  Number(range.plannedHours) || 0,
  range.status || "not-started",
]);

const canRepairScheduleDuplicate = (range: Task["plannedRanges"][number], canonical: Task["plannedRanges"][number]) => {
  const rangeSource = range.sourceType && range.sourceId ? `${range.sourceType}:${range.sourceId}` : "";
  const canonicalSource = canonical.sourceType && canonical.sourceId ? `${canonical.sourceType}:${canonical.sourceId}` : "";
  if (!rangeSource && !canonicalSource) return false;
  return !rangeSource || !canonicalSource || rangeSource === canonicalSource;
};

/** Repairs orphaned and duplicate schedules left by older project-linking flows. */
export const repairDuplicateProjectSchedules = (data: AppData): AppData => {
  let repaired = false;
  const tasks = data.tasks.map((task) => {
    const normalizedProjectRanges = task.plannedRanges.map((range) => {
      const hasProjectMetadata = Boolean(range.sourceType || range.sourceId);
      if (!hasProjectMetadata || isActiveProjectScheduleSource(data.goals, task.id, range.sourceType, range.sourceId)) return range;

      // Keep the user's schedule itself. Only release the stale project ownership
      // so it can be edited or deleted in the same way as an ordinary plan.
      const ordinaryRange = { ...range };
      delete ordinaryRange.sourceType;
      delete ordinaryRange.sourceId;
      repaired = true;
      return ordinaryRange;
    });
    const canonicalByKey = new Map<string, Task["plannedRanges"][number]>();
    normalizedProjectRanges.forEach((range) => {
      const key = scheduleDuplicateKey(range);
      const current = canonicalByKey.get(key);
      if (!current || (range.sourceId && !current.sourceId)) canonicalByKey.set(key, range);
    });
    const migratedIds = new Map<string, string>();
    const plannedRanges = normalizedProjectRanges.filter((range) => {
      const canonical = canonicalByKey.get(scheduleDuplicateKey(range));
      if (!canonical || canonical.id === range.id || !canRepairScheduleDuplicate(range, canonical)) return true;
      migratedIds.set(range.id, canonical.id);
      repaired = true;
      return false;
    });
    if (!migratedIds.size && plannedRanges.every((range, index) => range === task.plannedRanges[index])) return task;
    const migrateRecord = <T,>(record: Record<string, T> | undefined) => Object.fromEntries(
      Object.entries(record || {}).map(([key, value]) => {
        const separator = key.indexOf("::");
        if (separator < 0) return [key, value];
        const migratedId = migratedIds.get(key.slice(separator + 2));
        return [migratedId ? `${key.slice(0, separator)}::${migratedId}` : key, value];
      }),
    );
    return {
      ...task,
      plannedRanges,
      plannedHours: plannedRanges.reduce((sum, range) => sum + (Number(range.plannedHours) || 0), 0),
      dailyPlans: migrateRecord(task.dailyPlans),
      dailyPlanCompleted: migrateRecord(task.dailyPlanCompleted),
      dailyPlanStatuses: migrateRecord(task.dailyPlanStatuses),
      dailyActualHours: migrateRecord(task.dailyActualHours),
    };
  });
  return repaired ? { ...data, tasks } : data;
};
