import type { Goal, PlannedRange } from "./types";

export interface TaskProjectContext {
  projectId: string;
  projectTitle: string;
  kind: "origin" | "linked";
  location: string;
}

export const taskProjectContexts = (projects: Goal[], taskId: string): TaskProjectContext[] => {
  const contexts: TaskProjectContext[] = [];
  projects.forEach((project) => {
    if (project.originTaskId === taskId) {
      contexts.push({ projectId: project.id, projectTitle: project.title, kind: "origin", location: "プロジェクトの起点" });
      return;
    }
    const milestone = project.milestones.find((item) => item.linkedTaskId === taskId || item.taskIds.includes(taskId));
    const work = (project.workItems || []).find((item) => item.linkedTaskId === taskId);
    if (work) {
      const parentMilestone = project.milestones.find((item) => item.id === work.milestoneId);
      contexts.push({
        projectId: project.id,
        projectTitle: project.title,
        kind: "linked",
        location: parentMilestone ? `マイルストーン「${parentMilestone.title}」／作業項目「${work.title}」` : `プロジェクト直属／作業項目「${work.title}」`,
      });
    } else if (milestone) {
      contexts.push({ projectId: project.id, projectTitle: project.title, kind: "linked", location: `マイルストーン「${milestone.title}」` });
    } else if (project.taskIds.includes(taskId)) {
      contexts.push({ projectId: project.id, projectTitle: project.title, kind: "linked", location: "プロジェクト直属" });
    }
  });
  return contexts.sort((a, b) => Number(a.kind !== "origin") - Number(b.kind !== "origin"));
};

/** A project schedule is managed only while its source still points at this task. */
export const isActiveProjectScheduleSource = (
  projects: Goal[],
  taskId: string,
  sourceType: PlannedRange["sourceType"],
  sourceId: string | undefined,
) => {
  if (!sourceType || !sourceId) return false;
  if (sourceType === "project-milestone") {
    return projects.some((project) => project.milestones.some((milestone) =>
      milestone.id === sourceId && milestone.linkedTaskId === taskId));
  }
  return projects.some((project) => (project.workItems || []).some((work) =>
    work.id === sourceId && work.linkedTaskId === taskId));
};

export const isTaskScheduleManagedByProject = (projects: Goal[], taskId: string) =>
  projects.some((project) =>
    project.milestones.some((milestone) => milestone.linkedTaskId === taskId)
    || (project.workItems || []).some((work) => work.linkedTaskId === taskId));

/** Resolve a schedule against its own project item, never another item on the same task. */
export const projectScheduleSource = (projects: Goal[], taskId: string, range: PlannedRange) => {
  for (const project of projects) {
    const work = (project.workItems || []).find((item) => item.linkedTaskId === taskId
      && (range.sourceType === "project-work" && item.id === range.sourceId
        || !range.sourceId && (item.plannedRanges || []).some((planned) => planned.id === range.id)));
    if (work) return { projectId: project.id, title: work.title, status: work.status === "done" ? "completed" : work.status, label: work.status === "done" ? "達成" : work.status === "in-progress" ? "進行中" : "未着手" };
    const milestone = project.milestones.find((item) => item.linkedTaskId === taskId
      && (range.sourceType === "project-milestone" && item.id === range.sourceId
        || !range.sourceId && (item.plannedRanges || []).some((planned) => planned.id === range.id)));
    if (milestone) {
      const status = milestone.status || (milestone.completed ? "achieved" : "not-started");
      return { projectId: project.id, title: milestone.title, status: status === "achieved" ? "completed" : status, label: status === "achieved" ? "達成" : status === "in-progress" ? "進行中" : "未着手" };
    }
  }
  return null;
};
