// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTask } from "../appHelpers";
import { Sidebar } from "../components/Sidebar";
import type { Task } from "../types";

const date = "2026-11-26";
const noop = () => {};
const waitingTask = (id: string, reviewDate: string, changes: Partial<Task> = {}): Task => ({
  ...createTask(), id, title: id, status: "waiting-client",
  waitingFollowUp: { kind: "reply", party: "取引先", startedAt: "2026-11-20", reviewDate, memo: "" },
  ...changes,
});
function renderSidebar(tasks: Task[], changes: Partial<ComponentProps<typeof Sidebar>> = {}) {
  return render(<Sidebar tasks={tasks} tags={[]} projects={[]} periods={[]} selectedId={null}
    search="" advancedFilter={{ mode: "and", conditions: [] }} savedViews={[]} sortRules={[]}
    filtersHidden collapsedIds={new Set()} onSearch={noop} onClearFilters={noop} onSaveView={noop}
    onApplyView={noop} onDeleteView={noop} onSortRules={noop} onToggleFilters={noop}
    onSelect={noop} onToggleCollapse={noop} onCreate={noop} onToday={noop}
    narrow={false} density="standard" groupByTag onToggleWidth={noop} onToggleDensity={noop}
    onToggleGroupByTag={noop} onQuick={noop} onOpenProject={noop} onSaveTemplate={noop}
    workspaceMode="work" {...changes} />);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${date}T12:00:00`));
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("サイドバーの作業予定と待ち確認を分ける", () => {
  it("今日の作業予定と確認日が今日以前の待ちを別々に表示し、待ちは確認日の古い順に並べる", () => {
    const work = { ...createTask(), id: "work", title: "今日の作業", plannedRanges: [{ id: "range", startDate: date, endDate: date }] };
    const onSelect = vi.fn();
    renderSidebar([work, waitingTask("今日の待ち", date), waitingTask("超過した待ち", "2026-11-25"),
      waitingTask("未来の待ち", "2026-11-27"), waitingTask("日付なし", ""),
      waitingTask("終了済み", date, { status: "done" }), waitingTask("中止済み", date, { status: "cancelled" }),
      waitingTask("引き継ぎ済み", date, { status: "handed-over" })], { onSelect });
    const workSection = within(screen.getByRole("region", { name: "今日すること" }));
    const waitingSection = within(screen.getByRole("region", { name: "今日確認する待ち" }));
    expect(workSection.getByText("今日の作業")).toBeTruthy();
    expect(workSection.queryByText("今日の待ち")).toBeNull();
    expect(workSection.queryByText("超過した待ち")).toBeNull();
    expect(waitingSection.queryByText("今日の作業")).toBeNull();
    expect(waitingSection.getByText("確認日 2026/11/26（今日）")).toBeTruthy();
    expect(waitingSection.getByText("確認日 2026/11/25（超過）")).toBeTruthy();
    const waitingCards = screen.getByRole("region", { name: "今日確認する待ち" }).querySelectorAll("[data-task-id]");
    expect([...waitingCards].map((card) => card.getAttribute("data-task-id"))).toEqual(["超過した待ち", "今日の待ち"]);
    fireEvent.click(waitingSection.getByText("今日の待ち"));
    expect(onSelect).toHaveBeenCalledWith("今日の待ち");
  });

  it("親を折りたたんでも子の待ち確認を表示し、各欄の開閉状態を別々に保存する", () => {
    const tasks = [{ ...createTask(), id: "parent" }, waitingTask("子の確認", date, { parentTaskId: "parent" })];
    const view = renderSidebar(tasks, { collapsedIds: new Set(["parent"]) });
    const waitingSection = () => screen.getByRole("region", { name: "今日確認する待ち" });
    expect(within(waitingSection()).getByText("子の確認")).toBeTruthy();
    expect(waitingSection().querySelector("[data-task-depth='0']")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /今日すること\s*0件/ }));
    expect(within(waitingSection()).getByText("子の確認")).toBeTruthy();
    fireEvent.click(within(waitingSection()).getByRole("button", { name: /今日確認する待ち\s*1件/ }));
    expect(within(waitingSection()).queryByText("子の確認")).toBeNull();
    view.unmount();
    renderSidebar(tasks);
    expect(screen.getByRole("button", { name: /今日すること\s*0件/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /今日確認する待ち\s*1件/ }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: /今日確認する待ち\s*1件/ }));
    expect(within(waitingSection()).getByText("子の確認")).toBeTruthy();
  });

  it("待ち確認と別に作業予定を持つタスクは、作業予定としても表示する", () => {
    renderSidebar([waitingTask("確認と作業", date, {
      plannedRanges: [{ id: "range", startDate: date, endDate: date }],
    })]);
    expect(within(screen.getByRole("region", { name: "今日すること" })).getByText("確認と作業")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "今日確認する待ち" })).getByText("確認と作業")).toBeTruthy();
  });
});
