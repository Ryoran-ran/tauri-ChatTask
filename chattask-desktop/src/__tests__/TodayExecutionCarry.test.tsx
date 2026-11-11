// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTask } from "../appHelpers";
import { TodayModal } from "../components/TodayModal";
import { saveExecutionGroups } from "../components/todayExecutionGroups";

const date = "2026-10-16"; // Friday; the next working day is Monday.
const destination = "2026-10-19";
const noop = () => {};
const tasks = Array.from({ length: 3 }, (_, index) => ({
  ...createTask(), id: `task${index}`, title: `作業${index}`,
  plannedRanges: [{ id: `range${index}`, startDate: date, endDate: date }],
}));
const keys = tasks.map((_, index) => `task${index}:range${index}`);
const onUpdateTask = vi.fn();

function Harness({ finalizedAt = "" }: { finalizedAt?: string }) {
  return <TodayModal workspaceMode="work" tasks={tasks} habits={[]} projects={[]} tags={[]} inboxItems={[]}
    todayOrder={keys} onTodayOrder={noop} onHabitsChange={noop} onOpenInbox={noop} onReviewInbox={noop}
    activity={[]} periods={[]} date={date} note="" finalizedAt={finalizedAt} onDate={noop} onNote={noop}
    onFinalize={noop} onUnfinalize={noop} onUpdateTask={onUpdateTask} onCancelCompletion={noop}
    onStartTimer={() => true} onSelect={noop} onOpenDocuments={noop} onClose={noop} />;
}

beforeEach(() => {
  const stored = new Map<string, string>([["chatTaskTodayView", "order"]]);
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); } });
  vi.stubGlobal("confirm", vi.fn(() => true));
  saveExecutionGroups(date, [{ id: "group", name: "並行作業", itemKeys: keys.slice(0, 2) }]);
  onUpdateTask.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("今日の対応順から次営業日へ持ち越す", () => {
  it("グループ内の予定をチェックで選択し、まとめて持ち越す", () => {
    render(<Harness />);
    const groupMembers = document.querySelectorAll<HTMLElement>(".execution-group-member");
    expect(groupMembers).toHaveLength(2);
    expect(within(groupMembers[0]).queryByRole("button", { name: /次営業日へ選択/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `タスクを選んで${destination}へ回す` }));
    fireEvent.click(within(groupMembers[0]).getByRole("checkbox", { name: "次の営業日に回す" }));
    expect(within(groupMembers[0]).getByRole<HTMLInputElement>("checkbox", { name: "次の営業日に回す" }).checked).toBe(true);
    expect(screen.getByRole("button", { name: `選択したタスクを${destination}へ回す（1件）` })).toBeTruthy();
    expect(onUpdateTask).not.toHaveBeenCalled();
    fireEvent.click(within(groupMembers[1]).getByRole("checkbox", { name: "次の営業日に回す" }));
    fireEvent.click(screen.getByRole("button", { name: `選択したタスクを${destination}へ回す（2件）` }));
    expect(onUpdateTask).toHaveBeenCalledTimes(2);
    expect(onUpdateTask).toHaveBeenCalledWith("task0", expect.objectContaining({
      plannedRanges: [expect.objectContaining({ id: "range0", endDate: destination, carriedOverDates: [date] })],
    }), expect.stringContaining("持ち越し"));
    expect(onUpdateTask).toHaveBeenCalledWith("task1", expect.objectContaining({
      plannedRanges: [expect.objectContaining({ id: "range1", endDate: destination, carriedOverDates: [date] })],
    }), expect.stringContaining("持ち越し"));
    expect(screen.queryByRole("checkbox", { name: "次の営業日に回す" })).toBeNull();
  });

  it("上部の選択ボタンでチェックを表示し、選択解除やキャンセルができる", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: `タスクを選んで${destination}へ回す` }));
    const single = document.querySelector<HTMLElement>(".execution-next-group .execution-unit-list > li")!;
    const checkbox = within(single).getByRole<HTMLInputElement>("checkbox", { name: "次の営業日に回す" });
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(screen.getByRole("button", { name: `選択したタスクを${destination}へ回す（1件）` })).toBeTruthy();
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "選択をやめる" }));
    expect(screen.queryByRole("checkbox", { name: "次の営業日に回す" })).toBeNull();
    expect(onUpdateTask).not.toHaveBeenCalled();
  });

  it("対応順の選択をボードへ切り替えても引き継ぐ", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: `タスクを選んで${destination}へ回す` }));
    fireEvent.click(within(document.querySelectorAll<HTMLElement>(".execution-group-member")[0]).getByRole("checkbox", { name: "次の営業日に回す" }));
    fireEvent.click(screen.getByRole("button", { name: "ボード" }));
    const checkboxes = screen.getAllByRole<HTMLInputElement>("checkbox", { name: "次の営業日に回す" });
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
  });

  it("確定済みの日は持ち越せない", () => {
    render(<Harness finalizedAt={`${date}T18:00:00Z`} />);
    expect(screen.queryByRole("button", { name: `タスクを選んで${destination}へ回す` })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "次の営業日に回す" })).toBeNull();
  });
});
