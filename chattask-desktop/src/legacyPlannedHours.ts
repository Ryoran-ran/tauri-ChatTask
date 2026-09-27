import type { PlannedRange } from "./types";

/** 旧形式の合計を、工数が未入力の予定にのみ引き継ぐ。明示的な0は維持する。 */
export function inheritLegacyPlannedHours(ranges: PlannedRange[], total: number | undefined): PlannedRange[] {
  const missing = ranges.filter(range => range.plannedHours == null);
  if (!missing.length || total == null || !Number.isFinite(total) || total < 0) return ranges;
  const known = ranges.reduce((sum, range) => sum + (Number(range.plannedHours) || 0), 0);
  let remainder = Math.max(0, total - known);
  let remaining = missing.length;
  return ranges.map(range => {
    if (range.plannedHours != null) return range;
    // 最後に残差を渡し、小数工数の丸めによる合計の欠落を避ける。
    const plannedHours = remainder / remaining;
    remainder -= plannedHours;
    remaining--;
    return { ...range, plannedHours };
  });
}

export function inheritLegacyBaseline(ranges: PlannedRange[], baselines: PlannedRange[] | undefined, total: number | undefined): PlannedRange[] {
  if (baselines?.length) return inheritLegacyPlannedHours(baselines, total);
  if (total != null && total > 0) return inheritLegacyPlannedHours(ranges.map(range => ({ ...range, plannedHours: undefined })), total);
  return ranges;
}
