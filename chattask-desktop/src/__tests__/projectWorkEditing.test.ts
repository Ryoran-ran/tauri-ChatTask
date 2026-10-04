import { describe, expect, it } from "vitest";
import { appendProjectWork, buildProjectWorkEditChanges, createProjectWorkEditDraft } from "../projectWorkEditing";
import type { ProjectWorkItem } from "../types";

const now = "2026-09-26T12:00:00.000Z";
const stored = (): ProjectWorkItem => ({
  id: "work", milestoneId: "milestone", linkedTaskId: "task", title: "作業", description: "元の説明",
  priority: "A", dueDate: "2026-09-30", status: "in-progress", plannedHours: 3, actualHours: 2,
  targetWorkStartDate: "2026-09-28", targetWorkEndDate: "2026-09-29",
  plannedRanges: [{ id: "range", title: "作業", startDate: "2026-09-21", endDate: "2026-09-23", plannedHours: 3, note: "メモ", status: "in-progress" }],
  baselinePlannedRanges: [], baselinePlannedHours: 0, sortOrder: 1, createdAt: "2026-09-01", updatedAt: "2026-09-01",
});
const displayed = (work: ProjectWorkItem): ProjectWorkItem => ({
  ...work, priority: "B", dueDate: "", actualHours: 99,
  plannedRanges: work.plannedRanges?.map((range) => ({ ...range, startDate: "2026-09-24", endDate: "2026-09-25", sourceType: "project-work", sourceId: work.id })),
});

describe("未保存作業の破棄と追加", () => {
  it("1回の更新で未保存作業を除外し、次の作業だけを追加する", () => {
    const saved = stored();
    const draft = { ...stored(), id: "draft" };
    const next = { ...draft, id: "next" };
    const works = [saved, draft];
    expect(appendProjectWork(works, next, draft.id)).toEqual([saved, next]);
    expect(works).toEqual([saved, draft]);
  });

  it("繰り返し切り替えても未保存作業が増えず、最後のキャンセルで元の一覧に戻る", () => {
    const saved = stored();
    let draft = { ...stored(), id: "draft-0" };
    let works = [saved, draft];
    for (let index = 1; index <= 5; index++) {
      const next = { ...draft, id: `draft-${index}` };
      works = appendProjectWork(works, next, draft.id);
      expect(works).toHaveLength(2);
      expect(works.some((work) => work.id === draft.id)).toBe(false);
      draft = next;
    }
    expect(works.filter((work) => work.id !== draft.id)).toEqual([saved]);
  });

  it("保存済み作業から新規追加する場合は、既存作業を破棄しない", () => {
    const saved = stored();
    const next = { ...saved, id: "new" };
    expect(appendProjectWork([saved], next)).toEqual([saved, next]);
  });

  it("別マイルストーンの作業・同名の作業とその予定・実績を保持する", () => {
    const saved = stored();
    const other = { ...saved, id: "other", milestoneId: "other-milestone" };
    const draft = { ...saved, id: "draft" };
    const next = { ...saved, id: "next" };
    const result = appendProjectWork([saved, draft, other], next, draft.id);
    expect(result).toEqual([saved, other, next]);
    expect(result[0]).toBe(saved);
    expect(result[1]).toBe(other);
  });

  it("不明なIDや別マイルストーンの作業は削除せず中止する", () => {
    const saved = stored();
    const next = { ...saved, id: "next", milestoneId: "other" };
    const works = [saved];
    expect(() => appendProjectWork(works, next, "missing")).toThrow("破棄対象");
    expect(() => appendProjectWork(works, next, saved.id)).toThrow("破棄対象");
    expect(works).toEqual([saved]);
  });

  it("追加IDや破棄対象IDの重複を検知し、一覧を変更しない", () => {
    const saved = stored();
    expect(() => appendProjectWork([saved], saved, saved.id)).toThrow("重複");
    expect(() => appendProjectWork([saved, { ...saved }], { ...saved, id: "new" }, saved.id)).toThrow("破棄対象");
  });
});

