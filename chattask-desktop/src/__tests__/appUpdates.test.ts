import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAppUpdate, compareVersions, getCurrentAppVersion, openReleasePage, parseRelease, RELEASES_URL } from "../services/appUpdates";
import appConfig from "../../src-tauri/tauri.conf.json";

const tauri = vi.hoisted(() => ({ isTauri: vi.fn(() => false), getVersion: vi.fn(), openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: tauri.isTauri }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: tauri.getVersion }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: tauri.openUrl }));
const release = { tag_name: "v0.2.0", draft: false, prerelease: false, body: "変更内容", published_at: "2026-10-14T00:00:00Z" };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); tauri.isTauri.mockReturnValue(false); });

describe("アプリ更新確認", () => {
  it.each([
    ["0.10.0", "0.9.0", 1], ["v1.0.0", "1.0.0", 0], ["0.1.0", "0.2.0", -1],
    ["1.0.0+build.1", "1.0.0+build.2", 0], ["1.0.0", "1.0.0-rc.1", 1],
    ["1.0.0-rc.2", "1.0.0-rc.10", -1], ["1.0.0-alpha", "1.0.0-alpha.1", -1],
    ["1.0.0-1", "1.0.0-beta", -1], ["1.0.0-beta", "1.0.0-alpha", 1],
  ])("%s と %s の順序を正しく判定する", (left, right, expected) => {
    expect(compareVersions(left, right)).toBe(expected);
  });

  it.each(["01.0.0", "1.0", "1.0.0-01", "latest", "1.0.0\n"])("不正なバージョン %s を最新版と誤認しない", value => {
    expect(() => compareVersions(value, "0.1.0")).toThrow();
  });

  it("アプリでは実行中の版、プレビューではTauri設定の版を表示する", async () => {
    expect(await getCurrentAppVersion()).toBe(appConfig.version);
    tauri.isTauri.mockReturnValue(true); tauri.getVersion.mockResolvedValue("0.3.0");
    expect(await getCurrentAppVersion()).toBe("0.3.0");
  });

  it("公開版だけを案内し、同じ版や古い版への更新を勧めない", () => {
    expect(parseRelease(release, "0.1.0")).toMatchObject({ newer: true, version: "0.2.0", notes: "変更内容" });
    expect(parseRelease(release, "0.2.0").newer).toBe(false);
    expect(parseRelease(release, "0.3.0").newer).toBe(false);
    for (const value of [null, {}, { ...release, draft: true }, { ...release, prerelease: true }, { ...release, tag_name: "v0.3.0-beta" }]) {
      expect(() => parseRelease(value, "0.1.0")).toThrow();
    }
  });

  it("応答内の外部URLを使わず、不正な公開日と空の変更内容も扱う", () => {
    expect(parseRelease({ ...release, html_url: "https://evil.example", body: null, published_at: "invalid" }, "0.1.0"))
      .toMatchObject({ url: `${RELEASES_URL}/tag/v0.2.0`, notes: "", publishedAt: null });
  });

  it("公開リリースを認証情報なしで取得する", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(release)); vi.stubGlobal("fetch", fetcher);
    expect((await checkAppUpdate("0.1.0")).newer).toBe(true);
    expect(fetcher).toHaveBeenCalledWith("https://api.github.com/repos/Ryoran-ran/tauri-ChatTask/releases/latest", expect.objectContaining({ credentials: "omit", signal: expect.any(AbortSignal) }));
  });

  it.each([[404, "公開リリース"], [403, "制限"], [429, "制限"], [500, "HTTP 500"]])("HTTP %s を更新なしと区別する", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status })));
    await expect(checkAppUpdate("0.1.0")).rejects.toThrow(message);
  });

  it("オフラインと壊れたJSONで再試行を案内する", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(new Response("not json"));
    vi.stubGlobal("fetch", fetcher);
    await expect(checkAppUpdate("0.1.0")).rejects.toThrow("ネットワーク");
    await expect(checkAppUpdate("0.1.0")).rejects.toThrow("読み取れません");
  });

  it("15秒で通信を打ち切る", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })));
    const result = expect(checkAppUpdate("0.1.0")).rejects.toThrow("中断");
    await vi.advanceTimersByTimeAsync(15000); await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("画面を閉じたときの中断を通信へ伝える", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })));
    const result = expect(checkAppUpdate("0.1.0", controller.signal)).rejects.toThrow("中断");
    controller.abort(); await result;
  });

  it("デスクトップの既定ブラウザーで正規の配布ページだけを開く", async () => {
    tauri.isTauri.mockReturnValue(true);
    await openReleasePage(); expect(tauri.openUrl).toHaveBeenCalledWith(RELEASES_URL);
    await expect(openReleasePage("https://github.com.evil.example/Ryoran-ran/tauri-ChatTask/releases")).rejects.toThrow();
    await expect(openReleasePage("https://github.com/another/repo/releases")).rejects.toThrow();
    expect(tauri.openUrl).toHaveBeenCalledTimes(1);
  });
});
