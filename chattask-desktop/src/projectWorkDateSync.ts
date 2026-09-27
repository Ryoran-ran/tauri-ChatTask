import type { PlannedRange, ProjectWorkItem, Task } from "./types";

export type WorkDateSyncDirection = "schedule-to-work" | "work-to-schedule";
export type WorkDateSyncSelection = { id: string; expectedSignature: string };
export type SyncWorkDates = (selections: WorkDateSyncSelection[], direction: WorkDateSyncDirection) => string | null;

// 両項目が未導入の旧データだけを補完する。
// 空文字・nullや片側だけ欠けた期間は、削除／入力途中の可能性があるので補完しない。
export const initialWorkTargetDates = (work: ProjectWorkItem) => {
  if (work.targetWorkStartDate === undefined && work.targetWorkEndDate === undefined) {
    const range = work.plannedRanges?.[0];
    return {
      targetWorkStartDate: range?.startDate || "",
      targetWorkEndDate: range?.endDate || range?.startDate || "",
    };
  }
  return {
    targetWorkStartDate: work.targetWorkStartDate ?? "",
    targetWorkEndDate: work.targetWorkEndDate ?? "",
  };
};

export const workDateSyncSignature = (work: ProjectWorkItem) => JSON.stringify([
  work.id, work.linkedTaskId, work.targetWorkStartDate || "", work.targetWorkEndDate || "",
  (work.plannedRanges || []).map(({ id, startDate, endDate }) => [id, startDate, endDate || startDate]),
]);

export const workDatesDiffer = (work: ProjectWorkItem) => {
  const ranges = work.plannedRanges || [];
  if (ranges.length > 1) return true;
  return (work.targetWorkStartDate || "") !== (ranges[0]?.startDate || "")
    || (work.targetWorkEndDate || "") !== (ranges[0]?.endDate || ranges[0]?.startDate || "");
};

const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  && Number.isFinite(Date.parse(`${date}T00:00:00Z`))
  && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

export const workDateSyncError = (work: ProjectWorkItem, direction: WorkDateSyncDirection): string | null => {
  if ((work.plannedRanges || []).length > 1) return "作業日に複数の予定があります。作業の編集画面で確認してください。";
  const range = work.plannedRanges?.[0];
  const start = direction === "schedule-to-work" ? work.targetWorkStartDate || "" : range?.startDate || "";
  const end = direction === "schedule-to-work" ? work.targetWorkEndDate || "" : range?.endDate || start;
  if (!start || !end) return "同期元の開始日と終了日を設定してください。空欄で既存の日付を消すことはありません。";
  if (!validDate(start) || !validDate(end) || end < start) return "同期元の日付の範囲を確認してください。";
  return null;
};

export const buildWorkDateSyncChanges = (
  work: ProjectWorkItem,
  direction: WorkDateSyncDirection,
  expectedSignature: string,
  newRangeId: () => string,
  now: string,
): Partial<ProjectWorkItem> => {
  if (workDateSyncSignature(work) !== expectedSignature) throw new Error("確認中に作業日が変更されました。閉じて最新の日付を確認してください。");
  const error = workDateSyncError(work, direction);
  if (error) throw new Error(error);
  if (!workDatesDiffer(work)) return {};
  const range = work.plannedRanges?.[0];
  if (direction === "work-to-schedule") return {
    targetWorkStartDate: range!.startDate,
    targetWorkEndDate: range!.endDate || range!.startDate,
  };
  const plannedRanges = [{
    ...(range || {
      id: newRangeId(), title: work.title, plannedHours: work.plannedHours,
      status: work.status === "done" ? "completed" as const : work.status,
      ...(work.completedAt ? { completedAt: work.completedAt } : {}),
    }),
    startDate: work.targetWorkStartDate!, endDate: work.targetWorkEndDate!,
  }];
  // 既存の予定ID・メモ・完了状態・実績参照を保ち、日付だけを変更する。
  const baselinePlannedRanges = work.baselinePlannedRanges?.length
    ? work.baselinePlannedRanges : work.plannedRanges?.length ? work.plannedRanges : plannedRanges;
  const hasBaseline = Boolean(work.baselinePlannedRanges?.length) || Number(work.baselinePlannedHours) > 0;
  const baselinePlannedHours = hasBaseline ? work.baselinePlannedHours ?? work.plannedHours : work.plannedHours;
  const changed = JSON.stringify(baselinePlannedRanges) !== JSON.stringify(plannedRanges);
  return {
    plannedRanges, baselinePlannedRanges, baselinePlannedHours,
    replannedAt: changed ? now : "", replanReason: changed ? work.replanReason || "" : "",
  };
};

