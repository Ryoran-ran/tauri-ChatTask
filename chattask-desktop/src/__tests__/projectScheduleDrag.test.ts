import { describe, expect, it } from "vitest";
import { calculateScheduleDrag, visibleScheduleRange } from "../projectScheduleDrag";
import type { NonWorkingPeriod } from "../types";

const range = { start: "2026-09-24", end: "2026-09-25" }; // 木・金の2営業日
describe("目標期間のドラッグ", () => {
  it("中央の移動は木金の2営業日を金月へ移す", () => {
    expect(calculateScheduleDrag("move", range, 1, [])).toEqual({ range: { start: "2026-09-25", end: "2026-09-28" } });
    expect(range).toEqual({ start: "2026-09-24", end: "2026-09-25" });
  });
  it("右に休日へ移動したら次の営業日に合わせる", () => {
    expect(calculateScheduleDrag("move", range, 2, []).range).toEqual({ start: "2026-09-28", end: "2026-09-29" });
  });
  it("左に休日へ移動したら前の営業日に合わせる", () => {
    expect(calculateScheduleDrag("move", { start: "2026-09-28", end: "2026-09-29" }, -1, []).range).toEqual({ start: "2026-09-25", end: "2026-09-28" });
  });
  it("祝日・休暇を飛ばして同じ営業日数を確保する", () => {
    const periods: NonWorkingPeriod[] = [{ id: "leave", type: "vacation", startDate: "2026-09-28", endDate: "2026-09-29" }];
    expect(calculateScheduleDrag("move", range, 1, periods).range).toEqual({ start: "2026-09-25", end: "2026-09-30" });
  });
  it("カスタム曜日休みと土日出勤の設定を使う", () => {
    const periods: NonWorkingPeriod[] = [{ id: "week", type: "weekend", startDate: "2026-01-01", endDate: "", weekdays: [3] }];
    expect(calculateScheduleDrag("move", range, 1, periods).range).toEqual({ start: "2026-09-25", end: "2026-09-26" });
  });
  it("途中をつかんでも元の開始日からの差分で移動し、営業日数を累積変更しない", () => {
    const original = { start: "2026-09-24", end: "2026-09-28" };
    expect(calculateScheduleDrag("move", original, 1, []).range).toEqual({ start: "2026-09-25", end: "2026-09-29" });
    expect(calculateScheduleDrag("move", original, 4, []).range).toEqual({ start: "2026-09-28", end: "2026-09-30" });
  });
  it.each(["move", "start", "end"] as const)("クリックだけなら休日を含む元の期間も変更しない: %s", mode => {
    const original = { start: "2026-09-26", end: "2026-09-29" };
    expect(calculateScheduleDrag(mode, original, 0, []).range).toEqual(original);
  });
  it("終了端のみ動かすと開始日を固定し休日の日付も選べる", () => {
    expect(calculateScheduleDrag("end", range, 1, []).range).toEqual({ start: "2026-09-24", end: "2026-09-26" });
  });
  it("開始端のみ動かすと終了日を固定する", () => {
    expect(calculateScheduleDrag("start", range, -5, []).range).toEqual({ start: "2026-09-19", end: "2026-09-25" });
  });
  it("両端は逆転させず1日で止まる", () => {
    expect(calculateScheduleDrag("start", range, 10, []).range).toEqual({ start: "2026-09-25", end: "2026-09-25" });
    expect(calculateScheduleDrag("end", range, -10, []).range).toEqual({ start: "2026-09-24", end: "2026-09-24" });
  });
  it("単日も1営業日のまま休日を越える", () => {
    expect(calculateScheduleDrag("move", { start: "2026-09-25", end: "2026-09-25" }, 1, []).range).toEqual({ start: "2026-09-28", end: "2026-09-28" });
  });
  it("空白からの逆方向の線引きもできる", () => {
    expect(calculateScheduleDrag("draw", { start: "2026-09-28", end: "2026-09-28" }, -3, []).range).toEqual({ start: "2026-09-25", end: "2026-09-28" });
  });
  it("営業日0日の移動は期間を変えず理由を返す", () => {
    const original = { start: "2026-09-26", end: "2026-09-27" };
    const result = calculateScheduleDrag("move", original, 1, []);
    expect(result.range).toEqual(original);
    expect(result.error).toContain("営業日がない");
  });
  it("移動先が全日休みでもループせず元の期間を守る", () => {
    const result = calculateScheduleDrag("move", range, 4, [{ id: "closed", type: "weekend", startDate: "2026-09-28", endDate: "", weekdays: [0, 1, 2, 3, 4, 5, 6] }]);
    expect(result.range).toEqual(range);
    expect(result.error).toBeTruthy();
  });
  it("移動先に十分な営業日がなくても期間を切り詰めない", () => {
    const result = calculateScheduleDrag("move", range, 1, [{ id: "closed", type: "weekend", startDate: "2026-09-26", endDate: "", weekdays: [0, 1, 2, 3, 4, 5, 6] }]);
    expect(result.range).toEqual(range);
    expect(result.error).toBeTruthy();
  });
  it("不正な日付は変更しない", () => {
    expect(calculateScheduleDrag("move", { start: "", end: "2026-09-25" }, 1, []).error).toBeTruthy();
  });
  it("年をまたいで移動できる", () => {
    expect(calculateScheduleDrag("move", { start: "2026-12-30", end: "2026-12-31" }, 2, []).range).toEqual({ start: "2027-01-01", end: "2027-01-04" });
  });
});
describe("表示範囲外の描画", () => {
  const dates = ["2026-09-25", "2026-09-26", "2026-09-27"];
  it("期間を保持したまま描画のみ切り取り、見えていない端は操作させない", () => {
    const original = { start: "2026-09-24", end: "2026-09-28" };
    expect(visibleScheduleRange(original, dates)).toEqual({ start: 0, end: 2, clippedStart: true, clippedEnd: true });
    expect(original).toEqual({ start: "2026-09-24", end: "2026-09-28" });
  });
  it("完全に範囲外なら表示しない", () => {
    expect(visibleScheduleRange({ start: "2026-09-28", end: "2026-09-29" }, dates)).toBeNull();
  });
});
