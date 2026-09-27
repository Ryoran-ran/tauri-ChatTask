import { afterEach, describe, expect, it, vi } from "vitest";
import { createPendingSave, createSaveBeforeExit } from "../services/pendingSave";
import { parseImportedData, saveAppData, loadAppData, restoreAppBackup } from "../services/storage";
import type { AppData } from "../types";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
const seed = () => parseImportedData(JSON.stringify({ tasks: [], goals: [], organizationSeed: 1 }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("終了処理と実際の保存サービスの接続（IPCのみモック）", () => {
  it("遅い初期化保存の後に旧自動保存を実行しない（書き戻り回帰）", async () => {
    vi.useFakeTimers();
    const old = { ...seed(), projectDailyCapacityHours: 8 }, blank = { ...seed(), projectDailyCapacityHours: 6 };
    const writes: number[] = [];
    invoke.mockImplementation(async (_command: string, args: { data: AppData }) => {
      await new Promise(resolve => setTimeout(resolve, 500));
      writes.push(args.data.projectDailyCapacityHours!);
    });
    const saver = createPendingSave<AppData>(data => saveAppData(data, "sqlite", "test"), vi.fn());
    saver.update(old);
    let screen: AppData = old;
    const reset = saver.replace(async () => { await saveAppData(blank, "sqlite", "test"); return blank; }, data => { screen = data; });
    await vi.advanceTimersByTimeAsync(1200); await reset;
    await saver.flush();
    expect(writes).toEqual([6]); expect(screen).toEqual(blank);
  });
  it("復元コマンドと移行後保存の全期間に旧自動保存を停止する", async () => {
    vi.useFakeTimers();
    const restored = { ...seed(), projectDailyCapacityHours: 4 };
    const calls: string[] = [];
    invoke.mockImplementation(async (command: string) => {
      calls.push(command); await new Promise(resolve => setTimeout(resolve, 500));
      return command === "restore_app_backup" ? restored : undefined;
    });
    const saver = createPendingSave<AppData>(data => saveAppData(data, "sqlite", "test"), vi.fn());
    saver.update(seed());
    const restore = saver.replace(async () => {
      const next = await restoreAppBackup("fixture", "test");
      await saveAppData(next, "sqlite", "test"); return next;
    }, () => {});
    await vi.advanceTimersByTimeAsync(1500); await restore; await saver.flush();
    expect(calls).toEqual(["restore_app_backup", "save_app_data_sqlite"]);
  });
  it("既存のSQLite保存キューの後に最新状態を保存し、応答を待って終了する", async () => {
    vi.useFakeTimers();
    const first = deferred(), second = deferred(), firstStarted = deferred(), secondStarted = deferred();
    const writes: AppData[] = [];
    invoke.mockImplementationOnce(async (_command: string, args: { data: AppData; environment: string }) => {
      expect(args.environment).toBe("test"); writes.push(args.data); firstStarted.resolve(); await first.promise;
    }).mockImplementationOnce(async (_command: string, args: { data: AppData }) => {
      writes.push(args.data); secondStarted.resolve(); await second.promise;
    });
    const old = seed(), latest = { ...old, projectDailyCapacityHours: 4 };
    const savingOld = saveAppData(old, "sqlite", "test"); await firstStarted.promise;
    const saver = createPendingSave<AppData>(data => saveAppData(data, "sqlite", "test"), vi.fn());
    const exit = vi.fn(async () => {});
    const close = createSaveBeforeExit(saver.flush, exit, vi.fn(), vi.fn());
    saver.update(latest); const closing = close();
    await Promise.resolve(); expect(writes).toHaveLength(1); expect(exit).not.toHaveBeenCalled();
    first.resolve(); await savingOld; await secondStarted.promise;
    expect(writes[1].projectDailyCapacityHours).toBe(4);
    expect(writes[1]).not.toBe(latest); // キュー内は独立したスナップショット
    expect(exit).not.toHaveBeenCalled();
    second.resolve(); await closing;
    expect(exit).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls.map(call => call[0])).toEqual(["save_app_data_sqlite", "save_app_data_sqlite"]);
  });
  it("SQLite失敗時に終了せず、再試行時には保存キューも復帰する", async () => {
    vi.useFakeTimers();
    invoke.mockRejectedValueOnce(new Error("SQLite error")).mockResolvedValueOnce(undefined);
    const saver = createPendingSave<AppData>(data => saveAppData(data, "sqlite", "test"), vi.fn());
    const exit = vi.fn(async () => {}), notify = vi.fn();
    const close = createSaveBeforeExit(saver.flush, exit, vi.fn(), notify);
    saver.update(seed()); await close();
    expect(exit).not.toHaveBeenCalled(); expect(notify).toHaveBeenCalledTimes(1);
    await close(); expect(exit).toHaveBeenCalledTimes(1); expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("localStorageへフォールバック中の終了でも保存し、別環境を上書きしない", async () => {
    vi.useFakeTimers();
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
    const data = { ...seed(), projectDailyCapacityHours: 4 };
    values.set("chatTaskGoals", "production-sentinel");
    const saver = createPendingSave<AppData>(snapshot => saveAppData(snapshot, "localStorage", "test"), vi.fn());
    const exit = vi.fn(async () => { expect(loadAppData("test").projectDailyCapacityHours).toBe(4); });
    const close = createSaveBeforeExit(saver.flush, exit, vi.fn(), vi.fn());
    saver.update(data); await close();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(loadAppData("test").projectDailyCapacityHours).toBe(4);
    expect(values.get("chatTaskGoals")).toBe("production-sentinel");
  });
});