/** 日付専用の同期。別予定の削除、工数の再計算、日別実績キーの移動は行わない。 */
export const buildLinkedTaskDateSyncChanges = (task: Task, workId: string, range: PlannedRange): Partial<Task> => {
  const owned = task.plannedRanges.filter((item) => item.sourceType === "project-work" && item.sourceId === workId);
  if (owned.length > 1 || (owned.length === 1 && owned[0].id !== range.id)) {
    throw new Error("関連ChatTaskの予定が変更されています。作業日を確認し直してください。");
  }
  const matching = task.plannedRanges.filter((item) => item.id === range.id);
  if (matching.length > 1) throw new Error("予定IDが重複しています。同期を中止しました。");
  const existing = matching[0];
  if (existing) {
    if ((existing.sourceType || existing.sourceId) && !(existing.sourceType === "project-work" && existing.sourceId === workId)) {
      throw new Error("予定IDが別の作業と重複しています。同期を中止しました。");
    }
    return { plannedRanges: task.plannedRanges.map((item) => item.id === range.id
      ? { ...item, startDate: range.startDate, endDate: range.endDate, sourceType: "project-work", sourceId: workId }
      : item) };
  }
  const plannedRanges = [...task.plannedRanges, { ...range, sourceType: "project-work" as const, sourceId: workId }];
  return { plannedRanges, plannedHours: plannedRanges.reduce((sum, item) => sum + (Number(item.plannedHours) || 0), 0) };
};

/** 全件の検証と変更の組み立てが成功するまで保存しない。同じTaskの変更はまとめる。 */
export const buildBatchWorkDateSyncChanges = (
  storedWorks: ProjectWorkItem[],
  displayedWorks: ProjectWorkItem[],
  tasks: Task[],
  selections: WorkDateSyncSelection[],
  direction: WorkDateSyncDirection,
  newRangeId: () => string,
  now: string,
) => {
  const workChanges = new Map<string, Partial<ProjectWorkItem>>();
  const taskChanges = new Map<string, Partial<Task>>();
  const selectedIds = new Set<string>();
  for (const { id, expectedSignature } of selections) {
    if (selectedIds.has(id)) throw new Error("同期対象の作業が重複しています。");
    selectedIds.add(id);
    const matching = displayedWorks.filter((work) => work.id === id);
    if (matching.length !== 1 || storedWorks.filter((work) => work.id === id).length !== 1) {
      throw new Error("同期対象の作業が見つからないか重複しています。画面を開き直してください。");
    }
    const work = matching[0];
    try {
      const changes = buildWorkDateSyncChanges(work, direction, expectedSignature, newRangeId, now);
      if (!Object.keys(changes).length) continue;
      if (direction === "schedule-to-work" && work.linkedTaskId && changes.plannedRanges) {
        const linked = tasks.find((task) => task.id === work.linkedTaskId);
        if (!linked) throw new Error("関連ChatTaskが見つかりません。関連付けを確認してください。");
        const previous = taskChanges.get(linked.id) || {};
        const next = buildLinkedTaskDateSyncChanges({ ...linked, ...previous }, work.id, changes.plannedRanges[0]);
        taskChanges.set(linked.id, { ...previous, ...next });
      }
      workChanges.set(id, { ...changes, updatedAt: now });
    } catch (error) {
      throw new Error(`${work.title || "名称未設定"}：${error instanceof Error ? error.message : "同期できません。"} 今回の同期は反映していません。`);
    }
  }
  return {
    workItems: storedWorks.map((work) => workChanges.has(work.id) ? { ...work, ...workChanges.get(work.id) } : work),
    taskChanges: [...taskChanges].map(([id, changes]) => ({ id, changes })),
  };
};
