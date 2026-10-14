import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import appConfig from "../../src-tauri/tauri.conf.json";

export const RELEASES_URL = "https://github.com/Ryoran-ran/tauri-ChatTask/releases";
const RELEASE_API = "https://api.github.com/repos/Ryoran-ran/tauri-ChatTask/releases/latest";

// SemVer precedence: build metadata is ignored, prereleases precede stable releases.
function parseVersion(value: string) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(value);
  if (!match || match[4]?.split(".").some(part => /^\d+$/.test(part) && /^0\d/.test(part))) {
    throw new Error("バージョン情報の形式を確認できませんでした。");
  }
  return { core: match.slice(1, 4), pre: match[4]?.split(".") ?? [] };
}

const compareNumber = (a: string, b: string) => a.length !== b.length ? Math.sign(a.length - b.length) : a === b ? 0 : a > b ? 1 : -1;

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left), b = parseVersion(right);
  for (let i = 0; i < 3; i++) {
    const difference = compareNumber(a.core[i], b.core[i]);
    if (difference) return difference;
  }
  if (!a.pre.length || !b.pre.length) return a.pre.length ? -1 : b.pre.length ? 1 : 0;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNumeric = /^\d+$/.test(x), yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return compareNumber(x, y);
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export const getCurrentAppVersion = () => isTauri() ? getVersion() : Promise.resolve(appConfig.version);

export interface AppRelease {
  version: string;
  notes: string;
  publishedAt: string | null;
  url: string;
  newer: boolean;
}

export function parseRelease(value: unknown, currentVersion: string): AppRelease {
  if (!value || typeof value !== "object") throw new Error("更新情報を読み取れませんでした。");
  const release = value as Record<string, unknown>;
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== "string") {
    throw new Error("正式リリースの情報を確認できませんでした。");
  }
  if (parseVersion(release.tag_name).pre.length) throw new Error("正式リリースの情報を確認できませんでした。");
  const publishedAt = typeof release.published_at === "string" && Number.isFinite(Date.parse(release.published_at)) ? release.published_at : null;
  return {
    version: release.tag_name.replace(/^v/, ""),
    notes: typeof release.body === "string" ? release.body : "",
    publishedAt,
    // Construct the destination ourselves; do not open arbitrary URLs from the response.
    url: `${RELEASES_URL}/tag/${encodeURIComponent(release.tag_name)}`,
    newer: compareVersions(release.tag_name, currentVersion) > 0,
  };
}

export async function checkAppUpdate(currentVersion: string, signal?: AbortSignal): Promise<AppRelease> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, 15000);
  try {
    let response: Response;
    try {
      response = await fetch(RELEASE_API, {
        headers: { Accept: "application/vnd.github+json" },
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
      });
    } catch {
      throw new Error(controller.signal.aborted ? "更新確認を中断しました。時間をおいて再度お試しください。" : "更新情報に接続できません。ネットワーク接続を確認して再度お試しください。");
    }
    if (response.status === 404) throw new Error("公開リリースが見つかりません。まだ公開されていないか、配布先にアクセスできない可能性があります。");
    if (response.status === 403 || response.status === 429) throw new Error("更新情報へのアクセスが制限されています。時間をおいて再度お試しください。");
    if (!response.ok) throw new Error(`更新情報を取得できませんでした（HTTP ${response.status}）。時間をおいて再度お試しください。`);
    let data: unknown;
    try { data = await response.json(); }
    catch { throw new Error("更新情報を読み取れませんでした。時間をおいて再度お試しください。"); }
    return parseRelease(data, currentVersion);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}

export async function openReleasePage(url = RELEASES_URL) {
  const parsed = new URL(url);
  if (parsed.origin !== "https://github.com" || parsed.username || parsed.password ||
      !(parsed.pathname === "/Ryoran-ran/tauri-ChatTask/releases" || parsed.pathname.startsWith("/Ryoran-ran/tauri-ChatTask/releases/tag/"))) {
    throw new Error("配布ページのURLが正しくありません。");
  }
  if (isTauri()) await openUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
