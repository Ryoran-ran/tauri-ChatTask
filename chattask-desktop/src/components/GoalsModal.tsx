import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PRIORITIES, STATUS_GROUPS, STATUS_LABELS as TASK_STATUS_LABELS } from "../data/constants";
import { removeTaskAttachments } from "../services/attachments";
import { exportMarkdown } from "../services/documents";
import type { Goal, GoalMilestone, GoalStatus, PlannedRange, ProjectTag, ProjectWorkItem, Task, TaskLink } from "../types";
import { generateId, rangeDates, todayValue } from "../utils";
import { AttachmentsSection } from "./AttachmentsSection";
import { Modal } from "./Modal";
import { WorkDatePicker } from "./WorkDatePicker";

const STATUS_LABELS: Record<GoalStatus, string> = {
  "not-started": "未着手", "in-progress": "進行中", paused: "一時停止",
  achieved: "達成", archived: "アーカイブ", cancelled: "中止（旧）",
};
const PROJECT_STATUS_GROUPS: { label: string; values: GoalStatus[] }[] = [
  { label: "開始前", values: ["not-started"] },
  { label: "対応中", values: ["in-progress", "paused"] },
  { label: "終了", values: ["achieved", "archived", "cancelled"] },
];
type ProjectFilterField = "status" | "priority" | "tag" | "deadline" | "text";
type ProjectFilterCondition = { id: string; field: ProjectFilterField; operator: "is" | "is-not" | "contains" | "not-contains"; value: string };
type ProjectAdvancedFilter = { mode: "and" | "or"; conditions: ProjectFilterCondition[] };
type ProjectSortKey = "priority" | "dueDate" | "status" | "progress" | "updatedAt" | "title";
type ProjectSortRule = { id: string; key: ProjectSortKey; direction: "asc" | "desc" };
const blankProjectFilter = (): ProjectFilterCondition => ({ id: generateId(), field: "status", operator: "is", value: "in-progress" });
const PROJECT_SORT_LABELS: Record<ProjectSortKey, string> = { priority: "優先度", dueDate: "期限", status: "ステータス", progress: "進捗率", updatedAt: "更新日", title: "プロジェクト名" };
const LAST_SELECTED_PROJECT_KEY = "chatTaskLastSelectedProjectId";

