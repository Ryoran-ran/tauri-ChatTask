import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTask } from "../appHelpers";
import { TodayModal } from "../components/TodayModal";
import { saveExecutionGroups, type ExecutionGroup } from "../components/todayExecutionGroups";

vi.mock("../components/Modal", () => ({ Modal: ({ children }: { children: ReactNode }) => <>{children}</> }));
afterEach(() => vi.unstubAllGlobals());

const date = "2026-10-15";
const noop = () => {};
function renderToday(count: number, groups: ExecutionGroup[], finalizedAt = "") {
  const stored = new Map<string, string>([["chatTaskTodayView", "order"]]);
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
  saveExecutionGroups(date, groups);
  const tasks = Array.from({ length: count }, (_, index) => ({
    ...createTask(), id: `task${index}`, title: `作業${index}`,
    plannedRanges: [{ id: `range${index}`, startDate: date, endDate: date }],
  }));
  const props: ComponentProps<typeof TodayModal> = {
    workspaceMode: "work", tasks, habits: [], projects: [], tags: [], inboxItems: [], todayOrder: [],
    activity: [], periods: [], date, note: "", finalizedAt,
    onTodayOrder: noop, onHabitsChange: noop, onOpenInbox: noop, onReviewInbox: noop,
    onDate: noop, onNote: noop, onFinalize: noop, onUnfinalize: noop, onUpdateTask: noop,
    onCancelCompletion: noop, onStartTimer: () => true, onSelect: noop, onOpenDocuments: noop, onClose: noop,
  };
  return renderToStaticMarkup(<TodayModal {...props} />);
}

const createButtonAttributes = (html: string) => {
  const match = html.match(/<button\b([^>]*)>＋ 作業グループを作成<\/button>/);
  expect(match).not.toBeNull();
  return match![1];
};

describe("今日のグループ分けの再利用", () => {
  it("対応する作業があればAI相談を開けるが、確定済みの日は開けない", () => {
    const button = (html: string) => html.match(/<button\b([^>]*)>AIに着手順を相談<\/button>/)![1];
    expect(button(renderToday(2, []))).not.toContain("disabled");
    expect(button(renderToday(0, []))).toContain("disabled");
    expect(button(renderToday(2, [], `${date}T18:00:00`))).toContain("disabled");
  });
  it("全作業を一度まとめても作成ボタンを有効なままにする", () => {
    const html = renderToday(4, [{ id: "first", name: "最初のグループ", itemKeys: [0, 1, 2, 3].map(index => `task${index}:range${index}`) }]);
    expect(html).toContain("最初のグループ");
    expect(createButtonAttributes(html)).not.toContain("disabled");
  });

  it("複数グループを保存して画面を開き直しても再度作成できる", () => {
    const html = renderToday(4, [
      { id: "first", name: "グループA", itemKeys: ["task0:range0", "task1:range1"] },
      { id: "second", name: "グループB", itemKeys: ["task2:range2", "task3:range3"] },
    ]);
    expect(html).toContain("グループA");
    expect(html).toContain("グループB");
    expect(createButtonAttributes(html)).not.toContain("disabled");
  });

  it("確定済みの日のグループは変更させない", () => {
    expect(createButtonAttributes(renderToday(4, [], `${date}T18:00:00`))).toContain("disabled");
  });

  it("作業が2件未満のときだけ作成を無効にする", () => {
    expect(createButtonAttributes(renderToday(1, []))).toContain("disabled");
    expect(createButtonAttributes(renderToday(2, []))).not.toContain("disabled");
  });
});
