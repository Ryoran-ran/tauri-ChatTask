import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectScheduleDeadline } from "../components/ProjectScheduleDeadline";
import { ProjectTargetLine } from "../components/ProjectTargetLine";

describe("期限日の終端表示", () => {
  it.each([false, true])("作業・マイルストーンとも日付列の右端に期限を置く: %s", milestone => {
    const html = renderToStaticMarkup(<ProjectScheduleDeadline date="2026-09-30" index={9} dayWidth={30} milestone={milestone} />);
    expect(html).toContain("left:300px");
    expect(html).toContain("09/30");
    expect(html).toContain("◆");
    expect(html).toContain("2026-09-30（この日の終わり）");
    expect(html).not.toContain("data-schedule-drag");
  });

  it("期限日までの期間の終点と一致し、翌日までは1列分超える", () => {
    const due = renderToStaticMarkup(<ProjectScheduleDeadline date="2026-09-30" index={9} dayWidth={30} />);
    const onTime = renderToStaticMarkup(<ProjectTargetLine start={3} end={9} dayWidth={30} />);
    const late = renderToStaticMarkup(<ProjectTargetLine start={3} end={10} dayWidth={30} />);
    expect(due).toContain("left:300px");
    expect(onTime).toContain("left:90px;width:210px");
    expect(late).toContain("left:90px;width:240px");
  });

  it("単日の期限も期間の右端に揃う", () => {
    const html = renderToStaticMarkup(<ProjectScheduleDeadline date="2026-09-21" index={0} dayWidth={30} />);
    expect(html).toContain("left:30px");
  });

  it("表示最終日はラベルを内側へ寄せる指定を付ける", () => {
    const html = renderToStaticMarkup(<ProjectScheduleDeadline date="2026-09-30" index={9} dayWidth={30} lastColumn />);
    expect(html).toContain("is-last-column");
    expect(html).toContain("left:300px");
  });
});
