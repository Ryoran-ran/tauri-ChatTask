export type UsageInteraction = "click" | "keyboard" | "shortcut";
export type UsageEventKind = "action" | "surface";

export interface UiUsageEvent {
  id: string;
  kind: UsageEventKind;
  actionId: string;
  surface: string;
  interaction: UsageInteraction;
  sessionId: string;
  occurredAt: string;
}

export interface UsageActionDefinition {
  id: string;
  label: string;
  surface: string;
  category: string;
  /** Safety and administration actions must not become removal candidates just because they are rare. */
  occasionalByDesign?: boolean;
}

export interface UsageDailySummary {
  actions: Record<string, number>;
  surfaces: Record<string, number>;
}

export interface UsageStore {
  version: 1;
  events: UiUsageEvent[];
  daily: Record<string, UsageDailySummary>;
}

export interface UsageActionSummary extends UsageActionDefinition {
  uses: number;
  activeDays: number;
  sessions: number;
  eligibleSessions: number;
  sessionRate: number | null;
  lastUsedAt: string;
  classification: "frequent" | "occasional" | "rare" | "unused" | "protected" | "collecting";
}

export interface UsageAnalysisExport {
  schemaVersion: 1;
  generatedAt: string;
  period: { days: number; start: string; end: string };
  privacy: { rawEventsIncluded: false; contentIncluded: false };
  actions: UsageActionSummary[];
  daily: Record<string, UsageDailySummary>;
}

export const USAGE_RETENTION_DAYS = 90;
const MAX_RAW_EVENTS = 20_000;
const STORE_KEY = "chatTaskUiUsageV1";

export const USAGE_ACTIONS: UsageActionDefinition[] = [
  { id: "header.search", label: "全文検索", surface: "main", category: "ヘッダー" },
  { id: "header.inbox", label: "Inbox", surface: "main", category: "ヘッダー" },
  { id: "header.waiting", label: "待ち", surface: "main", category: "ヘッダー" },
  { id: "header.notifications", label: "通知", surface: "main", category: "ヘッダー" },
  { id: "header.projects", label: "プロジェクト", surface: "main", category: "ヘッダー" },
  { id: "header.gantt", label: "ガントチャート", surface: "main", category: "ヘッダー" },
  { id: "header.weekly", label: "週間予定", surface: "main", category: "ヘッダー" },
  { id: "records.achievements", label: "頑張りの記録", surface: "main", category: "記録・分析" },
  { id: "records.reflections", label: "振り返り記録", surface: "main", category: "記録・分析" },
  { id: "records.issues", label: "課題一覧", surface: "main", category: "記録・分析" },
  { id: "records.report", label: "まとめ出力", surface: "main", category: "記録・分析", occasionalByDesign: true },
  { id: "settings.open", label: "設定を開く", surface: "main", category: "設定" },
  { id: "settings.usage", label: "利用状況を確認", surface: "settings", category: "設定" },
  { id: "settings.data", label: "データ管理・バックアップ", surface: "settings", category: "設定", occasionalByDesign: true },
  { id: "settings.export", label: "データをエクスポート", surface: "settings", category: "設定", occasionalByDesign: true },
  { id: "settings.import", label: "データをインポート", surface: "settings", category: "設定", occasionalByDesign: true },
  { id: "sidebar.today", label: "今日のページ", surface: "main", category: "タスク一覧" },
  { id: "sidebar.create_task", label: "新規タスクを追加", surface: "main", category: "タスク一覧" },
  { id: "sidebar.advanced_filter", label: "条件検索", surface: "main", category: "タスク一覧" },
  { id: "sidebar.sort", label: "並び替え", surface: "main", category: "タスク一覧" },
  { id: "task.documents", label: "ドキュメント", surface: "task_detail", category: "タスク詳細" },
  { id: "task.code_review", label: "コードレビュー", surface: "task_detail", category: "タスク詳細" },
  { id: "task.reflection", label: "振り返り", surface: "task_detail", category: "タスク詳細" },
  { id: "task.save_template", label: "テンプレートとして保存", surface: "task_detail", category: "タスク詳細" },
  { id: "task.schedule", label: "予定を開く", surface: "task_detail", category: "タスク詳細" },
  { id: "task.related", label: "関連タスクを開く", surface: "task_detail", category: "タスク詳細" },
  { id: "today.start_timer", label: "タイマーを開始", surface: "today", category: "今日のページ" },
  { id: "today.complete_work", label: "作業の達成を切り替え", surface: "today", category: "今日のページ" },
  { id: "today.open_inbox", label: "Inboxを開く", surface: "today", category: "今日のページ" },
  { id: "project.schedule", label: "作業スケジュール", surface: "projects", category: "プロジェクト" },
  { id: "project.gantt", label: "ガントチャート", surface: "projects", category: "プロジェクト" },
  { id: "project.create_tasks", label: "未登録作業をTaskへ登録", surface: "projects", category: "プロジェクト" },
];