describe("プロジェクト作業の編集データ保全", () => {
  it("編集初期値の期限と優先度は関連Taskではなく作業自身の値を使う", () => {
    const work = stored();
    const view = displayed(work);
    const draft = createProjectWorkEditDraft(work, view);
    expect(draft.priority).toBe("A");
    expect(draft.dueDate).toBe("2026-09-30");
    expect(draft.actualHours).toBe(2);
    expect(draft.plannedRanges).toEqual(view.plannedRanges);
    expect(draft.plannedRanges).not.toBe(view.plannedRanges);
  });

  it("説明だけの編集で期限あり・優先度Aが期限なし・優先度Bに変わらない", () => {
    const work = stored();
    const before = structuredClone(work);
    const initial = createProjectWorkEditDraft(work, displayed(work));
    const changes = buildProjectWorkEditChanges(initial, { ...initial, description: "説明のみ変更" }, now);
    expect(changes).toEqual({ description: "説明のみ変更" });
    expect({ ...work, ...changes }).toEqual({ ...before, description: "説明のみ変更" });
    expect(work).toEqual(before);
  });

  it("説明保存では予定・工数・完了状態・目標日を同期対象に含めない", () => {
    const work = stored();
    const initial = createProjectWorkEditDraft(work, { ...displayed(work), plannedHours: 7 });
    const changes = buildProjectWorkEditChanges(initial, { ...initial, description: "変更" }, now);
    for (const key of ["title", "status", "linkedTaskId", "plannedRanges", "plannedHours", "actualHours", "baselinePlannedRanges", "baselinePlannedHours", "targetWorkStartDate", "targetWorkEndDate", "completedAt", "sortOrder"]) {
      expect(changes).not.toHaveProperty(key);
    }
  });

  it("無編集保存は何も更新しない", () => {
    const work = stored();
    const initial = createProjectWorkEditDraft(work, displayed(work));
    expect(buildProjectWorkEditChanges(initial, structuredClone(initial), now)).toEqual({});
  });

  it("期限と優先度を明示的に変更した場合はその変更だけを保存する", () => {
    const initial = stored();
    expect(buildProjectWorkEditChanges(initial, { ...initial, dueDate: "2026-10-10", priority: "C" }, now))
      .toEqual({ dueDate: "2026-10-10", priority: "C" });
    expect(buildProjectWorkEditChanges(initial, { ...initial, dueDate: "" }, now)).toEqual({ dueDate: "" });
  });

  it("所属マイルストーンの変更と直属化を保存できる", () => {
    const initial = stored();
    expect(buildProjectWorkEditChanges(initial, { ...initial, milestoneId: "other-milestone" }, now))
      .toEqual({ milestoneId: "other-milestone" });
    expect(buildProjectWorkEditChanges(initial, { ...initial, milestoneId: "" }, now))
      .toEqual({ milestoneId: "" });
  });

  it("関連Taskがない作業でも説明以外を保存しない", () => {
    const work = { ...stored(), linkedTaskId: "" };
    const initial = createProjectWorkEditDraft(work, work);
    expect(buildProjectWorkEditChanges(initial, { ...initial, description: "変更" }, now)).toEqual({ description: "変更" });
  });

  it("編集中に別の操作で変更された未編集の期限・優先度を巻き戻さない", () => {
    const work = stored();
    const initial = createProjectWorkEditDraft(work, displayed(work));
    const latest = { ...work, dueDate: "2026-10-15", priority: "D" as const, actualHours: 5 };
    const changes = buildProjectWorkEditChanges(initial, { ...initial, description: "変更" }, now);
    expect({ ...latest, ...changes }).toEqual({ ...latest, description: "変更" });
  });

  it("作業日・工数を編集した場合は予定を更新し、初期計画も設定する", () => {
    const initial = stored();
    const draft = { ...initial, plannedHours: 5, plannedRanges: [{ ...initial.plannedRanges![0], endDate: "2026-09-26" }] };
    const changes = buildProjectWorkEditChanges(initial, draft, now);
    expect(changes.plannedHours).toBe(5);
    expect(changes.plannedRanges).toEqual([{ ...draft.plannedRanges[0], plannedHours: 5 }]);
    expect(changes.baselinePlannedRanges).toEqual(changes.plannedRanges);
    expect(changes).not.toHaveProperty("dueDate");
    expect(changes).not.toHaveProperty("priority");
  });

  it.each(["title", "status", "linkedTaskId"] as const)("%s の編集による同期では表示中の最新作業日を保持する", (key) => {
    const work = stored();
    const initial = createProjectWorkEditDraft(work, displayed(work));
    const draft = { ...initial, [key]: key === "title" ? "新名称" : key === "status" ? "done" : "new-task" } as ProjectWorkItem;
    const changes = buildProjectWorkEditChanges(initial, draft, now);
    expect(changes[key]).toBe(draft[key]);
    expect(changes.plannedRanges?.[0].startDate).toBe("2026-09-24");
    expect(changes).not.toHaveProperty("dueDate");
    expect(changes).not.toHaveProperty("priority");
  });

  it("編集用データの変更やキャンセルで元の作業を変更しない", () => {
    const work = stored();
    const view = displayed(work);
    const before = structuredClone({ work, view });
    const draft = createProjectWorkEditDraft(work, view);
    draft.priority = "C";
    draft.plannedRanges![0].note = "下書き";
    expect({ work, view }).toEqual(before);
  });
});
