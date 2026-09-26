import type { ProjectWorkItem } from "./types";

const order = (work: ProjectWorkItem) => Number.isFinite(work.scheduleSortOrder) ? work.scheduleSortOrder! : work.sortOrder ?? 0;
export const compareScheduleWorks = (a: ProjectWorkItem, b: ProjectWorkItem) => {
  const aDate = a.targetWorkStartDate || "";
  const bDate = b.targetWorkStartDate || "";
  if (aDate !== bDate) return !aDate ? 1 : !bDate ? -1 : aDate.localeCompare(bDate);
  return order(a) - order(b) || a.id.localeCompare(b.id);
};

export function sameStartScheduleWorks(works: ProjectWorkItem[], target: ProjectWorkItem) {
  if (!target.targetWorkStartDate) return [];
  return works.filter(work => (work.milestoneId || "") === (target.milestoneId || "")
    && work.targetWorkStartDate === target.targetWorkStartDate).sort(compareScheduleWorks);
}

/** 表示用の関連Task由来データを保存せず、保存済み作業の順序だけを一括更新する。 */
export function reorderScheduleWorks(stored: ProjectWorkItem[], displayed: ProjectWorkItem[], id: string, direction: -1 | 1) {
  const targets = displayed.filter(work => work.id === id);
  if (targets.length !== 1 || (direction !== -1 && direction !== 1)) return stored;
  const peers = sameStartScheduleWorks(displayed, targets[0]);
  const index = peers.findIndex(work => work.id === id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= peers.length) return stored;
  const ids = new Set(peers.map(work => work.id));
  if (ids.size !== peers.length || peers.some(work => stored.filter(item => item.id === work.id).length !== 1)) return stored;
  [peers[index], peers[next]] = [peers[next], peers[index]];
  const orders = new Map(peers.map((work, position) => [work.id, position]));
  return stored.map(work => orders.has(work.id) ? { ...work, scheduleSortOrder: orders.get(work.id)! } : work);
}
