import { useEffect, useMemo, useRef, useState } from "react";
import { STATUS_LABELS, WAITING_STATUSES } from "../data/constants";
import type { Goal, NonWorkingPeriod, PlannedRange, ProjectTag, Task, TaskStatus } from "../types";
import { addDays, getNonWorkingPeriod, isRecurringDue, plannedHoursForDate, rangeDates, todayValue } from "../utils";
import { Modal } from "./Modal";
import { WorkDatePicker } from "./WorkDatePicker";
import { createGanttExcel } from "../services/ganttExcel";
import { createGanttSvg } from "../services/ganttSvg";
import { createImagePdf } from "../services/imagePdf";
import { xmlEscape, zipFiles } from "../services/xmlSpreadsheet";

type GanttStatusFilter = "all" | "active" | "waiting" | "done";
type GanttDisplay = "compare" | "planned" | "actual";
type GanttScale = "week" | "month" | "quarter" | "half-year" | "year" | "project";
type GanttRow = {
  id: string;
  kind: "project" | "task" | "schedule" | "milestone" | "work";
  title: string;
  periodLabel?: string;
  description?: string;
  parentId?: string;
  depth: number;
  hasChildren?: boolean;
  task?: Task;
  linkedTaskId?: string;
  status: string;
  priority?: Task["priority"];
  tagId?: string;
  baselineRanges: PlannedRange[];
  plannedRanges: PlannedRange[];
  actualStart: string;
  actualEnd: string;
  actualDates: string[];
  achievedDates: string[];
  plannedHours: number;
  actualHours: number;
  dueDate: string;
};

const hours = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
const plannedHours = (ranges: PlannedRange[], fallback = 0) => ranges.reduce((sum, range) => sum + (Number(range.plannedHours) || 0), 0) || fallback;
const taskActualRange = (task?: Task) => {
  if (!task) return { start: "", end: "", dates: [] as string[] };
  const dates = [...Object.entries(task.dailyActualHours || {})
    .filter(([, value]) => Number(value) > 0)
    .map(([key]) => key.split("::")[0])
    .filter(Boolean),
  ...task.plannedRanges.flatMap((range) => Object.entries(range.carriedOverWork || {}).filter(([, worked]) => worked).map(([date]) => date))]
    .sort();
  return { start: dates[0] || "", end: dates[dates.length - 1] || "", dates: [...new Set(dates)] };
};
const rangeActual = (task: Task, range: PlannedRange) => {
  const entries = Object.entries(task.dailyActualHours || {}).filter(([planKey, value]) => {
    if (Number(value) <= 0) return false;
    const separator = planKey.indexOf("::");
    if (separator >= 0) return planKey.slice(separator + 2) === range.id;
    return range.startDate <= planKey && range.endDate >= planKey;
  });
  const dates = [...entries.map(([planKey]) => planKey.split("::")[0]),
    ...Object.entries(range.carriedOverWork || {}).filter(([, worked]) => worked).map(([date]) => date)].sort();
  return {
    start: dates[0] || "",
    end: dates[dates.length - 1] || "",
    dates: [...new Set(dates)],
    hours: entries.reduce((sum, [, value]) => sum + (Number(value) || 0), 0),
  };
};
const taskAchievedDates = (task?: Task) => task
  ? [...new Set(Object.entries(task.dailyPlanCompleted || {})
    .filter(([, achieved]) => achieved)
    .map(([planKey]) => planKey.split("::")[0])
    .filter(Boolean))].sort()
  : [];
const rangeAchievedDates = (task: Task, range: PlannedRange) => [...new Set(Object.entries(task.dailyPlanCompleted || {})
  .filter(([planKey, achieved]) => {
    if (!achieved) return false;
    const separator = planKey.indexOf("::");
    if (separator >= 0) return planKey.slice(separator + 2) === range.id;
    return range.startDate <= planKey && range.endDate >= planKey;
  })
  .map(([planKey]) => planKey.split("::")[0]))].sort();
const projectAchievedDates = (task: Task | undefined, sourceType: PlannedRange["sourceType"], sourceId: string, fallbackRanges: PlannedRange[]) => {
  if (!task) return [];
  const rangeIds = new Set(task.plannedRanges
    .filter((range) => range.sourceType === sourceType && range.sourceId === sourceId)
    .map((range) => range.id));
  return [...new Set(Object.entries(task.dailyPlanCompleted || {})
    .filter(([planKey, achieved]) => {
      if (!achieved) return false;
      const separator = planKey.indexOf("::");
      if (separator >= 0) return rangeIds.has(planKey.slice(separator + 2));
      return fallbackRanges.some((range) => range.startDate <= planKey && range.endDate >= planKey);
    })
    .map(([planKey]) => planKey.split("::")[0]))].sort();
};
const projectActualRange = (task: Task | undefined, sourceType: PlannedRange["sourceType"], sourceId: string, fallbackRanges: PlannedRange[]) => {
  if (!task) return { start: "", end: "", dates: [] as string[], hours: 0 };
  const rangeIds = new Set(task.plannedRanges
    .filter((range) => range.sourceType === sourceType && range.sourceId === sourceId)
    .map((range) => range.id));
  const entries = Object.entries(task.dailyActualHours || {})
    .filter(([planKey, value]) => {
      if (Number(value) <= 0) return false;
      const separator = planKey.indexOf("::");
      if (separator >= 0) return rangeIds.has(planKey.slice(separator + 2));
      return fallbackRanges.some((range) => range.startDate <= planKey && range.endDate >= planKey);
    });
  const carriedWorkDates = task.plannedRanges
    .filter((range) => range.sourceType === sourceType && range.sourceId === sourceId)
    .flatMap((range) => Object.entries(range.carriedOverWork || {}).filter(([, worked]) => worked).map(([date]) => date));
  const dates = [...entries.map(([planKey]) => planKey.split("::")[0]), ...carriedWorkDates].sort();
  return { start: dates[0] || "", end: dates[dates.length - 1] || "", dates: [...new Set(dates)], hours: entries.reduce((sum, [, value]) => sum + (Number(value) || 0), 0) };
};
const contiguousDateRanges = (values: string[]) => {
  const dates = [...new Set(values.filter(Boolean))].sort();
  const ranges: Array<{ start: string; end: string }> = [];
  dates.forEach((date) => {
    const previous = ranges[ranges.length - 1];
    if (previous && addDays(previous.end, 1) === date) previous.end = date;
    else ranges.push({ start: date, end: date });
  });
  return ranges;
};
const isCompletedStatus = (status: string) => ["done", "cancelled", "handed-over", "achieved", "completed"].includes(status);
const taskStatus = (task: Task) => {
  if (task.status === "cancelled" || task.status === "handed-over") return task.status;
  if (task.status === "done" || task.progressStatus === "completed" || task.completedAt) return "done";
  if (task.progressStatus === "in-progress") return "doing";
  if (task.progressStatus === "waiting") return WAITING_STATUSES.includes(task.status) ? task.status : "waiting-general";
  return task.status;
};
const taskEndingReason = (task: Task) => {
  if (task.status !== "cancelled" && task.status !== "handed-over") return "";
  const prefix = `${STATUS_LABELS[task.status]}理由：`;
  return [...task.history].reverse().find((entry) => entry.type === "comment" && entry.text.startsWith(prefix))?.text.slice(prefix.length).trim() || "";
};
const taskTone = (status: string) => status === "cancelled" ? "cancelled" : status === "handed-over" ? "handed-over" : isCompletedStatus(status) ? "done" : WAITING_STATUSES.includes(status as TaskStatus) ? "waiting" : status === "doing" || status === "in-progress" ? "doing" : "todo";
const statusLabel = (status: string) => STATUS_LABELS[status as TaskStatus]
  || ({ "not-started": "未着手", "in-progress": "進行中", completed: "完了", achieved: "達成", done: "達成" }[status] || status);
