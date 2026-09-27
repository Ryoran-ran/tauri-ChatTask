import type { AppData, Goal, ProjectWorkItem } from "./types";
import { inheritLegacyBaseline, inheritLegacyPlannedHours } from "./legacyPlannedHours";

interface ScheduleMigration {
  taskId: string;
  milestoneId: string;
  rangeId: string;
  workId: string;
}

/** 表示時だけの仮作業ではなく、保存できる作業へ一度だけ変換する。入力は変更しない。 */
export function migrateLegacyMilestoneProject(project: Goal): { project: Goal; migrations: ScheduleMigration[] } {
  if (!project.milestones.some(milestone => milestone.plannedRanges?.length)) return { project, migrations: [] };
  const existing = project.workItems || [];
  const works: ProjectWorkItem[] = [...existing];
  const usedIds = new Set(existing.map(work => work.id));
  const migrations: ScheduleMigration[] = [];
  const milestones = project.milestones.map(milestone => {
    const ranges = inheritLegacyPlannedHours(milestone.plannedRanges || [], milestone.plannedHours);
    if (!ranges.length) return milestone;
    const baselines = inheritLegacyBaseline(ranges, milestone.baselinePlannedRanges, milestone.baselinePlannedHours);
    const linkedTaskId = milestone.linkedTaskId || milestone.taskIds?.[0] || "";
    const hasChildren = existing.some(work => work.milestoneId === milestone.id);
    ranges.forEach((range, index) => {
      // 同じ旧データは常に同じIDになる。異なる予定や既存作業とは統合しない。
      const baseId = `legacy-milestone:${JSON.stringify([project.id, milestone.id, range.id, index])}`;
      let id = baseId;
      for (let suffix = 2; usedIds.has(id); suffix++) id = `${baseId}:${suffix}`;
      usedIds.add(id);
      const baseline = baselines.find(item => item.id === range.id) || baselines[index] || range;
      works.push({
        id, milestoneId: milestone.id,
        title: range.title?.trim() || (!hasChildren && ranges.length === 1 ? milestone.title : "") || `${milestone.title || "マイルストーン"}：予定${index + 1}`,
        description: range.description?.trim() || range.note?.trim() || milestone.description || "",
        status: milestone.status === "achieved" || milestone.completed ? "done" : milestone.status === "in-progress" ? "in-progress" : "not-started",
        priority: project.priority || "B",
        dueDate: milestone.dueDate || range.endDate || range.startDate || "",
        linkedTaskId, plannedHours: Number(range.plannedHours) || 0, actualHours: 0,
        targetWorkStartDate: range.startDate || "", targetWorkEndDate: range.endDate || range.startDate || "",
        plannedRanges: [range], baselinePlannedRanges: [baseline], baselinePlannedHours: Number(baseline.plannedHours) || 0,
        replanReason: milestone.replanReason || "", replannedAt: milestone.replannedAt || "",
        linkedTaskScheduleSnapshot: (milestone.linkedTaskScheduleSnapshot || []).filter(item => item.id === range.id),
        linkedTaskPlannedHoursSnapshot: Number(milestone.linkedTaskPlannedHoursSnapshot) || 0,
        syncLinkedTaskStatus: false, sortOrder: works.length,
        createdAt: project.createdAt, updatedAt: project.updatedAt, completedAt: milestone.completedAt,
      });
      if (linkedTaskId) migrations.push({ taskId: linkedTaskId, milestoneId: milestone.id, rangeId: range.id, workId: id });
    });
    // 元の予定は子作業へ移したので、次回の読み込みでは再生成しない。
    return { ...milestone, dueDate: milestone.dueDate || ranges.map(range => range.endDate).filter(Boolean).sort().slice(-1)[0] || "",
      linkedTaskId: "", taskIds: [], plannedRanges: [], plannedHours: 0,
      baselinePlannedRanges: [], baselinePlannedHours: 0, replanReason: "", replannedAt: "",
      linkedTaskScheduleSnapshot: [], linkedTaskPlannedHoursSnapshot: 0 };
  });
  return { project: { ...project, milestones, workItems: works }, migrations };
}

/** Task側の対応する予定も同時に付け替える。予定ID・日付・実績のキーは変えない。 */
export function migrateLegacyMilestoneData(data: AppData): AppData {
  const mappings = new Map<string, string[]>();
  let changed = false;
  const goals = data.goals.map(project => {
    const migrated = migrateLegacyMilestoneProject(project);
    if (migrated.project !== project) changed = true;
    for (const item of migrated.migrations) {
      const key = JSON.stringify([item.taskId, item.milestoneId, item.rangeId]);
      mappings.set(key, [...(mappings.get(key) || []), item.workId]);
    }
    return migrated.project;
  });
  if (!changed) return data;
  const tasks = data.tasks.map(task => {
    let remapped = false;
    const plannedRanges = task.plannedRanges.map(range => {
      if (range.sourceType !== "project-milestone") return range;
      const targets = mappings.get(JSON.stringify([task.id, range.sourceId, range.id]));
      if (targets?.length !== 1) return range;
      remapped = true;
      return { ...range, sourceType: "project-work" as const, sourceId: targets[0] };
    });
    return remapped ? { ...task, plannedRanges } : task;
  });
  return { ...data, goals, tasks };
}