function ProjectSortModal({ rules, onChange, onClose }: { rules: ProjectSortRule[]; onChange: (rules: ProjectSortRule[]) => void; onClose: () => void }) {
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return <Modal title="プロジェクトの並び替え" onClose={onClose} wide><div className="sort-editor-dialog">
    <header><div><strong>並び替え条件</strong><p>上にある条件から順番に適用します。</p></div></header>
    <div className="task-sort-rules">{rules.map((rule, index) => <div key={rule.id}>
      <b>{index + 1}</b>
      <select value={rule.key} onChange={(event) => onChange(rules.map((item) => item.id === rule.id ? { ...item, key: event.target.value as ProjectSortKey } : item))}>{Object.entries(PROJECT_SORT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select value={rule.direction} aria-label={`${PROJECT_SORT_LABELS[rule.key]}の方向`} onChange={(event) => onChange(rules.map((item) => item.id === rule.id ? { ...item, direction: event.target.value as "asc" | "desc" } : item))}><option value="asc">昇順</option><option value="desc">降順</option></select>
      <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" disabled={index === rules.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" aria-label={`${PROJECT_SORT_LABELS[rule.key]}を削除`} onClick={() => onChange(rules.filter((item) => item.id !== rule.id))}>×</button>
    </div>)}</div>
    {rules.length < Object.keys(PROJECT_SORT_LABELS).length && <button type="button" className="advanced-filter-add" onClick={() => { const key = (Object.keys(PROJECT_SORT_LABELS) as ProjectSortKey[]).find((candidate) => !rules.some((rule) => rule.key === candidate)); if (key) onChange([...rules, { id: generateId(), key, direction: key === "priority" || key === "dueDate" || key === "title" ? "asc" : "desc" }]); }}>＋ 並び替え条件を追加</button>}
    <footer><button type="button" className="primary" onClick={onClose}>設定を反映</button></footer>
  </div></Modal>;
}

function ProjectStatusFilterModal({ value, onChange, onClose }: { value: string; onChange: (value: string) => void; onClose: () => void }) {
  const selected = value.split(",").filter((status): status is GoalStatus => status in STATUS_LABELS);
  const toggle = (status: GoalStatus) => onChange(selected.includes(status) ? selected.filter((item) => item !== status).join(",") : [...selected, status].join(","));
  const toggleGroup = (statuses: GoalStatus[]) => {
    const allSelected = statuses.every((status) => selected.includes(status));
    onChange(allSelected ? selected.filter((status) => !statuses.includes(status)).join(",") : [...new Set([...selected, ...statuses])].join(","));
  };
  return <Modal title="プロジェクトのステータスを選択" onClose={onClose} wide><div className="status-filter-picker"><header><div><strong>対象にするステータス</strong><p>カテゴリー単位または個別に複数選択できます。</p></div><div><button type="button" onClick={() => onChange(Object.keys(STATUS_LABELS).join(","))}>すべて選択</button><button type="button" onClick={() => onChange("")}>すべて解除</button></div></header><div className="status-filter-groups project-status-filter-groups">{PROJECT_STATUS_GROUPS.map((group) => { const count = group.values.filter((status) => selected.includes(status)).length; return <section key={group.label}><label className="status-filter-group-title"><input type="checkbox" checked={count === group.values.length} ref={(element) => { if (element) element.indeterminate = count > 0 && count < group.values.length; }} onChange={() => toggleGroup(group.values)} /><span>{group.label}</span><small>{count}/{group.values.length}</small></label><div>{group.values.map((status) => <label key={status}><input type="checkbox" checked={selected.includes(status)} onChange={() => toggle(status)} /><span>{STATUS_LABELS[status]}</span></label>)}</div></section>; })}</div><div className="modal-actions"><span>{selected.length}件選択中</span><button type="button" className="primary" onClick={onClose}>選択を確定</button></div></div></Modal>;
}

function ProjectAdvancedFilterModal({ filter, tags, onApply, onClose }: { filter: ProjectAdvancedFilter; tags: ProjectTag[]; onApply: (filter: ProjectAdvancedFilter) => void; onClose: () => void }) {
  const [statusConditionId, setStatusConditionId] = useState("");
  const update = (id: string, changes: Partial<ProjectFilterCondition>) => onApply({ ...filter, conditions: filter.conditions.map((item) => item.id === id ? { ...item, ...changes } : item) });
  const defaults: Record<ProjectFilterField, string> = { status: "in-progress", priority: "A", tag: tags[0]?.id || "none", deadline: "true", text: "" };
  const labels: Record<ProjectFilterField, string> = { status: "ステータス", priority: "優先度", tag: "案件タグ", deadline: "期限", text: "文字列" };
  const valueEditor = (item: ProjectFilterCondition) => {
    if (item.field === "status") { const values = item.value.split(",").filter((status): status is GoalStatus => status in STATUS_LABELS); return <button type="button" className="status-filter-select" onClick={() => setStatusConditionId(item.id)}><span>{values.length === 0 ? "未選択" : values.length === 1 ? STATUS_LABELS[values[0]] : `${values.length}件のステータス`}</span><small>選択画面を開く ›</small></button>; }
    if (item.field === "priority") return <select value={item.value} onChange={(event) => update(item.id, { value: event.target.value })}>{PRIORITIES.map((value) => <option key={value}>{value}</option>)}</select>;
    if (item.field === "tag") return <select value={item.value} onChange={(event) => update(item.id, { value: event.target.value })}><option value="none">タグなし</option>{tags.map((tag) => <option value={tag.id} key={tag.id}>{tag.name}</option>)}</select>;
    if (item.field === "deadline") return <select value={item.value} onChange={(event) => update(item.id, { value: event.target.value })}><option value="true">あり</option><option value="false">なし</option></select>;
    return <input value={item.value} onChange={(event) => update(item.id, { value: event.target.value })} placeholder="プロジェクト名・説明・達成条件" />;
  };
  const statusCondition = filter.conditions.find((item) => item.id === statusConditionId && item.field === "status");
  return <><Modal title="プロジェクトの条件検索" onClose={onClose} wide><div className="advanced-filter-builder"><header><div><strong>条件の組み合わせ</strong><p>プロジェクトを複数の条件で絞り込みます。</p></div><select value={filter.mode} onChange={(event) => onApply({ ...filter, mode: event.target.value as "and" | "or" })}><option value="and">すべて満たす（AND）</option><option value="or">いずれかを満たす（OR）</option></select></header><div className="advanced-filter-list">{filter.conditions.map((item, index) => <div className="advanced-filter-row" key={item.id}><b>{index + 1}</b><select value={item.field} onChange={(event) => { const field = event.target.value as ProjectFilterField; update(item.id, { field, operator: field === "text" ? "contains" : "is", value: defaults[field] }); }}>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><select value={item.operator} onChange={(event) => update(item.id, { operator: event.target.value as ProjectFilterCondition["operator"] })}>{item.field === "text" ? <><option value="contains">含む</option><option value="not-contains">含まない</option></> : <><option value="is">一致する</option><option value="is-not">一致しない</option></>}</select>{valueEditor(item)}<button type="button" aria-label="条件を削除" onClick={() => onApply({ ...filter, conditions: filter.conditions.filter((condition) => condition.id !== item.id) })}>×</button></div>)}</div><button type="button" className="advanced-filter-add" onClick={() => onApply({ ...filter, conditions: [...filter.conditions, blankProjectFilter()] })}>＋ 条件を追加</button><div className="modal-actions"><button type="button" disabled={!filter.conditions.length} onClick={() => onApply({ mode: "and", conditions: [] })}>条件をすべて解除</button><button type="button" className="primary" onClick={onClose}>検索結果を表示</button></div></div></Modal>{statusCondition && <ProjectStatusFilterModal value={statusCondition.value} onChange={(value) => update(statusCondition.id, { value })} onClose={() => setStatusConditionId("")} />}</>;
}
const WORK_STATUS = { "not-started": "未着手", "in-progress": "進行中", done: "達成" } as const;
const MILESTONE_STATUS = { "not-started": "未着手", "in-progress": "進行中", achieved: "達成" } as const;
type CreateRelatedTask = (title: string, parentTaskId?: string, changes?: Partial<Task>, openAfterCreate?: boolean) => string;

const normalizeProject = (project: Goal): Goal => {
  const now = new Date().toISOString();
  const existingWork = (project.workItems || []).flatMap((item, index) => {
    const plannedRanges = item.plannedRanges || [];
    const baselinePlannedRanges = item.baselinePlannedRanges || [];
    const base = {
      ...item,
      sortOrder: item.sortOrder ?? index,
      // 作業工数は予定ごとの入力だけを正とし、Taskや旧フィールド由来の値は使わない。
      plannedHours: scheduleHours(plannedRanges),
      actualHours: Number(item.actualHours) || 0,
      plannedRanges,
      baselinePlannedRanges,
      baselinePlannedHours: scheduleHours(baselinePlannedRanges),
      replanReason: item.replanReason || "",
      replannedAt: item.replannedAt || "",
      linkedTaskScheduleSnapshot: item.linkedTaskScheduleSnapshot || [],
      linkedTaskPlannedHoursSnapshot: Number(item.linkedTaskPlannedHoursSnapshot) || 0,
      syncLinkedTaskStatus: item.syncLinkedTaskStatus !== false,
    };
    if (plannedRanges.length <= 1) return [base];

    // 旧形式では1つの作業に複数の予定を持てたため、予定単位の作業へ分割する。
    // 通常のChatTaskの複数予定は対象外で、ProjectWorkItemだけを移行する。
    return plannedRanges.map((range, rangeIndex) => {
      const baseline = baselinePlannedRanges.find((candidate) => candidate.id === range.id)
        || baselinePlannedRanges[rangeIndex]
        || range;
      return {
        ...base,
        id: rangeIndex === 0 ? item.id : `${item.id}:${range.id}`,
        title: range.title?.trim() || item.title,
        description: range.description?.trim() || range.note?.trim() || item.description,
        dueDate: item.dueDate || range.endDate || range.startDate,
        plannedHours: Number(range.plannedHours) || 0,
        plannedRanges: [range],
        baselinePlannedRanges: [baseline],
        baselinePlannedHours: Number(baseline.plannedHours) || 0,
        sortOrder: (item.sortOrder ?? index) + rangeIndex / 100,
      };
    });
  });
  const migratedWork: ProjectWorkItem[] = [];
  const milestones = (project.milestones || []).map((item, index) => {
    const plannedRanges = item.plannedRanges || [];
    const linkedTaskId = item.linkedTaskId || item.taskIds?.[0] || "";
    if (plannedRanges.length) {
      const hasExistingChildren = existingWork.some((work) => work.milestoneId === item.id);
      const baselines = item.baselinePlannedRanges || [];
      plannedRanges.forEach((range, rangeIndex) => {
        const baseline = baselines.find((candidate) => candidate.id === range.id)
          || baselines[rangeIndex]
          || range;
        migratedWork.push({
          id: generateId(),
          milestoneId: item.id,
          title: range.title?.trim()
            || (!hasExistingChildren && plannedRanges.length === 1 ? item.title : "")
            || `${item.title || "マイルストーン"}：予定${rangeIndex + 1}`,
          description: range.description?.trim() || range.note?.trim() || item.description || "",
          status: item.status === "achieved" || item.completed ? "done" : item.status === "in-progress" ? "in-progress" : "not-started",
          priority: project.priority || "B",
          dueDate: item.dueDate || range.endDate || range.startDate || "",
          linkedTaskId,
          plannedHours: Number(range.plannedHours) || 0,
          actualHours: 0,
          plannedRanges: [range],
          baselinePlannedRanges: [baseline],
          baselinePlannedHours: Number(baseline.plannedHours) || 0,
          replanReason: item.replanReason || "",
          replannedAt: item.replannedAt || "",
          linkedTaskScheduleSnapshot: item.linkedTaskScheduleSnapshot || [],
          linkedTaskPlannedHoursSnapshot: Number(item.linkedTaskPlannedHoursSnapshot) || 0,
          syncLinkedTaskStatus: false,
          sortOrder: existingWork.length + migratedWork.length,
          createdAt: now,
          updatedAt: now,
        });
      });
    }
    return {
      ...item,
      description: item.description || "",
      dueDate: item.dueDate || plannedRanges.map((range) => range.endDate).sort().slice(-1)[0] || "",
      linkedTaskId: plannedRanges.length ? "" : linkedTaskId,
      taskIds: plannedRanges.length ? [] : item.taskIds || [],
      sortOrder: item.sortOrder ?? index,
      status: item.status || (item.completed ? "achieved" : "not-started"),
      plannedRanges: [],
      plannedHours: 0,
      baselinePlannedRanges: [],
      baselinePlannedHours: 0,
      replanReason: "",
      replannedAt: "",
      linkedTaskScheduleSnapshot: [],
      linkedTaskPlannedHoursSnapshot: 0,
      syncLinkedTaskStatus: item.syncLinkedTaskStatus !== false,
    };
  });
  return {
    ...project,
    status: project.status === "cancelled" ? "paused" : project.status,
    originTaskId: project.originTaskId || "",
    priority: project.priority || "B",
    taskIds: project.taskIds || [],
    milestones,
    workItems: [...existingWork, ...migratedWork],
    sharedLinks: project.sharedLinks || [],
  };
};
const blankProject = (): Goal => {
  const now = new Date().toISOString();
  return { id: generateId(), title: "新しいプロジェクト", description: "", successCriteria: "", dueDate: "", status: "not-started", projectTagId: "", taskIds: [], milestones: [], reviews: [], originTaskId: "", priority: "B", workItems: [], sharedLinks: [], createdAt: now, updatedAt: now };
};
const progress = (project: Goal) => {
  const work = project.workItems || [];
  if (work.length) return Math.round(work.filter((item) => item.status === "done").length / work.length * 100);
  return project.milestones.length ? Math.round(project.milestones.filter((item) => item.completed).length / project.milestones.length * 100) : project.status === "achieved" ? 100 : 0;
};
const daysLeft = (date: string) => date ? Math.ceil((new Date(`${date}T00:00:00`).getTime() - new Date(`${todayValue()}T00:00:00`).getTime()) / 86_400_000) : null;
const effort = (workItems: ProjectWorkItem[]) => workItems.reduce((total, item) => ({
  planned: total.planned + (Number(item.plannedHours) || 0),
  actual: total.actual + (Number(item.actualHours) || 0),
}), { planned: 0, actual: 0 });
const formatHours = (hours: number) => `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
const scheduleHours = (ranges: PlannedRange[]) => ranges.reduce((total, range) => total + (Number(range.plannedHours) || 0), 0);
const scheduleSignature = (ranges: PlannedRange[]) => JSON.stringify([...ranges].sort((a, b) =>
  a.startDate.localeCompare(b.startDate)
  || a.endDate.localeCompare(b.endDate)
  || (a.sourceType || "").localeCompare(b.sourceType || "")
  || (a.sourceId || "").localeCompare(b.sourceId || "")
  || a.id.localeCompare(b.id)));
const scheduleStart = (ranges: PlannedRange[] | undefined) => ranges?.map((range) => range.startDate).filter(Boolean).sort()[0] || "";
// 作業項目の予定と関連ChatTaskの予定は別物として扱う。
// 作業側が未設定でも、関連ChatTaskの日付を表示・並び替えへ流用しない。
const effectiveRanges = (item: { plannedRanges?: PlannedRange[] }, _tasks: Task[]) => item.plannedRanges || [];
const actualHoursFromTodayPages = (item: { id: string; linkedTaskId?: string; plannedRanges?: PlannedRange[] }, tasks: Task[], sourceType: PlannedRange["sourceType"]) => {
  const task = tasks.find((candidate) => candidate.id === item.linkedTaskId);
  if (!task) return 0;
  const linkedRanges = task.plannedRanges
    .filter((range) => range.sourceType === sourceType && range.sourceId === item.id)
  const rangeIds = new Set([...linkedRanges, ...(item.plannedRanges || [])].map((range) => range.id));
  const fallbackRanges = item.plannedRanges?.length ? item.plannedRanges : linkedRanges;
  return Object.entries(task.dailyActualHours || {}).reduce((total, [planKey, hours]) => {
    const rangeId = planKey.includes("::") ? planKey.slice(planKey.indexOf("::") + 2) : "";
    const plainDateMatches = !rangeId && fallbackRanges.some((range) => range.startDate <= planKey && range.endDate >= planKey);
    return total + (rangeIds.has(rangeId) || plainDateMatches ? Number(hours) || 0 : 0);
  }, 0);
};
const markdownText = (value: string | undefined, fallback = "未設定") => value?.trim() || fallback;
const markdownRanges = (ranges: PlannedRange[] | undefined) => {
  if (!ranges?.length) return "未設定";
  return [...ranges]
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate))
    .map((range) => `${range.startDate}${range.endDate !== range.startDate ? `〜${range.endDate}` : ""}${range.plannedHours ? `（${formatHours(range.plannedHours)}）` : ""}`)
    .join("、");
};
const projectToMarkdown = (project: Goal, tasks: Task[], tags: ProjectTag[]) => {
  const projectEffort = effort(project.workItems || []);
  const tagName = tags.find((tag) => tag.id === project.projectTagId)?.name || "未設定";
  const lines = [
    `# ${markdownText(project.title, "名称未設定のプロジェクト")}`,
    "",
    "## 基本情報",
    "",
    `- ステータス: ${STATUS_LABELS[project.status]}`,
    `- 優先度: ${project.priority || "未設定"}`,
    `- 案件タグ: ${tagName}`,
    `- 進捗率: ${progress(project)}%`,
    `- GOAL期限: ${project.dueDate || "未設定"}`,
    `- 予定工数: ${formatHours(projectEffort.planned)}`,
    `- 実績工数: ${formatHours(projectEffort.actual)}`,
    "",
    "## 概要",
    "",
    markdownText(project.description, "概要はありません。"),
    "",
    "## 最終達成条件",
    "",
    markdownText(project.successCriteria, "最終達成条件は未設定です。"),
    "",
    "## マイルストーン",
    "",
  ];

  const sortedMilestones = [...project.milestones].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (!sortedMilestones.length) lines.push("マイルストーンはありません。", "");
  sortedMilestones.forEach((milestone, index) => {
    const works = (project.workItems || []).filter((item) => item.milestoneId === milestone.id).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const milestoneStatus = milestone.status || (milestone.completed ? "achieved" : "not-started");
    const ownPlanned = scheduleHours(milestone.plannedRanges || []) || Number(milestone.plannedHours) || 0;
    const ownActual = actualHoursFromTodayPages(milestone, tasks, "project-milestone");
    const workEffort = effort(works);
    lines.push(
      `### ${index + 1}. ${markdownText(milestone.title, "名称未設定")}`,
      "",
      `- ステータス: ${MILESTONE_STATUS[milestoneStatus]}`,
      `- 期限: ${milestone.dueDate || "未設定"}`,
      `- マイルストーン工数: 予定 ${formatHours(ownPlanned)} / 実績 ${formatHours(ownActual)}`,
      `- 配下作業工数: 予定 ${formatHours(workEffort.planned)} / 実績 ${formatHours(workEffort.actual)}`,
      `- 対応期間: ${markdownRanges(milestone.plannedRanges)}`,
      "",
      markdownText(milestone.description, "説明はありません。"),
      "",
      "#### 作業項目",
      "",
    );
    if (!works.length) lines.push("配下の作業項目はありません。", "");
    works.forEach((work) => {
      const linkedTask = tasks.find((task) => task.id === work.linkedTaskId);
      lines.push(
        `- [${work.status === "done" ? "x" : " "}] **${markdownText(work.title, "名称未設定")}**`,
        `  - ステータス: ${WORK_STATUS[work.status]}`,
        `  - 優先度: ${work.priority}`,
        `  - 期限: ${work.dueDate || "未設定"}`,
        `  - 工数: 予定 ${formatHours(work.plannedHours || 0)} / 実績 ${formatHours(work.actualHours || 0)}`,
        `  - 対応期間: ${markdownRanges(work.plannedRanges)}`,
        `  - 関連ChatTask: ${linkedTask?.title || "未設定"}`,
        `  - 説明: ${markdownText(work.description, "なし")}`,
      );
    });
    lines.push("");
  });

  const directWorks = (project.workItems || []).filter((item) => !item.milestoneId).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  lines.push("## マイルストーン未割当の作業", "");
  if (!directWorks.length) lines.push("未割当の作業はありません。", "");
  directWorks.forEach((work) => {
    const linkedTask = tasks.find((task) => task.id === work.linkedTaskId);
    lines.push(
      `- [${work.status === "done" ? "x" : " "}] **${markdownText(work.title, "名称未設定")}**`,
      `  - ステータス: ${WORK_STATUS[work.status]}`,
      `  - 優先度: ${work.priority}`,
      `  - 期限: ${work.dueDate || "未設定"}`,
      `  - 工数: 予定 ${formatHours(work.plannedHours || 0)} / 実績 ${formatHours(work.actualHours || 0)}`,
      `  - 対応期間: ${markdownRanges(work.plannedRanges)}`,
      `  - 関連ChatTask: ${linkedTask?.title || "未設定"}`,
      `  - 説明: ${markdownText(work.description, "なし")}`,
    );
  });
  lines.push("");
  return lines.join("\n");
};
const compareBySchedule = <T extends { id: string; sortOrder?: number; plannedRanges?: PlannedRange[]; linkedTaskId?: string }>(a: T, b: T, tasks: Task[]) => {
  const aStart = scheduleStart(effectiveRanges(a, tasks));
  const bStart = scheduleStart(effectiveRanges(b, tasks));
  if (aStart !== bStart) {
    if (!aStart) return 1;
    if (!bStart) return -1;
    return aStart.localeCompare(bStart);
  }
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id);
};
const compareMilestonesByDueDate = (a: GoalMilestone, b: GoalMilestone) => {
  const aDue = a.dueDate || "";
  const bDue = b.dueDate || "";
  if (aDue !== bDue) {
    if (!aDue) return 1;
    if (!bDue) return -1;
    return aDue.localeCompare(bDue);
  }
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id);
};
const formatScheduleDate = (date: string) => date.split("-").join("/");
function ScheduleDate({ ranges, showUnscheduled = false }: { ranges: PlannedRange[]; showUnscheduled?: boolean }) {
  if (!ranges.length) return showUnscheduled ? <span className="project-schedule-date-summary is-unscheduled">予定なし</span> : null;
  const starts = ranges.map((range) => range.startDate).filter(Boolean).sort();
  const ends = ranges.map((range) => range.endDate || range.startDate).filter(Boolean).sort();
  if (!starts.length || !ends.length) return null;
  const start = starts[0];
  const end = ends[ends.length - 1];
  const delayed = ranges.some((range) => range.status !== "completed" && Boolean(range.originalEndDate) && range.endDate > range.originalEndDate!);
  const advanced = ranges.find((range) => range.advancedFromStartDate && range.advancedFromEndDate);
  return (
    <span className={`project-schedule-date-summary ${delayed ? "is-delayed" : ""} ${advanced ? "is-advanced" : ""}`}>
      <span className="project-schedule-date-range">
        対応日 {formatScheduleDate(start)}{end !== start && `〜${formatScheduleDate(end)}`}
      </span>
      {delayed && <b>遅延</b>}
      {advanced && <b>当初 {formatScheduleDate(advanced.advancedFromStartDate!)}から前倒し</b>}
    </span>
  );
}
function StatusSyncState(_: { task: Task | null | undefined; status: "not-started" | "in-progress" | "achieved" | "done"; enabled: boolean; onReflect: () => void }) {
  return null;
}
function ProjectResources({ project, onLinks }: { project: Goal; onLinks: (links: TaskLink[]) => void }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const addLink = () => {
    const entered = url.trim();
    if (!entered) return;
    const normalized = /^https?:\/\//i.test(entered) ? entered : `https://${entered}`;
    try {
      const parsed = new URL(normalized);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      onLinks([...(project.sharedLinks || []), { id: generateId(), label: label.trim() || parsed.hostname, url: parsed.toString() }]);
      setLabel("");
      setUrl("");
      setError("");
    } catch {
      setError("正しいサイトURLを入力してください。");
    }
  };
  return <section className="project-resources">
    <header><div><strong>共有サイト・ファイル</strong><small>このプロジェクトで共通利用する資料をまとめます。</small></div></header>
    <div className="project-shared-links">
      <div className="project-shared-link-list">{(project.sharedLinks || []).map((link) => <div key={link.id}><a href={link.url} target="_blank" rel="noreferrer"><span>↗</span><strong>{link.label || link.url}</strong><small>{link.url}</small></a><button type="button" className="danger-text" aria-label={`${link.label || link.url}を削除`} onClick={() => onLinks((project.sharedLinks || []).filter((item) => item.id !== link.id))}>×</button></div>)}{!project.sharedLinks?.length && <p>共有サイトは登録されていません。</p>}</div>
      <div className="project-shared-link-form"><label>表示名<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例：案件管理サイト" /></label><label>URL<input value={url} onChange={(event) => { setUrl(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addLink(); } }} placeholder="https://..." /></label><button type="button" onClick={addLink}>サイトを追加</button></div>
      {error && <p className="project-shared-link-error">{error}</p>}
    </div>
    <div className="project-shared-files"><AttachmentsSection taskId={`project:${project.id}`} title="共有ファイル" /></div>
  </section>;
}
export function ProjectsModal({ projects, tasks, tags, initialProjectId, onSave, onCreateTask, onUpdateTask, onSelectTask, onOpenGantt, onClose }: { projects: Goal[]; tasks: Task[]; tags: ProjectTag[]; initialProjectId?: string; onSave: (projects: Goal[]) => void; onCreateTask: CreateRelatedTask; onUpdateTask: (id: string, changes: Partial<Task>, history?: string) => void; onSelectTask: (id: string) => void; onOpenGantt: (projectId: string) => void; onClose: () => void }) {
  const [items, setItems] = useState(() => projects.map(normalizeProject));
  const [selectedId, setSelectedId] = useState(() => initialProjectId || localStorage.getItem(LAST_SELECTED_PROJECT_KEY) || "");
  const [filter, setFilter] = useState(() => localStorage.getItem("chatTaskProjectFilter") || "active");
  const [advancedFilterOpen, setAdvancedFilterOpen] = useState(false);
  const [sortEditorOpen, setSortEditorOpen] = useState(false);
  const [advancedFilter, setAdvancedFilter] = useState<ProjectAdvancedFilter>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("chatTaskProjectAdvancedFilter") || "null") as ProjectAdvancedFilter | null;
      if (stored && Array.isArray(stored.conditions) && (stored.mode === "and" || stored.mode === "or")) return stored;
    } catch { /* use defaults */ }
    return { mode: "and", conditions: [] };
  });
  const [sortRules, setSortRules] = useState<ProjectSortRule[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("chatTaskProjectSortRules") || "null") as ProjectSortRule[] | null;
      if (Array.isArray(stored) && stored.length) return stored;
    } catch { /* migrate legacy setting */ }
    return [{ id: generateId(), key: (localStorage.getItem("chatTaskProjectSortKey") as ProjectSortKey) || "updatedAt", direction: localStorage.getItem("chatTaskProjectSortDirection") === "asc" ? "asc" : "desc" }];
  });
  const [view, setView] = useState<"board" | "tree">("tree");
  const [search, setSearch] = useState("");
  const [searchPanelOpen, setSearchPanelOpen] = useState(() => localStorage.getItem("chatTaskProjectSearchPanelOpen") !== "false");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [editingBoard, setEditingBoard] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [exportingMarkdown, setExportingMarkdown] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState(() => localStorage.getItem("chatTaskProjectOverviewExpanded") === "true");
  const [projectEditDraft, setProjectEditDraft] = useState<Goal | null>(null);
  const [editSnapshot, setEditSnapshot] = useState<Goal | null>(null);
  const [editTaskSnapshots, setEditTaskSnapshots] = useState<Task[]>([]);
  const syncProjectSchedule = (
    linkedTaskId: string,
    plannedRanges: PlannedRange[],
    sourceType: NonNullable<PlannedRange["sourceType"]>,
    sourceId: string,
    _plannedHours: number,
    history: string,
  ) => {
    const linkedTask = tasks.find((task) => task.id === linkedTaskId);
    if (!linkedTask) return;
    const transferredRangeIds = new Set(plannedRanges.map((range) => range.id));
    const transferredRangeKeys = new Set(plannedRanges.map((range) => JSON.stringify([
      range.startDate,
      range.endDate,
      (range.title || "").trim(),
      Number(range.plannedHours) || 0,
      range.status || "not-started",
    ])));
    // A project work item only takes ownership of the explicitly selected range.
    // Every other standalone or project-managed range must remain on the task.
    // Legacy flows may have copied the selected schedule under a new id. Treat an
    // identical standalone range as the transferred range instead of displaying it twice.
    const preserved = linkedTask.plannedRanges.filter((range) => range.sourceId !== sourceId
      && !transferredRangeIds.has(range.id)
      && !(!range.sourceId && transferredRangeKeys.has(JSON.stringify([
        range.startDate,
        range.endDate,
        (range.title || "").trim(),
        Number(range.plannedHours) || 0,
        range.status || "not-started",
      ]))));
    const projectRanges = plannedRanges.map((range) => ({ ...range, sourceType, sourceId }));
    const nextRanges = [...preserved, ...projectRanges];
    const nextPlannedHours = scheduleHours(nextRanges);
    if (scheduleSignature(nextRanges) === scheduleSignature(linkedTask.plannedRanges) && Number(linkedTask.plannedHours) === Number(nextPlannedHours)) return;
    const managedKeyByDate = new Map(projectRanges.flatMap((range) => rangeDates([range]).map((date) => [date, `${date}::${range.id}`] as const)));
    const migrate = <T,>(record: Record<string, T> | undefined) => Object.fromEntries(Object.entries(record || {}).map(([key, value]) => [managedKeyByDate.get(key) || key, value]));
    onUpdateTask(linkedTaskId, {
      plannedRanges: nextRanges, plannedHours: nextPlannedHours,
      dailyPlans: migrate(linkedTask.dailyPlans),
      dailyPlanCompleted: migrate(linkedTask.dailyPlanCompleted),
      dailyPlanStatuses: migrate(linkedTask.dailyPlanStatuses),
      dailyActualHours: migrate(linkedTask.dailyActualHours),
    }, history);
  };
  const releaseProjectSchedule = (linkedTaskId: string, sourceId: string, snapshot: PlannedRange[] = [], _plannedHoursSnapshot = 0) => {
    const linkedTask = tasks.find((task) => task.id === linkedTaskId);
    if (!linkedTask) return;
    const releasedRangeIds = new Set(linkedTask.plannedRanges.filter((range) => range.sourceId === sourceId).map((range) => range.id));
    const unrelatedRanges = linkedTask.plannedRanges.filter((range) => range.sourceId !== sourceId);
    const unrelatedIds = new Set(unrelatedRanges.map((range) => range.id));
    const restoredTransferredRanges = snapshot
      .filter((range) => releasedRangeIds.has(range.id) && !unrelatedIds.has(range.id))
      .map((range) => ({ ...range, sourceType: undefined, sourceId: undefined }));
    const restored = [...unrelatedRanges, ...restoredTransferredRanges];
    const restoreKey = (key: string) => {
      const separator = key.indexOf("::");
      return separator >= 0 && releasedRangeIds.has(key.slice(separator + 2)) ? key.slice(0, separator) : key;
    };
    const restore = <T,>(record: Record<string, T> | undefined) => Object.fromEntries(Object.entries(record || {}).map(([key, value]) => [restoreKey(key), value]));
    onUpdateTask(linkedTaskId, {
      plannedRanges: restored, plannedHours: scheduleHours(restored),
      dailyPlans: restore(linkedTask.dailyPlans),
      dailyPlanCompleted: restore(linkedTask.dailyPlanCompleted),
      dailyPlanStatuses: restore(linkedTask.dailyPlanStatuses),
      dailyActualHours: restore(linkedTask.dailyActualHours),
    }, "プロジェクトとの関連解除により、Task側の予定を復元しました。");
  };
  useEffect(() => {
    onSave(items);
  }, [items]);
  useEffect(() => { localStorage.setItem("chatTaskProjectAdvancedFilter", JSON.stringify(advancedFilter)); }, [advancedFilter]);
  useEffect(() => { localStorage.setItem("chatTaskProjectSortRules", JSON.stringify(sortRules)); }, [sortRules]);
  useEffect(() => {
    setDescriptionExpanded(false);
  }, [selectedId]);
  const storedProject = items.find((item) => item.id === selectedId) || null;
  const beginProjectEdit = () => {
    if (!storedProject) return;
    setEditSnapshot(structuredClone(storedProject));
    setEditTaskSnapshots(structuredClone(tasks));
    setView("board");
    localStorage.setItem("chatTaskProjectView", "board");
    setOverviewExpanded(true);
    localStorage.setItem("chatTaskProjectOverviewExpanded", "true");
    setEditingBoard(true);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".project-view-board")?.scrollTo({ top: 0, behavior: "smooth" });
    });
  };
  const completeProjectEdit = () => {
    setEditSnapshot(null);
    setEditTaskSnapshots([]);
    setEditingBoard(false);
  };
  const cancelProjectEdit = () => {
    if (!editSnapshot) return completeProjectEdit();
    const next = items.map((item) => item.id === editSnapshot.id ? editSnapshot : item);
    setItems(next);
    onSave(next);
    editTaskSnapshots.forEach((snapshot) => {
      const current = tasks.find((task) => task.id === snapshot.id);
      if (!current) return;
      const changed = current.status !== snapshot.status
        || current.completedAt !== snapshot.completedAt
        || Number(current.plannedHours) !== Number(snapshot.plannedHours)
        || scheduleSignature(current.plannedRanges) !== scheduleSignature(snapshot.plannedRanges);
      if (changed) onUpdateTask(snapshot.id, {
        status: snapshot.status,
        completedAt: snapshot.completedAt,
        plannedHours: snapshot.plannedHours,
        plannedRanges: snapshot.plannedRanges,
      }, "プロジェクト編集のキャンセルにより、連動内容を編集前へ戻しました。");
    });
    setEditSnapshot(null);
    setEditTaskSnapshots([]);
    setEditingBoard(false);
    setDeleteConfirm(false);
  };
  const project = useMemo(() => {
    if (!storedProject) return null;
    const milestones: GoalMilestone[] = [...storedProject.milestones]
      .sort(compareMilestonesByDueDate)
      .map((item, index) => ({ ...item, sortOrder: index }));
    const workItems = (storedProject.workItems || []).map((item) => ({
      ...item,
      actualHours: actualHoursFromTodayPages(item, tasks, "project-work"),
    }));
    const groups = new Map<string, ProjectWorkItem[]>();
    for (const item of workItems) {
      const key = item.milestoneId || "";
      groups.set(key, [...(groups.get(key) || []), item]);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => compareBySchedule(a, b, tasks)).forEach((item, index) => { item.sortOrder = index; });
    }
    return { ...storedProject, milestones, workItems };
  }, [storedProject, tasks]);
  const exportProjectMarkdown = async () => {
    if (!project || exportingMarkdown) return;
    setExportingMarkdown(true);
    try {
      const path = await exportMarkdown(project.title || "project", projectToMarkdown(project, tasks, tags));
      window.alert(`Markdownを出力しました。\n${path}`);
    } catch (reason) {
      window.alert(`Markdownを出力できませんでした。\n${String(reason)}`);
    } finally {
      setExportingMarkdown(false);
    }
  };
  const visible = useMemo(() => {
    const priorityRank = { A: 1, B: 2, C: 3, D: 4 };
    const statusRank: Record<GoalStatus, number> = { "not-started": 1, "in-progress": 2, paused: 3, achieved: 4, archived: 5, cancelled: 6 };
    const filtered = items.filter((item) => {
      if (!advancedFilter.conditions.length && filter !== "all" && ["achieved", "archived"].includes(item.status)) return false;
      const text = [item.title, item.description, item.successCriteria, tags.find((tag) => tag.id === item.projectTagId)?.name || ""].join(" ").toLowerCase();
      if (search.trim() && !text.includes(search.trim().toLowerCase())) return false;
      if (!advancedFilter.conditions.length) return true;
      const results = advancedFilter.conditions.map((condition) => {
        let matches = false;
        if (condition.field === "status") matches = condition.value.split(",").filter(Boolean).includes(item.status);
        else if (condition.field === "priority") matches = item.priority === condition.value;
        else if (condition.field === "tag") matches = condition.value === "none" ? !item.projectTagId : item.projectTagId === condition.value;
        else if (condition.field === "deadline") matches = Boolean(item.dueDate) === (condition.value === "true");
        else matches = !condition.value.trim() || text.includes(condition.value.trim().toLowerCase());
        return condition.operator === "is-not" || condition.operator === "not-contains" ? !matches : matches;
      });
      return advancedFilter.mode === "and" ? results.every(Boolean) : results.some(Boolean);
    });
    return filtered.sort((a, b) => {
      for (const rule of sortRules) {
        let comparison = 0;
        if (rule.key === "priority") comparison = priorityRank[a.priority || "B"] - priorityRank[b.priority || "B"];
        else if (rule.key === "status") comparison = statusRank[a.status] - statusRank[b.status];
        else if (rule.key === "progress") comparison = progress(a) - progress(b);
        else if (rule.key === "title") comparison = a.title.localeCompare(b.title, "ja");
        else if (rule.key === "dueDate") comparison = a.dueDate && b.dueDate ? a.dueDate.localeCompare(b.dueDate) : a.dueDate ? -1 : b.dueDate ? 1 : 0;
        else comparison = a.updatedAt.localeCompare(b.updatedAt);
        if (comparison) return rule.direction === "asc" ? comparison : -comparison;
      }
      return a.id.localeCompare(b.id);
    });
  }, [items, filter, search, advancedFilter, sortRules, tags]);
  useEffect(() => {
    const explicitlyOpenedProjectExists = Boolean(initialProjectId && items.some((item) => item.id === initialProjectId));
    if (explicitlyOpenedProjectExists && selectedId === initialProjectId) return;
    if (visible.some((item) => item.id === selectedId)) return;
    const lastSelectedId = localStorage.getItem(LAST_SELECTED_PROJECT_KEY) || "";
    const nextSelectedId = visible.find((item) => item.id === lastSelectedId)?.id || visible[0]?.id || "";
    if (nextSelectedId !== selectedId) setSelectedId(nextSelectedId);
  }, [initialProjectId, items, selectedId, visible]);
  useEffect(() => {
    if (selectedId && items.some((item) => item.id === selectedId)) {
      localStorage.setItem(LAST_SELECTED_PROJECT_KEY, selectedId);
    }
  }, [items, selectedId]);
  const update = (changes: Partial<Goal>) => setItems((current) => current.map((item) => item.id === selectedId ? { ...item, ...changes, updatedAt: new Date().toISOString() } : item));
  const add = () => { const next = blankProject(); setItems((current) => [next, ...current]); setSelectedId(next.id); };
  const remove = () => {
    if (project) {
      void removeTaskAttachments(`project:${project.id}`).catch(() => undefined);
      project.milestones.forEach((milestone) => {
        if (milestone.linkedTaskId) releaseProjectSchedule(milestone.linkedTaskId, milestone.id, milestone.linkedTaskScheduleSnapshot, milestone.linkedTaskPlannedHoursSnapshot);
      });
      (project.workItems || []).forEach((work) => {
        if (work.linkedTaskId) releaseProjectSchedule(work.linkedTaskId, work.id, work.linkedTaskScheduleSnapshot, work.linkedTaskPlannedHoursSnapshot);
      });
    }
    const next = items.filter((item) => item.id !== selectedId);
    setItems(next);
    onSave(next);
    setSelectedId(visible.find((item) => item.id !== selectedId)?.id || "");
    setDeleteConfirm(false);
  };
  const addMilestone = (position?: unknown) => {
    if (!project) return "";
    const insertAt = typeof position === "number" ? position : project.milestones.length;
    const milestone: GoalMilestone = { id: generateId(), title: "", completed: false, taskIds: [], description: "", dueDate: "", linkedTaskId: "", sortOrder: insertAt, status: "not-started", plannedRanges: [], plannedHours: 0, baselinePlannedRanges: [], baselinePlannedHours: 0, replanReason: "", replannedAt: "", syncLinkedTaskStatus: true };
    const ordered = [...project.milestones].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    ordered.splice(insertAt, 0, milestone);
    update({ milestones: ordered.map((item, index) => ({ ...item, sortOrder: index })) });
    return milestone.id;
  };
  const updateMilestone = (id: string, changes: Partial<GoalMilestone>) => {
    if (!project) return;
    update({ milestones: project.milestones.map((item) => {
      if (item.id !== id) return item;
      const wasAchieved = item.status === "achieved" || item.completed;
      const achieved = changes.status !== undefined ? changes.status === "achieved" : changes.completed !== undefined ? changes.completed : wasAchieved;
      const completedAt = achieved ? item.completedAt || new Date().toISOString() : undefined;
      return { ...item, ...changes, completedAt, plannedRanges: [], plannedHours: 0, baselinePlannedRanges: [], baselinePlannedHours: 0 };
    }) });
  };
  const addWorkItem = (milestoneId = "") => {
    if (!project) return "";
    const now = new Date().toISOString();
    const workId = generateId();
    const work: ProjectWorkItem = {
      id: workId, milestoneId, title: "新しい作業項目",
      description: "", status: "not-started", priority: "B",
      dueDate: "", linkedTaskId: "",
      plannedHours: 0, actualHours: 0,
      plannedRanges: [], baselinePlannedRanges: [], baselinePlannedHours: 0,
      replanReason: "", replannedAt: "",
      linkedTaskScheduleSnapshot: [], linkedTaskPlannedHoursSnapshot: 0,
      syncLinkedTaskStatus: false, sortOrder: (project.workItems || []).length, createdAt: now, updatedAt: now,
    };
    update({
      workItems: [...(project.workItems || []), work],
    });
    return work.id;
  };
  const moveMilestone = (id: string, direction: -1 | 1) => {
    if (!project) return;
    const target = project.milestones.find((item) => item.id === id);
    if (!target) return;
    const targetDueDate = target.dueDate || "";
    const sameDate = project.milestones
      .filter((item) => (item.dueDate || "") === targetDueDate)
      .sort(compareMilestonesByDueDate);
    const currentIndex = sameDate.findIndex((item) => item.id === id);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= sameDate.length) return;
    [sameDate[currentIndex], sameDate[nextIndex]] = [sameDate[nextIndex], sameDate[currentIndex]];
    const order = new Map(sameDate.map((item, index) => [item.id, index]));
    update({ milestones: project.milestones.map((item) => order.has(item.id) ? { ...item, sortOrder: order.get(item.id)! } : item) });
  };
  const updateWork = (id: string, changes: Partial<ProjectWorkItem>) => {
    if (!project) return;
    const work = (project.workItems || []).find((item) => item.id === id);
    if (!work) return;
    let nextChanges = changes;
    if (changes.title !== undefined) {
      const title = changes.title.trim();
      const plannedRanges = (changes.plannedRanges ?? work.plannedRanges ?? []).slice(0, 1).map((range) => ({ ...range, title }));
      nextChanges = { ...nextChanges, plannedRanges, plannedHours: scheduleHours(plannedRanges) };
    }
    if (changes.linkedTaskId !== undefined && changes.linkedTaskId !== work.linkedTaskId) {
      if (work.linkedTaskId) releaseProjectSchedule(work.linkedTaskId, work.id, work.linkedTaskScheduleSnapshot, work.linkedTaskPlannedHoursSnapshot);
      if (changes.linkedTaskId) {
        const linkedTask = tasks.find((task) => task.id === changes.linkedTaskId);
        const standalone = linkedTask?.plannedRanges.filter((range) => !range.sourceId) || [];
        // 新規作業では、関連Taskと予定を同じ保存操作で設定する。
        // 作成直後のworkは予定が空のため、常に入力中の変更値を優先する。
        const plannedRanges = (changes.plannedRanges ?? work.plannedRanges ?? []).slice(0, 1).map((range) => ({ ...range, title: (changes.title ?? work.title).trim() }));
        const plannedHours = scheduleHours(plannedRanges);
        const baselinePlannedRanges = changes.baselinePlannedRanges?.length
          ? changes.baselinePlannedRanges
          : work.baselinePlannedRanges?.length ? work.baselinePlannedRanges : plannedRanges;
        const baselinePlannedHours = Number(changes.baselinePlannedHours)
          || Number(work.baselinePlannedHours)
          || plannedHours;
        nextChanges = { ...changes, plannedRanges, plannedHours, baselinePlannedRanges, baselinePlannedHours, linkedTaskScheduleSnapshot: standalone, linkedTaskPlannedHoursSnapshot: Number(linkedTask?.plannedHours) || 0 };
        syncProjectSchedule(changes.linkedTaskId, plannedRanges, "project-work", work.id, plannedHours, "作業項目の予定を関連Taskへ反映しました。");
      }
    }
    if (changes.status !== undefined) nextChanges = {
      ...nextChanges,
      plannedRanges: (nextChanges.plannedRanges ?? work.plannedRanges ?? []).map((range) => ({
        ...range,
        status: changes.status === "done" ? "completed" : changes.status,
        completedAt: changes.status === "done" ? range.completedAt || new Date().toISOString() : undefined,
      })),
      completedAt: changes.status === "done" ? work.completedAt || new Date().toISOString() : undefined,
    };
    if ((changes.title !== undefined || changes.status !== undefined) && work.linkedTaskId && changes.linkedTaskId === undefined) {
      const plannedRanges = (nextChanges.plannedRanges ?? work.plannedRanges ?? []).slice(0, 1);
      syncProjectSchedule(work.linkedTaskId, plannedRanges, "project-work", work.id, scheduleHours(plannedRanges), changes.status !== undefined ? "作業項目の状態を予定へ反映しました。" : "作業名を予定へ反映しました。");
    }
    update({ workItems: (project.workItems || []).map((item) => item.id === id ? { ...item, ...nextChanges, updatedAt: new Date().toISOString() } : item) });
  };
  const reflectMilestoneStatus = (_milestone: GoalMilestone) => {};
  const reflectWorkStatus = (_work: ProjectWorkItem) => {};
  const updateMilestoneSchedule = (id: string, plannedRanges: PlannedRange[]) => {
    const milestone = project?.milestones.find((item) => item.id === id);
    if (!milestone) return;
    const plannedHours = scheduleHours(plannedRanges);
    const hasBaseline = Boolean(milestone.baselinePlannedRanges?.length);
    const baselinePlannedRanges = hasBaseline
      ? milestone.baselinePlannedRanges
      : milestone.plannedRanges?.length ? milestone.plannedRanges : plannedRanges;
    const baselinePlannedHours = hasBaseline
      ? Number(milestone.baselinePlannedHours) || scheduleHours(baselinePlannedRanges || [])
      : milestone.plannedRanges?.length ? Number(milestone.plannedHours) || scheduleHours(milestone.plannedRanges) : plannedHours;
    const changedFromBaseline = scheduleSignature(baselinePlannedRanges || []) !== scheduleSignature(plannedRanges)
      || Number(baselinePlannedHours) !== Number(plannedHours);
    updateMilestone(id, {
      plannedRanges,
      plannedHours,
      baselinePlannedRanges,
      baselinePlannedHours,
      replannedAt: changedFromBaseline ? new Date().toISOString() : "",
      replanReason: changedFromBaseline ? milestone.replanReason || "" : "",
    });
    if (milestone.linkedTaskId) syncProjectSchedule(milestone.linkedTaskId, plannedRanges, "project-milestone", milestone.id, plannedHours, "マイルストーンから予定と予定工数を更新しました。");
  };
  const updateWorkSchedule = (id: string, plannedRanges: PlannedRange[]) => {
    const work = project?.workItems?.find((item) => item.id === id);
    if (!work) return;
    // プロジェクト作業は「1作業＝1予定」。通常Taskの plannedRanges は変更しない。
    plannedRanges = plannedRanges.slice(0, 1).map((range) => ({ ...range, title: work.title.trim() }));
    const plannedHours = scheduleHours(plannedRanges);
    const hasBaseline = Boolean(work.baselinePlannedRanges?.length);
    const baselinePlannedRanges = hasBaseline ? work.baselinePlannedRanges! : work.plannedRanges?.length ? work.plannedRanges : plannedRanges;
    const baselinePlannedHours = hasBaseline
      ? Number(work.baselinePlannedHours) || scheduleHours(baselinePlannedRanges)
      : work.plannedRanges?.length ? Number(work.plannedHours) || scheduleHours(work.plannedRanges) : plannedHours;
    const changed = scheduleSignature(baselinePlannedRanges) !== scheduleSignature(plannedRanges)
      || Number(baselinePlannedHours) !== Number(plannedHours);
    updateWork(id, { plannedRanges, plannedHours, baselinePlannedRanges, baselinePlannedHours, replannedAt: changed ? new Date().toISOString() : "", replanReason: changed ? work.replanReason || "" : "" });
    if (work.linkedTaskId) syncProjectSchedule(work.linkedTaskId, plannedRanges, "project-work", work.id, plannedHours, "プロジェクトの作業項目から予定と予定工数を更新しました。");
  };
  const persistProjectChanges = (changes: Partial<Goal>) => {
    const now = new Date().toISOString();
    const next = items.map((item) => item.id === selectedId ? { ...item, ...changes, updatedAt: now } : item);
    setItems(next);
    onSave(next);
  };
  const deleteMilestone = (id: string) => {
    if (!project) return;
    const milestone = project.milestones.find((item) => item.id === id);
    if (milestone?.linkedTaskId) releaseProjectSchedule(milestone.linkedTaskId, milestone.id, milestone.linkedTaskScheduleSnapshot, milestone.linkedTaskPlannedHoursSnapshot);
    persistProjectChanges({
      milestones: project.milestones.filter((item) => item.id !== id),
      workItems: (project.workItems || []).map((item) => item.milestoneId === id ? { ...item, milestoneId: "" } : item),
    });
  };
  const deleteWork = (id: string) => {
    if (!project) return;
    const work = (project.workItems || []).find((item) => item.id === id);
    if (work?.linkedTaskId) releaseProjectSchedule(work.linkedTaskId, work.id, work.linkedTaskScheduleSnapshot, work.linkedTaskPlannedHoursSnapshot);
    persistProjectChanges({ workItems: (project.workItems || []).filter((item) => item.id !== id) });
  };
  const origin = project?.originTaskId ? tasks.find((task) => task.id === project.originTaskId) : null;
  const remaining = project ? daysLeft(project.dueDate) : null;
  const deadlineStatusText = project?.dueDate && remaining !== null
    ? remaining === 0
      ? "今日"
      : remaining < 0
        ? `${Math.abs(remaining)}日超過`
        : `あと${remaining}日`
    : "";
  const descriptionIsLong = Boolean(project && (
    project.description.length > 180
    || project.description.split("\n").length > 4
  ));
  const projectPlannedHours = project
    ? (project.workItems || []).reduce((total, work) => total + (Number(work.plannedHours) || 0), 0)
    : 0;

  return <Modal title="プロジェクト管理" onClose={onClose} wide><div className="goals-layout project-layout">
    <aside>
      <button className="primary" onClick={add}>＋ プロジェクト追加</button>
      <button type="button" className="project-search-toggle" aria-expanded={searchPanelOpen} onClick={() => { const next = !searchPanelOpen; setSearchPanelOpen(next); localStorage.setItem("chatTaskProjectSearchPanelOpen", String(next)); }}><small>{searchPanelOpen ? "▼" : "▶"}</small><span>検索・絞り込み</span></button>
      {searchPanelOpen && <div className="project-search-panel">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="プロジェクトを検索" />
        <select value={filter} onChange={(event) => { setFilter(event.target.value); localStorage.setItem("chatTaskProjectFilter", event.target.value); }}><option value="active">進行中のみ</option><option value="all">達成・アーカイブを含む</option></select>
        <button type="button" className={`project-advanced-filter-open ${advancedFilter.conditions.length ? "active" : ""}`} onClick={() => setAdvancedFilterOpen(true)}>＋ 条件検索（AND・OR）{advancedFilter.conditions.length ? ` ${advancedFilter.conditions.length}件` : ""}</button>
        <button type="button" className="sort-editor-open" onClick={() => setSortEditorOpen(true)}><span>↕ 並び替え</span><small>{sortRules.length}条件・上から優先</small></button>
      </div>}
      {visible.map((item) => <button key={item.id} className={`project-list-item ${item.id === selectedId ? "active" : ""}`} onClick={() => setSelectedId(item.id)}><span className="project-list-title"><i className={`priority priority-${item.priority}`}>{item.priority}</i><span>{item.title}</span></span><small>{STATUS_LABELS[item.status]}・{progress(item)}%{item.dueDate ? `・期限 ${item.dueDate}` : ""}</small></button>)}
    </aside>
    <main className="project-view-tree">{project ? <>
      <aside className="project-info-pane">
      <div className="goal-heading"><div className="project-title-area">{editingBoard ? <input value={project.title} onChange={(event) => update({ title: event.target.value })} /> : <h2>{project.title}</h2>}{editingBoard ? <div className="project-edit-actions"><button type="button" className="project-edit-cancel" onClick={cancelProjectEdit}>編集をキャンセル</button><button type="button" onClick={completeProjectEdit}>編集を完了</button></div> : <div className="project-heading-actions"><button type="button" onClick={() => setProjectEditDraft(structuredClone(project))}>基本情報を編集</button></div>}</div><div className="goal-progress"><strong>{progress(project)}%</strong><span><i style={{ width: `${progress(project)}%` }} /></span></div></div>
      <EffortSummary workItems={project.workItems || []} label="プロジェクト工数" plannedOverride={projectPlannedHours || undefined} completed={project.status === "achieved"} />
      <div className="field-grid goal-fields"><label>状態<select value={project.status} onChange={(event) => update({ status: event.target.value as GoalStatus })}>{Object.entries(STATUS_LABELS).filter(([value]) => value !== "cancelled").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{editingBoard ? <><label>優先度<select value={project.priority} onChange={(event) => update({ priority: event.target.value as Goal["priority"] })}>{["A", "B", "C", "D"].map((value) => <option key={value}>{value}</option>)}</select></label><label>案件タグ<select value={project.projectTagId} onChange={(event) => update({ projectTagId: event.target.value })}><option value="">タグなし</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label><label className={`goal-deadline-field ${remaining !== null && remaining < 0 ? "overdue" : ""}`}>GOAL期限<WorkDatePicker ariaLabel="GOAL期限" value={project.dueDate} onChange={(dueDate) => update({ dueDate })} />{deadlineStatusText && <small>{deadlineStatusText}</small>}</label></> : <><div className="project-read-field"><small>優先度</small><strong>{project.priority}</strong></div><div className="project-read-field"><small>案件タグ</small><strong>{tags.find((tag) => tag.id === project.projectTagId)?.name || "タグなし"}</strong></div><div className={`project-read-field project-read-deadline ${remaining !== null && remaining < 0 ? "overdue" : ""}`}><small>GOAL期限</small><strong>{project.dueDate || "未設定"}</strong>{deadlineStatusText && <span>{deadlineStatusText}</span>}</div></>}</div>
      <button type="button" className={`project-summary-toggle ${overviewExpanded || editingBoard ? "active" : ""}`} onClick={() => { const next = !overviewExpanded; setOverviewExpanded(next); localStorage.setItem("chatTaskProjectOverviewExpanded", String(next)); }}><span>{overviewExpanded || editingBoard ? "▼" : "▶"}</span> 詳細情報</button>
      {(overviewExpanded || editingBoard) && <section className="project-overview-details">
        <section className="project-summary-section"><header>概要・達成条件</header><div className={`goal-text-fields ${editingBoard ? "" : "is-readonly"}`}>{editingBoard ? <><label>プロジェクトの説明<textarea rows={3} value={project.description} onChange={(event) => update({ description: event.target.value })} /></label><label>GOAL（最終達成条件）<textarea rows={3} value={project.successCriteria} onChange={(event) => update({ successCriteria: event.target.value })} placeholder="どの状態になれば完了か" /></label></> : <><div className="project-description-field"><small>プロジェクトの説明</small><p className={descriptionIsLong && !descriptionExpanded ? "is-collapsed" : ""}>{project.description || "説明はありません"}</p>{descriptionIsLong && <button type="button" className="project-description-toggle" aria-expanded={descriptionExpanded} onClick={() => setDescriptionExpanded((expanded) => !expanded)}>{descriptionExpanded ? "折りたたむ" : "もっと見る"}</button>}</div><div><small>GOAL（最終達成条件）</small><p>{project.successCriteria || "最終達成条件は未設定です"}</p></div></>}</div></section>
        {origin && <section className="project-summary-section"><header>関連情報</header><section className="project-origin"><div><strong>起点ToDo・これまでの経緯</strong><span>{origin.title}</span><small>{origin.description.slice(0, 100)}</small></div><button onClick={() => onSelectTask(origin.id)}>開く</button></section></section>}
        <section className="project-summary-section"><header>共有資料</header><ProjectResources key={project.id} project={project} onLinks={(sharedLinks) => update({ sharedLinks })} /></section>
      </section>}
      </aside>
      <section className="project-milestone-pane">
      <div className="project-workspace-toolbar"><div><strong>マイルストーン</strong><small>計画と作業項目を確認・整理します</small></div><div><button type="button" onClick={exportProjectMarkdown} disabled={exportingMarkdown}>{exportingMarkdown ? "出力中..." : "MD出力"}</button><button type="button" onClick={() => onOpenGantt(project.id)}>ガントチャート</button></div></div>
      <MilestonePlanOverview milestones={project.milestones} workItems={project.workItems || []} editing={editingBoard} onUpdate={updateMilestone} />
      {view === "board" && <>{!editingBoard && project.milestones.length > 1 && <section className="same-date-order-panel"><strong>マイルストーンの同一期限内順序</strong><small>期限が同じ項目だけ、↑／↓で移動できます。期限が異なる場合は期限の昇順で自動的に並びます。</small>{[...project.milestones].sort(compareMilestonesByDueDate).map((milestone) => <div key={`order-${milestone.id}`}><span>{milestone.title || "名称未設定"}<small>{milestone.dueDate || "期限未設定"}</small></span><div className="same-date-order-controls"><button type="button" title="同じ期限の中で上へ" onClick={() => moveMilestone(milestone.id, -1)}>↑</button><button type="button" title="同じ期限の中で下へ" onClick={() => moveMilestone(milestone.id, 1)}>↓</button></div></div>)}</section>}
      <section className="goal-section"><div className="goal-section-heading"><h3>マイルストーン</h3><div className="goal-section-heading-actions">{editingBoard ? <><button type="button" className="project-edit-cancel" onClick={cancelProjectEdit}>キャンセル</button><button type="button" onClick={completeProjectEdit}>編集を完了</button><button type="button" onClick={addMilestone}>＋ マイルストーン追加</button></> : <button type="button" onClick={beginProjectEdit}>ボードを編集</button>}</div></div><div className="project-milestones">{[...project.milestones].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((milestone, milestoneIndex) => { const linkedTask = tasks.find((task) => task.id === milestone.linkedTaskId); const ranges = milestone.plannedRanges?.length ? milestone.plannedRanges : linkedTask?.plannedRanges || []; const milestoneWorks = (project.workItems || []).filter((item) => item.milestoneId === milestone.id); return <article key={milestone.id}><div className="board-milestone-label"><span>MILESTONE {milestoneIndex + 1}</span><small>配下の作業項目 {milestoneWorks.length}件</small></div><div className={`project-item-main ${editingBoard ? "" : "is-readonly"}`}><select value={milestone.status || (milestone.completed ? "achieved" : "not-started")} onChange={(event) => { const status = event.target.value as NonNullable<GoalMilestone["status"]>; updateMilestone(milestone.id, { status, completed: status === "achieved" }); }}>{Object.entries(MILESTONE_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{editingBoard ? <><input value={milestone.title} className={milestone.completed ? "plan-completed" : ""} onChange={(event) => updateMilestone(milestone.id, { title: event.target.value })} /><WorkDatePicker ariaLabel="マイルストーンの期限" value={milestone.dueDate || ""} onChange={(dueDate) => updateMilestone(milestone.id, { dueDate })} /><button onClick={() => addWorkItem(milestone.id)}>作業追加</button><button className="danger-text" onClick={() => deleteMilestone(milestone.id)}>削除</button></> : <>{milestone.linkedTaskId ? <button type="button" className="project-milestone-title-link" title="関連ChatTaskを開く" onClick={() => onSelectTask(milestone.linkedTaskId!)}>{milestone.title}</button> : <strong>{milestone.title}</strong>}<time>{milestone.dueDate || "期限未設定"}</time></>}</div>{!editingBoard && <ScheduleDate ranges={ranges} />}{editingBoard ? <><textarea rows={2} value={milestone.description || ""} onChange={(event) => updateMilestone(milestone.id, { description: event.target.value })} placeholder="マイルストーンの説明" /><LinkedTaskSelector tasks={tasks} value={milestone.linkedTaskId || ""} suggestedTaskIds={[project.originTaskId || "", ...project.taskIds]} suggestionLabel="このプロジェクトの候補" onCreateTask={onCreateTask} onChange={(linkedTaskId) => updateMilestone(milestone.id, { linkedTaskId, taskIds: linkedTaskId ? [linkedTaskId] : [] })} /><label className="status-sync-toggle"><input type="checkbox" checked={milestone.syncLinkedTaskStatus !== false} onChange={(event) => updateMilestone(milestone.id, { syncLinkedTaskStatus: event.target.checked })} />関連ChatTaskへステータス連動</label><ScheduleEditor ranges={ranges} onChange={(nextRanges) => updateMilestoneSchedule(milestone.id, nextRanges)} /></> : <><p>{milestone.description || "説明はありません"}</p><StatusSyncState task={linkedTask} status={milestone.status || (milestone.completed ? "achieved" : "not-started")} enabled={milestone.syncLinkedTaskStatus !== false} onReflect={() => reflectMilestoneStatus(milestone)} /></>}<div className="board-milestone-works">{milestoneWorks.map((work) => <WorkRow key={work.id} work={work} tasks={tasks} editing={editingBoard} suggestedTaskIds={[milestone.linkedTaskId || "", ...milestone.taskIds]} onCreateTask={onCreateTask} onUpdate={(changes) => updateWork(work.id, changes)} onSchedule={(nextRanges) => updateWorkSchedule(work.id, nextRanges)} onDelete={() => deleteWork(work.id)} onOpen={onSelectTask} onReflectStatus={() => reflectWorkStatus(work)} />)}{!milestoneWorks.length && !editingBoard && <p className="board-no-work">配下の作業項目はありません</p>}</div></article>; })}</div></section>
      <section className="goal-section project-direct-work"><div className="goal-section-heading"><h3>プロジェクト直属の作業項目</h3>{editingBoard && <button onClick={() => addWorkItem()}>＋ 追加</button>}</div>{(project.workItems || []).filter((item) => !item.milestoneId).map((work) => <WorkRow key={work.id} work={work} tasks={tasks} editing={editingBoard} suggestedTaskIds={[project.originTaskId || "", ...project.taskIds]} onCreateTask={onCreateTask} onUpdate={(changes) => updateWork(work.id, changes)} onSchedule={(ranges) => updateWorkSchedule(work.id, ranges)} onDelete={() => deleteWork(work.id)} onOpen={onSelectTask} onReflectStatus={() => reflectWorkStatus(work)} />)}</section></>}
      <ProjectTree project={project} tasks={tasks} onCreateTask={onCreateTask} onMilestone={updateMilestone} onMilestoneSchedule={updateMilestoneSchedule} onAddMilestone={addMilestone} onWork={updateWork} onWorkSchedule={updateWorkSchedule} onAddWork={addWorkItem} onDeleteMilestone={deleteMilestone} onDeleteWork={deleteWork} onOpen={onSelectTask} onReflectMilestone={reflectMilestoneStatus} onReflectWork={reflectWorkStatus} />
      </section>
      {advancedFilterOpen && <ProjectAdvancedFilterModal filter={advancedFilter} tags={tags} onApply={setAdvancedFilter} onClose={() => setAdvancedFilterOpen(false)} />}
      {sortEditorOpen && <ProjectSortModal rules={sortRules} onChange={setSortRules} onClose={() => setSortEditorOpen(false)} />}
      <div className="goal-footer">{deleteConfirm ? <div><span>プロジェクトだけを削除します。起点ToDoは残ります。</span><button onClick={() => setDeleteConfirm(false)}>取消</button><button className="danger" onClick={remove}>削除する</button></div> : <button className="danger-text" onClick={() => setDeleteConfirm(true)}>プロジェクトを削除</button>}<span className="autosave-status">自動保存</span><button className="primary" onClick={onClose}>閉じる</button></div>
      {projectEditDraft && createPortal(<div className="project-editor-backdrop" onPointerDown={() => setProjectEditDraft(null)}><section className="project-editor-dialog" role="dialog" aria-modal="true" aria-label="プロジェクトを編集" onPointerDown={(event) => event.stopPropagation()}><header><div><small>PROJECT</small><h3>プロジェクトを編集</h3><p>名称や状態、期限などの基本情報を変更します。</p></div><button type="button" aria-label="閉じる" onClick={() => setProjectEditDraft(null)}>×</button></header><div className="project-editor-fields"><label className="project-editor-title">プロジェクト名<input autoFocus value={projectEditDraft.title} onChange={(event) => setProjectEditDraft({ ...projectEditDraft, title: event.target.value })} /></label><label>状態<select value={projectEditDraft.status} onChange={(event) => setProjectEditDraft({ ...projectEditDraft, status: event.target.value as GoalStatus })}>{Object.entries(STATUS_LABELS).filter(([value]) => value !== "cancelled").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>優先度<select value={projectEditDraft.priority} onChange={(event) => setProjectEditDraft({ ...projectEditDraft, priority: event.target.value as Goal["priority"] })}>{["A", "B", "C", "D"].map((value) => <option key={value}>{value}</option>)}</select></label><label>案件タグ<select value={projectEditDraft.projectTagId} onChange={(event) => setProjectEditDraft({ ...projectEditDraft, projectTagId: event.target.value })}><option value="">タグなし</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label><label>GOAL期限<WorkDatePicker ariaLabel="GOAL期限" value={projectEditDraft.dueDate} onChange={(dueDate) => setProjectEditDraft({ ...projectEditDraft, dueDate })} /></label><label className="project-editor-description">プロジェクトの説明<textarea rows={5} value={projectEditDraft.description} onChange={(event) => setProjectEditDraft({ ...projectEditDraft, description: event.target.value })} /></label><label className="project-editor-description">GOAL（最終達成条件）<textarea rows={4} value={projectEditDraft.successCriteria} onChange={(event) => setProjectEditDraft({ ...projectEditDraft, successCriteria: event.target.value })} placeholder="どの状態になれば完了か" /></label></div><footer><button type="button" onClick={() => setProjectEditDraft(null)}>キャンセル</button><button type="button" className="primary" disabled={!projectEditDraft.title.trim()} onClick={() => { persistProjectChanges(projectEditDraft); setProjectEditDraft(null); }}>保存</button></footer></section></div>, document.body)}
    </> : <div className="empty-list">プロジェクトを追加してください。</div>}</main>
  </div></Modal>;
}

function ProjectTree({ project, tasks, onCreateTask, onMilestone, onMilestoneSchedule, onAddMilestone, onWork, onWorkSchedule, onAddWork, onDeleteMilestone, onDeleteWork, onOpen, onReflectMilestone, onReflectWork }: { project: Goal; tasks: Task[]; onCreateTask: CreateRelatedTask; onMilestone: (id: string, changes: Partial<GoalMilestone>) => void; onMilestoneSchedule: (id: string, ranges: PlannedRange[]) => void; onAddMilestone: (insertAt?: number) => string; onWork: (id: string, changes: Partial<ProjectWorkItem>) => void; onWorkSchedule: (id: string, ranges: PlannedRange[]) => void; onAddWork: (milestoneId: string) => string; onDeleteMilestone: (id: string) => void; onDeleteWork: (id: string) => void; onOpen: (id: string) => void; onReflectMilestone: (milestone: GoalMilestone) => void; onReflectWork: (work: ProjectWorkItem) => void }) {
  const onAddWorkRef = useRef(onAddWork);
  useEffect(() => { onAddWorkRef.current = onAddWork; }, [onAddWork]);
  const editingMilestone = "";
  const [milestoneDialogId, setMilestoneDialogId] = useState("");
  const [milestoneDraft, setMilestoneDraft] = useState<GoalMilestone | null>(null);
  const setEditingMilestone = (id: string) => setMilestoneDialogId(id);
  const editingWork = "";
  const [workDialogId, setWorkDialogId] = useState("");
  const [workDraft, setWorkDraft] = useState<ProjectWorkItem | null>(null);
  const setEditingWork = (id: string) => setWorkDialogId(id);
  const [milestoneEditSnapshot, setMilestoneEditSnapshot] = useState<GoalMilestone | null>(null);
  const [workEditSnapshot, setWorkEditSnapshot] = useState<ProjectWorkItem | null>(null);
  const [newMilestoneEditId, setNewMilestoneEditId] = useState("");
  const [newWorkEditId, setNewWorkEditId] = useState("");
  const [dismissedWorkTransferId, setDismissedWorkTransferId] = useState("");
  const [openMenu, setOpenMenu] = useState("");
  const [collapsedWorks, setCollapsedWorks] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("chatTaskCollapsedMilestoneWorks") || "{}"); }
    catch { return {}; }
  });
  const [hideAchievedWorks, setHideAchievedWorks] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("chatTaskHideAchievedMilestoneWorks") || "{}"); }
    catch { return {}; }
  });
  const [collapsedMilestones, setCollapsedMilestones] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(`chatTaskCollapsedMilestones:${project.id}`) || "{}"); }
    catch { return {}; }
  });
  useEffect(() => {
    try {
      setCollapsedMilestones(JSON.parse(localStorage.getItem(`chatTaskCollapsedMilestones:${project.id}`) || "{}"));
    } catch {
      setCollapsedMilestones({});
    }
  }, [project.id]);
  const toggleWorks = (id: string) => setCollapsedWorks((current) => {
    const next = { ...current, [id]: !current[id] };
    localStorage.setItem("chatTaskCollapsedMilestoneWorks", JSON.stringify(next));
    return next;
  });
  const toggleAchievedWorks = (id: string) => setHideAchievedWorks((current) => {
    const next = { ...current, [id]: !current[id] };
    localStorage.setItem("chatTaskHideAchievedMilestoneWorks", JSON.stringify(next));
    return next;
  });
  const toggleMilestone = (id: string) => setCollapsedMilestones((current) => {
    const next = { ...current, [id]: !current[id] };
    localStorage.setItem(`chatTaskCollapsedMilestones:${project.id}`, JSON.stringify(next));
    return next;
  });
  useEffect(() => {
    if (!milestoneDialogId) {
      setMilestoneDraft(null);
      return;
    }
    const source = project.milestones.find((item) => item.id === milestoneDialogId);
    if (source && milestoneDraft?.id !== source.id) setMilestoneDraft(structuredClone(source));
  }, [milestoneDialogId, milestoneDraft?.id, project.milestones]);
  useEffect(() => {
    if (!workDialogId) {
      setWorkDraft(null);
      return;
    }
    const source = (project.workItems || []).find((item) => item.id === workDialogId);
    if (source && workDraft?.id !== source.id) setWorkDraft(structuredClone(source));
  }, [project.workItems, workDialogId, workDraft?.id]);
  useEffect(() => setDismissedWorkTransferId(""), [workDialogId]);
  useEffect(() => {
    if (editingMilestone) document.querySelector<HTMLInputElement>(".tree-title-input")?.focus();
  }, [editingMilestone]);
  useEffect(() => {
    if (!milestoneDialogId) {
      setMilestoneEditSnapshot(null);
      setNewMilestoneEditId("");
      return;
    }
    if (milestoneDialogId === newMilestoneEditId || milestoneEditSnapshot?.id === milestoneDialogId) return;
    const milestone = project.milestones.find((item) => item.id === milestoneDialogId);
    if (milestone) setMilestoneEditSnapshot(structuredClone(milestone));
  }, [milestoneDialogId, milestoneEditSnapshot, newMilestoneEditId, project.milestones]);
  const completeMilestoneEdit = () => {
    setEditingMilestone("");
    setMilestoneEditSnapshot(null);
    setNewMilestoneEditId("");
  };
  const cancelMilestoneEdit = (id: string) => {
    if (milestoneEditSnapshot?.id === id) {
      onMilestone(id, milestoneEditSnapshot);
      onMilestoneSchedule(id, milestoneEditSnapshot.plannedRanges || []);
    } else {
      onDeleteMilestone(id);
    }
    completeMilestoneEdit();
  };
  const completeWorkEdit = () => {
    setWorkDialogId("");
    setWorkDraft(null);
    setWorkEditSnapshot(null);
    setNewWorkEditId("");
  };
  const cancelWorkEdit = (id: string) => {
    if (workEditSnapshot?.id === id) {
      onWork(id, workEditSnapshot);
      onWorkSchedule(id, workEditSnapshot.plannedRanges || []);
    } else {
      onDeleteWork(id);
    }
    completeWorkEdit();
  };
  const milestones = [...project.milestones].sort(compareMilestonesByDueDate);
  const allMilestonesAchieved = milestones.length > 0
    && milestones.every((milestone) => milestone.status === "achieved" || milestone.completed);
  const workDialogMilestone = workDraft
    ? project.milestones.find((item) => item.id === workDraft.milestoneId) || null
    : null;
  const workDialogMilestoneWorks = workDialogMilestone
    ? (project.workItems || []).filter((item) => item.milestoneId === workDialogMilestone.id).sort((a, b) => a.sortOrder - b.sortOrder)
    : [];
  const workTransferTask = workDraft
    ? tasks.find((task) => task.id === (workDraft.linkedTaskId || project.originTaskId || "")) || null
    : null;
  const workTransferCandidates = workDraft && workTransferTask && (workDraft.plannedRanges || []).length === 0
    ? workTransferTask.plannedRanges.filter((range) => !range.sourceId)
    : [];
  const transferScheduleToWork = (range: PlannedRange) => {
    if (!workDraft || !workTransferTask) return;
    const inheritedTitle = range.title?.trim() || workTransferTask.title.trim() || workDraft.title.trim();
    const transferredRange = { ...structuredClone(range), title: inheritedTitle };
    setWorkDraft({
      ...workDraft,
      title: inheritedTitle,
      linkedTaskId: workTransferTask.id,
      plannedRanges: [transferredRange],
      plannedHours: Number(transferredRange.plannedHours) || 0,
    });
  };
  const saveWorkDraft = (continueAdding: boolean) => {
    if (!workDraft) return;
    const milestoneId = workDraft.milestoneId;
    const plannedRanges = (workDraft.plannedRanges || []).slice(0, 1).map((range) => ({ ...range, title: workDraft.title.trim() }));
    const sanitizedDraft = { ...workDraft, plannedRanges, plannedHours: scheduleHours(plannedRanges) };
    onWorkSchedule(workDraft.id, plannedRanges);
    onWork(workDraft.id, sanitizedDraft);
    if (!continueAdding) {
      completeWorkEdit();
      return;
    }
    setWorkEditSnapshot(null);
    setNewWorkEditId("");
    // 親側へ保存された状態が反映されてから次の項目を追加し、直前の保存内容を上書きしない。
    window.setTimeout(() => {
      const id = onAddWorkRef.current(milestoneId);
      if (!id) return;
      setNewWorkEditId(id);
      setEditingWork(id);
    }, 0);
  };
  return <section className="project-tree" aria-label="プロジェクトツリー">
    {(editingMilestone || editingWork) && <div className="tree-edit-toolbar"><span>{editingMilestone ? "マイルストーンを編集中" : "作業項目を編集中"}</span><div><button type="button" className="tree-edit-cancel" onClick={() => editingMilestone ? cancelMilestoneEdit(editingMilestone) : cancelWorkEdit(editingWork)}>編集をキャンセル</button><button type="button" className="tree-edit-done" onClick={() => editingMilestone ? completeMilestoneEdit() : completeWorkEdit()}>編集を完了</button></div></div>}
    {milestones.length === 0 && <button type="button" className="tree-empty-add" onClick={() => { const id = onAddMilestone(0); if (id) { setMilestoneEditSnapshot(null); setNewMilestoneEditId(id); setEditingMilestone(id); } }}>＋ 最初のマイルストーンを追加</button>}
    {milestones.map((milestone, index) => {
      const works = (project.workItems || []).filter((item) => item.milestoneId === milestone.id).sort((a, b) => a.sortOrder - b.sortOrder);
      const achievedWorkCount = works.filter((work) => work.status === "done").length;
      const visibleWorks = hideAchievedWorks[milestone.id] ? works.filter((work) => work.status !== "done") : works;
      const linked = milestone.linkedTaskId ? tasks.find((task) => task.id === milestone.linkedTaskId) : null;
      const milestoneActualHours = actualHoursFromTodayPages(milestone, tasks, "project-milestone")
        + works.reduce((sum, work) => sum + (Number(work.actualHours) || 0), 0);
      const milestoneAchieved = milestone.status === "achieved" || milestone.completed;
      const pathAchieved = milestones.slice(0, index + 1).every((item) => item.status === "achieved" || item.completed);
      const milestoneCollapsed = milestoneAchieved && Boolean(collapsedMilestones[milestone.id]);
      const milestoneDueDate = milestone.dueDate || "";
      const canMoveMilestoneUp = index > 0 && (milestones[index - 1].dueDate || "") === milestoneDueDate;
      const canMoveMilestoneDown = index < milestones.length - 1 && (milestones[index + 1].dueDate || "") === milestoneDueDate;
      return <div className={`tree-row ${index % 2 === 0 ? "tree-left" : "tree-right"} ${pathAchieved ? "path-completed" : ""} ${milestoneCollapsed ? "milestone-collapsed" : ""}`} key={milestone.id}>
        <button type="button" className={`tree-node ${milestoneAchieved ? "completed" : ""}`} disabled={!milestoneAchieved} aria-expanded={milestoneAchieved ? !milestoneCollapsed : undefined} aria-label={milestoneAchieved ? `${index + 1}番目の達成済みマイルストーン「${milestone.title}」を${milestoneCollapsed ? "表示" : "数字の中に隠す"}` : `${index + 1}番目のマイルストーン`} title={milestoneAchieved ? milestoneCollapsed ? `${milestone.title}を表示` : `${milestone.title}を折りたたむ` : milestone.title} onClick={() => milestoneAchieved && toggleMilestone(milestone.id)}>{index + 1}</button>
        {!milestoneCollapsed && <button type="button" className="tree-trunk-add" aria-label={`${index + 1}番目の後にマイルストーンを追加`} onClick={() => { const id = onAddMilestone(index + 1); if (id) { setMilestoneEditSnapshot(null); setNewMilestoneEditId(id); setEditingMilestone(id); setOpenMenu(""); } }}>＋</button>}
        {!milestoneCollapsed && <article className={`tree-card ${milestone.status === "achieved" || milestone.completed ? "completed" : ""} ${editingMilestone === milestone.id ? "is-editing" : ""} ${collapsedWorks[milestone.id] ? "work-collapsed" : ""}`}>
          <header><div><small>MILESTONE {index + 1}</small>{editingMilestone === milestone.id ? <input className="tree-title-input" value={milestone.title} onChange={(event) => onMilestone(milestone.id, { title: event.target.value })} /> : linked ? <button type="button" className="tree-milestone-title-link" title="関連ChatTaskを開く" onClick={() => onOpen(linked.id)}>{milestone.title}</button> : <strong>{milestone.title}</strong>}<ScheduleDate ranges={milestone.plannedRanges?.length ? milestone.plannedRanges : linked?.plannedRanges || []} /></div><div className="tree-card-actions"><select className={`tree-status-select status-${milestone.status || "not-started"}`} aria-label={`${milestone.title}のステータス`} value={milestone.status || (milestone.completed ? "achieved" : "not-started")} onChange={(event) => { const status = event.target.value as NonNullable<GoalMilestone["status"]>; onMilestone(milestone.id, { status, completed: status === "achieved" }); }}>{Object.entries(MILESTONE_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" className="tree-menu-trigger" aria-label={`${milestone.title}の操作`} aria-expanded={openMenu === `m-${milestone.id}`} onClick={() => setOpenMenu(openMenu === `m-${milestone.id}` ? "" : `m-${milestone.id}`)}>…</button>{openMenu === `m-${milestone.id}` && <div className="tree-item-menu"><button type="button" onClick={() => { setEditingMilestone(milestone.id); setOpenMenu(""); }}>編集</button><button type="button" disabled={!canMoveMilestoneUp} onClick={() => { onMilestone(milestone.id, { sortOrder: (milestone.sortOrder ?? index) - 1.5 }); setOpenMenu(""); }}>↑ 同日内で上へ</button><button type="button" disabled={!canMoveMilestoneDown} onClick={() => { onMilestone(milestone.id, { sortOrder: (milestone.sortOrder ?? index) + 1.5 }); setOpenMenu(""); }}>↓ 同日内で下へ</button><button type="button" className="danger-text" onClick={() => { setOpenMenu(""); onDeleteMilestone(milestone.id); }}>削除</button></div>}</div></header>
          {editingMilestone === milestone.id ? <><textarea className="tree-description" rows={2} value={milestone.description || ""} onChange={(event) => onMilestone(milestone.id, { description: event.target.value })} placeholder="マイルストーンの説明" /><LinkedTaskSelector tasks={tasks} value={milestone.linkedTaskId || ""} suggestedTaskIds={[project.originTaskId || "", ...project.taskIds]} suggestionLabel="このプロジェクトの候補" compact onCreateTask={onCreateTask} onChange={(linkedTaskId) => onMilestone(milestone.id, { linkedTaskId, taskIds: linkedTaskId ? [linkedTaskId] : [] })} /><label className="status-sync-toggle"><input type="checkbox" checked={milestone.syncLinkedTaskStatus !== false} onChange={(event) => onMilestone(milestone.id, { syncLinkedTaskStatus: event.target.checked })} />関連ChatTaskへステータス連動</label><ScheduleEditor ranges={milestone.plannedRanges?.length ? milestone.plannedRanges : linked?.plannedRanges || []} onChange={(ranges) => onMilestoneSchedule(milestone.id, ranges)} /><button className="tree-edit-done" onClick={() => setEditingMilestone("")}>編集を完了</button></> : <>{milestone.description && <p>{milestone.description}</p>}<StatusSyncState task={linked} status={milestone.status || (milestone.completed ? "achieved" : "not-started")} enabled={milestone.syncLinkedTaskStatus !== false} onReflect={() => onReflectMilestone(milestone)} /></>}
          {milestone.dueDate && <time>期限 {milestone.dueDate}</time>}
          {(works.length > 0 || Number(milestone.plannedHours) > 0 || milestoneActualHours > 0) && <div className="tree-effort-overview"><EffortSummary workItems={works} label="マイルストーン工数" plannedOverride={Number(milestone.plannedHours) || undefined} actualOverride={milestoneActualHours} completed={milestone.status === "achieved" || milestone.completed} />{works.map((work) => <div key={`effort-${work.id}`} className={work.plannedHours > 0 && work.actualHours > work.plannedHours ? "over" : ""}><span>{work.title}</span>{editingWork === work.id ? <span className="tree-effort-inputs"><label>予定<input type="number" min="0" step="0.25" value={work.plannedHours || ""} onChange={(event) => onWork(work.id, { plannedHours: Math.max(0, Number(event.target.value) || 0) })} /></label><label title="今日のページに入力した工数を反映します">実績<input type="number" value={work.actualHours || ""} disabled /></label></span> : <span>予定 {formatHours(work.plannedHours)} ／ 実績 {formatHours(work.actualHours)}</span>}</div>)}</div>}
          {works.length > 0 && <div className="tree-work-display-controls">{achievedWorkCount > 0 && <label><input type="checkbox" checked={Boolean(hideAchievedWorks[milestone.id])} onChange={() => toggleAchievedWorks(milestone.id)} />達成した作業を非表示 <small>{achievedWorkCount}件</small></label>}<button type="button" className="tree-work-collapse-button" aria-expanded={!collapsedWorks[milestone.id]} onClick={() => toggleWorks(milestone.id)}><span aria-hidden="true">{collapsedWorks[milestone.id] ? "▶" : "▼"}</span>{collapsedWorks[milestone.id] ? `作業を表示（${visibleWorks.length}/${works.length}件）` : `作業を折りたたむ（${visibleWorks.length}/${works.length}件）`}</button></div>}
          {works.length > 0 && <div className="tree-work-items">{visibleWorks.map((work, workIndex) => { const linkedWorkTask = tasks.find((task) => task.id === work.linkedTaskId); const workRanges = (work.plannedRanges || []).slice(0, 1); const workStart = scheduleStart(workRanges); const canMoveWorkUp = workIndex > 0 && scheduleStart(effectiveRanges(visibleWorks[workIndex - 1], tasks)) === workStart; const canMoveWorkDown = workIndex < visibleWorks.length - 1 && scheduleStart(effectiveRanges(visibleWorks[workIndex + 1], tasks)) === workStart; return <div key={work.id} className={`tree-work-editor ${editingWork === work.id ? "is-editing" : ""} ${work.status === "done" ? "completed" : ""}`}>{editingWork === work.id ? <><select className={`tree-status-select status-${work.status}`} aria-label={`${work.title}のステータス`} value={work.status} onChange={(event) => onWork(work.id, { status: event.target.value as ProjectWorkItem["status"] })}>{Object.entries(WORK_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input value={work.title} onChange={(event) => onWork(work.id, { title: event.target.value })} /><textarea rows={2} value={work.description} onChange={(event) => onWork(work.id, { description: event.target.value })} placeholder="作業項目の説明" /><LinkedTaskSelector tasks={tasks} value={work.linkedTaskId} suggestedTaskIds={[milestone.linkedTaskId || "", ...milestone.taskIds]} suggestionLabel="このマイルストーンの候補" compact onCreateTask={onCreateTask} onChange={(linkedTaskId) => onWork(work.id, { linkedTaskId })} /><label className="status-sync-toggle"><input type="checkbox" checked={work.syncLinkedTaskStatus !== false} onChange={(event) => onWork(work.id, { syncLinkedTaskStatus: event.target.checked })} />関連ChatTaskへステータス連動</label><ScheduleEditor single fixedTitle={work.title} ranges={workRanges} onChange={(ranges) => onWorkSchedule(work.id, ranges.slice(0, 1))} /><button type="button" className="tree-edit-done" onClick={() => setEditingWork("")}>編集を完了</button></> : <><select className={`tree-status-select status-${work.status}`} aria-label={`${work.title}のステータス`} value={work.status} onChange={(event) => onWork(work.id, { status: event.target.value as ProjectWorkItem["status"] })}>{Object.entries(WORK_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{work.linkedTaskId ? <button type="button" className="tree-work-title-link" title="関連ChatTaskを開く" onClick={() => onOpen(work.linkedTaskId)}>{work.title}</button> : <strong>{work.title}</strong>}<ScheduleDate ranges={workRanges} showUnscheduled />{work.description && <p>{work.description}</p>}<StatusSyncState task={linkedWorkTask} status={work.status} enabled={work.syncLinkedTaskStatus !== false} onReflect={() => onReflectWork(work)} /><div className="tree-work-menu"><button type="button" className="tree-menu-trigger" aria-label={`${work.title}の操作`} aria-expanded={openMenu === `w-${work.id}`} onClick={() => setOpenMenu(openMenu === `w-${work.id}` ? "" : `w-${work.id}`)}>…</button>{openMenu === `w-${work.id}` && <div className="tree-item-menu"><button type="button" onClick={() => { setEditingWork(work.id); setOpenMenu(""); }}>編集</button><button type="button" disabled={!canMoveWorkUp} onClick={() => { onWork(work.id, { sortOrder: work.sortOrder - 1.5 }); setOpenMenu(""); }}>↑ 同日内で上へ</button><button type="button" disabled={!canMoveWorkDown} onClick={() => { onWork(work.id, { sortOrder: work.sortOrder + 1.5 }); setOpenMenu(""); }}>↓ 同日内で下へ</button><button type="button" className="danger-text" onClick={() => { setOpenMenu(""); onDeleteWork(work.id); }}>削除</button></div>}</div></>}</div>; })}{hideAchievedWorks[milestone.id] && !visibleWorks.length && <p className="tree-work-hidden-empty">達成済みの作業をすべて非表示にしています。</p>}</div>}
          <button className="tree-add-work" onClick={() => { const id = onAddWork(milestone.id); if (id) { setWorkEditSnapshot(null); setNewWorkEditId(id); setEditingWork(id); setOpenMenu(""); } }}>＋ 作業項目を追加（任意）</button>
        </article>}
      </div>;
    })}
    <div className={`tree-goal ${allMilestonesAchieved ? "completed" : ""}`}><span className="tree-goal-node">◎</span><small>GOAL</small><strong>{project.title}</strong><p>{project.successCriteria || "最終達成条件を入力してください"}</p>{project.dueDate && <time>期限 {project.dueDate}</time>}<b>{progress(project)}% 達成</b></div>
    {milestoneDraft && createPortal(<div className="milestone-editor-backdrop" onPointerDown={() => { if (newMilestoneEditId === milestoneDraft.id) onDeleteMilestone(milestoneDraft.id); setMilestoneDialogId(""); setNewMilestoneEditId(""); }}><section className="milestone-editor-dialog" role="dialog" aria-modal="true" aria-label="マイルストーンを編集" onPointerDown={(event) => event.stopPropagation()}><header><div><small>MILESTONE</small><h3>{newMilestoneEditId === milestoneDraft.id ? "マイルストーンを追加" : "マイルストーンを編集"}</h3></div><button type="button" aria-label="閉じる" onClick={() => { if (newMilestoneEditId === milestoneDraft.id) onDeleteMilestone(milestoneDraft.id); setMilestoneDialogId(""); setNewMilestoneEditId(""); }}>×</button></header><div className="milestone-editor-fields"><label>マイルストーン名<input autoFocus value={milestoneDraft.title} onChange={(event) => setMilestoneDraft({ ...milestoneDraft, title: event.target.value })} placeholder="到達点を入力" /></label><label>期限<WorkDatePicker ariaLabel="マイルストーンの期限" value={milestoneDraft.dueDate || ""} onChange={(dueDate) => setMilestoneDraft({ ...milestoneDraft, dueDate })} /></label><label>状態<select value={milestoneDraft.status || (milestoneDraft.completed ? "achieved" : "not-started")} onChange={(event) => { const status = event.target.value as NonNullable<GoalMilestone["status"]>; setMilestoneDraft({ ...milestoneDraft, status, completed: status === "achieved" }); }}>{Object.entries(MILESTONE_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="milestone-editor-description">説明<textarea rows={5} value={milestoneDraft.description || ""} onChange={(event) => setMilestoneDraft({ ...milestoneDraft, description: event.target.value })} placeholder="完了条件や到達状態を記載" /></label></div><div className="milestone-editor-works"><div><strong>作業項目</strong><button type="button" onClick={() => { const id = onAddWork(milestoneDraft.id); if (id) { setNewWorkEditId(id); setEditingWork(id); } }}>＋ 作業を追加</button></div>{(project.workItems || []).filter((item) => item.milestoneId === milestoneDraft.id).sort((a, b) => a.sortOrder - b.sortOrder).map((work) => <button type="button" className="milestone-editor-work-row" key={work.id} onClick={() => setEditingWork(work.id)}><span><b>{work.title}</b><small>{WORK_STATUS[work.status]}・予定 {formatHours(work.plannedHours)}</small></span><span>編集 ›</span></button>)}{!(project.workItems || []).some((item) => item.milestoneId === milestoneDraft.id) && <p>作業項目はまだありません。ここから続けて追加できます。</p>}</div><p className="milestone-editor-note">予定期間と予定工数は、マイルストーン配下の作業項目で設定します。</p><footer><button type="button" onClick={() => { if (newMilestoneEditId === milestoneDraft.id) onDeleteMilestone(milestoneDraft.id); setMilestoneDialogId(""); setNewMilestoneEditId(""); }}>キャンセル</button><button type="button" className="primary" disabled={!milestoneDraft.title.trim()} onClick={() => { onMilestone(milestoneDraft.id, milestoneDraft); setMilestoneDialogId(""); setNewMilestoneEditId(""); }}>保存</button></footer></section></div>, document.body)}
    {workDraft && createPortal(<div className="milestone-editor-backdrop work-editor-layer" onPointerDown={() => { if (newWorkEditId === workDraft.id) onDeleteWork(workDraft.id); completeWorkEdit(); }}><section className="milestone-editor-dialog work-editor-dialog" role="dialog" aria-modal="true" aria-label="作業項目を編集" onPointerDown={(event) => event.stopPropagation()}><header><div><small>WORK ITEM</small><h3>{newWorkEditId === workDraft.id ? "作業項目を追加" : "作業項目を編集"}</h3></div><button type="button" aria-label="閉じる" onClick={() => { if (newWorkEditId === workDraft.id) onDeleteWork(workDraft.id); completeWorkEdit(); }}>×</button></header><div className="work-editor-fields"><label className="work-editor-title">作業名<input autoFocus value={workDraft.title} onChange={(event) => setWorkDraft({ ...workDraft, title: event.target.value })} placeholder="実施する作業を入力" /></label><label>状態<select value={workDraft.status} onChange={(event) => setWorkDraft({ ...workDraft, status: event.target.value as ProjectWorkItem["status"] })}>{Object.entries(WORK_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>優先度<select value={workDraft.priority} onChange={(event) => setWorkDraft({ ...workDraft, priority: event.target.value as ProjectWorkItem["priority"] })}>{["A", "B", "C", "D"].map((value) => <option key={value}>{value}</option>)}</select></label><label>期限<WorkDatePicker ariaLabel="作業項目の期限" value={workDraft.dueDate || ""} onChange={(dueDate) => setWorkDraft({ ...workDraft, dueDate })} /></label><label className="work-editor-description">説明<textarea rows={4} value={workDraft.description || ""} onChange={(event) => setWorkDraft({ ...workDraft, description: event.target.value })} placeholder="作業内容や完了条件を記載" /></label></div><div className="work-editor-related"><strong>関連ChatTask</strong><LinkedTaskSelector tasks={tasks} value={workDraft.linkedTaskId || ""} suggestedTaskIds={[milestoneDraft?.linkedTaskId || "", ...(milestoneDraft?.taskIds || []), project.originTaskId || "", ...project.taskIds]} suggestionLabel="関連する候補" onCreateTask={onCreateTask} onChange={(linkedTaskId) => setWorkDraft({ ...workDraft, linkedTaskId })} /></div><div className="work-editor-schedule"><strong>予定</strong>{!(workDraft.plannedRanges || []).length && <div className="work-unscheduled-state"><b>予定なし</b><span>作業だけを登録し、着手できるタイミングで予定を設定できます。</span></div>}<ScheduleEditor single fixedTitle={workDraft.title} ranges={(workDraft.plannedRanges || []).slice(0, 1)} onChange={(plannedRanges) => { const singleRange = plannedRanges.slice(0, 1).map((range) => ({ ...range, title: workDraft.title.trim() })); setWorkDraft({ ...workDraft, plannedRanges: singleRange, plannedHours: scheduleHours(singleRange) }); }} /></div><footer><button type="button" onClick={() => { if (newWorkEditId === workDraft.id) onDeleteWork(workDraft.id); completeWorkEdit(); }}>キャンセル</button>{newWorkEditId === workDraft.id && <button type="button" disabled={!workDraft.title.trim()} onClick={() => saveWorkDraft(false)}>保存して閉じる</button>}<button type="button" className="primary" disabled={!workDraft.title.trim()} onClick={() => saveWorkDraft(newWorkEditId === workDraft.id)}>{newWorkEditId === workDraft.id ? "保存して次を追加" : "保存"}</button></footer></section></div>, document.body)}
    {workDraft && workTransferCandidates.length > 0 && dismissedWorkTransferId !== workDraft.id && createPortal(
      <aside className="work-schedule-transfer" aria-label="起点タスクの既存予定">
        <div className="work-schedule-transfer-heading">
          <div><strong>起点タスクの既存予定</strong>
          <small>選んだ予定だけを、実績・メモ・完了状態を保ったままこの作業へ引き継ぎます。</small></div>
          <button type="button" onClick={() => setDismissedWorkTransferId(workDraft.id)}>予定を引き継がない</button>
        </div>
        <div className="work-schedule-transfer-list">
          {workTransferCandidates.map((range) => <button type="button" key={range.id} onClick={() => transferScheduleToWork(range)}>
            <span><b>{range.title || workTransferTask?.title || "予定"}</b><small>{range.startDate}{range.endDate && range.endDate !== range.startDate ? `〜${range.endDate}` : ""}・予定 {formatHours(Number(range.plannedHours) || 0)}</small></span>
            <strong>引き継ぐ</strong>
          </button>)}
        </div>
      </aside>,
      document.body,
    )}
    {workDraft && workDialogMilestone && !milestoneDraft && createPortal(
      <div className="work-context-layer" aria-label="対象マイルストーン">
        <aside className="work-context-panel">
          <header><div><small>MILESTONE</small><h3>{workDialogMilestone.title}</h3></div><span className={`work-context-status status-${workDialogMilestone.status || "not-started"}`}>{MILESTONE_STATUS[workDialogMilestone.status || (workDialogMilestone.completed ? "achieved" : "not-started")]}</span></header>
          {workDialogMilestone.description && <p>{workDialogMilestone.description}</p>}
          <dl><div><dt>期限</dt><dd>{workDialogMilestone.dueDate || "未設定"}</dd></div><div><dt>作業数</dt><dd>{workDialogMilestoneWorks.length}件</dd></div><div><dt>予定工数</dt><dd>{formatHours(workDialogMilestoneWorks.reduce((sum, item) => sum + (Number(item.plannedHours) || 0), 0))}</dd></div><div><dt>実績工数</dt><dd>{formatHours(workDialogMilestoneWorks.reduce((sum, item) => sum + (Number(item.actualHours) || 0), 0))}</dd></div></dl>
          <section><strong>配下の作業項目</strong>{workDialogMilestoneWorks.map((work) => <button type="button" key={work.id} className={work.id === workDraft.id ? "active" : ""} onClick={() => { if (newWorkEditId === workDraft.id) onDeleteWork(workDraft.id); setNewWorkEditId(""); setEditingWork(work.id); }}><span>{work.title}</span><small>{WORK_STATUS[work.status]}・予定 {formatHours(work.plannedHours)}</small></button>)}</section>
          <button type="button" className="work-context-add" onClick={() => { if (newWorkEditId === workDraft.id) onDeleteWork(workDraft.id); const id = onAddWork(workDialogMilestone.id); if (id) { setNewWorkEditId(id); setEditingWork(id); } }}>＋ 作業項目を追加</button>
        </aside>
      </div>,
      document.body,
    )}
  </section>;
}

function MilestonePlanOverview({ milestones, workItems, editing, onUpdate }: { milestones: GoalMilestone[]; workItems: ProjectWorkItem[]; editing: boolean; onUpdate: (id: string, changes: Partial<GoalMilestone>) => void }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("chatTaskMilestonePlanCollapsed") === "true");
  const toggleCollapsed = () => setCollapsed((current) => {
    const next = !current;
    localStorage.setItem("chatTaskMilestonePlanCollapsed", String(next));
    return next;
  });
  const endDate = (ranges: PlannedRange[]) => {
    const dates = ranges.map((range) => range.endDate || range.startDate).filter(Boolean).sort();
    return dates[dates.length - 1] || "";
  };
  const dayDifference = (baseline: string, current: string) => {
    if (!baseline || !current) return 0;
    return Math.round((new Date(`${current}T00:00:00Z`).getTime() - new Date(`${baseline}T00:00:00Z`).getTime()) / 86_400_000);
  };
  const formatSchedule = (ranges: PlannedRange[]) => {
    if (!ranges.length) return "未設定";
    const start = scheduleStart(ranges);
    const end = endDate(ranges);
    return start === end ? start : `${start}〜${end}`;
  };
  const rows = milestones.map((milestone) => {
    const works = workItems.filter((work) => work.milestoneId === milestone.id);
    const currentRanges = works.flatMap((work) => work.plannedRanges || []);
    const baselineRanges = works.flatMap((work) => work.baselinePlannedRanges?.length ? work.baselinePlannedRanges : work.plannedRanges || []);
    const currentHours = works.reduce((sum, work) => sum + (Number(work.plannedHours) || scheduleHours(work.plannedRanges || [])), 0);
    const baselineHours = works.reduce((sum, work) => sum + (
      work.baselinePlannedRanges?.length
        ? Number(work.baselinePlannedHours) || scheduleHours(work.baselinePlannedRanges)
        : Number(work.plannedHours) || scheduleHours(work.plannedRanges || [])
    ), 0);
    const dateDelta = dayDifference(endDate(baselineRanges), endDate(currentRanges));
    const hourDelta = currentHours - baselineHours;
    const actualHours = works.reduce((sum, work) => sum + (Number(work.actualHours) || 0), 0);
    const changed = dateDelta !== 0 || hourDelta !== 0;
    return { milestone, currentRanges, baselineRanges, currentHours, baselineHours, actualHours, dateDelta, hourDelta, changed };
  }).filter((row) => row.currentRanges.length || row.baselineRanges.length || row.currentHours || row.actualHours);
  if (!rows.length) return null;
  return <section className={`milestone-plan-overview ${collapsed ? "is-collapsed" : ""}`}>
    <header><button type="button" onClick={toggleCollapsed} aria-expanded={!collapsed}><span aria-hidden="true">{collapsed ? "▶" : "▼"}</span><span><strong>マイルストーン計画</strong><small>当初計画を残したまま、現在の見込みとの差を表示します。</small></span><b>{collapsed ? `表示（${rows.length}件）` : "折りたたむ"}</b></button></header>
    {!collapsed && <div className="milestone-plan-list">{rows.map(({ milestone, currentRanges, baselineRanges, currentHours, baselineHours, actualHours, dateDelta, hourDelta, changed }) => <article key={milestone.id} className={changed ? dateDelta > 0 || hourDelta > 0 ? "is-delayed" : "is-ahead" : ""}>
      <div className="milestone-plan-title"><strong>{milestone.title || "名称未設定"}</strong>{changed ? <span>{dateDelta > 0 ? `${dateDelta}日遅れ` : dateDelta < 0 ? `${Math.abs(dateDelta)}日前倒し` : hourDelta > 0 ? `予定工数 +${formatHours(hourDelta)}` : `予定工数 ${formatHours(hourDelta)}`}</span> : <span className="is-on-plan">計画どおり</span>}</div>
      <div className="milestone-plan-values"><span><small>当初予定</small><b>{formatSchedule(baselineRanges)}</b><em>{formatHours(baselineHours)}</em></span><span><small>現在予定</small><b>{formatSchedule(currentRanges)}</b><em>{formatHours(currentHours)}</em></span><span><small>実績</small><b>{formatHours(actualHours)}</b></span></div>
      {changed && (editing ? <label>変更理由<input value={milestone.replanReason || ""} onChange={(event) => onUpdate(milestone.id, { replanReason: event.target.value, replannedAt: milestone.replannedAt || new Date().toISOString() })} placeholder="遅延・前倒し・再見積もりの理由" /></label> : <p>{milestone.replanReason ? `変更理由：${milestone.replanReason}` : "変更理由は未入力です"}</p>)}
    </article>)}</div>}
  </section>;
}

function EffortSummary({ workItems, label, plannedOverride, actualOverride, completed = false }: { workItems: ProjectWorkItem[]; label: string; plannedOverride?: number; actualOverride?: number; completed?: boolean }) {
  const total = effort(workItems);
  const planned = plannedOverride ?? total.planned;
  const actual = actualOverride ?? total.actual;
  const rate = planned > 0 ? Math.round(actual / planned * 100) : 0;
  const accuracy = Math.max(planned, actual) > 0 ? Math.round(Math.min(planned, actual) / Math.max(planned, actual) * 100) : null;
  const difference = actual - planned;
  const differenceLabel = difference > 0 ? `予定より ${formatHours(difference)} 超過` : difference < 0 ? `予定より ${formatHours(Math.abs(difference))} 短縮` : "予定どおり";
  return <div className={`effort-summary ${planned > 0 && actual > planned ? "over" : ""}`}><strong>{label}</strong><span>予定 <b>{formatHours(planned)}</b></span><span>実績 <b>{formatHours(actual)}</b></span>{completed ? <><span>見積精度 <b>{accuracy === null ? "—" : `${accuracy}%`}</b></span><span className="effort-variance">{differenceLabel}</span></> : <span>消化率 <b>{rate}%</b></span>}</div>;
}

function ScheduleEditor({ ranges, onChange, single = true, fixedTitle }: { ranges: PlannedRange[]; onChange: (ranges: PlannedRange[]) => void; single?: boolean; fixedTitle?: string }) {
  const [startDate, setStartDate] = useState(todayValue());
  const [endDate, setEndDate] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [plannedHours, setPlannedHours] = useState("");
  const [editingId, setEditingId] = useState("");
  const [open, setOpen] = useState(false);
  const dateAfter = (days: number) => {
    const date = new Date(`${todayValue()}T12:00:00`);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const reset = () => {
    setStartDate(todayValue());
    setEndDate("");
    setTitle("");
    setNote("");
    setPlannedHours("");
    setEditingId("");
    setOpen(false);
  };
  const save = () => {
    if (!startDate) return;
    const end = endDate || startDate;
    if (end < startDate) return alert("終了日は開始日以降にしてください。");
    const range = { id: editingId || generateId(), startDate, endDate: end, title: fixedTitle?.trim() || title.trim(), description: note.trim(), note: note.trim(), plannedHours: Math.max(0, Number(plannedHours) || 0) };
    onChange(single
      ? [range]
      : (editingId ? ranges.map((item) => item.id === editingId ? range : item) : [...ranges, range]).sort((a, b) => a.startDate.localeCompare(b.startDate)));
    reset();
  };
  const edit = (range: PlannedRange) => {
    setEditingId(range.id);
    setStartDate(range.startDate);
    setEndDate(range.endDate === range.startDate ? "" : range.endDate);
    setTitle(fixedTitle || range.title || "");
    setNote(range.description || range.note || "");
    setPlannedHours(Number(range.plannedHours) > 0 ? String(range.plannedHours) : "");
    setOpen(true);
  };
  return <div className="project-schedule-editor">
    <div className="project-schedule-heading"><span><strong>{single ? "作業スケジュール" : "登録済み予定"}</strong><small>{single ? (ranges.length ? `予定工数 ${formatHours(scheduleHours(ranges))}` : "未設定") : `${ranges.length}件・合計 ${formatHours(scheduleHours(ranges))}`}</small></span>{(!single || ranges.length === 0) && <button type="button" onClick={() => { reset(); setOpen(true); }}>{single ? "＋ 予定を設定" : "＋ 予定を追加"}</button>}</div>
    {ranges.length > 0 ? <div className="project-schedule-list">{[...ranges].sort((a, b) => a.startDate.localeCompare(b.startDate)).map((range) => <article key={range.id}><button type="button" className="project-schedule-list-main" onClick={() => edit(range)}><time>{range.startDate === range.endDate ? formatScheduleDate(range.startDate) : `${formatScheduleDate(range.startDate)}〜${formatScheduleDate(range.endDate)}`}</time>{!fixedTitle && <strong>{range.title || "予定名なし"}</strong>}<b>{Number(range.plannedHours) > 0 ? formatHours(Number(range.plannedHours)) : "工数未設定"}</b>{(range.description || range.note) && <small>{range.description || range.note}</small>}</button><div><button type="button" onClick={() => edit(range)}>編集</button><button type="button" className="danger-text" aria-label={`${range.startDate}の予定を削除`} onClick={() => onChange(ranges.filter((item) => item.id !== range.id))}>削除</button></div></article>)}</div> : <p className="project-schedule-empty">予定はまだ登録されていません。</p>}
    {open && createPortal(<div className="schedule-range-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) reset(); }}><section className="schedule-range-dialog" role="dialog" aria-modal="true" aria-label={editingId ? "予定を編集" : "予定を追加"}><header><div><small>SCHEDULE</small><h3>{editingId ? "予定を編集" : "予定を追加"}</h3></div><button type="button" aria-label="閉じる" onClick={reset}>×</button></header><div className="schedule-range-quick"><span>日付をすばやく設定</span><button type="button" onClick={() => { setStartDate(todayValue()); setEndDate(""); }}>今日</button><button type="button" onClick={() => { setStartDate(dateAfter(1)); setEndDate(""); }}>明日</button><button type="button" onClick={() => { const next = new Date(`${todayValue()}T12:00:00`); do { next.setDate(next.getDate() + 1); } while ([0, 6].includes(next.getDay())); setStartDate(next.toISOString().slice(0, 10)); setEndDate(""); }}>翌営業日</button></div><div className="schedule-range-fields">{!fixedTitle && <label className="schedule-range-title">予定の題名<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例：デザイン確認" /></label>}<label>開始日<WorkDatePicker autoFocus={Boolean(fixedTitle)} ariaLabel="開始日" value={startDate} onChange={setStartDate} /></label><label>終了日（任意）<WorkDatePicker ariaLabel="終了日" value={endDate} min={startDate} onChange={setEndDate} /></label><label>予定工数（時間）<input type="number" min="0" step="0.25" value={plannedHours} onChange={(event) => setPlannedHours(event.target.value)} placeholder="例：2" /></label><label className="schedule-range-note">予定の説明<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="実施内容や完了条件（任意）" /></label></div><small className="schedule-range-help">{fixedTitle ? `予定名には作業名「${fixedTitle}」を自動で使用します。` : ""}終了日を空欄にすると、開始日の1日だけ登録します。</small><footer><button type="button" onClick={reset}>キャンセル</button><button type="button" className="primary" disabled={!startDate} onClick={save}>{editingId ? "更新" : "追加"}</button></footer></section></div>, document.body)}
  </div>;
}

function LinkedTaskSelector({ tasks, value, suggestedTaskIds, suggestionLabel, creationParentTaskId = "", compact = false, onCreateTask, onChange }: { tasks: Task[]; value: string; suggestedTaskIds: string[]; suggestionLabel: string; creationParentTaskId?: string; compact?: boolean; onCreateTask: CreateRelatedTask; onChange: (taskId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    title: "", description: "", status: "todo" as Task["status"], priority: "B" as Task["priority"],
    reminderDate: "", dueDate: "",
  });
  const selected = tasks.find((task) => task.id === value);
  const suggested = new Set(suggestedTaskIds.filter(Boolean));
  let addedDescendant = true;
  while (addedDescendant) {
    addedDescendant = false;
    tasks.forEach((task) => {
      if (task.parentTaskId && suggested.has(task.parentTaskId) && !suggested.has(task.id)) {
        suggested.add(task.id);
        addedDescendant = true;
      }
    });
  }
  const inferredParentTaskId = creationParentTaskId || suggestedTaskIds.find((id) => tasks.some((task) => task.id === id)) || "";
  const normalizedQuery = query.trim().toLowerCase();
  const matches = (task: Task) => !normalizedQuery || `${task.title} ${task.description}`.toLowerCase().includes(normalizedQuery);
  const candidateTasks = tasks.filter((task) => suggested.has(task.id) && matches(task));
  const otherTasks = tasks.filter((task) => !suggested.has(task.id) && matches(task));
  const choose = (taskId: string) => {
    onChange(taskId);
    setOpen(false);
    setQuery("");
    setCreating(false);
  };
  const beginCreate = () => {
    setDraft((current) => ({ ...current, title: query.trim() }));
    setCreating(true);
  };
  const createAndChoose = () => {
    if (!draft.title.trim()) return;
    choose(onCreateTask(draft.title, inferredParentTaskId, {
      description: draft.description,
      status: draft.status,
      priority: draft.priority,
      reminderDate: draft.reminderDate,
      dueDate: draft.dueDate,
    }, false));
  };
  return <div className={`linked-task-selector ${compact ? "compact" : ""}`}>
    {!compact && <span>関連ChatTask</span>}
    <button type="button" className={`linked-task-selector-trigger ${selected ? "has-selection" : "no-selection"}`} onClick={() => setOpen(true)}>
      <span>{selected ? selected.title : <><b aria-hidden="true">⌕</b> 関連ChatTaskを検索・設定</>}</span>{selected && <small>変更</small>}
    </button>
    {open && createPortal(<div className="linked-task-picker-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="linked-task-picker" role="dialog" aria-modal="true" aria-label="関連ChatTaskを検索">
        <header><div><strong>関連ChatTaskを選択</strong><small>候補から選ぶか、この画面のまま基本情報を入力して作成できます</small></div><button type="button" onClick={() => setOpen(false)}>×</button></header>
        <div className="linked-task-picker-search"><input autoFocus={!creating} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ChatTaskを検索..." /><button type="button" className="primary" onClick={beginCreate}>＋ 新規タスク作成</button></div>
        {creating && <div className="linked-task-create-panel">
          <div className="linked-task-create-heading"><strong>新しいChatTask</strong><small>作成後もプロジェクト画面を維持します</small></div>
          <label className="linked-task-create-title">タスク名<input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="タスク名を入力" /></label>
          <label className="linked-task-create-description">説明<textarea rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="対応内容や完了条件" /></label>
          <div className="linked-task-create-grid">
            <label>ステータス<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Task["status"] })}>{STATUS_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.values.filter((status) => status !== "recurring").map((status) => <option key={status} value={status}>{TASK_STATUS_LABELS[status]}</option>)}</optgroup>)}</select></label>
            <label>優先度<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Task["priority"] })}>{PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>
            <label>期限・通知日<WorkDatePicker ariaLabel="期限・通知日" value={draft.dueDate || draft.reminderDate} onChange={(date) => setDraft({ ...draft, dueDate: date, reminderDate: date })} /></label>
          </div>
          <div className="linked-task-create-actions"><button type="button" onClick={() => setCreating(false)}>キャンセル</button><button type="button" className="primary" disabled={!draft.title.trim()} onClick={createAndChoose}>作成して関連付け</button></div>
        </div>}
        <div className="linked-task-picker-results">
          {candidateTasks.length > 0 && <section><h4>{suggestionLabel}</h4>{candidateTasks.map((task) => <TaskChoice key={task.id} task={task} selected={task.id === value} suggested onChoose={() => choose(task.id)} />)}</section>}
          <section><h4>{normalizedQuery ? "検索結果" : "すべてのChatTask"}</h4>{otherTasks.map((task) => <TaskChoice key={task.id} task={task} selected={task.id === value} onChoose={() => choose(task.id)} />)}{!candidateTasks.length && !otherTasks.length && <p>該当するChatTaskはありません。</p>}</section>
        </div>
        <footer><button type="button" className="danger-text" onClick={() => choose("")}>関連を解除</button><button type="button" onClick={() => setOpen(false)}>キャンセル</button></footer>
      </section>
    </div>, document.body)}
  </div>;
}

function TaskChoice({ task, selected, suggested = false, onChoose }: { task: Task; selected: boolean; suggested?: boolean; onChoose: () => void }) {
  return <button type="button" className={`linked-task-choice ${selected ? "selected" : ""}`} onClick={onChoose}>
    <span><strong>{task.title}</strong><small>{task.description || "説明なし"}</small></span>
    <span>{suggested && <em>候補</em>}<b>{selected ? "選択中" : "選択"}</b></span>
  </button>;
}

function WorkRow({ work, tasks, editing, suggestedTaskIds, onCreateTask, onUpdate, onSchedule, onDelete, onOpen }: { work: ProjectWorkItem; tasks: Task[]; editing: boolean; suggestedTaskIds: string[]; onCreateTask: CreateRelatedTask; onUpdate: (changes: Partial<ProjectWorkItem>) => void; onSchedule: (ranges: PlannedRange[]) => void; onDelete: () => void; onOpen: (id: string) => void; onReflectStatus?: () => void }) {
  const ranges = (work.plannedRanges || []).slice(0, 1);
  return <div className={`project-work-row ${editing ? "" : "is-readonly"}`}>
    <select value={work.status} onChange={(event) => onUpdate({ status: event.target.value as ProjectWorkItem["status"] })}>{Object.entries(WORK_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    {editing ? <>
      <input value={work.title} className={work.status === "done" ? "plan-completed" : ""} onChange={(event) => onUpdate({ title: event.target.value })} />
      <select value={work.priority} onChange={(event) => onUpdate({ priority: event.target.value as ProjectWorkItem["priority"] })}>{["A", "B", "C", "D"].map((value) => <option key={value}>{value}</option>)}</select>
      <WorkDatePicker ariaLabel="作業項目の期限" value={work.dueDate} onChange={(dueDate) => onUpdate({ dueDate })} />
      <LinkedTaskSelector tasks={tasks} value={work.linkedTaskId} suggestedTaskIds={suggestedTaskIds} suggestionLabel="関連する候補" onCreateTask={onCreateTask} onChange={(linkedTaskId) => onUpdate({ linkedTaskId })} />
      <ScheduleEditor single fixedTitle={work.title} ranges={ranges} onChange={(nextRanges) => onSchedule(nextRanges.slice(0, 1))} />
      {work.baselinePlannedRanges?.length && scheduleSignature(work.baselinePlannedRanges) !== scheduleSignature(ranges) && <label className="work-replan-reason">予定変更理由<input value={work.replanReason || ""} onChange={(event) => onUpdate({ replanReason: event.target.value, replannedAt: work.replannedAt || new Date().toISOString() })} placeholder="前倒し・遅延・仕様変更など" /></label>}
      {work.linkedTaskId && <button onClick={() => onOpen(work.linkedTaskId)}>開く</button>}
      <button className="danger-text" onClick={onDelete}>削除</button>
      <div className="work-effort-inputs"><label>予定工数（時間）<input type="number" min="0" step="0.25" value={work.plannedHours || ""} onChange={(event) => onUpdate({ plannedHours: Math.max(0, Number(event.target.value) || 0) })} /></label><label title="今日のページに入力した工数を反映します">実績工数（今日のページ）<input type="number" value={work.actualHours || ""} disabled /></label></div>
      <textarea rows={2} value={work.description} onChange={(event) => onUpdate({ description: event.target.value })} placeholder="作業項目の説明" />
    </> : <>
      <div className="same-date-order-controls" aria-label="同じ対応開始日の中で並び替え">
        <button type="button" title="同じ対応開始日の中で上へ" onClick={() => onUpdate({ sortOrder: work.sortOrder - 1.5 })}>↑</button>
        <button type="button" title="同じ対応開始日の中で下へ" onClick={() => onUpdate({ sortOrder: work.sortOrder + 1.5 })}>↓</button>
      </div>
      {work.linkedTaskId ? <button type="button" className="project-work-title-link" title="関連ChatTaskを開く" onClick={() => onOpen(work.linkedTaskId)}>{work.title}</button> : <strong className="project-work-title">{work.title}</strong>}<span className="project-work-priority">優先度 {work.priority}</span><time className="project-work-deadline">{work.dueDate || "期限未設定"}</time>
      <ScheduleDate ranges={ranges} showUnscheduled />
      <div className={`work-effort-read ${work.plannedHours > 0 && work.actualHours > work.plannedHours ? "over" : ""}`}><span>予定 {formatHours(work.plannedHours)}</span><span>実績 {formatHours(work.actualHours)}</span></div>
      <p>{work.description || "説明はありません"}</p>
    </>}
  </div>;
}
