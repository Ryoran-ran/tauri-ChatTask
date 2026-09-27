import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTask } from "../appHelpers";
import { parseImportedData } from "../services/storage";
import type { AppData, Goal, ProjectWorkItem } from "../types";
import { applyScheduleCommand, historyUndoProblem, scheduleAppReducer, scheduleChangesForStorage, type ScheduleCommand } from "../projectScheduleHistory";
import { ScheduleHistoryDialog } from "../components/ScheduleHistoryDialog";
vi.mock("../components/Modal", () => ({ Modal: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

const work = (id: string): ProjectWorkItem => ({ id, title: id, milestoneId: "m", description: "保持", priority: "A", dueDate: "2026-10-10", linkedTaskId: "", status: "not-started", plannedHours: 3, actualHours: 2, sortOrder: 0, targetWorkStartDate: "2026-09-28", targetWorkEndDate: "2026-09-30", createdAt: "created", updatedAt: "updated" });
const project = (id = "p"): Goal => ({ id, title: id, description: "", successCriteria: "", dueDate: "", status: "in-progress", projectTagId: "", taskIds: [], reviews: [], milestones: [{ id: "m", title: "到達点", completed: false, taskIds: [], dueDate: "2026-10-10" }], workItems: [work("a"), work("b")], createdAt: "created", updatedAt: "updated" });
const seed = (): AppData => parseImportedData(JSON.stringify({ tasks: [], organizationSeed: 1, goals: [project(), project("other")], projectDailyCapacityHours: 6 }));
function move(data: AppData, id: string, workId = "a", end = "2026-10-01"): ScheduleCommand {
  const p = data.goals[0];
  return { kind: "apply", id, now: "2026-09-27T12:00:00.000Z", projectId: p.id, expectedProject: structuredClone(p), expectedTasks: [], expectedCapacity: data.projectDailyCapacityHours || 6, label: "作業の目標期間変更", taskChanges: [], changes: { workItems: p.workItems!.map(w => w.id === workId ? { ...w, targetWorkEndDate: end } : w) } };
}
const undo = (historyId: string, projectId = "p"): ScheduleCommand => ({ kind: "undo", id: `undo-${historyId}`, projectId, now: "2026-09-27T13:00:00.000Z", historyId });

describe("永続スケジュール取り消し履歴", () => {
  it("保存・再読み込み後に取り消せ、二重実行を拒否する", () => {
    const initial = seed();
    const saved = applyScheduleCommand(initial, move(initial, "h1")).data;
    const reloaded = parseImportedData(JSON.stringify(saved));
    const reverted = applyScheduleCommand(reloaded, undo("h1")).data;
    expect(reverted.goals[0].workItems![0].targetWorkEndDate).toBe("2026-09-30");
    expect(reverted.goals[0].scheduleHistory![0].undoneAt).toBeTruthy();
    expect(() => applyScheduleCommand(reverted, undo("h1"))).toThrow("取り消し済み");
    expect(initial.goals[0].scheduleHistory).toBeUndefined();
  });
  it("無関係な作業や後から編集した説明・優先度・期限を保持する", () => {
    let data = seed(); data = applyScheduleCommand(data, move(data, "a")).data; data = applyScheduleCommand(data, move(data, "b", "b")).data;
    data.goals[0].workItems![0].description = "変更済み";
    data.goals[0].workItems![0].dueDate = "2026-11-01";
    const restored = applyScheduleCommand(data, undo("a")).data;
    expect(restored.goals[0].workItems![0]).toMatchObject({ description: "変更済み", dueDate: "2026-11-01", priority: "A", targetWorkEndDate: "2026-09-30" });
    expect(restored.goals[0].workItems![1].targetWorkEndDate).toBe("2026-10-01");
    expect(restored.goals[1]).toBe(data.goals[1]);
  });
  it("同じ項目の新しい変更を先に取り消すと、古い変更も取り消せる", () => {
    let data = seed(); data = applyScheduleCommand(data, move(data, "first")).data; data = applyScheduleCommand(data, move(data, "second", "a", "2026-10-02")).data;
    expect(() => applyScheduleCommand(data, undo("first"))).toThrow("上書きを防ぐ");
    data = applyScheduleCommand(data, undo("second")).data; data = applyScheduleCommand(data, undo("first")).data;
    expect(data.goals[0].workItems![0].targetWorkEndDate).toBe("2026-09-30");
  });
  it("最新50件を保持し、別プロジェクトの履歴を混ぜない", () => {
    let data = seed();
    for (let i = 0; i < 55; i++) data = applyScheduleCommand(data, move(data, `h${i}`, "a", i % 2 ? "2026-10-02" : "2026-10-01")).data;
    expect(data.goals[0].scheduleHistory).toHaveLength(50);
    expect(data.goals[0].scheduleHistory![49].id).toBe("h5");
    expect(data.goals[1].scheduleHistory).toBeUndefined();
    expect(() => applyScheduleCommand(data, undo("h0"))).toThrow("最新50件");
    expect(() => applyScheduleCommand(data, undo("h54", "other"))).toThrow("見つかりません");
  });
  it("まとめ移動は1履歴で、対象の1件が削除されたら全件中止", () => {
    const initial = seed(); const command = move(initial, "bulk");
    if (command.kind !== "apply") throw Error();
    command.changes.workItems = initial.goals[0].workItems!.map(w => ({ ...w, targetWorkEndDate: "2026-10-02" }));
    const data = applyScheduleCommand(initial, command).data;
    expect(data.goals[0].scheduleHistory).toHaveLength(1);
    expect(data.goals[0].scheduleHistory![0].works).toHaveLength(2);
    data.goals[0].workItems!.pop(); const snapshot = structuredClone(data);
    const result = scheduleAppReducer({ data }, { type: "schedule", command: undo("bulk") });
    expect(result.data).toBe(data); expect(result.data).toEqual(snapshot); expect(result.scheduleResult?.error).toContain("削除");
  });
  it("同期と履歴を一括反映し、再起動後もProjectとTaskをまとめて戻す", () => {
    const initial = seed(); initial.tasks = [{ ...createTask(), id: "task", plannedRanges: [], plannedHours: 0 }];
    const command = move(initial, "sync"); if (command.kind !== "apply") throw Error();
    command.expectedTasks = structuredClone(initial.tasks);
    command.taskChanges = [{ id: "task", changes: { plannedRanges: [{ id: "r", startDate: "2026-09-28", endDate: "2026-10-01", plannedHours: 3, sourceType: "project-work", sourceId: "a" }], plannedHours: 3 } }];
    const saved = applyScheduleCommand(initial, command).data;
    const loaded = parseImportedData(JSON.stringify(saved));
    const restored = applyScheduleCommand(loaded, undo("sync")).data;
    expect(restored.tasks[0].plannedRanges).toEqual([]); expect(restored.tasks[0].plannedHours).toBe(0);
    expect(restored.goals[0].workItems![0].targetWorkEndDate).toBe("2026-09-30");
    loaded.tasks[0].plannedRanges.push({ id: "normal", startDate: "2026-10-05", endDate: "2026-10-05" });
    const result = scheduleAppReducer({ data: loaded }, { type: "schedule", command: undo("sync") });
    expect(result.data).toBe(loaded); expect(result.scheduleResult?.error).toContain("上書き");
  });
  it("古い画面からの同期要求はTaskもProjectも履歴も変更しない", () => {
    const data = seed(); const command = move(data, "stale");
    data.goals[0].workItems![0].description = "別画面から変更";
    const result = scheduleAppReducer({ data }, { type: "schedule", command });
    expect(result.data).toBe(data); expect(result.scheduleResult?.error).toBeTruthy(); expect(data.goals[0].scheduleHistory).toBeUndefined();
  });
  it("共通の計画可能時間を記録し、他の変更があると拒否する", () => {
    const data = seed(); const command = move(data, "capacity"); if (command.kind !== "apply") throw Error();
    command.changes = {}; command.capacity = 4;
    const saved = applyScheduleCommand(data, command).data;
    expect(applyScheduleCommand(saved, undo("capacity")).data.projectDailyCapacityHours).toBe(6);
    saved.projectDailyCapacityHours = 5;
    expect(() => applyScheduleCommand(saved, undo("capacity"))).toThrow("計画可能時間");
  });
  it("表示用補完値を保存せず、日付の差分だけを保持する", () => {
    const raw = project(); const view = structuredClone(raw);
    view.workItems![0].priority = "B"; view.workItems![0].dueDate = "";
    const patch = scheduleChangesForStorage(raw, view, { workItems: view.workItems!.map(w => w.id === "a" ? { ...w, targetWorkEndDate: "2026-10-02" } : w) });
    expect(patch.workItems![0]).toMatchObject({ priority: "A", dueDate: "2026-10-10", targetWorkEndDate: "2026-10-02" });
    expect(patch.workItems![1]).toBe(raw.workItems![1]);
  });
  it("旧データの補完された片側の日付も、期間変更時に保存する", () => {
    const raw = project(); const view = structuredClone(raw);
    delete raw.workItems![0].targetWorkStartDate; delete raw.workItems![0].targetWorkEndDate;
    const changes = scheduleChangesForStorage(raw, view, { workItems: view.workItems!.map(w => w.id === "a" ? { ...w, targetWorkEndDate: "2026-10-02" } : w) });
    expect(changes.workItems![0]).toMatchObject({ targetWorkStartDate: "2026-09-28", targetWorkEndDate: "2026-10-02" });
  });
  it("未定義だったガードもJSON往復で失わず、紐付けの変更を検出する", () => {
    const data = seed(); delete data.goals[0].milestones[0].linkedTaskId;
    const command = move(data, "m"); if (command.kind !== "apply") throw Error();
    command.changes = { milestones: data.goals[0].milestones.map(m => ({ ...m, dueDate: "2026-10-11" })) };
    const loaded: AppData = JSON.parse(JSON.stringify(applyScheduleCommand(data, command).data));
    loaded.goals[0].milestones[0].linkedTaskId = "new";
    expect(() => applyScheduleCommand(loaded, undo("m"))).toThrow("上書き");
  });
  it("未知バージョンや不正な履歴は適用しない", () => {
    const data = seed(); const saved = applyScheduleCommand(data, move(data, "h")).data;
    const record = saved.goals[0].scheduleHistory![0];
    record.works[0].fields[0].key = "id";
    expect(historyUndoProblem(record, saved.goals[0], [], 6)).toContain("不正");
    expect(() => applyScheduleCommand(saved, undo("h"))).toThrow("不正");
  });
  it("SQLite保存でJSONのキー順が変わっても、同期の取り消しを妨げない", () => {
    const data = seed(); data.tasks = [{ ...createTask(), id: "t", plannedRanges: [] }];
    const command = move(data, "sqlite"); if (command.kind !== "apply") throw Error();
    command.expectedTasks = structuredClone(data.tasks);
    command.taskChanges = [{ id: "t", changes: { plannedRanges: [{ id: "r", startDate: "2026-09-28", endDate: "2026-09-30", plannedHours: 3 }] } }];
    const saved = applyScheduleCommand(data, command).data;
    saved.tasks[0].plannedRanges = [{ plannedHours: 3, endDate: "2026-09-30", startDate: "2026-09-28", id: "r" }];
    expect(applyScheduleCommand(saved, undo("sqlite")).data.tasks[0].plannedRanges).toEqual([]);
  });
  it("履歴一覧は変更前後・対象・取り消し状態を表示する", () => {
    const data = seed(); const saved = applyScheduleCommand(data, move(data, "h")).data;
    const html = renderToStaticMarkup(<ScheduleHistoryDialog project={saved.goals[0]} tasks={[]} capacity={6} onUndo={() => {}} onClose={() => {}} />);
    expect(html).toContain("目標終了日"); expect(html).toContain("2026-10-01"); expect(html).toContain("2026-09-30"); expect(html).toContain("取り消し可能");
    const restored = applyScheduleCommand(saved, undo("h")).data;
    const after = renderToStaticMarkup(<ScheduleHistoryDialog project={restored.goals[0]} tasks={[]} capacity={6} onUndo={() => {}} onClose={() => {}} />);
    expect(after).toContain("取り消し済み"); expect(after).not.toContain("この操作を取り消す");
  });
});
