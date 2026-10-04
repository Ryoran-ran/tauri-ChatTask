import type { AppData, Goal, Task } from "./types";
import { buildScheduleUndo, createScheduleUndo, scheduleValuesEqual, type ScheduleUndoEntry } from "./projectScheduleUndo";

export interface ScheduleHistoryRecord extends ScheduleUndoEntry {
  id: string;
  version: 1;
  createdAt: string;
  undoneAt?: string;
}
export type ScheduleCommand = { id: string; now: string; projectId: string } & (
  | { kind: "undo"; historyId: string }
  | { kind: "apply"; expectedProject: Goal; expectedTasks: Task[]; expectedCapacity: number; changes: Partial<Goal>; taskChanges: { id: string; changes: Partial<Task> }[]; capacity?: number; label: string }
);
export interface ScheduleResult { id: string; projectId: string; error?: string; recordId?: string; label?: string; undone?: boolean }
export interface ScheduleAppState { data: AppData; scheduleResult?: ScheduleResult }
export type ScheduleAppAction = { type: "data"; value: AppData | ((current: AppData) => AppData) } | { type: "schedule"; command: ScheduleCommand };
const equal = scheduleValuesEqual;
const fail = () => { throw new Error("操作後にデータが変更されています。上書きを防ぐため反映しませんでした。内容を確認してください。"); };

/** 表示用補完値を保存せず、操作による差分だけを保存データへ適用する。 */
export function scheduleChangesForStorage(raw: Goal, beforeView: Goal, changes: Partial<Goal>): Partial<Goal> {
  const diff = createScheduleUndo(beforeView, { ...beforeView, ...changes }, [], [], "差分");
  if (!diff) return {};
  const afterView = { ...beforeView, ...changes };
  const patch = <T extends { id: string; targetWorkStartDate?: string; targetWorkEndDate?: string }>(items: T[], changes: ScheduleUndoEntry["works"], viewed: T[]) => {
    if (changes.some(change => items.filter(item => item.id === change.id).length !== 1)) fail();
    return items.map(item => {
      const change = changes.find(change => change.id === item.id);
      if (!change) return item;
      const next = { ...item } as T & Record<string, unknown>;
      for (const field of change.fields) {
        if (field.after === undefined) delete next[field.key];
        else Object.assign(next, { [field.key]: structuredClone(field.after) });
      }
      // 旧データで表示時だけ補完されている場合も、片側だけ未定義にしない。
      if (change.fields.some(field => field.key === "targetWorkStartDate" || field.key === "targetWorkEndDate")) {
        const source = viewed.find(item => item.id === change.id)!;
        next.targetWorkStartDate = source.targetWorkStartDate || "";
        next.targetWorkEndDate = source.targetWorkEndDate || "";
      }
      return next;
    });
  };
  return { ...(diff.works.length ? { workItems: patch(raw.workItems || [], diff.works, afterView.workItems || []) } : {}), ...(diff.milestones.length ? { milestones: patch(raw.milestones, diff.milestones, afterView.milestones) } : {}) };
}

// インポートされた履歴にも適用する。未知バージョンや不正フィールドからの復元を拒否。
export function validateHistory(record: ScheduleHistoryRecord) {
  if (record.version !== 1 || !record.id || !record.projectId || !record.createdAt || !record.label) throw new Error("この履歴の形式には対応していません。");
  const allowed = new Set(["title", "milestoneId", "targetWorkStartDate", "targetWorkEndDate", "dueDate", "scheduleSortOrder", "plannedRanges", "plannedHours", "baselinePlannedRanges", "baselinePlannedHours", "replanReason", "replannedAt", "linkedTaskScheduleSnapshot", "linkedTaskPlannedHoursSnapshot"]);
  for (const group of [record.works, record.milestones, record.tasks]) {
    if (!Array.isArray(group) || new Set(group.map(item => item.id)).size !== group.length) throw new Error("履歴の対象が不正です。");
    for (const change of group) {
      if (!change.id || !Array.isArray(change.fields) || !change.guards || change.fields.some(field => !allowed.has(field.key))) throw new Error("履歴の変更項目が不正です。");
    }
  }
  if (record.capacity && [record.capacity.before, record.capacity.after].some(value => !Number.isFinite(value) || value < 0.25 || value > 24)) throw new Error("履歴の計画可能時間が不正です。");
}

