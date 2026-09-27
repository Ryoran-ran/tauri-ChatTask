import type { Goal, GoalMilestone, ProjectWorkItem, Task } from "./types";

type ScheduleEntity = GoalMilestone | ProjectWorkItem | Task;
type FieldChange = { key: string; before: unknown; after: unknown };
type EntityChange = { id: string; title?: string; fields: FieldChange[]; guards: Record<string, unknown>; undefinedGuards?: string[] };
export interface ScheduleUndoEntry {
  projectId: string;
  label: string;
  works: EntityChange[];
  milestones: EntityChange[];
  tasks: EntityChange[];
  capacity?: { before: number; after: number };
}
/** SQLite/JSON再読込でオブジェクトのキー順が変わっても同じ値として扱う。配列順は保持。 */
export function scheduleValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => scheduleValuesEqual(value, b[index]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter(key => left[key] !== undefined);
  return keys.length === Object.keys(right).filter(key => right[key] !== undefined).length && keys.every(key => scheduleValuesEqual(left[key], right[key]));
}
const equal = scheduleValuesEqual;
const record = (value: object) => value as Record<string, unknown>;
const targetDates = new Set(["targetWorkStartDate", "targetWorkEndDate"]);

function entityChanges(before: ScheduleEntity[], after: ScheduleEntity[], guardKeys: string[]): EntityChange[] {
  if (before.length !== after.length || new Set(before.map(item => item.id)).size !== before.length || new Set(after.map(item => item.id)).size !== after.length) {
    throw new Error("登録・削除はスケジュールの取り消し対象外です。");
  }
  return after.flatMap(item => {
    const original = before.find(candidate => candidate.id === item.id);
    if (!original) throw new Error("取り消し対象を確認できません。");
    const fields = [...new Set([...Object.keys(original), ...Object.keys(item)])]
      .filter(key => key !== "updatedAt" && !equal(record(original)[key], record(item)[key]))
      .map(key => ({ key, before: targetDates.has(key) ? record(original)[key] ?? "" : record(original)[key], after: record(item)[key] }));
    return fields.length ? [{ id: item.id, title: item.title, fields, guards: Object.fromEntries(guardKeys.filter(key => record(item)[key] !== undefined).map(key => [key, record(item)[key]])), undefinedGuards: guardKeys.filter(key => record(item)[key] === undefined) }] : [];
  });
}

/** 表示用の値ではなく、変更直前の保存データから取り消し情報を作る。 */
export function createScheduleUndo(
  before: Goal, after: Goal, tasks: Task[], taskChanges: { id: string; changes: Partial<Task> }[], label: string,
  capacity?: { before: number; after: number },
): ScheduleUndoEntry | null {
  if (before.id !== after.id) throw new Error("プロジェクトが変更されています。");
  const affectedTasks = taskChanges.map(change => {
    const matches = tasks.filter(task => task.id === change.id);
    if (matches.length !== 1) throw new Error("関連タスクが見つからないか重複しています。");
    return matches[0];
  });
  const entry: ScheduleUndoEntry = {
    projectId: before.id, label,
    works: entityChanges(before.workItems || [], after.workItems || [], ["milestoneId", "linkedTaskId", "targetWorkStartDate", "targetWorkEndDate"]),
    milestones: entityChanges(before.milestones, after.milestones, ["linkedTaskId", "targetWorkStartDate", "targetWorkEndDate"]),
    tasks: entityChanges(affectedTasks, affectedTasks.map((task, index) => ({ ...task, ...taskChanges[index].changes })), []),
    ...(capacity && capacity.before !== capacity.after ? { capacity } : {}),
  };
  if (!entry.works.length && !entry.milestones.length && !entry.tasks.length && !entry.capacity) return null;
  return structuredClone(entry);
}

function restoreEntities<T extends ScheduleEntity>(current: T[], changes: EntityChange[]): T[] {
  // 全対象を検証してから返す。1件でも不一致なら呼び出し元は何も保存しない。
  for (const change of changes) {
    const matches = current.filter(item => item.id === change.id);
    if (matches.length !== 1) throw new Error("対象が削除されたか重複しているため、元に戻せません。");
    const item = record(matches[0]);
    if ((change.undefinedGuards || []).some(key => item[key] !== undefined)
      || Object.entries(change.guards).some(([key, value]) => !equal(item[key], value))
      || change.fields.some(field => !equal(item[field.key], field.after))) {
      throw new Error("操作後に対象のデータが変更されています。上書きを防ぐため、元に戻しませんでした。");
    }
  }
  return current.map(item => {
    const change = changes.find(candidate => candidate.id === item.id);
    if (!change) return item;
    const restored = { ...item };
    for (const field of change.fields) {
      if (field.before === undefined) delete record(restored)[field.key];
      else record(restored)[field.key] = structuredClone(field.before);
    }
    return restored;
  });
}

export function buildScheduleUndo(entry: ScheduleUndoEntry, project: Goal, tasks: Task[], dailyCapacity: number) {
  if (project.id !== entry.projectId) throw new Error("取り消し対象のプロジェクトが異なります。");
  if (entry.capacity && dailyCapacity !== entry.capacity.after) throw new Error("計画可能時間が変更されているため、元に戻せません。");
  const works = restoreEntities(project.workItems || [], entry.works);
  const milestones = restoreEntities(project.milestones, entry.milestones);
  const restoredTasks = restoreEntities(tasks, entry.tasks);
  const projectChanges: Partial<Goal> = {};
  if (entry.works.length) projectChanges.workItems = works;
  if (entry.milestones.length) projectChanges.milestones = milestones;
  return {
    projectChanges,
    taskChanges: entry.tasks.map(change => {
      const task = restoredTasks.find(item => item.id === change.id)!;
      const changes = Object.fromEntries(change.fields.map(field => [field.key, record(task)[field.key]])) as Partial<Task>;
      return { id: change.id, changes };
    }),
    capacity: entry.capacity?.before,
  };
}
