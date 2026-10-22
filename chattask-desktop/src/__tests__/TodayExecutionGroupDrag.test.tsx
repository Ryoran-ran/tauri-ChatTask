// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTask } from "../appHelpers";
import { TodayModal } from "../components/TodayModal";
import { readExecutionGroups, saveExecutionGroups } from "../components/todayExecutionGroups";

const date = "2026-10-15";
const noop = () => {};
const tasks = Array.from({ length: 4 }, (_, index) => ({
  ...createTask(), id: `task${index}`, title: `作業${index}`,
  plannedRanges: [{ id: `range${index}`, startDate: date, endDate: date }],
}));
const keys = tasks.map((_, index) => `task${index}:range${index}`);
const orderChange = vi.fn();

function Harness({ finalizedAt = "" }: { finalizedAt?: string }) {
  const [todayOrder, setTodayOrder] = useState(keys);
  return <TodayModal workspaceMode="work" tasks={tasks} habits={[]} projects={[]} tags={[]} inboxItems={[]}
    todayOrder={todayOrder} onTodayOrder={(order) => { orderChange(order); setTodayOrder(order); }}
    onHabitsChange={noop} onOpenInbox={noop} onReviewInbox={noop} activity={[]} periods={[]} date={date}
    note="" finalizedAt={finalizedAt} onDate={noop} onNote={noop} onFinalize={noop} onUnfinalize={noop}
    onUpdateTask={noop} onCancelCompletion={noop} onStartTimer={() => true} onSelect={noop}
    onOpenDocuments={noop} onClose={noop} />;
}

const members = () => [...document.querySelectorAll<HTMLElement>(".execution-group-member")];
const titles = () => members().map((row) => row.querySelector(".execution-order-main strong")?.textContent);
const dataTransfer = () => ({ setData: vi.fn(), effectAllowed: "", dropEffect: "" });

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
  });
  localStorage.setItem("chatTaskTodayView", "order");
  saveExecutionGroups(date, [{ id: "first", name: "最初", itemKeys: keys.slice(0, 3) }]);
  orderChange.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("今日のグループ内ドラッグ", () => {
  it("グループ内の離れた位置へ並べ替え、再表示後も順番を保つ", () => {
    const view = render(<Harness />);
    expect(titles()).toEqual(["作業0", "作業1", "作業2"]);
    const transfer = dataTransfer();
    fireEvent.dragStart(members()[0], { dataTransfer: transfer });
    fireEvent.dragOver(members()[2], { dataTransfer: transfer });
    expect(members()[2].className).toContain("is-drop-target");
    fireEvent.drop(members()[2], { dataTransfer: transfer });
    expect(titles()).toEqual(["作業1", "作業2", "作業0"]);
    expect(orderChange).toHaveBeenLastCalledWith([keys[1], keys[2], keys[0], keys[3]]);
    expect(readExecutionGroups(date)[0].itemKeys).toEqual([keys[1], keys[2], keys[0]]);
    view.unmount();
    render(<Harness />);
    expect(titles()).toEqual(["作業1", "作業2", "作業0"]);
  });

  it("確定済みの日はグループ内の作業をドラッグできない", () => {
    render(<Harness finalizedAt={`${date}T18:00:00Z`} />);
    expect(members().every((row) => row.getAttribute("draggable") === "false")).toBe(true);
    expect(screen.getByRole("button", { name: "＋ 作業グループを作成" }).hasAttribute("disabled")).toBe(true);
  });

  it("別グループへの作業ドロップは無効にし、グループ全体のドラッグは維持する", () => {
    saveExecutionGroups(date, [
      { id: "first", name: "最初", itemKeys: keys.slice(0, 2) },
      { id: "second", name: "次", itemKeys: keys.slice(2) },
    ]);
    render(<Harness />);
    const groups = document.querySelectorAll<HTMLElement>(".execution-work-group");
    fireEvent.click(groups[1].querySelector(".execution-group-toggle")!);
    const transfer = dataTransfer();
    fireEvent.dragStart(members()[0], { dataTransfer: transfer });
    fireEvent.dragOver(members()[2], { dataTransfer: transfer });
    fireEvent.drop(members()[2], { dataTransfer: transfer });
    expect(orderChange).not.toHaveBeenCalled();
    expect(readExecutionGroups(date).map((group) => group.itemKeys)).toEqual([keys.slice(0, 2), keys.slice(2)]);
    fireEvent.dragStart(groups[0], { dataTransfer: transfer });
    fireEvent.dragOver(groups[1], { dataTransfer: transfer });
    fireEvent.drop(groups[1], { dataTransfer: transfer });
    expect(orderChange).toHaveBeenLastCalledWith([keys[2], keys[3], keys[0], keys[1]]);
  });
});
