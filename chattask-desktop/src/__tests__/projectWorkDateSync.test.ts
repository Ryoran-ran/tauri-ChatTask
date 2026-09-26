import { describe, expect, it, vi } from "vitest";
import { buildBatchWorkDateSyncChanges, buildLinkedTaskDateSyncChanges, buildWorkDateSyncChanges, initialWorkTargetDates, workDateSyncError, workDateSyncSignature, workDatesDiffer } from "../projectWorkDateSync";
import { createTask } from "../appHelpers";
import { buildProjectWorkEditChanges, createProjectWorkEditDraft } from "../projectWorkEditing";
import { parseImportedData } from "../services/storage";
import type { ProjectWorkItem } from "../types";

const now = "2026-09-26T00:00:00.000Z";
const work = (changes: Partial<ProjectWorkItem> = {}): ProjectWorkItem => ({
  id: "work-1", milestoneId: "milestone-1", title: "作業", description: "説明", status: "done",
  priority: "B", dueDate: "2026-10-10", linkedTaskId: "", plannedHours: 3, actualHours: 2,
  targetWorkStartDate: "2026-09-28", targetWorkEndDate: "2026-09-30",
  plannedRanges: [{ id: "range-1", startDate: "2026-09-23", endDate: "2026-09-25", plannedHours: 3,
    title: "作業", status: "completed", completedAt: now, note: "保存するメモ", originalEndDate: "2026-09-24" }],
  sortOrder: 0, createdAt: now, updatedAt: now, completedAt: now, ...changes,
});
const sync = (item: ProjectWorkItem, direction: "schedule-to-work" | "work-to-schedule") =>
  buildWorkDateSyncChanges(item, direction, workDateSyncSignature(item), () => "new-range", now);