const kindLabel = (kind: GanttRow["kind"]) => kind === "project" ? "プロジェクト" : kind === "milestone" ? "マイルストーン" : kind === "task" ? "タスク" : "作業";
const kindIcon = (kind: GanttRow["kind"]) => kind === "project" ? "◫" : kind === "milestone" ? "◆" : kind === "task" ? "≡" : "▣";
const dateObject = (value: string) => new Date(`${value}T12:00:00`);
const ganttPeriodLabel = (start: string, end: string) => {
  const startDate = dateObject(start);
  const endDate = dateObject(end);
  const startLabel = `${startDate.getFullYear()}年${startDate.getMonth() + 1}月${startDate.getDate()}日`;
  const endLabel = startDate.getFullYear() === endDate.getFullYear()
    ? `${endDate.getMonth() + 1}月${endDate.getDate()}日`
    : `${endDate.getFullYear()}年${endDate.getMonth() + 1}月${endDate.getDate()}日`;
  return `${startLabel}〜${endLabel}`;
};
const dateValue = (date: Date) => {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
};
const monthStart = (value: string) => {
  const date = dateObject(value);
  return dateValue(new Date(date.getFullYear(), date.getMonth(), 1, 12));
};
const monthEnd = (value: string, monthOffset = 0) => {
  const date = dateObject(value);
  return dateValue(new Date(date.getFullYear(), date.getMonth() + monthOffset + 1, 0, 12));
};
const shiftMonths = (value: string, amount: number) => {
  const date = dateObject(value);
  return dateValue(new Date(date.getFullYear(), date.getMonth() + amount, 1, 12));
};
const shiftDateMonths = (value: string, amount: number) => {
  const date = dateObject(value);
  const day = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  target.setDate(Math.min(day, lastDay));
  return dateValue(target);
};
const weekStart = (value: string) => {
  const date = dateObject(value);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return dateValue(date);
};
const yearStart = (value: string) => `${value.slice(0, 4)}-01-01`;
const aggregateRows = (id: string, kind: GanttRow["kind"], title: string, status: string, depth: number, children: GanttRow[], dueDate = ""): GanttRow => {
  const starts = children.flatMap((row) => row.plannedRanges.map((range) => range.startDate)).filter(Boolean).sort();
  const ends = children.flatMap((row) => row.plannedRanges.map((range) => range.endDate)).filter(Boolean).sort();
  const actualStarts = children.map((row) => row.actualStart).filter(Boolean).sort();
  const actualEnds = children.map((row) => row.actualEnd).filter(Boolean).sort();
  const actualDates = [...new Set(children.flatMap((row) => row.actualDates))].sort();
  const achievedDates = [...new Set(children.flatMap((row) => row.achievedDates))].sort();
  return {
    id, kind, title, status, depth, hasChildren: children.length > 0,
    baselineRanges: (() => {
      const baselineStarts = children.flatMap((row) => row.baselineRanges.map((range) => range.startDate)).filter(Boolean).sort();
      const baselineEnds = children.flatMap((row) => row.baselineRanges.map((range) => range.endDate)).filter(Boolean).sort();
      return baselineStarts.length ? [{ id: `${id}:baseline`, startDate: baselineStarts[0], endDate: baselineEnds[baselineEnds.length - 1] }] : [];
    })(),
    plannedRanges: starts.length ? [{ id: `${id}:aggregate`, startDate: starts[0], endDate: ends[ends.length - 1] }] : [],
    actualStart: actualStarts[0] || "", actualEnd: actualEnds[actualEnds.length - 1] || "",
    actualDates, achievedDates,
    plannedHours: children.reduce((sum, row) => sum + row.plannedHours, 0),
    actualHours: children.reduce((sum, row) => sum + row.actualHours, 0),
    dueDate,
  };
};