const emptyStore = (): UsageStore => ({ version: 1, events: [], daily: {} });
const environmentSuffix = () => localStorage.getItem("chatTaskActiveEnvironment") === "test" ? ":test" : "";
const storageKey = () => `${STORE_KEY}${environmentSuffix()}`;
const datePart = (timestamp: string) => {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const eventId = () => globalThis.crypto?.randomUUID?.() || `usage-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const sessionId = eventId();

export const usageRetentionStart = (now = new Date(), days = USAGE_RETENTION_DAYS) => {
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  return start.toISOString();
};

export const pruneUsageEvents = (events: UiUsageEvent[], now = new Date()) => {
  const start = usageRetentionStart(now);
  return events.filter((event) => event.occurredAt >= start).slice(-MAX_RAW_EVENTS);
};

const validEvent = (value: unknown): value is UiUsageEvent => {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<UiUsageEvent>;
  return Boolean(event.id && event.actionId && event.surface && event.sessionId && event.occurredAt
    && (event.kind === "action" || event.kind === "surface"));
};

export const loadUsageStore = (): UsageStore => {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey()) || "null") as Partial<UsageStore> | null;
    if (!parsed || parsed.version !== 1) return emptyStore();
    return {
      version: 1,
      events: pruneUsageEvents(Array.isArray(parsed.events) ? parsed.events.filter(validEvent) : []),
      daily: parsed.daily && typeof parsed.daily === "object" ? parsed.daily : {},
    };
  } catch {
    return emptyStore();
  }
};

const saveUsageStore = (store: UsageStore) => {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(store));
    window.dispatchEvent(new Event("chattask-usage-updated"));
  } catch (error) {
    console.warn("利用状況を保存できませんでした。", error);
  }
};

const record = (kind: UsageEventKind, actionId: string, surface: string, interaction: UsageInteraction = "click") => {
  const occurredAt = new Date().toISOString();
  const store = loadUsageStore();
  const event: UiUsageEvent = { id: eventId(), kind, actionId, surface, interaction, sessionId, occurredAt };
  const date = datePart(occurredAt);
  const daily = store.daily[date] || { actions: {}, surfaces: {} };
  const counts = kind === "action" ? daily.actions : daily.surfaces;
  counts[actionId] = (counts[actionId] || 0) + 1;
  saveUsageStore({ ...store, events: pruneUsageEvents([...store.events, event]), daily: { ...store.daily, [date]: daily } });
};

export const recordUsageAction = (actionId: string, interaction: UsageInteraction = "click") => {
  const definition = USAGE_ACTIONS.find((item) => item.id === actionId);
  if (!definition) return;
  record("action", actionId, definition.surface, interaction);
};

export const recordUsageSurface = (surface: string) => {
  const actionId = `surface.${surface}`;
  if (loadUsageStore().events.some((event) => event.kind === "surface" && event.actionId === actionId && event.sessionId === sessionId)) return;
  record("surface", actionId, surface);
};

export const installUsageClickTracking = () => {
  const listener = (event: MouseEvent) => {
    const element = (event.target as Element | null)?.closest<HTMLElement>("[data-usage-id]");
    const actionId = element?.dataset.usageId;
    if (!actionId || element?.matches(":disabled,[aria-disabled='true']")) return;
    recordUsageAction(actionId, event.detail === 0 ? "keyboard" : "click");
  };
  document.addEventListener("click", listener, true);
  return () => document.removeEventListener("click", listener, true);
};

export const clearUsageData = () => {
  localStorage.removeItem(storageKey());
  window.dispatchEvent(new Event("chattask-usage-updated"));
};

export const summarizeUsage = (
  events: UiUsageEvent[],
  definitions: UsageActionDefinition[] = USAGE_ACTIONS,
  days = 30,
  now = new Date(),
): UsageActionSummary[] => {
  const periodStart = usageRetentionStart(now, days);
  const period = events.filter((event) => event.occurredAt >= periodStart && event.occurredAt <= now.toISOString());
  return definitions.map((definition) => {
    const actionEvents = period.filter((event) => event.kind === "action" && event.actionId === definition.id);
    const actionSessions = new Set(actionEvents.map((event) => event.sessionId));
    const eligibleSessions = new Set(period.filter((event) => event.kind === "surface" && event.surface === definition.surface).map((event) => event.sessionId));
    const activeDays = new Set(actionEvents.map((event) => datePart(event.occurredAt))).size;
    const sessionRate = eligibleSessions.size ? actionSessions.size / eligibleSessions.size : null;
    let classification: UsageActionSummary["classification"] = "occasional";
    if (definition.occasionalByDesign && actionEvents.length <= 2) classification = "protected";
    else if (eligibleSessions.size < 3 && actionEvents.length < 3) classification = "collecting";
    else if (!actionEvents.length) classification = eligibleSessions.size >= 3 ? "unused" : "rare";
    else if (activeDays >= 3 || actionSessions.size >= 3 || (eligibleSessions.size >= 3 && sessionRate !== null && sessionRate >= .5)) classification = "frequent";
    else if (eligibleSessions.size >= 5 && sessionRate !== null && sessionRate < .1) classification = "rare";
    return {
      ...definition,
      uses: actionEvents.length,
      activeDays,
      sessions: actionSessions.size,
      eligibleSessions: eligibleSessions.size,
      sessionRate,
      lastUsedAt: actionEvents[actionEvents.length - 1]?.occurredAt || "",
      classification,
    };
  });
};

export const buildUsageAnalysisExport = (
  store: UsageStore,
  days = 30,
  now = new Date(),
): UsageAnalysisExport => {
  const start = usageRetentionStart(now, days);
  const startDate = datePart(start);
  const endDate = datePart(now.toISOString());
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    period: { days, start: startDate, end: endDate },
    privacy: { rawEventsIncluded: false, contentIncluded: false },
    actions: summarizeUsage(store.events, USAGE_ACTIONS, days, now),
    daily: Object.fromEntries(Object.entries(store.daily).filter(([date]) => date >= startDate && date <= endDate)),
  };
};

const csvCell = (value: string | number | boolean | null) => {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const usageAnalysisCsv = (analysis: UsageAnalysisExport) => {
  const header = ["期間開始", "期間終了", "操作ID", "機能名", "カテゴリー", "画面", "利用回数", "利用日数", "利用セッション", "表示セッション", "利用率（%）", "最終利用日時", "分類", "必要時に使う機能"];
  const rows = analysis.actions.map((action) => [
    analysis.period.start,
    analysis.period.end,
    action.id,
    action.label,
    action.category,
    action.surface,
    action.uses,
    action.activeDays,
    action.sessions,
    action.eligibleSessions,
    action.sessionRate === null ? "" : Math.round(action.sessionRate * 1000) / 10,
    action.lastUsedAt,
    action.classification,
    Boolean(action.occasionalByDesign),
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
};