describe("プロジェクト全体の作業日同期", () => {
  const pair = () => [work(), work({ id: "work-2", title: "作業2", plannedRanges: [{ ...work().plannedRanges![0], id: "range-2" }], targetWorkStartDate: "2026-10-01", targetWorkEndDate: "2026-10-02" })];
  const select = (items: ProjectWorkItem[]) => items.map((item) => ({ id: item.id, expectedSignature: workDateSyncSignature(item) }));

  it("選択した複数作業をまとめて更新し、未選択の作業は変更しない", () => {
    const items = [...pair(), work({ id: "excluded" })];
    const before = structuredClone(items);
    const result = buildBatchWorkDateSyncChanges(items, items, [], select(items.slice(0, 2)), "schedule-to-work", () => "new", now);
    expect(result.workItems.slice(0, 2).map((item) => item.plannedRanges![0].startDate)).toEqual(["2026-09-28", "2026-10-01"]);
    expect(result.workItems[2]).toBe(items[2]);
    expect(items).toEqual(before);
    expect(result.taskChanges).toEqual([]);
  });

  it("同じTaskの複数予定の更新を1つにまとめ、別予定と実績を残す", () => {
    const items = pair().map((item) => ({ ...item, linkedTaskId: "task" }));
    const ranges = items.map((item) => ({ ...item.plannedRanges![0], sourceType: "project-work" as const, sourceId: item.id }));
    const normal = { ...ranges[0], id: "normal", sourceType: undefined, sourceId: undefined };
    const task = { ...createTask(), id: "task", plannedRanges: [normal, ...ranges], plannedHours: 9, dailyActualHours: { "2026-09-23::range-1": 2 } };
    const before = structuredClone(task);
    const result = buildBatchWorkDateSyncChanges(items, items, [task], select(items), "schedule-to-work", () => "new", now);
    expect(result.taskChanges).toHaveLength(1);
    const changes = result.taskChanges[0].changes;
    expect(changes.plannedRanges?.map((range) => range.startDate)).toEqual(["2026-09-23", "2026-09-28", "2026-10-01"]);
    expect(changes.plannedRanges?.[0]).toEqual(normal);
    expect(Object.keys(changes)).toEqual(["plannedRanges"]);
    expect(task).toEqual(before);
  });

  it("同じTaskへの予定の新規追加も複数件保持し、工数を合算する", () => {
    const items = pair().map((item) => ({ ...item, linkedTaskId: "task", plannedRanges: [] }));
    let id = 0;
    const result = buildBatchWorkDateSyncChanges(items, items, [{ ...createTask(), id: "task", plannedRanges: [] }], select(items), "schedule-to-work", () => `new-${++id}`, now);
    expect(result.taskChanges).toHaveLength(1);
    expect(result.taskChanges[0].changes.plannedRanges?.map((range) => range.id)).toEqual(["new-1", "new-2"]);
    expect(result.taskChanges[0].changes.plannedHours).toBe(6);
  });

  it("逆方向の一括同期は目標期間だけを更新し、関連Taskを書き換えない", () => {
    const items = pair();
    const result = buildBatchWorkDateSyncChanges(items, items, [], select(items), "work-to-schedule", () => "new", now);
    result.workItems.forEach((item, index) => {
      expect(item).toEqual({ ...items[index], targetWorkStartDate: "2026-09-23", targetWorkEndDate: "2026-09-25", updatedAt: now });
    });
    expect(result.taskChanges).toEqual([]);
  });

  it("2件目が確認後に変更された場合、1件目も含めて反映用データを返さない", () => {
    const items = pair();
    const selection = select(items);
    items[1] = { ...items[1], targetWorkEndDate: "2026-10-03" };
    const before = structuredClone(items);
    expect(() => buildBatchWorkDateSyncChanges(items, items, [], selection, "schedule-to-work", () => "new", now)).toThrow("今回の同期は反映していません");
    expect(items).toEqual(before);
  });

  it("選択した作業の空欄・削除・関連Task消失は全体を中止する", () => {
    const items = pair();
    const empty = [items[0], { ...items[1], targetWorkStartDate: "" }];
    expect(() => buildBatchWorkDateSyncChanges(empty, empty, [], select(empty), "schedule-to-work", () => "new", now)).toThrow("同期元");
    expect(() => buildBatchWorkDateSyncChanges(items.slice(0, 1), items.slice(0, 1), [], select(items), "schedule-to-work", () => "new", now)).toThrow("見つからない");
    const missing = [items[0], { ...items[1], linkedTaskId: "missing" }];
    expect(() => buildBatchWorkDateSyncChanges(missing, missing, [], select(missing), "schedule-to-work", () => "new", now)).toThrow("関連ChatTask");
  });

  it("無効な作業でも未選択なら同期を妨げず、そのまま保持する", () => {
    const items = pair();
    items[1].targetWorkStartDate = "";
    const result = buildBatchWorkDateSyncChanges(items, items, [], select(items.slice(0, 1)), "schedule-to-work", () => "new", now);
    expect(result.workItems[1]).toBe(items[1]);
  });

  it("表示用の実績・期限・優先度を保存データに上書きしない", () => {
    const items = pair();
    const displayed = items.map((item) => ({ ...item, actualHours: 99, dueDate: "", priority: "A" as const }));
    const result = buildBatchWorkDateSyncChanges(items, displayed, [], select(displayed), "schedule-to-work", () => "new", now);
    result.workItems.forEach((item, i) => {
      expect(item.actualHours).toBe(items[i].actualHours);
      expect(item.dueDate).toBe(items[i].dueDate);
      expect(item.priority).toBe(items[i].priority);
    });
  });

  it("0件選択は何も変更しない", () => {
    const items = pair();
    const result = buildBatchWorkDateSyncChanges(items, items, [], [], "schedule-to-work", () => "new", now);
    expect(result.workItems).toEqual(items);
    expect(result.taskChanges).toEqual([]);
  });
});

