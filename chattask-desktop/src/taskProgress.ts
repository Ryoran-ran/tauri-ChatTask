import { WAITING_STATUSES, isTerminalStatus } from "./data/constants";
import type { Task } from "./types";

export type WbsStatus = "notStarted" | "inProgress" | "waiting" | "completed";

export interface TaskProgressSummary {
  childCount: number;
  completedCount: number;
  counts: Record<WbsStatus, number>;
  progressPercent: number;
  progressBasis: "effort" | "count";
  plannedHours: number;
  actualHours: number;
  nextTasks: Task[];
}

const taskPlannedHours = (task: Task) => {
  const scheduleTotal = [...task.plannedRanges, ...(task.unscheduledPlans || [])]
    .reduce((sum, range) => sum + Math.max(0, Number(range.plannedHours) || 0), 0);
  return scheduleTotal || Math.max(0, Number(task.plannedHours) || 0);
};

const wbsStatus = (task: Task): WbsStatus => {
  if (isTerminalStatus(task.status)) return "completed";
  if (WAITING_STATUSES.includes(task.status) || task.waitingFollowUp) return "waiting";
  if (task.status === "doing" || task.status === "recurring") return "inProgress";
  return "notStarted";
};

const actionableOrder = (a: Task, b: Task) => {
  const statusRank = (task: Task) => task.status === "doing" ? 0 : 1;
  const priorityRank = { A: 0, B: 1, C: 2, D: 3 };
  return statusRank(a) - statusRank(b)
    || priorityRank[a.priority] - priorityRank[b.priority]
    || (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31")
    || a.createdAt.localeCompare(b.createdAt);
};

/** 親タスクに保存値を追加せず、現在の子タスクからWBS進捗を算出する。 */
export const summarizeTaskProgress = (parentId: string, allTasks: Task[]): TaskProgressSummary => {
  const children = allTasks.filter((task) => task.parentTaskId === parentId);
  const counts: Record<WbsStatus, number> = { notStarted: 0, inProgress: 0, waiting: 0, completed: 0 };
  children.forEach((task) => { counts[wbsStatus(task)] += 1; });

  const plannedByChild = children.map(taskPlannedHours);
  const plannedHours = plannedByChild.reduce((sum, hours) => sum + hours, 0);
  const actualHours = children.reduce((sum, task) => sum + Math.max(0, Number(task.actualHours) || 0), 0);
  const completedCount = counts.completed;
  const progressBasis = plannedHours > 0 ? "effort" : "count";
  const completedEffort = children.reduce((sum, task, index) =>
    sum + (wbsStatus(task) === "completed" ? plannedByChild[index] : 0), 0);
  const progressPercent = children.length === 0 ? 0 : Math.round(
    progressBasis === "effort" ? completedEffort / plannedHours * 100 : completedCount / children.length * 100,
  );

  const descendants: Task[] = [];
  const visited = new Set<string>([parentId]);
  const collect = (id: string) => {
    allTasks.filter((task) => task.parentTaskId === id).forEach((task) => {
      if (visited.has(task.id)) return;
      visited.add(task.id);
      descendants.push(task);
      collect(task.id);
    });
  };
  collect(parentId);
  const childIdsWithChildren = new Set(descendants.map((task) => task.parentTaskId));
  const actionable = descendants.filter((task) =>
    !isTerminalStatus(task.status)
    && !WAITING_STATUSES.includes(task.status)
    && !task.waitingFollowUp);
  const leafTasks = actionable.filter((task) => !childIdsWithChildren.has(task.id));

  return {
    childCount: children.length,
    completedCount,
    counts,
    progressPercent: Number.isFinite(progressPercent) ? progressPercent : 0,
    progressBasis,
    plannedHours,
    actualHours,
    nextTasks: (leafTasks.length ? leafTasks : actionable).sort(actionableOrder).slice(0, 3),
  };
};
