import type { ProjectWorkItem, Task } from "./types";

/** Task側の欠落・関連解除は、独立した作業計画を削除する指示ではない。 */
export function reflectTaskScheduleOnWork(work: ProjectWorkItem, task: Task, now: string): ProjectWorkItem {
  if (work.linkedTaskId !== task.id) return work;
  const owned = task.plannedRanges.filter(range => range.sourceType === "project-work" && range.sourceId === work.id);
  if (!owned.length) return work;
  return {
    ...work,
    plannedRanges: owned.map(range => ({ ...range, sourceType: undefined, sourceId: undefined })),
    plannedHours: owned.every(range => range.plannedHours != null)
      ? owned.reduce((sum, range) => sum + (Number(range.plannedHours) || 0), 0)
      : work.plannedHours,
    replanReason: owned.find(range => range.advanceReason)?.advanceReason || work.replanReason,
    replannedAt: owned.find(range => range.advancedAt)?.advancedAt || work.replannedAt,
    updatedAt: now,
  };
}

/** 未保存作業の破棄と次の作業の追加を、同じ一覧に対する1回の更新にする。 */
export const appendProjectWork = (works: ProjectWorkItem[], next: ProjectWorkItem, discardedDraftId?: string): ProjectWorkItem[] => {
  if (works.some((work) => work.id === next.id)) throw new Error("追加する作業のIDが重複しています。");
  if (discardedDraftId) {
    const matches = works.filter((work) => work.id === discardedDraftId);
    if (matches.length !== 1 || matches[0].milestoneId !== next.milestoneId) {
      throw new Error("破棄対象の作業を確認できません。画面を開き直してください。");
    }
  }
  return [...works.filter((work) => work.id !== discardedDraftId), next];
};

/** 期限・優先度等は作業自身を正本とする。関連Taskの最新予定だけを編集用に引き継ぐ。 */
export const createProjectWorkEditDraft = (stored: ProjectWorkItem, displayed: ProjectWorkItem): ProjectWorkItem => {
  if (stored.id !== displayed.id) throw new Error("編集対象の作業が一致しません。");
  return structuredClone({ ...stored, plannedRanges: displayed.plannedRanges || [], plannedHours: displayed.plannedHours });
};

/** 表示用の集計値や、操作していない項目を保存に含めない。 */
export const buildProjectWorkEditChanges = (initial: ProjectWorkItem, draft: ProjectWorkItem, now: string): Partial<ProjectWorkItem> => {
  if (initial.id !== draft.id) throw new Error("編集対象の作業が一致しません。");
  const changes: Partial<ProjectWorkItem> = {};
  const editableFields = ["title", "description", "status", "priority", "dueDate", "linkedTaskId"] as const;
  for (const key of editableFields) {
    if (initial[key] !== draft[key]) Object.assign(changes, { [key]: key === "title" ? draft.title.trim() : draft[key] });
  }
  const scheduleEdited = JSON.stringify(initial.plannedRanges || []) !== JSON.stringify(draft.plannedRanges || [])
    || initial.plannedHours !== draft.plannedHours;
  // 名称・状態・関連付けの変更はTaskの予定も更新するため、表示中の最新予定を渡す。
  // 説明・期限・優先度だけの編集では予定の同期を起動しない。
  if (scheduleEdited || changes.title !== undefined || changes.status !== undefined || changes.linkedTaskId !== undefined) {
    const plannedHours = Math.max(0, Number(draft.plannedHours) || 0);
    const plannedRanges = (draft.plannedRanges || []).slice(0, 1).map((range) => ({ ...range, title: draft.title.trim(), plannedHours }));
    Object.assign(changes, { plannedRanges, plannedHours });
    if (scheduleEdited) {
      const hasBaseline = Boolean(draft.baselinePlannedRanges?.length) || Number(draft.baselinePlannedHours) > 0;
      const baselinePlannedRanges = hasBaseline ? draft.baselinePlannedRanges || [] : plannedRanges;
      const baselinePlannedHours = hasBaseline ? Math.max(0, Number(draft.baselinePlannedHours) || 0) : plannedHours;
      const changed = JSON.stringify(baselinePlannedRanges) !== JSON.stringify(plannedRanges) || baselinePlannedHours !== plannedHours;
      Object.assign(changes, {
        baselinePlannedRanges, baselinePlannedHours,
        replannedAt: changed ? draft.replannedAt || now : "",
        replanReason: changed ? draft.replanReason || "" : "",
      });
    }
  }
  return changes;
};