export function historyUndoProblem(record: ScheduleHistoryRecord, project: Goal, tasks: Task[], capacity: number) {
  try {
    validateHistory(record);
    if (record.undoneAt) return "取り消し済み";
    buildScheduleUndo(record, project, tasks, capacity);
    return "";
  } catch (error) { return error instanceof Error ? error.message : "履歴を確認できません。"; }
}

/** 全検証が成功した場合だけ、Project・Task・設定・履歴を一つのAppDataとして返す。 */
export function applyScheduleCommand(data: AppData, command: ScheduleCommand): { data: AppData; result: ScheduleResult } {
  const matches = data.goals.filter(project => project.id === command.projectId);
  if (matches.length !== 1) throw new Error("プロジェクトが削除されたか重複しています。");
  const project = matches[0];
  const history = Array.isArray(project.scheduleHistory) ? project.scheduleHistory : [];
  const capacity = data.projectDailyCapacityHours || 6;
  let projectChanges: Partial<Goal>, taskChanges: { id: string; changes: Partial<Task> }[], nextCapacity: number | undefined;
  let nextHistory: ScheduleHistoryRecord[], record: ScheduleHistoryRecord;
  if (command.kind === "apply") {
    if (!equal(project, command.expectedProject) || capacity !== command.expectedCapacity) fail();
    if (history.some(item => item.id === command.id)) throw new Error("この操作は反映済みです。");
    for (const expected of command.expectedTasks) {
      const found = data.tasks.filter(task => task.id === expected.id);
      if (found.length !== 1 || !equal(found[0], expected)) fail();
    }
    if (command.taskChanges.some(change => !command.expectedTasks.some(task => task.id === change.id))) fail();
    projectChanges = command.changes; taskChanges = command.taskChanges; nextCapacity = command.capacity;
    const entry = createScheduleUndo(project, { ...project, ...projectChanges }, data.tasks, taskChanges, command.label,
      nextCapacity === undefined ? undefined : { before: capacity, after: nextCapacity });
    if (!entry) throw new Error("変更はありません。");
    record = { ...entry, id: command.id, createdAt: command.now, version: 1 };
    validateHistory(record);
    nextHistory = [record, ...history].slice(0, 50);
  } else {
    const found = history.filter(item => item.id === command.historyId);
    if (found.length !== 1) throw new Error("履歴が見つかりません。最新50件まで取り消せます。");
    record = found[0];
    const problem = historyUndoProblem(record, project, data.tasks, capacity);
    if (problem) throw new Error(problem);
    const restored = buildScheduleUndo(record, project, data.tasks, capacity);
    projectChanges = restored.projectChanges; taskChanges = restored.taskChanges; nextCapacity = restored.capacity;
    nextHistory = history.map(item => item.id === record.id ? { ...item, undoneAt: command.now } : item);
  }
  const updatedProject = { ...project, ...projectChanges, scheduleHistory: nextHistory, updatedAt: command.now };
  if (projectChanges.workItems) updatedProject.workItems = projectChanges.workItems.map(work => record.works.some(change => change.id === work.id) ? { ...work, updatedAt: command.now } : work);
  const nextTasks = data.tasks.map(task => {
    const patch = taskChanges.find(change => change.id === task.id);
    return patch ? { ...task, ...patch.changes, updatedAt: command.now } : task;
  });
  return { data: { ...data, goals: data.goals.map(item => item.id === project.id ? updatedProject : item), tasks: nextTasks,
    ...(nextCapacity !== undefined ? { projectDailyCapacityHours: nextCapacity } : {}) },
    result: { id: command.id, projectId: project.id, label: record.label, recordId: record.id, undone: command.kind === "undo" } };
}

export function scheduleAppReducer(state: ScheduleAppState, action: ScheduleAppAction): ScheduleAppState {
  if (action.type === "data") return { ...state, data: typeof action.value === "function" ? action.value(state.data) : action.value };
  try {
    const next = applyScheduleCommand(state.data, action.command);
    return { data: next.data, scheduleResult: next.result };
  } catch (error) {
    return { ...state, scheduleResult: { id: action.command.id, projectId: action.command.projectId, error: error instanceof Error ? error.message : "変更を反映できませんでした。" } };
  }
}
