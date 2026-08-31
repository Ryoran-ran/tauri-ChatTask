import type { Goal } from "./types";

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