describe("作業日の明示的な同期", () => {
  it("異なる作業日を検出し、同じ作業日は差異としない", () => {
    expect(workDatesDiffer(work())).toBe(true);
    expect(workDatesDiffer(work({ targetWorkStartDate: "2026-09-23", targetWorkEndDate: "2026-09-25" }))).toBe(false);
    expect(workDatesDiffer(work({ targetWorkStartDate: "", targetWorkEndDate: "", plannedRanges: [] }))).toBe(false);
  });

  it("単日の終了日省略は開始日と同じと扱う", () => {
    const item = work({ targetWorkStartDate: "2026-09-23", targetWorkEndDate: "2026-09-23",
      plannedRanges: [{ id: "r", startDate: "2026-09-23", endDate: "" }] });
    expect(workDatesDiffer(item)).toBe(false);
  });

  it("スケジュールからの同期で予定ID・メモ・状態・工数・実績と元データを保持する", () => {
    const item = work();
    const before = structuredClone(item);
    const changes = sync(item, "schedule-to-work");
    expect(changes.plannedRanges).toEqual([{ ...item.plannedRanges![0], startDate: "2026-09-28", endDate: "2026-09-30" }]);
    expect(changes.baselinePlannedRanges).toEqual(item.plannedRanges);
    expect(changes.replannedAt).toBe(now);
    expect(item).toEqual(before);
    for (const key of ["plannedHours", "actualHours", "title", "description", "priority", "dueDate", "status", "completedAt", "linkedTaskId"]) {
      expect(changes).not.toHaveProperty(key);
    }
  });

  it("初期計画と変更理由が既にある場合は保持する", () => {
    const baseline = [{ id: "r", startDate: "2026-09-01", endDate: "2026-09-03", plannedHours: 5 }];
    const changes = sync(work({ baselinePlannedRanges: baseline, baselinePlannedHours: 5, replanReason: "調整" }), "schedule-to-work");
    expect(changes.baselinePlannedRanges).toEqual(baseline);
    expect(changes.baselinePlannedHours).toBe(5);
    expect(changes.replanReason).toBe("調整");
  });

  it("初期計画がない作業では、0の初期値ではなく現在の見積工数を初期計画に残す", () => {
    const changes = sync(work({ baselinePlannedRanges: [], baselinePlannedHours: 0 }), "schedule-to-work");
    expect(changes.baselinePlannedHours).toBe(3);
  });

  it("マイルストーンからの同期では目標期間の2項目だけを変更する", () => {
    expect(sync(work(), "work-to-schedule")).toEqual({ targetWorkStartDate: "2026-09-23", targetWorkEndDate: "2026-09-25" });
  });

  it("作業日が未設定の場合は明示的な同期でのみ予定を作成する", () => {
    const item = work({ plannedRanges: [] });
    const changes = sync(item, "schedule-to-work");
    expect(changes.plannedRanges).toEqual([{ id: "new-range", title: "作業", startDate: "2026-09-28", endDate: "2026-09-30", plannedHours: 3, status: "completed", completedAt: now }]);
    expect(item.plannedRanges).toEqual([]);
  });

  it.each([
    { targetWorkStartDate: "", targetWorkEndDate: "" },
    { targetWorkEndDate: "" },
    { targetWorkStartDate: "2026-02-30" },
    { targetWorkStartDate: "2026-10-01" },
  ])("空欄・無効日付・逆転した期間は既存予定に反映しない: %j", (changes) => {
    expect(() => sync(work(changes), "schedule-to-work")).toThrow();
  });

  it("未設定の作業日を同期して既存の目標期間を消さない", () => {
    expect(() => sync(work({ plannedRanges: [] }), "work-to-schedule")).toThrow();
  });

  it("複数予定は1件に切り詰めず同期を止める", () => {
    const item = work();
    item.plannedRanges!.push({ ...item.plannedRanges![0], id: "range-2" });
    for (const direction of ["schedule-to-work", "work-to-schedule"] as const) {
      expect(workDateSyncError(item, direction)).toContain("複数");
      expect(() => sync(item, direction)).toThrow();
    }
    expect(item.plannedRanges).toHaveLength(2);
  });

  it("確認後に日付が変わった場合は古い確認内容で上書きしない", () => {
    const item = work();
    const signature = workDateSyncSignature(item);
    item.targetWorkStartDate = "2026-09-29";
    expect(() => buildWorkDateSyncChanges(item, "schedule-to-work", signature, () => "new", now)).toThrow("確認中");
  });

  it("一致する日付を再同期して予定IDを作り直さない", () => {
    const item = work({ targetWorkStartDate: "2026-09-23", targetWorkEndDate: "2026-09-25" });
    const newId = vi.fn(() => "new");
    expect(buildWorkDateSyncChanges(item, "schedule-to-work", workDateSyncSignature(item), newId, now)).toEqual({});
    expect(newId).not.toHaveBeenCalled();
  });

  it("確認中に関連Taskが変わった場合は同期を中止する", () => {
    const item = work();
    const signature = workDateSyncSignature(item);
    item.linkedTaskId = "another-task";
    expect(() => buildWorkDateSyncChanges(item, "schedule-to-work", signature, () => "new", now)).toThrow("確認中");
  });

  it("旧データのみ初期補完し、明示的に空にした目標日は復活させない", () => {
    expect(initialWorkTargetDates(work({ targetWorkStartDate: undefined, targetWorkEndDate: undefined })))
      .toEqual({ targetWorkStartDate: "2026-09-23", targetWorkEndDate: "2026-09-25" });
    expect(initialWorkTargetDates(work({ targetWorkStartDate: "", targetWorkEndDate: "" })))
      .toEqual({ targetWorkStartDate: "", targetWorkEndDate: "" });
  });
});

