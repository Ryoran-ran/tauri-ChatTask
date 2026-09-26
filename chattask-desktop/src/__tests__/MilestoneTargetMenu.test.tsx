import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearMilestoneTargetChanges, MilestoneTargetMenu } from "../components/MilestoneTargetMenu";
import type { GoalMilestone } from "../types";

const milestone: GoalMilestone = {
  id: "milestone", title: "公開", status: "not-started", completed: false, taskIds: ["task"],
  dueDate: "2026-09-30", targetWorkStartDate: "2026-09-21", targetWorkEndDate: "2026-09-29",
};
describe("マイルストーンの目標期間クリア", () => {
  it("開始・終了の2項目だけを明示的な空欄にする", () => {
    const patch = clearMilestoneTargetChanges(milestone, milestone);
    expect(patch).toEqual({ targetWorkStartDate: "", targetWorkEndDate: "" });
    expect({ ...milestone, ...patch }).toMatchObject({ id: "milestone", title: "公開", dueDate: "2026-09-30", taskIds: ["task"], status: "not-started" });
    expect(milestone.targetWorkStartDate).toBe("2026-09-21");
  });
  it("片側だけ設定された期間もクリアできる", () => {
    const partial = { ...milestone, targetWorkEndDate: "" };
    expect(clearMilestoneTargetChanges(partial, partial)).toEqual({ targetWorkStartDate: "", targetWorkEndDate: "" });
  });
  it.each([
    { targetWorkStartDate: "2026-09-22" }, { targetWorkEndDate: "2026-09-30" }, { id: "other" },
  ])("確認中に期間や対象が変われば保存しない: %j", changes => {
    expect(() => clearMilestoneTargetChanges({ ...milestone, ...changes }, milestone)).toThrow("確認中に目標期間が変更");
  });
  it("初期表示では確認画面を出さず変更も行わない", () => {
    let called = false;
    const html = renderToStaticMarkup(<MilestoneTargetMenu milestone={milestone} onClear={() => { called = true; }} />);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("クリアしますか");
    expect(called).toBe(false);
  });
});
