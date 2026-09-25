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
    history: [], reflections: [],
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

/**
 * Repairs stale project ownership and exact array duplicates left by older
 * project-linking flows. Schedules with different IDs are never merged here:
 * matching dates, titles, hours and statuses do not prove that they are the
 * same user-created schedule.
 */
export const repairDuplicateProjectSchedules = (data: AppData): AppData => {
  let repaired = false;
  const tasks = data.tasks.map((task) => {
    let taskRepaired = false;
    const normalizedProjectRanges = task.plannedRanges.map((range) => {
      const hasProjectMetadata = Boolean(range.sourceType || range.sourceId);
      if (!hasProjectMetadata || isActiveProjectScheduleSource(data.goals, task.id, range.sourceType, range.sourceId)) return range;

      // Keep the user's schedule itself. Only release the stale project ownership
      // so it can be edited or deleted in the same way as an ordinary plan.
      const ordinaryRange = { ...range };
      delete ordinaryRange.sourceType;
      delete ordinaryRange.sourceId;
      repaired = true;
      taskRepaired = true;
      return ordinaryRange;
    });
    const fingerprintsById = new Map<string, Set<string>>();
    normalizedProjectRanges.forEach((range) => {
      const fingerprints = fingerprintsById.get(range.id) || new Set<string>();
      fingerprints.add(JSON.stringify(range));
      fingerprintsById.set(range.id, fingerprints);
    });
    const seenExactIds = new Set<string>();
    let removedExactDuplicate = false;
    const plannedRanges = normalizedProjectRanges.filter((range) => {
      // A reused ID with different contents is ambiguous, so preserve every entry.
      if ((fingerprintsById.get(range.id)?.size || 0) !== 1) return true;
      if (!seenExactIds.has(range.id)) {
        seenExactIds.add(range.id);
        return true;
      }
      repaired = true;
      taskRepaired = true;
      removedExactDuplicate = true;
      return false;
    });
    if (!taskRepaired) return task;
    return {
      ...task,
      plannedRanges,
      plannedHours: removedExactDuplicate
        ? plannedRanges.reduce((sum, range) => sum + (Number(range.plannedHours) || 0), 0)
        : task.plannedHours,
    };
  });
  return repaired ? { ...data, tasks } : data;
};
