import type { Goal } from "./types";
import { migrateLegacyMilestoneProject } from "./projectLegacyMigration";

export interface ProjectEditContext {
  before: Goal;
  deletedWorkIds?: string[];
  deletedMilestoneIds?: string[];
  deletedMilestoneWorkDisposition?:
    | { kind: "detach" }
    | { kind: "delete" }
    | { kind: "move"; milestoneId: string };
}

const equal = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((value, index) => equal(value, b[index]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
  return keys.every(key => equal(left[key], right[key]));
};

/** 古い画面の一覧ではなく、操作で変えたフィールドだけを最新データへ適用する。 */
function mergeFields<T extends { id: string }>(current: T, before: T, after: Partial<T>): T {
  const result = { ...current };
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (key === "id" || key === "createdAt" || equal(before[key], after[key])) continue;
    Object.assign(result, { [key]: after[key] });
  }
  return result;
}

function mergeItems<T extends { id: string }>(current: T[], before: T[], after: T[], deletedIds: string[] = []): T[] {
  const deleted = new Set(deletedIds);
  const oldById = new Map(before.map(item => [item.id, item]));
  const nextById = new Map(after.map(item => [item.id, item]));
  const currentIds = new Set(current.map(item => item.id));
  // 一覧からの欠落は削除の意思ではない。削除操作が指定したIDだけを除く。
  const merged = current.filter(item => !deleted.has(item.id)).map(item => {
    const old = oldById.get(item.id), next = nextById.get(item.id);
    return old && next ? mergeFields(item, old, next) : item;
  });
  // 古い一覧に残る削除済み項目を復活させない。今回新規追加した項目だけを加える。
  return [...merged, ...after.filter(item => !currentIds.has(item.id) && !oldById.has(item.id) && !deleted.has(item.id))];
}

export function mergeProjectEdit(current: Goal, changes: Partial<Goal>, context: ProjectEditContext): Goal {
  if (current.id !== context.before.id) return current;
  // 旧形式が直接渡された場合も、表示と同じIDの実体を作ってから差分保存する。
  current = migrateLegacyMilestoneProject(current).project;
  const { workItems, milestones, ...fields } = changes;
  const result = mergeFields(current, context.before, fields);
  if (workItems) result.workItems = mergeItems(current.workItems || [], context.before.workItems || [], workItems, context.deletedWorkIds);
  if (milestones) result.milestones = mergeItems(current.milestones, context.before.milestones, milestones, context.deletedMilestoneIds);
  // 親を消す間に追加された子にも、確認画面で選んだ処置を同じように適用する。
  if (context.deletedMilestoneIds?.length) {
    const deletedMilestones = new Set(context.deletedMilestoneIds);
    const disposition = context.deletedMilestoneWorkDisposition || { kind: "detach" as const };
    if (disposition.kind === "delete") {
      result.workItems = (result.workItems || []).filter(work => !deletedMilestones.has(work.milestoneId));
    } else {
      const milestoneId = disposition.kind === "move" ? disposition.milestoneId : "";
      result.workItems = (result.workItems || []).map(work =>
        deletedMilestones.has(work.milestoneId) ? { ...work, milestoneId } : work);
    }
  }
  return result;
}
