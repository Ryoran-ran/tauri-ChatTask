import { describe, expect, it } from "vitest";
import { buildUsageAnalysisExport, pruneUsageEvents, summarizeUsage, usageAnalysisCsv, type UiUsageEvent, type UsageActionDefinition, type UsageStore } from "../usageAnalytics";

const event = (changes: Partial<UiUsageEvent> = {}): UiUsageEvent => ({
  id: changes.id || "event",
  kind: "action",
  actionId: "main.create",
  surface: "main",
  interaction: "click",
  sessionId: "session-1",
  occurredAt: "2026-10-09T10:00:00.000Z",
  ...changes,
});

const definitions: UsageActionDefinition[] = [
  { id: "main.create", label: "作成", surface: "main", category: "主要操作" },
  { id: "main.hidden", label: "未使用機能", surface: "main", category: "主要操作" },
  { id: "main.backup", label: "バックアップ", surface: "main", category: "管理", occasionalByDesign: true },
];

describe("利用状況の集計", () => {
  it("回数・利用日数・表示セッションに対する利用率を集計する", () => {
    const events = [
      event({ id: "surface-1", kind: "surface", actionId: "surface.main", sessionId: "session-1" }),
      event({ id: "surface-2", kind: "surface", actionId: "surface.main", sessionId: "session-2" }),
      event({ id: "surface-3", kind: "surface", actionId: "surface.main", sessionId: "session-3" }),
      event({ id: "action-1", sessionId: "session-1" }),
      event({ id: "action-2", sessionId: "session-1", occurredAt: "2026-10-08T10:00:00.000Z" }),
      event({ id: "action-3", sessionId: "session-2", occurredAt: "2026-10-07T10:00:00.000Z" }),
    ];

    const summary = summarizeUsage(events, definitions, 30, new Date("2026-10-10T00:00:00.000Z"));
    expect(summary[0]).toMatchObject({ uses: 3, activeDays: 3, sessions: 2, eligibleSessions: 3, sessionRate: 2 / 3, classification: "frequent" });
    expect(summary[1]).toMatchObject({ uses: 0, eligibleSessions: 3, classification: "unused" });
    expect(summary[2].classification).toBe("protected");
  });

  it("90日より古い生イベントを削除する", () => {
    const events = [
      event({ id: "old", occurredAt: "2026-01-01T00:00:00.000Z" }),
      event({ id: "recent", occurredAt: "2026-10-09T00:00:00.000Z" }),
    ];

    expect(pruneUsageEvents(events, new Date("2026-10-10T00:00:00.000Z")).map((item) => item.id)).toEqual(["recent"]);
  });

  it("表示機会が少ない段階では整理候補にせず集計中とする", () => {
    const events = [
      event({ id: "surface-1", kind: "surface", actionId: "surface.main" }),
      event({ id: "action-1" }),
    ];

    const summary = summarizeUsage(events, definitions, 30, new Date("2026-10-10T00:00:00.000Z"));
    expect(summary[0].classification).toBe("collecting");
    expect(summary[1].classification).toBe("collecting");
  });

  it("個別イベントを含めず、期間内の集計をJSON・CSV出力用に整形する", () => {
    const store: UsageStore = {
      version: 1,
      events: [event({ id: "action-1" })],
      daily: {
        "2026-10-09": { actions: { "main.create": 1 }, surfaces: { "surface.main": 1 } },
        "2026-01-01": { actions: { "main.create": 9 }, surfaces: {} },
      },
    };

    const analysis = buildUsageAnalysisExport(store, 30, new Date("2026-10-10T00:00:00.000Z"));
    expect(analysis.privacy).toEqual({ rawEventsIncluded: false, contentIncluded: false });
    expect(analysis.daily).toEqual({ "2026-10-09": store.daily["2026-10-09"] });
    expect(analysis).not.toHaveProperty("events");
    const csv = usageAnalysisCsv(analysis);
    expect(csv).toContain("操作ID,機能名");
    expect(csv).toContain("header.search,全文検索");
    expect(csv).not.toContain("session-1");
  });
});
