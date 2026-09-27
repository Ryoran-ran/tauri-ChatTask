import type { Goal, NonWorkingPeriod, ProjectWorkItem } from "./types";
import { addDays, getNonWorkingPeriod } from "./utils";
import { calculateScheduleDrag, scheduleDayOffset } from "./projectScheduleDrag";

const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`))
  && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

export function shiftByWorkingDays(date: string, days: number, periods: NonWorkingPeriod[]) {
  if (!validDate(date)) throw new Error("日付が未設定または不正です。");
  if (!Number.isInteger(days) || !days || Math.abs(days) > 365) throw new Error("移動日数は1〜365営業日で指定してください。");
  const direction = days > 0 ? 1 : -1;
  let remaining = Math.abs(days);
  let next = date;
  for (let i = 0; i < 3660; i++) {
    next = addDays(next, direction);
    if (!getNonWorkingPeriod(next, periods)) remaining--;
    if (!remaining) return next;
  }
  throw new Error("移動先の営業日が見つかりません。休日設定を確認してください。");
}

export function moveWorkByWorkingDays(work: ProjectWorkItem, days: number, periods: NonWorkingPeriod[]) {
  if (work.status === "done") throw new Error("完了済みの作業は対象外です。");
  const original = { start: work.targetWorkStartDate || "", end: work.targetWorkEndDate || "" };
  if (!validDate(original.start) || !validDate(original.end) || original.end < original.start) throw new Error("目標期間が未設定または不正です。");
  const start = shiftByWorkingDays(original.start, days, periods);
  const result = calculateScheduleDrag("move", original, scheduleDayOffset(original.start, start), periods);
  if (result.error) throw new Error(result.error);
  return { targetWorkStartDate: result.range.start, targetWorkEndDate: result.range.end };
}

export function batchMoveContextSignature(projects: Goal[], periods: NonWorkingPeriod[], capacity: number) {
  return JSON.stringify([capacity, periods, projects.map(project => [project.id, (project.workItems || []).map(work => [work.id, work.targetWorkStartDate, work.targetWorkEndDate, work.plannedHours, work.status])])]);
}

export interface BatchScheduleMoveRequest {
  projectId: string;
  milestoneId: string;
  milestoneSignature: string;
  works: { id: string; signature: string }[];
  days: number;
  moveDeadline: boolean;
  contextSignature: string;
}
export type MoveScheduleWorks = (request: BatchScheduleMoveRequest) => string | null;

/** 全件を検証してから、保存データの日付だけを変更するパッチを返す。 */
export function buildBatchScheduleMoveChanges(stored: Goal, displayed: Goal, projects: Goal[], periods: NonWorkingPeriod[], capacity: number, request: BatchScheduleMoveRequest): Partial<Goal> {
  if (stored.id !== request.projectId || displayed.id !== request.projectId) throw new Error("プロジェクトが変更されています。");
  if (!request.works.length) throw new Error("移動する作業を選択してください。");
  if (new Set(request.works.map(work => work.id)).size !== request.works.length) throw new Error("作業IDが重複しています。");
  const milestones = displayed.milestones.filter(item => item.id === request.milestoneId);
  if (milestones.length !== 1 || JSON.stringify(milestones[0]) !== request.milestoneSignature
    || stored.milestones.filter(item => item.id === request.milestoneId).length !== 1) throw new Error("確認中にマイルストーンが変更されました。開き直してください。");
  if (batchMoveContextSignature(projects, periods, capacity) !== request.contextSignature) throw new Error("確認中に予定・工数・休日設定が変更されました。開き直してください。");
  const patches = new Map<string, ReturnType<typeof moveWorkByWorkingDays>>();
  for (const selected of request.works) {
    const matches = (displayed.workItems || []).filter(item => item.id === selected.id);
    const saved = (stored.workItems || []).filter(item => item.id === selected.id);
    if (matches.length !== 1 || saved.length !== 1 || matches[0].milestoneId !== request.milestoneId || saved[0].milestoneId !== request.milestoneId
      || JSON.stringify(matches[0]) !== selected.signature || saved[0].linkedTaskId !== matches[0].linkedTaskId
      || saved[0].targetWorkStartDate !== matches[0].targetWorkStartDate || saved[0].targetWorkEndDate !== matches[0].targetWorkEndDate) {
      throw new Error("確認中に対象の作業が変更・削除されました。開き直してください。今回の移動は反映していません。");
    }
    patches.set(selected.id, moveWorkByWorkingDays(matches[0], request.days, periods));
  }
  const changes: Partial<Goal> = {};
  if (request.moveDeadline) {
    const dueDate = shiftByWorkingDays(milestones[0].dueDate || "", request.days, periods);
    changes.milestones = stored.milestones.map(item => item.id === request.milestoneId ? { ...item, dueDate } : item);
  }
  const now = new Date().toISOString();
  changes.workItems = (stored.workItems || []).map(work => patches.has(work.id) ? { ...work, ...patches.get(work.id), updatedAt: now } : work);
  return changes;
}