describe("目標期間の削除と旧データ補完", () => {
  it.each([
    ["", "", "", ""],
    ["", undefined, "", ""],
    [undefined, "", "", ""],
    ["2026-09-28", undefined, "2026-09-28", ""],
    [undefined, "2026-09-30", "", "2026-09-30"],
    ["2026-09-28", "", "2026-09-28", ""],
    [null, null, "", ""],
    [null, undefined, "", ""],
  ])("削除済み／片側未設定の期間は補完しない: %s, %s", (start, end, expectedStart, expectedEnd) => {
    // JSON由来のnullも含めて読み込み時の防御を検証する。
    const item = { ...work(), targetWorkStartDate: start, targetWorkEndDate: end } as ProjectWorkItem;
    expect(initialWorkTargetDates(item)).toEqual({ targetWorkStartDate: expectedStart, targetWorkEndDate: expectedEnd });
  });

  it("両項目が未導入の旧データは補完し、その後の明示的削除を維持する", () => {
    const legacy = work({ targetWorkStartDate: undefined, targetWorkEndDate: undefined });
    const migrated = { ...legacy, ...initialWorkTargetDates(legacy) };
    expect(migrated.targetWorkStartDate).toBe("2026-09-23");
    const cleared = { ...migrated, targetWorkStartDate: "", targetWorkEndDate: "" };
    expect(initialWorkTargetDates(cleared)).toEqual({ targetWorkStartDate: "", targetWorkEndDate: "" });
    expect(cleared.plannedRanges).toEqual(legacy.plannedRanges);
  });

  it("削除→JSON保存と再読み込み→説明保存を繰り返しても期間を復活させない", () => {
    const original = work();
    let item: ProjectWorkItem = { ...original, targetWorkStartDate: "", targetWorkEndDate: "" };
    for (let cycle = 0; cycle < 3; cycle++) {
      const restored = parseImportedData(JSON.stringify({ organizationSeed: 1, tasks: [], goals: [{ id: "project", workItems: [item] }] })).goals[0].workItems![0];
      const normalized = { ...restored, ...initialWorkTargetDates(restored) };
      const initial = createProjectWorkEditDraft(normalized, normalized);
      const changes = buildProjectWorkEditChanges(initial, { ...initial, description: `説明 ${cycle}` }, now);
      expect(changes).toEqual({ description: `説明 ${cycle}` });
      item = { ...normalized, ...changes };
      expect(item.targetWorkStartDate).toBe("");
      expect(item.targetWorkEndDate).toBe("");
      expect(item.plannedRanges).toEqual(original.plannedRanges);
    }
  });

  it("削除後の作業日変更も目標期間に自動反映しない", () => {
    const cleared = work({ targetWorkStartDate: "", targetWorkEndDate: "" });
    const changed = { ...cleared, plannedRanges: [{ ...cleared.plannedRanges![0], startDate: "2026-10-01", endDate: "2026-10-05" }] };
    expect(initialWorkTargetDates(changed)).toEqual({ targetWorkStartDate: "", targetWorkEndDate: "" });
    // ユーザーが明示的に同期した場合に限り復元できる。
    expect(sync(changed, "work-to-schedule")).toEqual({ targetWorkStartDate: "2026-10-01", targetWorkEndDate: "2026-10-05" });
  });
});

