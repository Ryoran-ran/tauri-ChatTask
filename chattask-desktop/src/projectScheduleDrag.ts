import type { NonWorkingPeriod } from "./types";
import { addDays, getNonWorkingPeriod } from "./utils";

export type ScheduleDragMode = "draw" | "move" | "start" | "end";
export interface ScheduleRange { start: string; end: string }
const MAX_DAYS = 3660;
export const scheduleDayOffset = (start: string, end: string) =>
  Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** 保存データには触れず、ドラッグ開始時の期間から常に計算する。 */
export function calculateScheduleDrag(
  mode: ScheduleDragMode, original: ScheduleRange, delta: number, periods: NonWorkingPeriod[],
): { range: ScheduleRange; error?: string } {
  if (!validDate(original.start) || !validDate(original.end) || original.end < original.start || !Number.isInteger(delta)) {
    return { range: original, error: "目標期間を確認してください。" };
  }
  if (delta === 0) return { range: original };
  if (mode === "draw") {
    const edge = addDays(original.start, delta);
    return { range: { start: edge < original.start ? edge : original.start, end: edge > original.start ? edge : original.start } };
  }
  if (mode === "start") return { range: { start: [addDays(original.start, delta), original.end].sort()[0], end: original.end } };
  if (mode === "end") return { range: { start: original.start, end: [addDays(original.end, delta), original.start].sort()[1] } };

  const days = scheduleDayOffset(original.start, original.end) + 1;
  if (days > MAX_DAYS) return { range: original, error: "期間が長すぎるため移動できません。日付入力で調整してください。" };
  let workingDays = 0;
  for (let i = 0; i < days; i += 1) {
    if (!getNonWorkingPeriod(addDays(original.start, i), periods)) workingDays += 1;
  }
  if (!workingDays) return { range: original, error: "営業日がない期間は移動できません。両端または日付入力で調整してください。" };

  let start = addDays(original.start, delta);
  const direction = delta > 0 ? 1 : -1;
  let skipped = 0;
  while (getNonWorkingPeriod(start, periods) && skipped < MAX_DAYS) {
    start = addDays(start, direction);
    skipped += 1;
  }
  if (getNonWorkingPeriod(start, periods)) return { range: original, error: "移動先の営業日が見つかりません。休日設定を確認してください。" };
  let remaining = workingDays;
  for (let i = 0; i < MAX_DAYS; i += 1) {
    const end = addDays(start, i);
    if (!getNonWorkingPeriod(end, periods)) remaining -= 1;
    if (remaining === 0) return { range: { start, end } };
  }
  return { range: original, error: "営業日数を維持できる期間が見つかりません。休日設定を確認してください。" };
}

/** 表示範囲外の期間を切り詰めても、元の保存期間は変更しない。 */
export function visibleScheduleRange(range: ScheduleRange | null, dates: string[]) {
  if (!range || !dates.length || range.end < dates[0] || range.start > dates[dates.length - 1] || range.end < range.start) return null;
  const start = scheduleDayOffset(dates[0], range.start);
  const end = scheduleDayOffset(dates[0], range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start: Math.max(0, start), end: Math.min(dates.length - 1, end), clippedStart: start < 0, clippedEnd: end >= dates.length };
}
