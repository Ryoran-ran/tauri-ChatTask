import type { Goal, GoalMilestone, ProjectWorkItem } from "./types";
import { compareScheduleWorks } from "./projectScheduleOrder";

export interface ScheduleWorkGroup {
  id: string;
  title: string;
  dueDate: string;
  kind: "milestone" | "direct";
  milestone?: GoalMilestone;
  works: ProjectWorkItem[];
  totalWorkCount: number;
}

/** 表示用に絞り込むだけで、保存データ・工数計算・同期対象は変更しない。 */
export function projectScheduleVisibility(project: Goal, showCompleted: boolean) {
  const works = project.workItems || [];
  let hiddenMilestoneCount = 0;
  let hiddenWorkCount = 0;
  const visibleWorks = (children: ProjectWorkItem[]) => {
    const visible = showCompleted ? [...children] : children.filter(work => work.status !== "done");
    hiddenWorkCount += children.length - visible.length;
    return visible.sort(compareScheduleWorks);
  };
  const groups: ScheduleWorkGroup[] = [];
  for (const milestone of [...project.milestones].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    const children = works.filter(work => work.milestoneId === milestone.id);
    const visible = visibleWorks(children);
    const completed = milestone.status ? milestone.status === "achieved" : milestone.completed;
    // 親だけ完了でも未完了の子作業を隠さない。空の未完了マイルストーンも登録用に残す。
    if (!showCompleted && completed && !visible.length) { hiddenMilestoneCount++; continue; }
    groups.push({ id: milestone.id, title: milestone.title || "名称未設定のマイルストーン", dueDate: milestone.dueDate || "", kind: "milestone", milestone, works: visible, totalWorkCount: children.length });
  }
  const direct = works.filter(work => !work.milestoneId);
  const visibleDirect = visibleWorks(direct);
  if (visibleDirect.length) groups.push({ id: "direct", title: "マイルストーン未割当", dueDate: project.dueDate || "", kind: "direct", works: visibleDirect, totalWorkCount: direct.length });
  return { groups, hiddenMilestoneCount, hiddenWorkCount };
}