describe("関連ChatTaskへの日付専用同期", () => {
  it("同内容の別IDの通常予定・他作業を残し、日別メモと実績、予定工数を上書きしない", () => {
    const item = work();
    const range = { ...item.plannedRanges![0], sourceType: "project-work" as const, sourceId: item.id };
    const normal = { ...item.plannedRanges![0], id: "normal" };
    const other = { ...range, id: "other", sourceId: "other-work" };
    const task = { ...createTask(), plannedRanges: [normal, range, other], plannedHours: 15,
      dailyPlans: { "2026-09-23": "メモ", "2026-09-23::range-1": "専用メモ" },
      dailyActualHours: { "2026-09-23": 1, "2026-09-23::range-1": 2 },
      dailyPlanCompleted: { "2026-09-23": true } };
    const before = structuredClone(task);
    const changes = buildLinkedTaskDateSyncChanges(task, item.id, sync(item, "schedule-to-work").plannedRanges![0]);
    expect(Object.keys(changes)).toEqual(["plannedRanges"]);
    expect(changes.plannedRanges).toEqual([normal, { ...range, startDate: "2026-09-28", endDate: "2026-09-30" }, other]);
    expect({ ...task, ...changes }.dailyActualHours).toEqual(before.dailyActualHours);
    expect({ ...task, ...changes }.dailyPlans).toEqual(before.dailyPlans);
    expect(task).toEqual(before);
  });

  it("関連Taskに予定がない場合は新規予定だけを追加し、通常予定を保持する", () => {
    const item = work();
    const range = sync(item, "schedule-to-work").plannedRanges![0];
    const normal = { ...range, id: "normal" };
    const changes = buildLinkedTaskDateSyncChanges({ ...createTask(), plannedRanges: [normal] }, item.id, range);
    expect(changes.plannedRanges).toEqual([normal, { ...range, sourceType: "project-work", sourceId: item.id }]);
    expect(changes.plannedHours).toBe(6);
  });

  it("同じIDでも他作業に属する予定は書き換えない", () => {
    const item = work();
    const range = item.plannedRanges![0];
    const task = { ...createTask(), plannedRanges: [{ ...range, sourceType: "project-work" as const, sourceId: "other-work" }] };
    expect(() => buildLinkedTaskDateSyncChanges(task, item.id, range)).toThrow("別の作業");
  });

  it("対応予定が複数ある、またはIDが変わった場合も削除せず中止する", () => {
    const item = work();
    const range = item.plannedRanges![0];
    const owned = { ...range, sourceType: "project-work" as const, sourceId: item.id };
    for (const plannedRanges of [[{ ...owned, id: "changed" }], [owned, { ...owned, id: "extra" }]]) {
      expect(() => buildLinkedTaskDateSyncChanges({ ...createTask(), plannedRanges }, item.id, range)).toThrow("変更");
    }
  });

  it("Task内で予定IDが重複している場合に複数の予定を書き換えない", () => {
    const item = work();
    const range = item.plannedRanges![0];
    expect(() => buildLinkedTaskDateSyncChanges({ ...createTask(), plannedRanges: [range, { ...range }] }, item.id, range)).toThrow("重複");
  });
});