export function GanttModal({ tasks, projects = [], tags, periods, initialProjectId = "", onSelect, onClose }: {
  tasks: Task[];
  projects?: Goal[];
  tags: ProjectTag[];
  periods: NonWorkingPeriod[];
  initialProjectId?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [scale, setScale] = useState<GanttScale>(() => {
    // プロジェクト画面から開く場合は、保存済みの全体ガント設定ではなく当月を表示する。
    if (initialProjectId) return "month";
    const stored = localStorage.getItem("chatTaskGanttScale");
    return ["week", "month", "quarter", "half-year", "year", "project"].includes(stored || "") ? stored as GanttScale : "month";
  });
  const [display, setDisplay] = useState<GanttDisplay>("compare");
  const [anchor, setAnchor] = useState(() => {
    const today = todayValue();
    if (scale === "week") return weekStart(today);
    if (scale === "year") return yearStart(today);
    return monthStart(today);
  });
  const [projectId, setProjectId] = useState(initialProjectId);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [recentProjectIds, setRecentProjectIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("chatTaskRecentGanttProjects") || "[]");
    } catch {
      return [];
    }
  });
  const [tag, setTag] = useState("all");
  const [completed, setCompleted] = useState(false);
  const [showOutOfPeriod, setShowOutOfPeriod] = useState(() => localStorage.getItem("chatTaskGanttShowOutOfPeriod") === "true");
  const [statusFilter, setStatusFilter] = useState<GanttStatusFilter>("all");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", updateViewportWidth);
    return () => window.removeEventListener("resize", updateViewportWidth);
  }, []);
  useEffect(() => {
    if (!exportMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) setExportMenuOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [exportMenuOpen]);
  const selectedProject = projects.find((project) => project.id === projectId);
  const selectedMilestoneIds = new Set(selectedProject?.milestones.map((milestone) => milestone.id) || []);
  const selectedMilestoneWorks = (selectedProject?.workItems || []).filter((work) => Boolean(work.milestoneId) && selectedMilestoneIds.has(work.milestoneId));
  const projectDates = selectedProject ? [
    selectedProject.dueDate,
    ...selectedProject.milestones.flatMap((milestone) => [
      milestone.dueDate,
      ...(milestone.plannedRanges || []).flatMap((range) => [range.startDate, range.endDate]),
      ...(milestone.baselinePlannedRanges || []).flatMap((range) => [range.startDate, range.endDate]),
    ]),
    ...selectedMilestoneWorks.flatMap((work) => [
      work.dueDate,
      ...(work.plannedRanges || []).flatMap((range) => [range.startDate, range.endDate]),
      ...(work.baselinePlannedRanges || []).flatMap((range) => [range.startDate, range.endDate]),
    ]),
  ].filter((value): value is string => Boolean(value)).sort() : [];
  if (selectedProject && !projectDates.length) {
    projectDates.push(selectedProject.createdAt?.slice(0, 10) || todayValue(), selectedProject.dueDate || todayValue());
    projectDates.sort();
  }
  const period = (() => {
    if (scale === "week") {
      return { start: anchor, end: addDays(anchor, 6) };
    }
    if (scale === "project" && projectDates.length) {
      return { start: projectDates[0], end: projectDates[projectDates.length - 1] };
    }
    // 年間の初期表示は暦年。1か月移動後は12か月の窓をそのままスライドする。
    if (scale === "year") return { start: anchor, end: addDays(shiftDateMonths(anchor, 12), -1) };
    if (scale === "month") return { start: anchor, end: addDays(shiftDateMonths(anchor, 1), -1) };
    const months = scale === "quarter" ? 3 : scale === "half-year" ? 6 : 1;
    return { start: monthStart(anchor), end: monthEnd(anchor, months - 1) };
  })();
  const dates = useMemo(() => rangeDates([{ id: "gantt-period", startDate: period.start, endDate: period.end }]), [period.start, period.end]);
  const workingDateOverrides = useMemo(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("chatTaskWorkingDateOverrides") || "[]");
      return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : [];
    } catch {
      return [];
    }
  }, []);
  const plannedEffortByDate = useMemo(() => new Map(dates.map((date) => {
    const total = tasks.reduce((sum, task) => {
      if (["done", "cancelled", "handed-over"].includes(task.status) || task.completedAt) return sum;
      if (task.status === "recurring" || task.taskKind === "recurring") {
        if (!isRecurringDue(task, date, periods, workingDateOverrides)) return sum;
        const record = task.recurrenceRecords.find((item) => item.date === date);
        return record?.status === "done" || record?.status === "skipped" ? sum : sum + (Number(task.plannedHours) || 0);
      }
      const activeRanges = task.plannedRanges.filter((range) => (range.status || "not-started") !== "completed");
      return activeRanges.length
        ? sum + plannedHoursForDate({ ...task, plannedRanges: activeRanges }, date, periods, workingDateOverrides)
        : sum;
    }, 0);
    return [date, total] as const;
  })), [dates, tasks, periods, workingDateOverrides]);
  const availableTimelineWidth = Math.max(320, viewportWidth * .96 - Math.min(420, Math.max(280, viewportWidth * .3)) - 70);
  const fittedCell = availableTimelineWidth / Math.max(1, dates.length);
  const cell = scale === "project"
    ? Math.max(.35, Math.min(64, fittedCell))
    : scale === "week"
      ? Math.min(120, Math.max(48, fittedCell))
      : scale === "month"
        ? Math.min(46, Math.max(18, fittedCell - 2))
        : scale === "quarter"
          ? Math.min(18, Math.max(8, fittedCell))
          : scale === "half-year"
            ? Math.min(10, Math.max(4, fittedCell))
            : Math.min(6, Math.max(2, fittedCell));
  const today = todayValue();
  const todayIndex = dates.indexOf(today);
  const tagById = new Map(tags.map((item) => [item.id, item]));
  const normalizedProjectSearch = projectSearch.trim().toLocaleLowerCase("ja");
  const projectStartDate = (project: Goal) => [
    ...project.milestones.flatMap((milestone) => (milestone.plannedRanges || []).map((range) => range.startDate)),
    ...(project.workItems || []).flatMap((work) => (work.plannedRanges || []).map((range) => range.startDate)),
  ].filter(Boolean).sort()[0] || project.createdAt?.slice(0, 10) || "";
  const projectCandidates = projects
    .filter((project) => !normalizedProjectSearch || [
      project.title,
      project.description,
      projectStartDate(project),
      project.dueDate,
      statusLabel(project.status),
    ].some((value) => value?.toLocaleLowerCase("ja").includes(normalizedProjectSearch)))
    .sort((a, b) => {
      const aRecent = recentProjectIds.indexOf(a.id);
      const bRecent = recentProjectIds.indexOf(b.id);
      if (aRecent >= 0 || bRecent >= 0) {
        if (aRecent < 0) return 1;
        if (bRecent < 0) return -1;
        return aRecent - bRecent;
      }
      return a.title.localeCompare(b.title, "ja");
    });
  const chooseProject = (nextProjectId: string) => {
    setProjectId(nextProjectId);
    setProjectSearch("");
    setProjectPickerOpen(false);
    if (!nextProjectId) {
      if (scale === "project") {
        setScale("month");
        localStorage.setItem("chatTaskGanttScale", "month");
      }
      return;
    }
    const nextProject = projects.find((project) => project.id === nextProjectId);
    const nextProjectStart = nextProject ? projectStartDate(nextProject) : "";
    if (nextProjectStart) setAnchor(nextProjectStart);
    setRecentProjectIds((current) => {
      const next = [nextProjectId, ...current.filter((id) => id !== nextProjectId)].slice(0, 5);
      localStorage.setItem("chatTaskRecentGanttProjects", JSON.stringify(next));
      return next;
    });
  };
  const projectManagedStatus = (task: Task) => {
    const statuses = projects.flatMap((project) => [
      ...(project.workItems || []).filter((item) => item.linkedTaskId === task.id).map((item) => item.status),
      ...project.milestones.filter((item) => item.linkedTaskId === task.id || item.taskIds.includes(task.id)).map((item) => item.completed || item.status === "achieved" ? "done" : item.status || "not-started"),
    ]);
    if (!statuses.length) return "";
    if (statuses.every((status) => ["done", "achieved", "completed"].includes(status))) return "done";
    if (statuses.some((status) => ["in-progress", "doing"].includes(status))) return "doing";
    return "todo";
  };
  const projectManagedRangeStatus = (range: PlannedRange) => {
    if (!range.sourceType || !range.sourceId) return "";
    for (const project of projects) {
      if (range.sourceType === "project-work") {
        const work = (project.workItems || []).find((item) => item.id === range.sourceId);
        if (work) return work.status === "done" ? "completed" : work.status;
      }
      if (range.sourceType === "project-milestone") {
        const milestone = project.milestones.find((item) => item.id === range.sourceId);
        if (milestone) return milestone.completed || milestone.status === "achieved" ? "completed" : milestone.status || "not-started";
      }
    }
    return "";
  };

  const sourceRows = useMemo<GanttRow[]>(() => {
    const ganttTasks = tasks.filter((task) => task.taskKind !== "recurring" && task.status !== "recurring");
    if (!selectedProject) {
      const taskMap = new Map(ganttTasks.map((task) => [task.id, task]));
      const childrenByParent = new Map<string, Task[]>();
      ganttTasks.forEach((task) => {
        const parentId = task.parentTaskId && taskMap.has(task.parentTaskId) ? task.parentTaskId : "";
        childrenByParent.set(parentId, [...(childrenByParent.get(parentId) || []), task]);
      });
      const makeTaskRow = (task: Task, depth: number, parentId?: string): GanttRow => {
        const actual = taskActualRange(task);
        const managedStatus = projectManagedStatus(task);
        const ownStatus = taskStatus(task);
        return {
          id: `task:${task.id}`, kind: "task", title: task.title, description: taskEndingReason(task), depth, parentId, task, linkedTaskId: task.id, status: ownStatus === "cancelled" || ownStatus === "handed-over" ? ownStatus : managedStatus || ownStatus,
          priority: task.priority, tagId: task.projectTagId, baselineRanges: [], plannedRanges: task.plannedRanges,
          actualStart: actual.start, actualEnd: actual.end, actualDates: actual.dates, achievedDates: taskAchievedDates(task), plannedHours: plannedHours(task.plannedRanges, Number(task.plannedHours) || 0),
          actualHours: Number(task.actualHours) || 0, dueDate: task.dueDate || "",
        };
      };
      const ordered: GanttRow[] = [];
      const visited = new Set<string>();
      const append = (task: Task, depth: number, parentId?: string) => {
        if (visited.has(task.id)) return;
        visited.add(task.id);
        const children = childrenByParent.get(task.id) || [];
        const ownRow = makeTaskRow(task, depth, parentId);
        const scheduleRows: GanttRow[] = [...task.plannedRanges].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate)).map((range, index) => {
          const actual = rangeActual(task, range);
          const dateLabel = range.startDate === range.endDate ? range.startDate : `${range.startDate}〜${range.endDate}`;
          const projectWork = range.sourceType === "project-work"
            ? projects.flatMap((project) => project.workItems || []).find((work) => work.id === range.sourceId)
            : undefined;
          const managedRangeStatus = projectManagedRangeStatus(range);
          const owningTaskStatus = taskStatus(task);
          const scheduleStatus = owningTaskStatus === "cancelled" || owningTaskStatus === "handed-over"
            ? owningTaskStatus
            : managedRangeStatus || (owningTaskStatus === "done" || range.status === "completed" || range.completedAt
              ? "completed"
            : range.status === "in-progress"
              ? "in-progress"
              : "not-started");
          return {
            id: `schedule:${task.id}:${range.id}`,
            kind: "schedule",
            title: projectWork?.title?.trim() || range.title?.trim() || `予定 ${index + 1}`,
            periodLabel: dateLabel,
            description: projectWork?.description?.trim() || range.description || range.note || "",
            depth: depth + 1, parentId: ownRow.id, linkedTaskId: task.id, status: scheduleStatus,
            priority: task.priority, tagId: task.projectTagId,
            baselineRanges: [{
              ...range,
              startDate: range.advancedFromStartDate || range.startDate,
              endDate: range.advancedFromEndDate || range.originalEndDate || range.endDate,
            }],
            plannedRanges: [range],
            actualStart: actual.start, actualEnd: actual.end, actualDates: actual.dates, achievedDates: rangeAchievedDates(task, range), plannedHours: Number(range.plannedHours) || 0,
            actualHours: actual.hours, dueDate: range.originalEndDate || range.endDate,
          };
        });
        const childRows: GanttRow[] = [...scheduleRows];
        children.forEach((child) => {
          const before = ordered.length;
          append(child, depth + 1, ownRow.id);
          childRows.push(...ordered.splice(before));
        });
        const directChildRows = childRows.filter((row) => row.parentId === ownRow.id);
        const aggregate = aggregateRows(ownRow.id, "task", ownRow.title, ownRow.status, depth, directChildRows, ownRow.dueDate);
        const ownScheduledHours = scheduleRows.reduce((sum, item) => sum + item.plannedHours, 0) || ownRow.plannedHours;
        const childTaskHours = directChildRows.filter((item) => item.kind === "task").reduce((sum, item) => sum + item.plannedHours, 0);
        const row = childRows.length
          ? { ...ownRow, ...aggregate, status: ownRow.status === "cancelled" || ownRow.status === "handed-over" ? ownRow.status : aggregate.status, plannedHours: ownScheduledHours + childTaskHours, task, linkedTaskId: task.id, priority: task.priority, tagId: task.projectTagId, parentId }
          : ownRow;
        ordered.push(row, ...childRows);
      };
      (childrenByParent.get("") || []).forEach((task) => append(task, 0));
      ganttTasks.filter((task) => !visited.has(task.id)).forEach((task) => append(task, 0));
      return ordered;
    }
    const milestoneBase: GanttRow[] = selectedProject.milestones.map((item) => {
      const ranges = item.plannedRanges || [];
      return {
        id: `milestone:${item.id}`, kind: "milestone", title: item.title || "名称未設定", parentId: `project:${selectedProject.id}`, depth: 1, linkedTaskId: item.linkedTaskId,
        status: item.completed || item.status === "achieved" ? "achieved" : item.status || "not-started",
        baselineRanges: item.baselinePlannedRanges?.length ? item.baselinePlannedRanges : ranges, plannedRanges: ranges,
        actualStart: "", actualEnd: "", actualDates: [], achievedDates: [], plannedHours: plannedHours(ranges, 0), actualHours: 0, dueDate: item.dueDate || "",
      };
    });
    const validMilestoneIds = new Set(selectedProject.milestones.map((milestone) => milestone.id));
    const milestoneWorkItems = (selectedProject.workItems || []).filter((item) => Boolean(item.milestoneId) && validMilestoneIds.has(item.milestoneId));
    const workBase: GanttRow[] = milestoneWorkItems.map((item) => {
      const linked = ganttTasks.find((task) => task.id === item.linkedTaskId);
      // 作業項目と関連ChatTaskの予定は独立している。
      // 作業に予定がなければ、関連ChatTaskの予定線を代わりに描画しない。
      const ranges = item.plannedRanges || [];
      const actual = projectActualRange(linked, "project-work", item.id, ranges);
      return {
        id: `work:${item.id}`, kind: "work", title: item.title, parentId: item.milestoneId ? `milestone:${item.milestoneId}` : `project:${selectedProject.id}`, depth: item.milestoneId ? 2 : 1, linkedTaskId: item.linkedTaskId, status: item.status,
        priority: item.priority, baselineRanges: item.baselinePlannedRanges?.length ? item.baselinePlannedRanges : ranges, plannedRanges: ranges, actualStart: actual.start, actualEnd: actual.end, actualDates: actual.dates, achievedDates: projectAchievedDates(linked, "project-work", item.id, ranges),
        plannedHours: plannedHours(ranges, Number(item.plannedHours) || 0), actualHours: Number(item.actualHours) || actual.hours,
        dueDate: item.dueDate || "",
      };
    });
    const ordered: GanttRow[] = [];
    const rowStartDate = (row: GanttRow) => row.plannedRanges.map((range) => range.startDate).filter(Boolean).sort()[0] || "";
    const compareByStartDate = (a: GanttRow, b: GanttRow) => {
      const aStart = rowStartDate(a);
      const bStart = rowStartDate(b);
      if (aStart !== bStart) {
        if (!aStart) return 1;
        if (!bStart) return -1;
        return aStart.localeCompare(bStart);
      }
      return 0;
    };
    const milestoneRows = milestoneBase.map((milestone) => {
      const works = workBase.filter((work) => work.parentId === milestone.id).sort((a, b) => {
        const dateOrder = compareByStartDate(a, b);
        if (dateOrder) return dateOrder;
        const aw = selectedProject.workItems?.find((item) => `work:${item.id}` === a.id);
        const bw = selectedProject.workItems?.find((item) => `work:${item.id}` === b.id);
        return (aw?.sortOrder || 0) - (bw?.sortOrder || 0);
      });
      const aggregate = works.length
        ? aggregateRows(milestone.id, "milestone", milestone.title, milestone.status, 1, works, milestone.dueDate)
        : milestone;
      return { ...milestone, ...aggregate, hasChildren: works.length > 0, linkedTaskId: milestone.linkedTaskId, parentId: `project:${selectedProject.id}`, children: works };
    });
    const milestoneOrder = new Map(selectedProject.milestones.map((item, index) => [`milestone:${item.id}`, item.sortOrder ?? index]));
    const projectChildren = [...milestoneRows].sort((a, b) => {
      const dateOrder = compareByStartDate(a, b);
      if (dateOrder) return dateOrder;
      const aOrder = milestoneOrder.get(a.id);
      const bOrder = milestoneOrder.get(b.id);
      return (aOrder ?? 0) - (bOrder ?? 0);
    });
    projectChildren.forEach((item) => ordered.push(item, ...((item as GanttRow & { children?: GanttRow[] }).children || [])));
    const projectRow = aggregateRows(`project:${selectedProject.id}`, "project", selectedProject.title, selectedProject.status, 0, projectChildren, selectedProject.dueDate);
    return [projectRow, ...ordered];
  }, [selectedProject, tasks, projects]);

  const normalizedQuery = query.trim().toLocaleLowerCase("ja");
  const isInDisplayedPeriod = (row: GanttRow) => {
    const overlaps = (start: string, end: string) => Boolean(start && end && start <= period.end && end >= period.start);
    return row.baselineRanges.some((range) => overlaps(range.startDate, range.endDate))
      || row.plannedRanges.some((range) => overlaps(range.startDate, range.endDate))
      || overlaps(row.actualStart, row.actualEnd)
      || Boolean(row.dueDate && row.dueDate >= period.start && row.dueDate <= period.end);
  };
  const matchingIds = new Set(sourceRows.filter((row) => {
    // 親の集計期間は、離れた子予定の間まで連続した予定に見えてしまう。
    // 通常表示では親自身を期間判定せず、表示対象になった子からのみ親を表示する。
    if (row.hasChildren && !normalizedQuery && !showOutOfPeriod) return false;
    if (!row.plannedRanges.length && !row.actualStart && !row.dueDate) return false;
    if (!showOutOfPeriod && !isInDisplayedPeriod(row)) return false;
    if (!completed && statusFilter !== "done" && isCompletedStatus(row.status)) return false;
    if (!projectId && tag !== "all" && (tag === "none" ? row.tagId : row.tagId !== tag)) return false;
    if (statusFilter === "active" && !["doing", "in-progress"].includes(row.status)) return false;
    if (statusFilter === "waiting" && !WAITING_STATUSES.includes(row.status as TaskStatus)) return false;
    if (statusFilter === "done" && !isCompletedStatus(row.status)) return false;
    return !normalizedQuery || row.title.toLocaleLowerCase("ja").includes(normalizedQuery);
  }).map((row) => row.id));
  sourceRows.forEach((row) => {
    let parentId = row.parentId;
    if (!matchingIds.has(row.id)) return;
    while (parentId) {
      matchingIds.add(parentId);
      parentId = sourceRows.find((candidate) => candidate.id === parentId)?.parentId;
    }
  });
  const rows = sourceRows.filter((row) => {
    if (!matchingIds.has(row.id)) return false;
    let parentId = row.parentId;
    while (parentId) {
      if (collapsed.has(parentId) && !normalizedQuery) return false;
      parentId = sourceRows.find((candidate) => candidate.id === parentId)?.parentId;
    }
    return true;
  });
  const delayedCount = rows.filter((row) => row.dueDate && row.dueDate < today && !isCompletedStatus(row.status)).length;
  const navigationUnits = scale === "week"
    ? { small: "1日", large: "1週間" }
    : scale === "month"
      ? { small: "1日", large: "1か月" }
      : scale === "quarter"
        ? { small: "1か月", large: "3か月" }
        : scale === "half-year"
          ? { small: "1か月", large: "半年" }
          : { small: "1か月", large: "1年" };
  const periodPickerLabel = () => {
    if (scale === "week") return `${period.start.replace(/-/g, "/")}〜${period.end.slice(5).replace("-", "/")}`;
    if (scale === "month") return `${period.start.slice(0, 4)}年${Number(period.start.slice(5, 7))}月`;
    return `${period.start.slice(0, 7).replace("-", "/")}〜${period.end.slice(0, 7).replace("-", "/")}`;
  };
  const choosePeriodDate = (date: string) => {
    if (!date || scale === "project") return;
    setAnchor(scale === "week" ? weekStart(date) : scale === "year" ? yearStart(date) : monthStart(date));
  };
  const navigatePeriod = (direction: -1 | 1, amount: "small" | "large") => {
    if (scale === "project") return;
    if (scale === "week") return setAnchor(addDays(anchor, direction * (amount === "small" ? 1 : 7)));
    if (scale === "month" && amount === "small") return setAnchor(addDays(anchor, direction));
    const months = amount === "small" ? 1 : scale === "quarter" ? 3 : scale === "half-year" ? 6 : scale === "year" ? 12 : 1;
    setAnchor(scale === "month" || scale === "year" ? shiftDateMonths(anchor, direction * months) : shiftMonths(anchor, direction * months));
  };
  const timelineLabel = (date: string, index: number) => {
    const parsed = dateObject(date);
    const day = parsed.getDate();
    const month = parsed.getMonth() + 1;
    if (scale === "week") return `${month}/${day}`;
    if (scale === "month") return day === 1 ? `${month}/1` : String(day);
    if (day === 1) return `${month}月`;
    if (scale === "quarter" && parsed.getDay() === 1) return String(day);
    if (index === 0 || index === dates.length - 1) return `${month}/${day}`;
    return "";
  };

  const grid = () => <>{dates.map((date) => <span className={`${getNonWorkingPeriod(date, periods) ? "non-working-cell" : ""} ${date === today ? "is-today" : ""}`} style={{ width: cell }} key={date} />)}</>;
  const todayLineLeft = todayIndex >= 0
    ? `calc(clamp(280px, 30vw, 420px) + ${todayIndex * cell + cell / 2}px)`
    : undefined;
  const bar = (startDate: string, endDate: string, className: string, title: string) => {
    if (!startDate || !endDate) return null;
    const clippedStart = startDate < dates[0] ? dates[0] : startDate;
    const clippedEnd = endDate > dates[dates.length - 1] ? dates[dates.length - 1] : endDate;
    const visible = clippedStart <= clippedEnd ? rangeDates([{ id: "visible", startDate: clippedStart, endDate: clippedEnd }]) : [];
    if (!visible.length || !dates.includes(visible[0])) return null;
    return <i className={className} style={{ left: dates.indexOf(visible[0]) * cell, width: visible.length * cell }} title={title} />;
  };
  const exportTitle = selectedProject?.title || "ガントチャート";
  const exportFileStem = `${exportTitle}_${period.start}_${period.end}`.replace(/[\\/:*?"<>|]/g, "_");
  const saveBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchorElement = document.createElement("a");
    anchorElement.href = url;
    anchorElement.download = filename;
    document.body.appendChild(anchorElement);
    anchorElement.click();
    anchorElement.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };
  const exportSvg = () => {
    const nonWorkingDates = new Set(dates.filter((date) => getNonWorkingPeriod(date, periods, workingDateOverrides)));
    return createGanttSvg({
      title: selectedProject ? `${selectedProject.title}・ガントチャート` : "ガントチャート",
      start: period.start,
      end: period.end,
      dates,
      dateLabels: dates.map(timelineLabel),
      plannedEffort: dates.map((date) => plannedEffortByDate.get(date) || 0),
      nonWorkingDates,
      display,
      cellWidth: cell,
      rows: rows.map((row) => ({
        kind: row.kind,
        title: row.title,
        periodLabel: row.periodLabel,
        depth: row.depth,
        hasChildren: row.hasChildren,
        status: statusLabel(row.status),
        statusTone: taskTone(row.status),
        priority: row.priority,
        tagName: row.tagId ? tagById.get(row.tagId)?.name : undefined,
        baselineRanges: row.baselineRanges,
        plannedRanges: row.plannedRanges,
        actualDates: row.actualDates,
        achievedDates: row.achievedDates,
        plannedHours: row.plannedHours,
        actualHours: row.actualHours,
        dueDate: row.dueDate,
        delayed: Boolean(row.dueDate && row.dueDate < today && !isCompletedStatus(row.status)),
      })),
    });
  };
  const exportPng = () => {
    setExportMenuOpen(false);
    const svg = exportSvg();
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const maxWidth = 4_000;
      const ratio = Math.min(2, maxWidth / image.width);
      canvas.width = Math.round(image.width * ratio);
      canvas.height = Math.round(image.height * ratio);
      const context = canvas.getContext("2d");
      if (!context) return URL.revokeObjectURL(url);
      context.scale(ratio, ratio);
      context.drawImage(image, 0, 0);
      canvas.toBlob((blob) => { if (blob) saveBlob(blob, `${exportFileStem}.png`); }, "image/png");
      URL.revokeObjectURL(url);
    };
    image.src = url;
  };
  const exportPdf = () => {
    setExportMenuOpen(false);
    const image = new Image();
    const url = URL.createObjectURL(new Blob([exportSvg()], { type: "image/svg+xml;charset=utf-8" }));
    const cleanup = () => URL.revokeObjectURL(url);
    image.onerror = cleanup;
    image.onload = () => {
      const maxCanvasDimension = 6_000;
      const ratio = Math.min(2, maxCanvasDimension / image.width, maxCanvasDimension / image.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * ratio));
      canvas.height = Math.max(1, Math.round(image.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) return cleanup();
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(async (jpegBlob) => {
        if (jpegBlob) {
          const pdf = createImagePdf(await jpegBlob.arrayBuffer(), canvas.width, canvas.height);
          saveBlob(pdf, `${exportFileStem}.pdf`);
        }
        cleanup();
      }, "image/jpeg", 0.94);
    };
    image.src = url;
  };
  const exportExcel = () => {
    setExportMenuOpen(false);
    const headers = ["種別", "項目", "状態", "優先度", "予定開始", "予定終了", "作業日", "予定工数", "実績工数", "期限"];
    const table = rows.map((row) => {
      const starts = row.plannedRanges.map((range) => range.startDate).filter(Boolean).sort();
      const ends = row.plannedRanges.map((range) => range.endDate).filter(Boolean).sort();
      const workDates = [...new Set([...row.actualDates, ...row.achievedDates])].sort().join(", ");
      return [kindLabel(row.kind), row.title, statusLabel(row.status), row.priority || "", starts[0] || "", ends[ends.length - 1] || "", workDates, row.plannedHours, row.actualHours, row.dueDate];
    });
    const columnName = (index: number) => String.fromCharCode(65 + index);
    const sheetRows = [headers, ...table].map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => typeof value === "number"
      ? `<c r="${columnName(columnIndex)}${rowIndex + 1}"><v>${value}</v></c>`
      : `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`).join("")}</row>`).join("");
    const files = [
      { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>` },
      { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="ガントチャート" sheetId="1" r:id="rId1"/></sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
      { name: "xl/worksheets/sheet1.xml", content: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>` },
    ];
    saveBlob(zipFiles(files), `${exportFileStem}.xlsx`);
  };
  const exportGanttExcel = () => {
    setExportMenuOpen(false);
    const nonWorkingDates = new Set(dates.filter((date) => getNonWorkingPeriod(date, periods, workingDateOverrides)));
    const blob = createGanttExcel({
      title: exportTitle,
      start: period.start,
      end: period.end,
      dates,
      display,
      nonWorkingDates,
      today,
      rows: rows.map((row) => ({
        kind: kindLabel(row.kind),
        title: row.title,
        status: statusLabel(row.status),
        priority: row.priority || "",
        depth: row.depth,
        baselineRanges: row.baselineRanges,
        plannedRanges: row.plannedRanges,
        actualDates: row.actualDates,
        achievedDates: row.achievedDates,
        plannedHours: row.plannedHours,
        actualHours: row.actualHours,
        dueDate: row.dueDate,
      })),
    });
    saveBlob(blob, `${exportFileStem}_ガント.xlsx`);
  };
  const exportMarkdown = () => {
    setExportMenuOpen(false);
    const scaleLabels: Record<GanttScale, string> = {
      week: "週間",
      month: "月間",
      quarter: "3か月",
      "half-year": "半年",
      year: "年間",
      project: "プロジェクト全期間",
    };
    const displayLabels: Record<GanttDisplay, string> = {
      compare: "予定と実績を比較",
      planned: "予定のみ",
      actual: "実績のみ",
    };
    const escapeCell = (value: unknown) => String(value ?? "")
      .replace(/\r?\n/g, "<br>")
      .replace(/\|/g, "\\|");
    const rangeText = (ranges: PlannedRange[]) => ranges
      .map((range) => range.startDate === range.endDate ? range.startDate : `${range.startDate}〜${range.endDate}`)
      .join("<br>");
    const rowById = new Map(sourceRows.map((row) => [row.id, row]));
    const totalPlannedHours = rows.reduce((sum, row) => sum + row.plannedHours, 0);
    const totalActualHours = rows.reduce((sum, row) => sum + row.actualHours, 0);
    const generatedAt = new Intl.DateTimeFormat("ja-JP", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date());
    const tableHeader = "| No. | 階層 | 種別 | 親項目 | 項目 | 状態 | 優先度 | 当初予定 | 現在予定 | 作業日 | 期限 | 予定工数(h) | 実績工数(h) | 期限超過 |";
    const tableDivider = "| ---: | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | --- |";
    const tableRows = rows.map((row, index) => {
      const parent = row.parentId ? rowById.get(row.parentId) : undefined;
      const workDates = [...new Set([...row.actualDates, ...row.achievedDates])].sort().join("<br>");
      const delayed = Boolean(row.dueDate && row.dueDate < today && !isCompletedStatus(row.status));
      return `| ${index + 1} | ${row.depth + 1} | ${escapeCell(kindLabel(row.kind))} | ${escapeCell(parent?.title || "-")} | ${escapeCell(row.title)} | ${escapeCell(statusLabel(row.status))} | ${escapeCell(row.priority || "-")} | ${escapeCell(rangeText(row.baselineRanges) || "-")} | ${escapeCell(rangeText(row.plannedRanges) || "-")} | ${escapeCell(workDates || "-")} | ${escapeCell(row.dueDate || "-")} | ${hours(row.plannedHours)} | ${hours(row.actualHours)} | ${delayed ? "はい" : "-"} |`;
    });
    const markdown = [
      `# ${exportTitle}：ガントチャート確認`,
      "",
      "## AIへの確認依頼",
      "",
      "以下のスケジュールを確認し、重要度を「高・中・低」で分けて問題点と改善案を示してください。",
      "",
      "1. 期限超過、期限直前の作業集中、工数の偏り",
      "2. 親子関係やマイルストーンの順序に対する予定の前後関係",
      "3. 同時期に集中している予定と、無理のある並行作業",
      "4. 当初予定と現在予定の差、および作業実績がない予定",
      "5. 工数・期限・依存関係が未設定で判断できない項目",
      "",
      "## 出力条件",
      "",
      `- 対象: ${selectedProject?.title || "全タスク・プロジェクト"}`,
      `- 表示期間: ${period.start}〜${period.end}`,
      `- 表示単位: ${scaleLabels[scale]}`,
      `- 表示内容: ${displayLabels[display]}`,
      `- 表示件数: ${rows.length}件`,
      `- 出力日時: ${generatedAt}`,
      "- 備考: 現在の検索・案件タグ・状態・完了表示などの絞り込み結果のみを出力しています。",
      "",
      "## サマリー",
      "",
      `- 予定工数合計: ${hours(totalPlannedHours)}h`,
      `- 実績工数合計: ${hours(totalActualHours)}h`,
      `- 期限超過: ${delayedCount}件`,
      "",
      "## スケジュール一覧",
      "",
      tableHeader,
      tableDivider,
      ...tableRows,
      "",
      "## 補足",
      "",
      "- 「現在予定」は複数の期間がある場合、期間ごとに分けて記載しています。",
      "- 「作業日」は実績工数がある日、または日別に作業達成を記録した日です。",
      "- 親項目の工数には配下項目の集計が含まれる場合があるため、単純加算時の二重計上に注意してください。",
      "",
    ].join("\n");
    saveBlob(new Blob(["\uFEFF", markdown], { type: "text/markdown;charset=utf-8" }), `${exportFileStem}.md`);
  };

  return <Modal title={selectedProject ? `${selectedProject.title}・ガントチャート` : "ガントチャート"} onClose={onClose} wide>
    <div className={`gantt-controls ${projectPickerOpen ? "project-picker-active" : ""}`}>
      <div className="gantt-filter-row">
      <select aria-label="表示期間" value={scale} onChange={(event) => { const value = event.target.value as GanttScale; setScale(value); setAnchor(value === "week" ? weekStart(anchor) : value === "year" ? yearStart(anchor) : monthStart(anchor)); localStorage.setItem("chatTaskGanttScale", value); }}>
        <option value="week">週（月〜日）</option>
        <option value="month">月</option>
        <option value="quarter">3ヶ月</option>
        <option value="half-year">半年</option>
        <option value="year">1年</option>
        <option value="project" disabled={!selectedProject}>プロジェクト全期間</option>
      </select>
      <select aria-label="表示内容" value={display} onChange={(event) => setDisplay(event.target.value as GanttDisplay)}><option value="compare">予定と実績を比較</option><option value="planned">予定のみ</option><option value="actual">実績のみ</option></select>
      {!!projects.length && <div className="gantt-project-picker">
        <button type="button" className={`gantt-project-trigger ${selectedProject ? "selected" : ""}`} aria-expanded={projectPickerOpen} onClick={() => { setProjectSearch(""); setProjectPickerOpen((open) => !open); }}>
          <span className="gantt-project-trigger-icon" aria-hidden="true">{selectedProject ? "P" : "⌕"}</span>
          <span>{selectedProject?.title || "プロジェクトを選択"}</span>
          <small aria-hidden="true">⌄</small>
        </button>
        {selectedProject && <button type="button" className="gantt-project-clear" aria-label="全体表示に戻す" title="全体表示に戻す" onClick={() => chooseProject("")}>×</button>}
        {projectPickerOpen && <div className="gantt-project-results" onMouseDown={(event) => event.preventDefault()}>
          <div className="gantt-project-results-search"><span aria-hidden="true">⌕</span><input autoFocus aria-label="プロジェクトを検索" value={projectSearch} placeholder="プロジェクト名・状態・予定開始日で検索" onChange={(event) => setProjectSearch(event.target.value)} /></div>
          <button type="button" className={`gantt-project-result all ${!projectId ? "selected" : ""}`} onClick={() => chooseProject("")}><span><b>全体を表示</b><small>すべてのTaskとプロジェクト</small></span></button>
          {!projectSearch && recentProjectIds.some((id) => projects.some((project) => project.id === id)) && <p className="gantt-project-results-heading">最近表示したプロジェクト</p>}
          {projectCandidates.map((project) => <button type="button" className={`gantt-project-result ${project.id === projectId ? "selected" : ""}`} key={project.id} onClick={() => chooseProject(project.id)}>
            <span><b>{project.title}</b><small>{statusLabel(project.status)}{projectStartDate(project) ? `・予定開始 ${projectStartDate(project)}` : "・予定開始未設定"}</small></span>
            <em>{project.milestones.length}件</em>
          </button>)}
          {!projectCandidates.length && <p>一致するプロジェクトはありません</p>}
        </div>}
      </div>}
      {!projectId && <select aria-label="案件タグ" value={tag} onChange={(event) => setTag(event.target.value)}><option value="all">すべてのタグ</option><option value="none">タグなし</option>{tags.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>}
      <select aria-label="状態" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as GanttStatusFilter)}><option value="all">すべての状態</option><option value="active">進行中</option><option value="waiting">待ち</option><option value="done">完了</option></select>
      <input className="gantt-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="項目を検索" />
      <label><input type="checkbox" checked={completed} onChange={(event) => setCompleted(event.target.checked)} />完了も表示</label>
      <label title="選択中の週・月などに予定、実績、期限がない項目も表示します"><input type="checkbox" checked={showOutOfPeriod} onChange={(event) => {
        const checked = event.target.checked;
        setShowOutOfPeriod(checked);
        localStorage.setItem("chatTaskGanttShowOutOfPeriod", String(checked));
      }} />期間外も表示</label>
      </div>
      <div className="gantt-action-row">
        <div className="gantt-tree-actions">
          {sourceRows.some((row) => row.hasChildren) && <><button type="button" onClick={() => setCollapsed(new Set())}>すべて展開</button><button type="button" onClick={() => setCollapsed(new Set(sourceRows.filter((row) => row.hasChildren).map((row) => row.id)))}>すべて折りたたむ</button></>}
        </div>
        <div className="gantt-navigation">
          <button disabled={scale === "project"} onClick={() => navigatePeriod(-1, "large")} aria-label={`${navigationUnits.large}前へ`}>← {navigationUnits.large}</button>
          <button disabled={scale === "project"} onClick={() => navigatePeriod(-1, "small")} aria-label={`${navigationUnits.small}前へ`}>← {navigationUnits.small}</button>
          {scale === "project"
            ? <strong className="gantt-period-label" aria-label="表示期間">{ganttPeriodLabel(period.start, period.end)}</strong>
            : <WorkDatePicker className="gantt-period-jump" ariaLabel={`${navigationUnits.large}の表示開始を選択`} value={anchor} onChange={choosePeriodDate} allowClear={false} formatValue={periodPickerLabel} showNonWorkingStatus={false} pickerMode={scale === "week" ? "day" : scale === "year" ? "year" : "month"} />}
          <button disabled={scale === "project"} onClick={() => setAnchor(scale === "week" ? weekStart(today) : scale === "year" ? yearStart(today) : monthStart(today))}>今日</button>
          <button disabled={scale === "project"} onClick={() => navigatePeriod(1, "small")} aria-label={`${navigationUnits.small}後へ`}>{navigationUnits.small} →</button>
          <button disabled={scale === "project"} onClick={() => navigatePeriod(1, "large")} aria-label={`${navigationUnits.large}後へ`}>{navigationUnits.large} →</button>
        </div>
        <div className="gantt-export" ref={exportMenuRef}>
          <button type="button" aria-haspopup="menu" aria-expanded={exportMenuOpen} onClick={() => setExportMenuOpen((open) => !open)}>ファイル出力 ▾</button>
          {exportMenuOpen && <div className="gantt-export-menu" role="menu"><button type="button" role="menuitem" onClick={exportMarkdown}><strong>Markdown</strong><small>AI確認用に予定・実績・期限を構造化して保存</small></button><button type="button" role="menuitem" onClick={exportPdf}><strong>PDF</strong><small>表示中の期間を横向きで印刷・保存</small></button><button type="button" role="menuitem" onClick={exportExcel}><strong>Excel（一覧）</strong><small>タスク・予定・工数を表形式で保存</small></button><button type="button" role="menuitem" onClick={exportGanttExcel}><strong>Excel（ガント）</strong><small>日付列へ予定・実績を色付きバーで表示</small></button><button type="button" role="menuitem" onClick={exportPng}><strong>PNG</strong><small>ガントチャートを画像として保存</small></button></div>}
        </div>
      </div>
    </div>
    <div className="gantt-overview"><span><b>{rows.length}</b>件を表示</span>{delayedCount > 0 && <span className="is-delayed"><b>{delayedCount}</b>件の期限超過</span>}<div className="gantt-capacity-legend" title="日付ヘッダー下段は、その日の未完了予定工数です"><b>日別工数</b><i className="light" />〜4h<i className="normal" />〜6h<i className="busy" />〜8h<i className="over" />8h超</div><div className="gantt-legend"><i className="summary" />親の集約期間<i className="baseline" />当初予定<i className="planned" />作業予定<i className="actual" />作業あり<i className="deadline" />期限</div></div>
    <div className={`gantt-scroll gantt-scale-${scale} ${cell < 28 ? "gantt-capacity-compact" : ""} gantt-display-${display} ${sourceRows.some((row) => row.baselineRanges.length) ? "gantt-has-baseline" : ""}`} onScroll={() => { if (projectPickerOpen) setProjectPickerOpen(false); }}>
      <div className="gantt-content">
      <div className="gantt-header"><div className="gantt-task-label gantt-label-heading"><strong>項目</strong><small>予定／実績・期限</small></div><div className="gantt-timeline" style={{ width: dates.length * cell }}>{dates.map((date, index) => {
        const label = timelineLabel(date, index);
        const effort = plannedEffortByDate.get(date) || 0;
        const effortTone = effort > 8 ? "over" : effort > 6 ? "busy" : effort > 4 ? "normal" : effort > 0 ? "light" : "empty";
        return <span className={`${date === today ? "is-today" : ""} ${label ? "has-label" : ""} gantt-capacity-${effortTone}`} style={{ width: cell }} key={date} title={`${date}・予定工数 ${hours(effort)}h`}><>{label && <b className="gantt-date-label">{label}</b>}</><small className="gantt-capacity-value">{effort > 0 ? `${hours(effort)}h` : ""}</small></span>;
      })}</div></div>
      {rows.map((row) => {
        const tone = taskTone(row.status);
        // 工数の有無ではなく、その日に作業したかを同じ緑線で表す。
        // dailyPlanCompleted は日別・予定別の達成だけなので、親タスクの完了は混入しない。
        const actualRanges = contiguousDateRanges([...row.actualDates, ...row.achievedDates]);
        const delayed = Boolean(row.dueDate && row.dueDate < today && !isCompletedStatus(row.status));
        const tagItem = row.tagId ? tagById.get(row.tagId) : undefined;
        const dueIndex = row.dueDate ? dates.indexOf(row.dueDate) : -1;
        return <div className={`gantt-row gantt-row-${row.kind} ${row.hasChildren ? "gantt-row-summary" : "gantt-row-leaf"} ${row.kind === "schedule" ? "gantt-row-work" : ""} ${row.kind === "task" && row.depth === 0 ? "gantt-row-task-root" : ""} ${delayed ? "is-delayed" : ""}`} key={row.id}>
          <div className="gantt-task-label" style={{ paddingLeft: `${.55 + row.depth * 1.05}rem` }}>
            <strong title={row.title}>
              {row.hasChildren
                ? <button type="button" className="gantt-tree-toggle" aria-label={collapsed.has(row.id) ? `${row.title}を展開` : `${row.title}を折りたたむ`} onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; })}>{collapsed.has(row.id) ? "▶" : "▼"}</button>
                : <i className="gantt-tree-leaf" />}
              <em className={`gantt-kind ${row.kind}`} aria-label={kindLabel(row.kind)} title={kindLabel(row.kind)}><span aria-hidden="true">{kindIcon(row.kind)}</span></em>
              {row.linkedTaskId ? <button type="button" className="gantt-title-link" onClick={() => onSelect(row.linkedTaskId!)}>{row.title}</button> : row.title}
            </strong>
            {row.kind === "schedule"
              ? <span className="gantt-schedule-meta"><small className="gantt-schedule-period">{row.periodLabel}</small>{row.description && <small className="gantt-schedule-description" title={row.description}>{row.description}</small>}<small className={`gantt-status ${tone}`}>{delayed ? "遅延" : statusLabel(row.status)}</small><small className="gantt-effort">予定 {hours(row.plannedHours)}h／実績 {hours(row.actualHours)}h</small></span>
              : <span>{row.hasChildren && <small className="gantt-summary-badge">集約</small>}{tagItem && <em className="gantt-project-tag">{tagItem.name}</em>}<small className={`gantt-status ${tone}`} title={row.description || statusLabel(row.status)}>{statusLabel(row.status)}</small>{row.priority && <small className={`priority priority-${row.priority}`}>{row.priority}</small>}<small>予定 {hours(row.plannedHours)}h / 実績 {hours(row.actualHours)}h</small>{row.dueDate && <small className={delayed ? "gantt-delay-label" : ""}>期限 {row.dueDate}</small>}</span>}
          </div>
          <div className="gantt-timeline gantt-comparison-timeline" style={{ width: dates.length * cell }}>{grid()}
            {display === "compare" && row.baselineRanges.map((range) => bar(range.startDate, range.endDate, "gantt-bar gantt-baseline-bar", `当初予定 ${range.startDate}〜${range.endDate}`))}
            {display !== "actual" && row.plannedRanges.map((range) => bar(range.startDate, range.endDate, `gantt-bar gantt-planned-bar status-${tone}`, `予定 ${range.startDate}〜${range.endDate}`))}
            {display !== "planned" && actualRanges.map((range) => bar(range.start, range.end, "gantt-bar gantt-actual-bar", `作業あり ${range.start}${range.end !== range.start ? `〜${range.end}` : ""}`))}
            {dueIndex >= 0 && <i className={`gantt-deadline-marker ${delayed ? "is-overdue" : ""}`} style={{ left: dueIndex * cell + cell / 2 }} title={`期限 ${row.dueDate}`} />}
          </div>
        </div>;
      })}
      {!rows.length && <div className="empty-list">条件に一致する項目はありません</div>}
      {!!rows.length && <div className="gantt-scroll-end" aria-hidden="true" />}
      {todayLineLeft && <i className="gantt-today-overlay" style={{ left: todayLineLeft }} aria-hidden="true" />}
      </div>
    </div>
  </Modal>;
}
