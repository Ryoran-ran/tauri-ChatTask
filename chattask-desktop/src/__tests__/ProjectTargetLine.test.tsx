import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectTargetLine } from "../components/ProjectTargetLine";

describe("目標期間の端点表示", () => {
  it("中央・両端のドラッグ操作を区別する", () => {
    const html = renderToStaticMarkup(<ProjectTargetLine start={0} end={0} dayWidth={30} />);
    expect(html).toContain('data-schedule-drag="move"');
    expect(html).toContain('data-schedule-drag="start"');
    expect(html).toContain('data-schedule-drag="end"');
  });

  it("表示範囲で切れた端に伸縮用のつまみは出さない", () => {
    const html = renderToStaticMarkup(<ProjectTargetLine start={0} end={9} dayWidth={30} clippedStart clippedEnd />);
    expect(html).toContain('data-schedule-drag="move"');
    expect(html).not.toContain('data-schedule-drag="start"');
    expect(html).not.toContain('data-schedule-drag="end"');
  });
  it("単日も日付列1つ分の幅と両端を描く", () => {
    const html = renderToStaticMarkup(<ProjectTargetLine start={3} end={3} dayWidth={30} />);
    expect(html).toContain("left:90px;width:30px");
    expect(html.match(/<i /g)).toHaveLength(2);
    expect(html).toContain("project-target-start");
    expect(html).toContain("project-target-end");
  });

  it("2日間は開始日の左端から終了日の右端を結ぶ", () => {
    const html = renderToStaticMarkup(<ProjectTargetLine start={3} end={4} dayWidth={30} />);
    expect(html).toContain("left:90px;width:60px");
    expect(html.match(/<i /g)).toHaveLength(2);
    expect(html).not.toContain("is-single-day");
  });

  it("長い期間も開始日と終了日を含めた幅で表示する", () => {
    const html = renderToStaticMarkup(<ProjectTargetLine start={0} end={9} dayWidth={30} />);
    expect(html).toContain("left:0;width:300px");
  });

  it.each(["project-milestone-target-line", "status-comfortable", "status-over exceeds-due", "is-draft"])("単日でも色・種類・ドラッグ状態を維持する: %s", (className) => {
    const html = renderToStaticMarkup(<ProjectTargetLine start={0} end={0} dayWidth={60} className={className} />);
    expect(html).toContain(className);
    expect(html).toContain("left:0;width:60px");
    expect(html.match(/<i /g)).toHaveLength(2);
  });
});
