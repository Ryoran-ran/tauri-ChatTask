import { afterEach, describe, expect, it, vi } from "vitest";
import { createPendingSave, createSaveBeforeExit } from "../services/pendingSave";

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
afterEach(() => vi.useRealTimers());

describe("終了前の保存", () => {
  it("入れ替え開始で未発行の自動保存を止め、画面確定中の旧更新も無視する", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (_value: string) => {});
    const saver = createPendingSave(save, vi.fn());
    saver.update("old");
    await saver.replace(async () => { await save("new"); return "new"; }, () => { saver.update("old-render"); });
    await vi.runAllTimersAsync(); await saver.flush();
    expect(save.mock.calls).toEqual([["new"]]);
    saver.update("edited-new"); await vi.runAllTimersAsync();
    expect(save.mock.calls).toEqual([["new"], ["edited-new"]]);
  });
  it("実行中の旧保存を待ち、追加の旧更新を保存せず入れ替える", async () => {
    vi.useFakeTimers();
    const gate = deferred(), order: string[] = [];
    const saver = createPendingSave(async (value: string) => { await gate.promise; order.push(value); }, vi.fn());
    saver.update("old"); await vi.advanceTimersByTimeAsync(250);
    saver.update("old-pending");
    const replacement = saver.replace(async () => { order.push("replacement"); return "new"; }, () => {});
    await expect(saver.flush()).rejects.toThrow("入れ替え");
    expect(order).toEqual([]);
    gate.resolve(); await replacement; await vi.runAllTimersAsync();
    expect(order).toEqual(["old", "replacement"]);
  });
  it("入れ替え失敗後は旧データの保存を停止し、再試行後のみ再開する", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (_value: string) => {});
    const saver = createPendingSave(save, vi.fn());
    saver.update("old");
    await expect(saver.replace(async () => { throw Error("restore failed"); }, () => {})).rejects.toThrow("restore failed");
    saver.update("old-late"); await vi.runAllTimersAsync();
    await expect(saver.flush()).rejects.toThrow("入れ替え");
    expect(save).not.toHaveBeenCalled();
    await saver.replace(async () => "reloaded", () => {});
    saver.update("new edit"); await saver.flush();
    expect(save.mock.calls).toEqual([["new edit"]]);
  });
  it("変更直後でも250msを待たず最新データを保存してから終了する", async () => {
    vi.useFakeTimers();
    const saved = deferred(), events: string[] = [];
    const saver = createPendingSave(async (value: string) => { events.push(value); await saved.promise; }, vi.fn());
    const close = createSaveBeforeExit(saver.flush, async () => { events.push("exit"); }, vi.fn(), vi.fn());
    saver.update("old"); saver.update("latest");
    const result = close();
    await Promise.resolve();
    expect(events).toEqual(["latest"]);
    saved.resolve(); await result;
    expect(events).toEqual(["latest", "exit"]);
    await vi.runAllTimersAsync();
    expect(events).toEqual(["latest", "exit"]);
  });
  it("保存中の変更を追加保存し、終了要求の連打を一回にまとめる", async () => {
    vi.useFakeTimers();
    const first = deferred(), second = deferred();
    const save = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const exit = vi.fn(async () => {});
    const saver = createPendingSave<string>(save, vi.fn());
    const close = createSaveBeforeExit(saver.flush, exit, vi.fn(), vi.fn());
    saver.update("first");
    const result = close(); await Promise.resolve();
    saver.update("second");
    expect(close()).toBe(result);
    first.resolve(); await Promise.resolve();
    expect(save.mock.calls).toEqual([["first"], ["second"]]);
    expect(exit).not.toHaveBeenCalled();
    second.resolve(); await result;
    expect(exit).toHaveBeenCalledTimes(1);
    saver.cancelTimer();
  });
  it("保存失敗時は終了せず、同じデータで再試行できる", async () => {
    vi.useFakeTimers();
    const failure = new Error("disk full");
    const save = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const exit = vi.fn(async () => {}), closing = vi.fn(), notify = vi.fn();
    const saver = createPendingSave<string>(save, vi.fn());
    const close = createSaveBeforeExit(saver.flush, exit, closing, notify);
    saver.update("unsaved"); await close();
    expect(exit).not.toHaveBeenCalled();
    expect(closing.mock.calls).toEqual([[true], [false]]);
    expect(notify).toHaveBeenCalledWith(failure);
    await close();
    expect(save.mock.calls).toEqual([["unsaved"], ["unsaved"]]);
    expect(exit).toHaveBeenCalledTimes(1);
  });
  it("通常の自動保存が進行中なら、その完了も待つ", async () => {
    vi.useFakeTimers();
    const saving = deferred();
    const save = vi.fn(() => saving.promise), exit = vi.fn(async () => {});
    const saver = createPendingSave<string>(save, vi.fn());
    saver.update("value"); await vi.advanceTimersByTimeAsync(250);
    const close = createSaveBeforeExit(saver.flush, exit, vi.fn(), vi.fn());
    const result = close(); await Promise.resolve();
    expect(exit).not.toHaveBeenCalled();
    saving.resolve(); await result;
    expect(save).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
  it("通常保存に失敗しても終了時に再保存する", async () => {
    vi.useFakeTimers();
    const notify = vi.fn(), save = vi.fn().mockRejectedValueOnce(new Error("IO")).mockResolvedValue(undefined);
    const saver = createPendingSave<string>(save, notify);
    saver.update("value"); await vi.advanceTimersByTimeAsync(250);
    expect(notify).toHaveBeenCalledTimes(1);
    await saver.flush(); expect(save).toHaveBeenCalledTimes(2);
  });
  it("データ読み込み前の終了は保存・終了せず、エラーを表示する", async () => {
    const exit = vi.fn(async () => {}), notify = vi.fn();
    const close = createSaveBeforeExit(async () => { throw new Error("loading"); }, exit, vi.fn(), notify);
    await close();
    expect(exit).not.toHaveBeenCalled(); expect(notify).toHaveBeenCalledTimes(1);
  });
  it("終了コマンドに失敗しても操作を再開できる", async () => {
    const closing = vi.fn(), notify = vi.fn();
    const close = createSaveBeforeExit(async () => {}, async () => { throw new Error("exit failed"); }, closing, notify);
    await close(); expect(closing).toHaveBeenLastCalledWith(false); expect(notify).toHaveBeenCalledTimes(1);
  });
});
