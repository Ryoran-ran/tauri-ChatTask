import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./App.css";
import { STATUS_LABELS, WAITING_STATUSES, isTerminalStatus } from "./data/constants";
import { DocumentsModal } from "./components/DocumentsModal";
import { DataManagementModal } from "./components/DataManagementModal";
import { GanttModal } from "./components/GanttModal";
import { WeeklyLoadModal } from "./components/WeeklyLoadModal";
import { Header } from "./components/Header";
import { HelpModal } from "./components/HelpModal";
import { NonWorkingModal } from "./components/NonWorkingModal";
import { ReportModal } from "./components/ReportModal";
import { ProfileModal } from "./components/ProfileModal";
import { ProjectsModal } from "./components/GoalsModal";
import { Sidebar } from "./components/Sidebar";
import { TagSettingsModal } from "./components/TagSettingsModal";
import { TaskDetail } from "./components/TaskDetail";
import { TaskCreateModal } from "./components/TaskCreateModal";
import { TaskTemplateSaveModal } from "./components/TaskTemplateSaveModal";
import { TaskTemplateManagerModal } from "./components/TaskTemplateManagerModal";
import { TodayModal } from "./components/TodayModal";
import { IssuesModal } from "./components/IssuesModal";
import { CommandPalette } from "./components/CommandPalette";
import { ActiveTimerBar, TimerFinishDialog, type TimerSession } from "./components/TaskTimer";
import { buildNotifications, NotificationsModal } from "./components/NotificationsModal";
import { FullTextSearchModal, type FullTextSearchResult } from "./components/FullTextSearchModal";
import { NonWorkingPeriodsProvider } from "./components/WorkDatePicker";
import { AchievementsModal } from "./components/AchievementsModal";
import { AdvancedFilterModal } from "./components/AdvancedFilterModal";
import { InboxModal } from "./components/InboxModal";
import { WaitingBoxModal } from "./components/WaitingBoxModal";
import { ToolsModal } from "./components/ToolsModal";
import { Modal } from "./components/Modal";
import { CodeReviewWindow } from "./components/CodeReviewWindow";
import { classifyLegacyStatus, getActiveEnvironment, initializeAppStorage, loadAppData, parseImportedData, saveAppData, saveLocalToolsMirror, setActiveEnvironment, type AppEnvironment, type StorageBackend } from "./services/storage";
import { removeTaskAttachments } from "./services/attachments";
import { taskProjectContexts } from "./projectContext";
import type { AdvancedTaskFilter, AppData, Goal, GoalStatus, InboxItem, Priority, RecurrenceRecord, SavedTaskView, Task, TaskFilter, TaskSortRule, TaskStatus, TaskTemplate } from "./types";
import { addDays, generateId, hasIncompletePlanForDate, isRecurringDue, isTaskPlannedForDate, mergeRanges, removeDateFromRanges, todayValue } from "./utils";
import { appendHistory, createTask, jumpToTaskMatch, repairDuplicateProjectSchedules } from "./appHelpers";

function App() {
  const [environment] = useState<AppEnvironment>(() => getActiveEnvironment());
  const [data, setData] = useState<AppData>(() => repairDuplicateProjectSchedules(loadAppData(environment)));
  const templateStorageKey = `chatTaskTemplates:${environment}`;
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>(() => {
    try { const stored = JSON.parse(localStorage.getItem(`chatTaskTemplates:${environment}`) || "[]"); return Array.isArray(stored) ? stored : []; } catch { return []; }
  });
  useEffect(() => { localStorage.setItem(templateStorageKey, JSON.stringify(taskTemplates)); }, [taskTemplates, templateStorageKey]);
  const [storageBackend, setStorageBackend] = useState<StorageBackend | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    const openTask = (event: Event) => { const id = (event as CustomEvent<{ id: string }>).detail?.id; if (id) setSelectedId(id); };
    window.addEventListener("chattask-open-task", openTask);
    return () => window.removeEventListener("chattask-open-task", openTask);
  }, []);
  const [creatingTaskParentId, setCreatingTaskParentId] = useState<string | null>(null);
  const [templateSourceTask, setTemplateSourceTask] = useState<Task | null>(null);
  const [creatingTaskTagId, setCreatingTaskTagId] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<"all" | Priority>("all");
  const [advancedFilterOpen, setAdvancedFilterOpen] = useState(false);
  const [advancedFilter, setAdvancedFilter] = useState<AdvancedTaskFilter>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("chatTaskAdvancedFilter") || "null") as AdvancedTaskFilter | null;
      if (stored && (stored.mode === "and" || stored.mode === "or") && Array.isArray(stored.conditions)) return stored;
    } catch { /* use an empty condition set */ }
    return { mode: "and", conditions: [] };
  });
  const [sortRules, setSortRules] = useState<TaskSortRule[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("chatTaskSortRules") || "[]") as TaskSortRule[];
      if (stored.length) return stored;
    } catch { /* use defaults */ }
    return [
      { id: "sort-priority", key: "priority", direction: "asc" },
      { id: "sort-today", key: "today", direction: "desc" },
      { id: "sort-due", key: "dueDate", direction: "asc" },
      { id: "sort-updated", key: "updatedAt", direction: "desc" },
    ];
  });
  const [filtersHidden, setFiltersHidden] = useState(() => localStorage.getItem("chatTaskSearchFiltersHidden") === "true");
  const [detailsHidden, setDetailsHidden] = useState(true);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem("chatTaskCollapsedIds") || "[]")));
  const [todayOpen, setTodayOpen] = useState(false);
  const [currentDate, setCurrentDate] = useState(todayValue());
  const [todayDate, setTodayDate] = useState(todayValue());
  const [tagsOpen, setTagsOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState<"task" | "parent" | "project" | "tag" | null>(null);
  const [codeReviewTaskId, setCodeReviewTaskId] = useState("");
  const [nonWorkingOpen, setNonWorkingOpen] = useState(false);
  const [ganttOpen, setGanttOpen] = useState(false);
  const [weeklyLoadOpen, setWeeklyLoadOpen] = useState(false);
  const [ganttProjectId, setGanttProjectId] = useState("");
  const [ganttReturnProjectId, setGanttReturnProjectId] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [projectFocusId, setProjectFocusId] = useState("");
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [dataManagementOpen, setDataManagementOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [hideRecurring, setHideRecurring] = useState(() => localStorage.getItem("chatTaskRecurringTasksHidden") === "true");
  const [openTodayOnStartup, setOpenTodayOnStartup] = useState(() => localStorage.getItem("chatTaskOpenTodayOnStartup") === "true");
  const [narrow, setNarrow] = useState(() => localStorage.getItem("chatTaskListNarrow") === "true");
  const [density, setDensity] = useState<"standard" | "compact" | "minimal">(() => { const value = localStorage.getItem("chatTaskCardsCompact"); return value === "standard" || value === "minimal" ? value : "compact"; });
  const [groupTasksByTag, setGroupTasksByTag] = useState(() => localStorage.getItem("chatTaskGroupTasksByTag") !== "false");
  const [dropNotice, setDropNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [commandPalette, setCommandPalette] = useState<{ taskId?: string; position?: { x: number; y: number } } | null>(null);
  const [workTimer, setWorkTimer] = useState<TimerSession | null>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("chatTaskWorkTimer") || "null") as TimerSession | null;
      return stored?.taskId && stored.durationMinutes > 0 ? stored : null;
    } catch { return null; }
  });
  const [timerFinishOpen, setTimerFinishOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [fullSearchOpen, setFullSearchOpen] = useState(false);
  const [achievementsOpen, setAchievementsOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxItemId, setInboxItemId] = useState("");
  const [waitingOpen, setWaitingOpen] = useState(false);
  const [waitingTaskId, setWaitingTaskId] = useState("");
  const [documentJump, setDocumentJump] = useState<{ scope: "task" | "project" | "tag"; ownerId: string; documentId: string; query: string } | null>(null);
  const [savedViews, setSavedViews] = useState<SavedTaskView[]>(() => {
    try { return JSON.parse(localStorage.getItem("chatTaskSavedViews") || "[]") as SavedTaskView[]; }
    catch { return []; }
  });
  useEffect(() => {
    localStorage.setItem("chatTaskAdvancedFilter", JSON.stringify(advancedFilter));
    document.documentElement.dataset.advancedFilterActive = String(advancedFilter.conditions.length > 0);
  }, [advancedFilter]);
  useEffect(() => {
    const openAdvancedFilter = () => setAdvancedFilterOpen(true);
    window.addEventListener("chattask-open-advanced-filter", openAdvancedFilter);
    return () => window.removeEventListener("chattask-open-advanced-filter", openAdvancedFilter);
  }, []);
  const importRef = useRef<HTMLInputElement>(null);
  const dropNoticeTimer = useRef<number | null>(null);

  useEffect(() => {
    const openWaiting = (event: Event) => {
      setWaitingTaskId((event as CustomEvent<{ taskId?: string }>).detail?.taskId || "");
      setWaitingOpen(true);
    };
    window.addEventListener("chattask-open-waiting", openWaiting);
    return () => window.removeEventListener("chattask-open-waiting", openWaiting);
  }, []);
  const selectedTask = data.tasks.find((task) => task.id === selectedId) || null;
  const codeReviewTask = data.tasks.find((task) => task.id === codeReviewTaskId) || null;
  const codeReviewRepositories = codeReviewTask
    ? data.projectTags.find((tag) => tag.id === codeReviewTask.projectTagId)?.githubRepositories || []
    : [];
  useEffect(() => {
    if (selectedId) setDetailsHidden(true);
  }, [selectedId]);
  const notificationCount = useMemo(() => buildNotifications(data.tasks).length, [data.tasks]);
  const selectedProject = selectedTask ? data.goals.find((project) => project.id === taskProjectContexts(data.goals, selectedTask.id)[0]?.projectId) : undefined;
  const selectedTag = selectedTask ? data.projectTags.find((tag) => tag.id === selectedTask.projectTagId) : undefined;
  const documentParentTask = selectedTask?.parentTaskId ? data.tasks.find((task) => task.id === selectedTask.parentTaskId) : undefined;
  const documentProject = documentJump?.scope === "project" ? data.goals.find((project) => project.id === documentJump.ownerId) : selectedProject;
  const documentTag = documentJump?.scope === "tag" ? data.projectTags.find((tag) => tag.id === documentJump.ownerId) : selectedTag;
  const documentScopeOptions = (active: "task" | "parent" | "project" | "tag") => selectedTask ? [
    { id: "task", icon: "T", label: "タスク専用", count: selectedTask.documents.length, active: active === "task", onOpen: () => setDocumentsOpen("task") },
    ...(documentParentTask ? [{ id: `parent:${documentParentTask.id}`, icon: "親", label: `親Task：${documentParentTask.title || "無題のタスク"}`, count: documentParentTask.documents.length, active: active === "parent", onOpen: () => setDocumentsOpen("parent") }] : []),
    ...((active === "project" ? documentProject : selectedProject) ? [{ id: "project", icon: "P", label: `プロジェクト共有：${(active === "project" ? documentProject : selectedProject)!.title}`, count: (active === "project" ? documentProject : selectedProject)!.sharedDocuments?.length || 0, active: active === "project", onOpen: () => setDocumentsOpen("project") }] : []),
    ...(selectedTag ? [{ id: "tag", icon: "#", label: `案件タグ共有：${selectedTag.name}`, count: selectedTag.sharedDocuments?.length || 0, active: active === "tag", onOpen: () => setDocumentsOpen("tag") }] : []),
  ] : [];
  useEffect(() => {
    setData((current) => ({
      ...current,
      goals: current.goals.map((project) => project.sharedDocuments === undefined
        ? { ...project, sharedDocuments: current.projectTags.find((tag) => tag.id === project.projectTagId)?.sharedDocuments || [] }
        : project),
    }));
  }, []);
  const openProjects = (projectId = "") => { setProjectFocusId(projectId); setGoalsOpen(true); };
  const saveProjects = (goals: Goal[]) => setData((current) => repairDuplicateProjectSchedules({
    ...current,
    goals,
    tasks: current.tasks.map((task) => ({
      ...task,
      plannedRanges: task.plannedRanges.map((range) => {
        if (range.sourceType !== "project-milestone" || !range.sourceId) return range;
        const migratedWork = goals.flatMap((goal) => goal.workItems || []).find((work) =>
          work.linkedTaskId === task.id && work.plannedRanges?.some((workRange) => workRange.id === range.id));
        return migratedWork ? { ...range, sourceType: "project-work" as const, sourceId: migratedWork.id } : range;
      }),
    })),
  }));
  const projectStatusFromTask = (status: TaskStatus): GoalStatus => {
    switch (status) {
      case "doing":
      case "waiting-general":
      case "waiting-client":
      case "waiting-team":
      case "waiting-pr":
      case "recurring":
        return "in-progress";
      case "pending":
        return "paused";
      case "done":
        return "achieved";
      case "cancelled":
        return "cancelled";
      case "handed-over":
        return "archived";
      case "todo":
      default:
        return "not-started";
    }
  };
  const promoteTaskToProject = (task: Task) => {
    const existing = data.goals.find((item) => item.originTaskId === task.id);
    if (existing) return openProjects(existing.id);
    const now = new Date().toISOString();
    const project: Goal = {
      id: generateId(), title: task.title, description: task.description, successCriteria: "",
      dueDate: task.dueDate || task.reminderDate, status: projectStatusFromTask(task.status), projectTagId: task.projectTagId,
      taskIds: [task.id], milestones: [], reviews: [], originTaskId: task.id,
      priority: task.priority, workItems: [], createdAt: now, updatedAt: now,
    };
    setData((current) => ({
      ...current,
      goals: [project, ...current.goals],
    }));
    openProjects(project.id);
  };

  useEffect(() => {
    let active = true;
    const legacyData = data;
    void initializeAppStorage(legacyData, environment)
      .then((result) => {
        if (!active) return;
        setData(repairDuplicateProjectSchedules(result.data));
        setStorageBackend(result.backend);
      })
      .catch((error) => {
        console.error("SQLiteの初期化に失敗したため、localStorageを使用します。", error);
        if (active) setStorageBackend("localStorage");
      });
    return () => { active = false; };
  }, [environment]);
  useEffect(() => {
    if (!storageBackend) return;
    const timer = window.setTimeout(() => {
      void saveAppData(data, storageBackend, environment).catch((error) => {
        console.error("アプリデータの保存に失敗しました。", error);
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [data, storageBackend, environment]);
  const updateLocalTools = (localTools: AppData["localTools"]) => setData((current) => {
    const next = { ...current, localTools };
    saveLocalToolsMirror(next, environment);
    return next;
  });
  const updateLocalToolsStoragePath = (localToolsStoragePath: string) => setData((current) => {
    const next = { ...current, localToolsStoragePath };
    saveLocalToolsMirror(next, environment);
    return next;
  });
  useEffect(() => localStorage.setItem("chatTaskCurrentFilter", filter), [filter]);
  useEffect(() => localStorage.setItem("chatTaskCurrentTagFilter", tagFilter), [tagFilter]);
  useEffect(() => localStorage.setItem("chatTaskCurrentPriorityFilter", priorityFilter), [priorityFilter]);
  useEffect(() => localStorage.setItem("chatTaskSortRules", JSON.stringify(sortRules)), [sortRules]);
  useEffect(() => localStorage.setItem("chatTaskSavedViews", JSON.stringify(savedViews)), [savedViews]);
  useEffect(() => localStorage.setItem("chatTaskSearchFiltersHidden", String(filtersHidden)), [filtersHidden]);
  useEffect(() => localStorage.setItem("chatTaskDetailsHidden", String(detailsHidden)), [detailsHidden]);
  useEffect(() => localStorage.setItem("chatTaskCollapsedIds", JSON.stringify([...collapsedIds])), [collapsedIds]);
  useEffect(() => localStorage.setItem("chatTaskRecurringTasksHidden", String(hideRecurring)), [hideRecurring]);
  useEffect(() => localStorage.setItem("chatTaskOpenTodayOnStartup", String(openTodayOnStartup)), [openTodayOnStartup]);
  useEffect(() => localStorage.setItem("chatTaskListNarrow", String(narrow)), [narrow]);
  useEffect(() => localStorage.setItem("chatTaskCardsCompact", density), [density]);
  useEffect(() => localStorage.setItem("chatTaskGroupTasksByTag", String(groupTasksByTag)), [groupTasksByTag]);
  useEffect(() => {
    const refreshCurrentDate = () => {
      const nextDate = todayValue();
      setCurrentDate((previousDate) => previousDate === nextDate ? previousDate : nextDate);
    };
    const interval = window.setInterval(refreshCurrentDate, 60_000);
    window.addEventListener("focus", refreshCurrentDate);
    document.addEventListener("visibilitychange", refreshCurrentDate);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshCurrentDate);
      document.removeEventListener("visibilitychange", refreshCurrentDate);
    };
  }, []);
  useEffect(() => {
    if (workTimer) localStorage.setItem("chatTaskWorkTimer", JSON.stringify(workTimer));
    else localStorage.removeItem("chatTaskWorkTimer");
  }, [workTimer]);
  useEffect(() => { if (openTodayOnStartup) setTodayOpen(true); }, []);
  useEffect(() => {
    const openFromKeyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPalette({ taskId: selectedId || undefined });
      } else if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFullSearchOpen(true);
      } else if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "n") {
        const target = event.target as HTMLElement | null;
        if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
        event.preventDefault();
        setCreatingTaskTagId(undefined);
        setCreatingTaskParentId("");
      }
    };
    const openFromContextMenu = (event: MouseEvent) => {
      const element = event.target as HTMLElement | null;
      if (!element || element.closest("input, textarea, [contenteditable='true'], a")) return;
      event.preventDefault();
      const taskId = element.closest<HTMLElement>("[data-task-id]")?.dataset.taskId || selectedId || undefined;
      setCommandPalette({ taskId, position: { x: event.clientX, y: event.clientY } });
    };
    window.addEventListener("keydown", openFromKeyboard);
    window.addEventListener("contextmenu", openFromContextMenu);
    return () => {
      window.removeEventListener("keydown", openFromKeyboard);
      window.removeEventListener("contextmenu", openFromContextMenu);
    };
  }, [selectedId]);
  useEffect(() => {
    const openExternal = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest<HTMLAnchorElement>("a[href^='http']"); if (!anchor) return;
      event.preventDefault();
      if ("__TAURI_INTERNALS__" in window) void openUrl(anchor.href); else window.open(anchor.href, "_blank", "noopener,noreferrer");
    };
    document.addEventListener("click", openExternal); return () => document.removeEventListener("click", openExternal);
  }, []);
  useEffect(() => {
    const showNotice = (text: string, error = false) => {
      if (dropNoticeTimer.current !== null) window.clearTimeout(dropNoticeTimer.current);
      setDropNotice({ text, error });
      dropNoticeTimer.current = window.setTimeout(() => setDropNotice(null), 3200);
    };
    const preventFileNavigation = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    const handleGlobalDrop = (event: globalThis.DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      event.stopPropagation();
      const files = Array.from(event.dataTransfer.files);
      if (!files.length) return showNotice("ドロップされたファイルを読み取れませんでした。", true);
      if (!selectedTask) return showNotice("ファイルを登録するには、先にタスクを開いてください。", true);
      window.dispatchEvent(new CustomEvent("chattask-global-files-dropped", { detail: { taskId: selectedTask.id, files } }));
    };
    const handleDropNotice = (event: Event) => {
      const detail = (event as CustomEvent<{ text: string; error?: boolean }>).detail;
      if (detail?.text) showNotice(detail.text, Boolean(detail.error));
    };
    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", handleGlobalDrop);
    window.addEventListener("chattask-drop-notice", handleDropNotice);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", handleGlobalDrop);
      window.removeEventListener("chattask-drop-notice", handleDropNotice);
    };
  }, [selectedTask?.id]);
  useEffect(() => () => {
    if (dropNoticeTimer.current !== null) window.clearTimeout(dropNoticeTimer.current);
  }, []);

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    const completedProjectWorkIds = new Set(data.goals.flatMap((project) =>
      (project.workItems || []).filter((work) => work.status === "done").map((work) => work.id)));
    const childrenByParent = new Map<string, Task[]>();
    data.tasks.forEach((task) => {
      if (!task.parentTaskId) return;
      childrenByParent.set(task.parentTaskId, [...(childrenByParent.get(task.parentTaskId) || []), task]);
    });
    const todayMemo = new Map<string, boolean>();
    const hasTodayInTree = (task: Task, visiting = new Set<string>()): boolean => {
      if (isTerminalStatus(task.status)) return false;
      const cached = todayMemo.get(task.id);
      if (cached !== undefined) return cached;
      if (visiting.has(task.id)) return false;
      const nextVisiting = new Set(visiting).add(task.id);
      const result = hasIncompletePlanForDate(task, currentDate, completedProjectWorkIds)
        || isRecurringDue(task, currentDate, data.nonWorkingPeriods)
        || Boolean(task.waitingFollowUp?.reviewDate && task.waitingFollowUp.reviewDate <= currentDate)
        || (childrenByParent.get(task.id) || []).some((child) => hasTodayInTree(child, nextVisiting));
      todayMemo.set(task.id, result);
      return result;
    };
    const compareTasks = (a: Task, b: Task) => {
      // 優先度は文字の自然な順序と同じく、昇順を A → B → C → D とする。
      const rank = { A: 1, B: 2, C: 3, D: 4 };
      for (const rule of sortRules) {
        let comparison = 0;
        if (rule.key === "priority") comparison = rank[a.priority] - rank[b.priority];
        else if (rule.key === "today") comparison = Number(hasTodayInTree(a)) - Number(hasTodayInTree(b));
        else if (rule.key === "dueDate") comparison = a.dueDate && b.dueDate ? a.dueDate.localeCompare(b.dueDate) : a.dueDate ? -1 : b.dueDate ? 1 : 0;
        else if (rule.key === "updatedAt") comparison = a.updatedAt.localeCompare(b.updatedAt);
        else if (rule.key === "createdAt") comparison = a.createdAt.localeCompare(b.createdAt);
        else if (rule.key === "title") comparison = a.title.localeCompare(b.title, "ja");
        if (comparison) return rule.direction === "asc" ? comparison : -comparison;
      }
      return 0;
    };
    const filtered = data.tasks.filter((task) => {
      if (hideRecurring && task.status === "recurring") return false;
      const tagName = data.projectTags.find((tag) => tag.id === task.projectTagId)?.name || "";
      const searchableText = [task.title, task.description, ...task.repositoryBranches.flatMap((group) => group.branchNames), tagName, ...task.links.map((link) => `${link.label} ${link.url}`), ...task.history.map((item) => item.text), ...task.documents.map((item) => `${item.title} ${item.content}`)].join(" ").toLowerCase();
      if (query && !searchableText.includes(query)) return false;
      if (advancedFilter.conditions.length) {
        const conditionMatches = advancedFilter.conditions.map((condition) => {
          let matches = false;
          if (condition.field === "status") matches = condition.value.split(",").filter(Boolean).includes(task.status);
          else if (condition.field === "priority") matches = task.priority === condition.value;
          else if (condition.field === "tag") matches = condition.value === "none" ? !task.projectTagId : task.projectTagId === condition.value;
          else if (condition.field === "today") matches = hasTodayInTree(task) === (condition.value === "true");
          else if (condition.field === "deadline") matches = Boolean(task.reminderDate || task.dueDate) === (condition.value === "true");
          else matches = !condition.value.trim() || searchableText.includes(condition.value.trim().toLowerCase());
          return condition.operator === "is-not" || condition.operator === "not-contains" ? !matches : matches;
        });
        const accepted = advancedFilter.mode === "and" ? conditionMatches.every(Boolean) : conditionMatches.some(Boolean);
        if (!accepted) return false;
      }
      if (!advancedFilter.conditions.some((condition) => condition.field === "status") && (isTerminalStatus(task.status) || task.status === "pending")) return false;
      return true;
    });
    const ids = new Set(filtered.map((task) => task.id));
    const ordered: Task[] = [];
    const visit = (parentId: string) => filtered
      .filter((task) => task.parentTaskId === parentId || (!ids.has(task.parentTaskId) && parentId === ""))
      .sort(compareTasks)
      .forEach((task) => { if (ordered.some((item) => item.id === task.id)) return; ordered.push(task); visit(task.id); });
    visit("");
    [...filtered].sort(compareTasks).forEach((task) => {
      if (ordered.some((item) => item.id === task.id)) return;
      ordered.push(task);
      visit(task.id);
    });
    return ordered;
  }, [data.tasks, data.projectTags, data.goals, data.nonWorkingPeriods, search, advancedFilter, hideRecurring, sortRules, currentDate]);

  const updateTaskById = (id: string, changes: Partial<Task>, historyText?: string) => {
    const currentTask = data.tasks.find((task) => task.id === id);
    const statusIsChanging = Boolean(changes.status && currentTask && changes.status !== currentTask.status);
    const waitingWillBeHandledExplicitly = Object.prototype.hasOwnProperty.call(changes, "waitingFollowUp");
    let releaseWaiting = false;
    let openWaitingEditor = false;
    if (currentTask?.waitingFollowUp && statusIsChanging && !waitingWillBeHandledExplicitly) {
      releaseWaiting = confirm(`「${currentTask.title}」は待ち箱に入っています。\n\nステータスを「${STATUS_LABELS[changes.status!]}」へ変更し、待ち箱を解除しますか？\n\n［OK］待ち箱を解除する\n［キャンセル］待ち箱には残す`);
    } else if (currentTask && statusIsChanging && changes.status && WAITING_STATUSES.includes(changes.status) && !currentTask.waitingFollowUp && !waitingWillBeHandledExplicitly) {
      openWaitingEditor = confirm(`ステータスを「${STATUS_LABELS[changes.status]}」へ変更します。\n\nこのタスクを待ち箱にも入れますか？\n相手・待ち内容・次に見る日を続けて設定できます。\n\n［OK］待ち箱にも入れる\n［キャンセル］ステータスだけ変更する`);
    }
    setData((current) => {
      let changed = false;
      const tasks = current.tasks.map((task) => {
      if (task.id !== id) return task;
      if (task.status === "recurring" && changes.status && isTerminalStatus(changes.status)) { alert("定期タスク本体は終了にできません。"); return task; }
      const hasChange = Object.entries(changes).some(([key, value]) =>
        JSON.stringify(task[key as keyof Task]) !== JSON.stringify(value));
      if (!hasChange) return task;
      changed = true;
      const now = new Date().toISOString();
      const next = { ...task, ...changes, ...(releaseWaiting && task.waitingFollowUp ? {
        waitingFollowUp: undefined,
        lastReleasedWaitingFollowUp: task.waitingFollowUp,
        lastReleasedWaitingStatus: task.status,
        waitingHistory: [...(task.waitingHistory || []), { id: generateId(), followUp: task.waitingFollowUp, status: task.status, releasedAt: now, reason: "status-change" as const }],
      } : {}), updatedAt: now };
      if (changes.status) Object.assign(next, classifyLegacyStatus(changes.status));
      if (changes.status === "recurring" && !next.recurrence) next.recurrence = { frequency: "weekly", weekday: new Date().getDay(), monthDay: new Date().getDate(), startDate: todayValue(), endDate: "", paused: false };
      if (changes.status) next.completedAt = isTerminalStatus(changes.status) ? now : null;
      next.isToday = isTaskPlannedForDate(next, todayValue());
      if (historyText) next.history = appendHistory(next, historyText);
      if (releaseWaiting && task.waitingFollowUp) {
        const waitingLabels = { go: "GO・承認待ち", confirmation: "内容確認待ち", reply: "返信待ち", material: "資料待ち", work: "作業完了待ち", other: "その他の待ち" };
        const info = task.waitingFollowUp;
        const details = [waitingLabels[info.kind], info.party && `相手：${info.party}`, `開始：${info.startedAt}`, info.reviewDate && `次に見る日：${info.reviewDate}`, info.memo && `メモ：${info.memo}`].filter(Boolean).join(" / ");
        next.history = appendHistory(next, `ステータス変更に伴い待ち箱を解除しました（${details}）。`);
      }
      return next;
      });
      if (!changed) return current;
      const activityTask = tasks.find((task) => task.id === id);
      const previousTask = current.tasks.find((task) => task.id === id);
      let activityType = historyText ? "task-updated" : "", activitySummary = historyText || "", activityDetails: Record<string, unknown> = {};
      if (previousTask && activityTask && changes.status && changes.status !== previousTask.status) {
        activityDetails = { fromStatus: previousTask.status, toStatus: changes.status };
        if (changes.status === "done") {
          activityType = "task-completed";
          activitySummary = "タスクを完了しました。";
        } else if (isTerminalStatus(previousTask.status)) {
          activityType = "task-reopened";
          activitySummary = `終了済みタスクを「${STATUS_LABELS[changes.status]}」として再開しました。`;
        }
      } else if (!historyText && changes.history && previousTask) {
        if (changes.history.length > previousTask.history.length) { activityType = "memo"; activitySummary = "メモを追加"; activityDetails = { text: changes.history[changes.history.length - 1]?.text || "" }; }
        else if (changes.history.length < previousTask.history.length) { activityType = "memo-deleted"; activitySummary = "メモを削除"; }
        else { activityType = "memo-edited"; activitySummary = "メモを編集"; }
      }
      const activityLog = activitySummary && activityTask ? [...current.activityLog, { id: generateId(), taskId: activityTask.id, taskTitle: activityTask.title, projectTagId: activityTask.projectTagId, type: activityType, summary: activitySummary, details: activityDetails, timestamp: new Date().toISOString() }] : current.activityLog;
      const changedSources = new Set([
        ...(previousTask?.plannedRanges || []).filter((range) => range.sourceId).map((range) => `${range.sourceType}:${range.sourceId}`),
        ...(activityTask?.plannedRanges || []).filter((range) => range.sourceId).map((range) => `${range.sourceType}:${range.sourceId}`),
      ]);
      const goals = changes.plannedRanges && activityTask && changedSources.size
        ? current.goals.map((goal) => ({
          ...goal,
          milestones: goal.milestones.map((milestone) => changedSources.has(`project-milestone:${milestone.id}`)
            ? {
              ...milestone,
              plannedRanges: activityTask.plannedRanges
                .filter((range) => range.sourceType === "project-milestone" && range.sourceId === milestone.id)
                .map((range) => ({ ...range, sourceType: undefined, sourceId: undefined })),
              updatedAt: new Date().toISOString(),
            }
            : milestone),
          workItems: (goal.workItems || []).map((work) => changedSources.has(`project-work:${work.id}`)
            ? {
              ...work,
              plannedRanges: activityTask.plannedRanges
                .filter((range) => range.sourceType === "project-work" && range.sourceId === work.id)
                .map((range) => ({ ...range, sourceType: undefined, sourceId: undefined })),
              plannedHours: activityTask.plannedRanges
                .filter((range) => range.sourceType === "project-work" && range.sourceId === work.id)
                .reduce((sum, range) => sum + (Number(range.plannedHours) || 0), 0),
              replanReason: activityTask.plannedRanges
                .find((range) => range.sourceType === "project-work" && range.sourceId === work.id && range.advanceReason)?.advanceReason || work.replanReason,
              replannedAt: activityTask.plannedRanges
                .find((range) => range.sourceType === "project-work" && range.sourceId === work.id && range.advancedAt)?.advancedAt || work.replannedAt,
              updatedAt: new Date().toISOString(),
            }
            : work),
        }))
        : current.goals;
      return { ...current, tasks, goals, activityLog };
    });
    if (openWaitingEditor) window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("chattask-open-waiting", { detail: { taskId: id } }));
    }, 0);
  };
  const cancelTaskCompletion = (taskId: string, completionEventId: string) => {
    setData((current) => {
      const completionEvent = current.activityLog.find((event) => event.id === completionEventId && event.taskId === taskId);
      const task = current.tasks.find((item) => item.id === taskId);
      if (!completionEvent || !task) return current;
      if (current.activityLog.some((event) => event.type === "task-completion-cancelled" && event.details?.completionEventId === completionEventId)) return current;
      const previousStatus = completionEvent.details?.fromStatus;
      const restoreStatus = typeof previousStatus === "string" && previousStatus in STATUS_LABELS && previousStatus !== "done"
        ? previousStatus as Task["status"]
        : "todo";
      const now = new Date().toISOString();
      const tasks = current.tasks.map((item) => {
        if (item.id !== taskId || item.status !== "done") return item;
        const next = {
          ...item,
          status: restoreStatus,
          completedAt: null,
          updatedAt: now,
          history: appendHistory(item, "誤操作のため完了記録を取り消しました。"),
        };
        Object.assign(next, classifyLegacyStatus(restoreStatus));
        return next;
      });
      const activityLog = [...current.activityLog, {
        id: generateId(),
        taskId,
        taskTitle: task.title,
        projectTagId: task.projectTagId,
        type: "task-completion-cancelled",
        summary: "誤操作のため完了記録を取り消しました。",
        details: { completionEventId, restoredStatus: task.status === "done" ? restoreStatus : task.status },
        timestamp: now,
      }];
      return { ...current, tasks, activityLog };
    });
  };

  const saveTaskAsTemplate = (task: Task, name: string, keywords: string[]) => {
    const now = new Date().toISOString();
    const existing = taskTemplates.find((template) => template.name === name);
    const template: TaskTemplate = {
      id: existing?.id || generateId(), name,
      keywords,
      title: task.title, description: task.description, nextAction: task.nextAction,
      priority: task.priority, projectTagId: task.projectTagId,
      plannedHours: Number(task.plannedHours) || task.plannedRanges.reduce((sum, range) => sum + (Number(range.plannedHours) || 0), 0),
      links: task.links.map((link) => ({ ...link })),
      documents: task.documents.map((document) => ({ ...document })),
      schedules: [...task.plannedRanges, ...(task.unscheduledPlans || [])].map((range) => ({ title: range.title, description: range.description, note: range.note, plannedHours: range.plannedHours, status: "not-started" })),
      createdAt: existing?.createdAt || now, updatedAt: now,
    };
    setTaskTemplates((current) => existing ? current.map((item) => item.id === existing.id ? template : item) : [...current, template]);
    setTemplateSourceTask(null);
    window.dispatchEvent(new CustomEvent("chattask-drop-notice", { detail: { text: existing ? `テンプレート「${name}」を更新しました。` : `テンプレート「${name}」を保存しました。` } }));
  };
  const createNewTask = (changes: Partial<Task>, parentId = "") => {
    const parent = data.tasks.find((task) => task.id === (changes.parentTaskId || parentId));
    const baseTask = createTask(parent);
    const now = baseTask.createdAt;
    const task: Task = {
      ...baseTask,
      ...changes,
      id: baseTask.id,
      title: changes.title?.trim() || "新規タスク",
      parentTaskId: changes.parentTaskId ?? baseTask.parentTaskId,
      createdAt: now,
      updatedAt: now,
      completedAt: changes.status && isTerminalStatus(changes.status) ? now : null,
      recurrence: changes.status === "recurring" ? changes.recurrence || { frequency: "weekly", weekday: new Date().getDay(), monthDay: new Date().getDate(), startDate: todayValue(), endDate: "", paused: false } : null,
      history: [{ id: generateId(), type: "system", text: "タスクを作成しました。", timestamp: now }],
    };
    if (changes.status) Object.assign(task, classifyLegacyStatus(changes.status));
    task.isToday = isTaskPlannedForDate(task, todayValue());
    setData((current) => ({ ...current, tasks: [...current.tasks, task], activityLog: [...current.activityLog, { id: generateId(), taskId: task.id, taskTitle: task.title, projectTagId: task.projectTagId, type: "task-created", summary: "タスクを作成", timestamp: task.createdAt }] }));
    setCreatingTaskParentId(null); setCreatingTaskTagId(undefined); setFilter("all"); setSearch(""); setSelectedId(task.id);
  };
  const createRelatedTask = (title: string, parentTaskId = "", changes: Partial<Task> = {}, openAfterCreate = false) => {
    const parent = data.tasks.find((item) => item.id === parentTaskId);
    const baseTask = createTask(parent);
    const task: Task = {
      ...baseTask,
      ...changes,
      id: baseTask.id,
      title: title.trim() || "新規タスク",
      parentTaskId: baseTask.parentTaskId,
      createdAt: baseTask.createdAt,
      updatedAt: baseTask.updatedAt,
      history: [{ id: generateId(), type: "system", text: "タスクを作成しました。", timestamp: baseTask.createdAt }],
    };
    if (changes.status) Object.assign(task, classifyLegacyStatus(changes.status));
    task.isToday = isTaskPlannedForDate(task, todayValue());
    task.completedAt = isTerminalStatus(task.status) ? task.createdAt : null;
    if (task.status === "recurring" && !task.recurrence) task.recurrence = { frequency: "weekly", weekday: new Date().getDay(), monthDay: new Date().getDate(), startDate: todayValue(), endDate: "", paused: false };
    setData((current) => ({
      ...current,
      tasks: [...current.tasks, task],
      activityLog: [...current.activityLog, { id: generateId(), taskId: task.id, taskTitle: task.title, projectTagId: task.projectTagId, type: "task-created", summary: "関連ChatTaskとしてタスクを作成", timestamp: task.createdAt }],
    }));
    if (openAfterCreate) {
      window.setTimeout(() => {
        setFilter("all");
        setSearch("");
        setSelectedId(task.id);
        setDetailsHidden(false);
        setGoalsOpen(false);
        setProjectFocusId("");
      }, 0);
    }
    return task.id;
  };

  const deleteSelectedTask = async () => {
    if (!selectedTask) return;
    try { await removeTaskAttachments(selectedTask.id); }
    catch (error) { alert(`添付ファイルの削除に失敗しました。\n${String(error)}`); return; }
    setData((current) => ({
      ...current,
      tasks: current.tasks.filter((task) => task.id !== selectedTask.id).map((task) => task.parentTaskId === selectedTask.id ? { ...task, parentTaskId: "" } : task),
      goals: current.goals.map((project) => ({
        ...project,
        originTaskId: project.originTaskId === selectedTask.id ? "" : project.originTaskId,
        taskIds: project.taskIds.filter((id) => id !== selectedTask.id),
        milestones: project.milestones.map((milestone) => ({ ...milestone, linkedTaskId: milestone.linkedTaskId === selectedTask.id ? "" : milestone.linkedTaskId, taskIds: milestone.taskIds.filter((id) => id !== selectedTask.id) })),
        workItems: project.workItems?.map((work) => work.linkedTaskId === selectedTask.id ? { ...work, linkedTaskId: "" } : work),
      })),
      activityLog: [...current.activityLog, { id: generateId(), taskId: selectedTask.id, taskTitle: selectedTask.title, projectTagId: selectedTask.projectTagId, type: "task-deleted", summary: "タスクを削除", details: { snapshot: selectedTask }, timestamp: new Date().toISOString() }],
    }));
    setSelectedId(null);
  };

  const deleteDailyPlanById = (id: string, date: string) => {
    setData((current) => {
      const target = current.tasks.find((task) => task.id === id);
      if (!target) return current;
      const dailyPlans = { ...target.dailyPlans };
      const dailyPlanCompleted = { ...target.dailyPlanCompleted };
      delete dailyPlans[date];
      delete dailyPlanCompleted[date];
      const now = new Date().toISOString();
      const tasks = current.tasks.map((task) => task.id === id ? {
        ...task,
        plannedRanges: removeDateFromRanges(task.plannedRanges, date),
        dailyPlans,
        dailyPlanCompleted,
        isToday: date === todayValue() ? false : task.isToday,
        updatedAt: now,
        history: appendHistory(task, `${date}の日別計画を削除しました。`),
      } : task);
      return { ...current, tasks, activityLog: [...current.activityLog, { id: generateId(), taskId: target.id, taskTitle: target.title, projectTagId: target.projectTagId, type: "daily-plan-deleted", summary: `${date}の日別計画を削除`, timestamp: now }] };
    });
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `chattask_export_${todayValue()}.json`; anchor.click(); URL.revokeObjectURL(url);
  };

  const importData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    try { const imported = parseImportedData(await file.text()); setData(imported); setSelectedId(null); alert("データを読み込みました。"); }
    catch (error) { alert(`読み込みに失敗しました。${error instanceof Error ? `\n${error.message}` : ""}`); }
    event.target.value = "";
  };

  const quickAction = (id: string, action: "doing" | "waiting" | "done" | "today" | "tomorrow" | "log") => {
    const task = data.tasks.find((item) => item.id === id); if (!task) return;
    if (action === "doing") updateTaskById(id, { status: "doing" }, "ステータスを進行中へ変更しました。");
    else if (action === "waiting") updateTaskById(id, { status: "waiting-general" }, "ステータスを待ちへ変更しました。");
    else if (action === "done") updateTaskById(id, { status: "done" }, "ステータスを完了へ変更しました。");
    else if (action === "log") { setSelectedId(id); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".memo-composer textarea")?.focus()); }
    else { const date = addDays(todayValue(), action === "tomorrow" ? 1 : 0); updateTaskById(id, { plannedRanges: mergeRanges([...task.plannedRanges, { id: generateId(), startDate: date, endDate: date }]) }, `${date}の予定へ追加しました。`); }
  };
  const revealTaskFromPalette = (task: Task) => {
    setSelectedId(task.id);
    setFilter(isTerminalStatus(task.status) ? "all-with-done" : "all");
    setSearch("");
    setDetailsHidden(true);
    setCreatingTaskParentId(null);
    setCreatingTaskTagId(undefined);
    setTodayOpen(false);
    setTagsOpen(false);
    setGoalsOpen(false);
    setIssuesOpen(false);
    setGanttOpen(false);
    setReportOpen(false);
    setDocumentsOpen(null);
    setNonWorkingOpen(false);
    setHelpOpen(false);
    setProfileOpen(false);
    setDataManagementOpen(false);
    setNotificationsOpen(false);
  };
  const openFullTextResult = (result: FullTextSearchResult, query: string) => {
    setFullSearchOpen(false);
    if (result.kind === "task") {
      const task = data.tasks.find((item) => item.id === result.taskId);
      if (task) {
        revealTaskFromPalette(task);
        jumpToTaskMatch(query);
      }
      return;
    }
    let taskId = "";
    if (result.scope === "task") taskId = result.ownerId;
    else if (result.scope === "project") {
      const project = data.goals.find((item) => item.id === result.ownerId);
      taskId = project?.originTaskId || project?.taskIds[0] || project?.milestones.find((item) => item.linkedTaskId)?.linkedTaskId || project?.workItems?.find((item) => item.linkedTaskId)?.linkedTaskId || "";
    } else {
      taskId = data.tasks.find((task) => task.projectTagId === result.ownerId)?.id || "";
    }
    if (taskId) setSelectedId(taskId);
    setDocumentJump({ scope: result.scope, ownerId: result.ownerId, documentId: result.documentId, query });
    setDocumentsOpen(result.scope);
  };
  const saveCurrentView = (name: string) => setSavedViews((current) => [...current, {
    id: generateId(),
    name,
    filter: "all",
    tagFilter: "all",
    priorityFilter: "all",
    search,
    density,
    narrow,
    groupByTag: groupTasksByTag,
    sortRules,
    advancedFilter,
  }]);
  const applySavedView = (view: SavedTaskView) => {
    const conditions = [...(view.advancedFilter?.conditions || [])];
    const addCondition = (field: "status" | "priority" | "tag" | "today" | "deadline", value: string) => conditions.push({ id: generateId(), field, operator: "is", value });
    if (view.tagFilter && view.tagFilter !== "all") addCondition("tag", view.tagFilter);
    if (view.priorityFilter && view.priorityFilter !== "all") addCondition("priority", view.priorityFilter);
    if (view.filter === "all-with-done") addCondition("status", Object.keys(STATUS_LABELS).join(","));
    else if (view.filter === "done") addCondition("status", "done,cancelled,handed-over");
    else if (view.filter === "today") addCondition("today", "true");
    else if (view.filter === "today-waiting") { addCondition("today", "true"); addCondition("status", WAITING_STATUSES.join(",")); }
    else if (view.filter === "my-turn") addCondition("status", ["doing", "recurring", ...WAITING_STATUSES].join(","));
    else if (view.filter === "waiting") addCondition("status", WAITING_STATUSES.join(","));
    else if (view.filter === "deadline") addCondition("deadline", "true");
    setFilter("all");
    setTagFilter("all");
    setPriorityFilter("all");
    setSearch(view.search);
    setDensity(view.density);
    setNarrow(view.narrow);
    setGroupTasksByTag(view.groupByTag);
    setSortRules(view.sortRules?.length ? view.sortRules : sortRules);
    setAdvancedFilter({ mode: conditions.length > (view.advancedFilter?.conditions.length || 0) ? "and" : view.advancedFilter?.mode || "and", conditions });
    setFiltersHidden(false);
  };
  const startWorkTimer = (task: Task, planKey: string, minutes: number, hasPlannedHours: boolean) => {
    if (workTimer) {
      alert(`「${workTimer.taskTitle}」を計測中です。常駐バーから終了してから別のタイマーを開始してください。`);
      return false;
    }
    const timer: TimerSession = {
      taskId: task.id,
      taskTitle: task.title,
      date: todayDate,
      planKey,
      durationMinutes: Math.max(1, Math.round(minutes)),
      plannedMinutes: hasPlannedHours ? Math.max(1, Math.round(minutes)) : null,
      startedAt: Date.now(),
      elapsedMs: 0,
    };
    setWorkTimer(timer);
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    if (task.status !== "recurring" && task.status !== "doing") updateTaskById(task.id, { status: "doing" }, "作業タイマーを開始し、ステータスを進行中へ変更しました。");
    return true;
  };
  const pauseWorkTimer = () => setWorkTimer((current) => current?.startedAt === null ? current : current ? { ...current, elapsedMs: current.elapsedMs + Math.max(0, Date.now() - current.startedAt), startedAt: null } : null);
  const resumeWorkTimer = () => setWorkTimer((current) => current?.startedAt === null ? { ...current, startedAt: Date.now() } : current);
  const finishWorkTimer = () => {
    pauseWorkTimer();
    setTimerFinishOpen(true);
  };
  const remindWorkTimer = () => {
    if (!workTimer || workTimer.overrunNotifiedAt) return;
    const plannedMinutes = typeof workTimer.plannedMinutes === "number" ? workTimer.plannedMinutes : null;
    const detail = plannedMinutes
      ? `予定${plannedMinutes}分に対して${plannedMinutes * 2}分経過しました。タイマーを確認してください。`
      : "予定工数が未設定のまま3時間経過しました。タイマーを確認してください。";
    setWorkTimer({ ...workTimer, overrunNotifiedAt: Date.now() });
    if ("Notification" in window && Notification.permission === "granted") new Notification("止め忘れの確認", { body: `「${workTimer.taskTitle}」\n${detail}` });
    else window.alert(`止め忘れの確認\n\n「${workTimer.taskTitle}」\n${detail}`);
  };
  const discardWorkTimer = () => {
    localStorage.removeItem("chatTaskWorkTimer");
    setTimerFinishOpen(false);
    setWorkTimer(null);
  };
  const resolveTimerPlanKey = (timer: TimerSession, task: Task) => {
    const recurringTask = task.taskKind === "recurring" || task.status === "recurring";
    if (timer.planKey.includes("::") || recurringTask) return timer.planKey;
    const ranges = task.plannedRanges.filter((range) => range.startDate <= timer.date && range.endDate >= timer.date);
    if (ranges.length === 1) {
      const [range] = ranges;
      return `${timer.date}::${range.id}`;
    }
    const durationMatches = ranges.filter((range) => {
      const days = Math.max(1, Math.round((new Date(`${range.endDate}T00:00:00Z`).getTime() - new Date(`${range.startDate}T00:00:00Z`).getTime()) / 86_400_000) + 1);
      return Math.abs(((Number(range.plannedHours) || 0) / days) * 60 - timer.durationMinutes) < 0.01;
    });
    return durationMatches.length === 1 ? `${timer.date}::${durationMatches[0].id}` : timer.planKey;
  };
  const timerMemo = (() => {
    if (!workTimer) return "";
    const task = data.tasks.find((item) => item.id === workTimer.taskId);
    if (!task) return "";
    if (task.taskKind === "recurring" || task.status === "recurring") {
      return task.recurrenceRecords.find((record) => record.date === workTimer.date)?.memo ?? task.recurrenceMemoTemplate;
    }
    return task.dailyPlans[workTimer.planKey] || "";
  })();
  const saveWorkTimer = (hours: number, memo: string, result: "pending" | "achieved") => {
    if (!workTimer) return;
    const task = data.tasks.find((item) => item.id === workTimer.taskId);
    if (!task) { setWorkTimer(null); setTimerFinishOpen(false); return; }
    const recurringTask = task.taskKind === "recurring" || task.status === "recurring";
    const timerPlanKey = resolveTimerPlanKey(workTimer, task);
    const memoPlanKey = workTimer.planKey;
    const timerRange = task.plannedRanges.find((range) => memoPlanKey.endsWith(`::${range.id}`));
    const timerWorkTitle = (() => {
      if (!timerRange) return "";
      if (timerRange.sourceType === "project-work" && timerRange.sourceId) {
        const work = data.goals.flatMap((project) => project.workItems || []).find((item) => item.id === timerRange.sourceId);
        if (work?.title.trim()) return work.title.trim();
      }
      if (timerRange.sourceType === "project-milestone" && timerRange.sourceId) {
        const milestone = data.goals.flatMap((project) => project.milestones).find((item) => item.id === timerRange.sourceId);
        if (milestone?.title.trim()) return milestone.title.trim();
      }
      return timerRange.title?.trim() || "";
    })();
    const previous = Number(task.dailyActualHours?.[timerPlanKey]) || 0;
    const dailyActualHours = { ...(task.dailyActualHours || {}), [timerPlanKey]: previous + hours };
    const changes: Partial<Task> = {
      dailyActualHours,
      actualHours: Object.values(dailyActualHours).reduce((sum, dailyHours) => sum + (Number(dailyHours) || 0), 0),
    };
    if (!recurringTask) {
      changes.dailyPlans = {
        ...task.dailyPlans,
        [memoPlanKey]: memo,
      };
    }
    if (result === "achieved" && !recurringTask) {
      changes.dailyPlanCompleted = {
        ...task.dailyPlanCompleted,
        [memoPlanKey]: true,
      };
      const dailyPlanText = (changes.dailyPlans?.[memoPlanKey] ?? task.dailyPlans[memoPlanKey] ?? "").trim();
      if (dailyPlanText) changes.history = [...task.history, {
        id: generateId(),
        type: "comment",
        text: dailyPlanText,
        timestamp: new Date().toISOString(),
        ...(timerWorkTitle && timerWorkTitle !== task.title.trim() ? { workTitle: timerWorkTitle } : {}),
        ...(typeof workTimer.plannedMinutes === "number" && workTimer.plannedMinutes > 0 ? { workPlannedHours: workTimer.plannedMinutes / 60 } : {}),
        ...(previous + hours > 0 ? { workActualHours: previous + hours } : {}),
      }];
    }
    if (recurringTask) {
      const existing = task.recurrenceRecords.find((record) => record.date === workTimer.date);
      const record: RecurrenceRecord = {
        date: workTimer.date,
        status: result === "achieved" ? "done" : existing?.status || "pending",
        actualDate: existing?.actualDate || workTimer.date,
        movedTo: existing?.movedTo,
        moveReason: existing?.moveReason,
        memo,
        timestamp: result === "achieved" ? new Date().toISOString() : existing?.timestamp || new Date().toISOString(),
      };
      changes.recurrenceRecords = [
        ...task.recurrenceRecords.filter((item) => item.date !== workTimer.date),
        record,
      ];
      const recurrenceMemo = (record.memo || "").trim();
      if (result === "achieved" && recurrenceMemo) changes.history = [...task.history, { id: generateId(), type: "comment", text: recurrenceMemo, timestamp: new Date().toISOString() }];
    }
    const timerHistoryText = `タイマーの実績 ${hours}h を${workTimer.date}へ記録しました。`;
    updateTaskById(task.id, changes, timerHistoryText);
    setWorkTimer(null);
    setTimerFinishOpen(false);
  };
  const finalizeDailyPage = (date: string) => setData((current) => {
    if (current.dailyFinalizedAt[date]) return current;
    const timestamp = new Date().toISOString();
    return {
      ...current,
      dailyFinalizedAt: { ...current.dailyFinalizedAt, [date]: timestamp },
      activityLog: [...current.activityLog, {
        id: generateId(),
        taskId: null,
        taskTitle: "",
        projectTagId: "",
        type: "daily-page-finalized",
        summary: `${date}の今日のページを確定しました。`,
        timestamp,
      }],
    };
  });
  const unfinalizeDailyPage = (date: string) => setData((current) => {
    if (!current.dailyFinalizedAt[date]) return current;
    const dailyFinalizedAt = { ...current.dailyFinalizedAt };
    delete dailyFinalizedAt[date];
    const timestamp = new Date().toISOString();
    return {
      ...current,
      dailyFinalizedAt,
      activityLog: [...current.activityLog, {
        id: generateId(),
        taskId: null,
        taskTitle: "",
        projectTagId: "",
        type: "daily-page-finalization-cancelled",
        summary: `${date}の今日のページの確定を取り消しました。`,
        timestamp,
      }],
    };
  });

  return <NonWorkingPeriodsProvider periods={data.nonWorkingPeriods}><div className="app-shell">
    {dropNotice && <div className={`global-drop-notice ${dropNotice.error ? "error" : ""}`} role="status">{dropNotice.text}</div>}
    <Header importRef={importRef} onImport={importData} onExport={exportData} onTags={() => setTagsOpen(true)} onTemplates={() => setTemplatesOpen(true)} onReport={() => setReportOpen(true)} onGantt={() => { setGanttProjectId(""); setGanttReturnProjectId(""); setGanttOpen(true); }} onWeeklyLoad={() => setWeeklyLoadOpen(true)} onGoals={() => setGoalsOpen(true)} onIssues={() => setIssuesOpen(true)} onSearch={() => setFullSearchOpen(true)} onInbox={() => setInboxOpen(true)} inboxCount={data.inboxItems.filter((item) => item.status === "inbox").length} onWaiting={() => { setWaitingTaskId(""); setWaitingOpen(true); }} waitingCount={data.tasks.filter((task) => task.waitingFollowUp).length} onNotifications={() => setNotificationsOpen(true)} notificationCount={notificationCount} onNonWorking={() => setNonWorkingOpen(true)} onHelp={() => setHelpOpen(true)} onProfile={() => setProfileOpen(true)} onDataManagement={() => setDataManagementOpen(true)} onAchievements={() => setAchievementsOpen(true)} onTools={() => setToolsOpen(true)} hideRecurring={hideRecurring} openTodayOnStartup={openTodayOnStartup} onHideRecurring={setHideRecurring} onOpenTodayOnStartup={setOpenTodayOnStartup} />
    <main className="workspace">
      <Sidebar tasks={visibleTasks} tags={data.projectTags} projects={data.goals} periods={data.nonWorkingPeriods} selectedId={selectedId} search={search} advancedFilter={advancedFilter} savedViews={savedViews} sortRules={sortRules} filtersHidden={filtersHidden} collapsedIds={collapsedIds} onSearch={setSearch} onClearFilters={() => { setSearch(""); setAdvancedFilter({ mode: "and", conditions: [] }); setFilter("all"); setTagFilter("all"); setPriorityFilter("all"); }} onSaveView={saveCurrentView} onApplyView={applySavedView} onDeleteView={(id) => setSavedViews((current) => current.filter((view) => view.id !== id))} onSortRules={setSortRules} onToggleFilters={() => setFiltersHidden((value) => !value)} onSelect={setSelectedId} onToggleCollapse={(id) => setCollapsedIds((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; })} onCreate={(projectTagId) => { setCreatingTaskTagId(projectTagId); setCreatingTaskParentId(""); }} onToday={() => setTodayOpen(true)} narrow={narrow} density={density} groupByTag={groupTasksByTag} onToggleGroupByTag={() => setGroupTasksByTag((value) => !value)} onToggleWidth={() => setNarrow((value) => !value)} onToggleDensity={() => setDensity((value) => value === "standard" ? "compact" : value === "compact" ? "minimal" : "standard")} onQuick={quickAction} onOpenProject={openProjects} onSaveTemplate={setTemplateSourceTask} />
      <TaskDetail task={selectedTask} allTasks={data.tasks} projects={data.goals} tags={data.projectTags} profile={data.userProfile} detailsHidden={detailsHidden} onToggleDetails={() => setDetailsHidden((value) => !value)} onUpdate={(changes, text) => selectedId && updateTaskById(selectedId, changes, text)} onDelete={deleteSelectedTask} onCreateChild={() => selectedId && setCreatingTaskParentId(selectedId)} onCreateSibling={() => { if (!selectedTask) return; setCreatingTaskTagId(selectedTask.projectTagId || undefined); setCreatingTaskParentId(selectedTask.parentTaskId || ""); }} onDocuments={() => { setDocumentJump(null); setDocumentsOpen("task"); }} onCodeReview={() => selectedTask && setCodeReviewTaskId(selectedTask.id)} onSharedDocuments={(projectId, documentId = "") => { const project = data.goals.find((item) => item.id === projectId); if (project) { setDocumentJump({ scope: "project", ownerId: project.id, documentId, query: "" }); setDocumentsOpen("project"); } }} onTagDocuments={() => { if (selectedTag) { setDocumentJump(null); setDocumentsOpen("tag"); } }} onOpenTagSettings={() => setTagsOpen(true)} onUpdateTagRepositories={(tagId, githubRepositories) => setData((current) => ({ ...current, projectTags: current.projectTags.map((tag) => tag.id === tagId ? { ...tag, githubRepositories } : tag) }))} onPromote={() => selectedTask && promoteTaskToProject(selectedTask)} onSaveTemplate={() => selectedTask && setTemplateSourceTask(selectedTask)} onOpenProject={openProjects} promoted={Boolean(selectedTask && data.goals.some((item) => item.originTaskId === selectedTask.id))} projectManaged={Boolean(selectedTask && data.goals.some((project) => project.milestones.some((milestone) => milestone.linkedTaskId === selectedTask.id) || project.workItems?.some((work) => work.linkedTaskId === selectedTask.id)))} onDeleteDailyPlan={(date) => selectedId && deleteDailyPlanById(selectedId, date)} onDeleteMemo={(id) => selectedTask && updateTaskById(selectedTask.id, { history: selectedTask.history.filter((item) => item.id !== id) })} onEditMemo={(id, text) => selectedTask && updateTaskById(selectedTask.id, { history: selectedTask.history.map((item) => item.id === id ? { ...item, text, editedAt: new Date().toISOString() } : item) })} />
    </main>
    {advancedFilterOpen && <AdvancedFilterModal filter={advancedFilter} tags={data.projectTags} onApply={setAdvancedFilter} onClose={() => setAdvancedFilterOpen(false)} />}
    {todayOpen && <TodayModal tasks={data.tasks} projects={data.goals} tags={data.projectTags} inboxItems={data.inboxItems} todayOrder={data.todayTaskOrders[todayDate] || []} onTodayOrder={(order) => setData((current) => ({ ...current, todayTaskOrders: { ...current.todayTaskOrders, [todayDate]: order } }))} onOpenInbox={(itemId = "") => { setInboxItemId(itemId); setInboxOpen(true); }} onReviewInbox={(id) => setData((current) => ({ ...current, inboxItems: current.inboxItems.map((item) => item.id === id ? { ...item, reviewedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : item) }))} activity={data.activityLog} periods={data.nonWorkingPeriods} date={todayDate} note={data.dailyNotes[todayDate] || ""} finalizedAt={data.dailyFinalizedAt[todayDate] || ""} activeTimerTaskId={workTimer?.taskId} onDate={setTodayDate} onNote={(note) => setData((current) => ({ ...current, dailyNotes: { ...current.dailyNotes, [todayDate]: note } }))} onFinalize={() => finalizeDailyPage(todayDate)} onUnfinalize={() => unfinalizeDailyPage(todayDate)} onUpdateTask={updateTaskById} onCancelCompletion={cancelTaskCompletion} onStartTimer={startWorkTimer} onSelect={setSelectedId} onOpenDocuments={(id) => { setSelectedId(id); setDocumentJump(null); setDocumentsOpen("task"); }} onClose={() => setTodayOpen(false)} />}
    {inboxOpen && <InboxModal items={data.inboxItems} tags={data.projectTags} tasks={data.tasks} initialItemId={inboxItemId} onSave={(inboxItems) => setData((current) => ({ ...current, inboxItems }))} onPromote={(_item: InboxItem, task) => createRelatedTask(task.title, task.parentTaskId, { description: task.description, nextAction: task.nextAction, projectTagId: task.projectTagId, priority: task.priority, status: task.status }, false)} onOpenTask={(id) => { setSelectedId(id); setInboxItemId(""); setInboxOpen(false); }} onClose={() => { setInboxItemId(""); setInboxOpen(false); }} />}
    {waitingOpen && <WaitingBoxModal tasks={data.tasks} initialTaskId={waitingTaskId} onUpdateTask={updateTaskById} onOpenTask={setSelectedId} onClose={() => { setWaitingOpen(false); setWaitingTaskId(""); }} />}
    {creatingTaskParentId !== null && <TaskCreateModal tasks={data.tasks} tags={data.projectTags} templates={taskTemplates} parentId={creatingTaskParentId} projectTagId={creatingTaskTagId} onCreate={(values) => createNewTask(values, creatingTaskParentId)} onClose={() => { setCreatingTaskParentId(null); setCreatingTaskTagId(undefined); }} />}
    {templateSourceTask && <TaskTemplateSaveModal task={templateSourceTask} onSave={(name, keywords) => saveTaskAsTemplate(templateSourceTask, name, keywords)} onClose={() => setTemplateSourceTask(null)} />}
    {templatesOpen && <TaskTemplateManagerModal templates={taskTemplates} tags={data.projectTags} onChange={setTaskTemplates} onClose={() => setTemplatesOpen(false)} />}
    {toolsOpen && <ToolsModal tools={data.localTools} storagePath={data.localToolsStoragePath} onSave={updateLocalTools} onStoragePath={updateLocalToolsStoragePath} onClose={() => setToolsOpen(false)} />}
    {codeReviewTask && <Modal title={`コードレビュー・${codeReviewTask.title}`} wide onClose={() => setCodeReviewTaskId("")}><CodeReviewWindow task={codeReviewTask} repositories={codeReviewRepositories} onUpdate={(changes, historyText) => updateTaskById(codeReviewTask.id, changes, historyText)} /></Modal>}
    {tagsOpen && <TagSettingsModal tags={data.projectTags} onSave={(projectTags) => setData((current) => {
      const ids = new Set(projectTags.map((tag) => tag.id));
      return {
        ...current,
        projectTags,
        tasks: current.tasks.map((task) => task.projectTagId && !ids.has(task.projectTagId) ? { ...task, projectTagId: "" } : task),
      };
    })} onUpdateRepositories={(tagId, githubRepositories) => setData((current) => ({ ...current, projectTags: current.projectTags.map((tag) => tag.id === tagId ? { ...tag, githubRepositories } : tag) }))} onClose={() => setTagsOpen(false)} />}
    {documentsOpen === "task" && selectedTask && <DocumentsModal task={selectedTask} persistenceKey={`task:${selectedTask.id}`} scopeLabel="タスク専用" scopeOptions={documentScopeOptions("task")} initialDocumentId={documentJump?.scope === "task" ? documentJump.documentId : ""} initialSearchQuery={documentJump?.scope === "task" ? documentJump.query : ""} onSave={(documents) => updateTaskById(selectedTask.id, { documents })} onClose={() => { setDocumentsOpen(null); setDocumentJump(null); }} />}
    {documentsOpen === "parent" && selectedTask && documentParentTask && <DocumentsModal task={documentParentTask} persistenceKey={`task:${documentParentTask.id}`} scopeLabel={`親Task：${documentParentTask.title || "無題のタスク"}`} scopeOptions={documentScopeOptions("parent")} onSave={(documents) => updateTaskById(documentParentTask.id, { documents })} onClose={() => { setDocumentsOpen(null); setDocumentJump(null); }} />}
    {documentsOpen === "project" && documentProject && <DocumentsModal title={`${documentProject.title}・プロジェクト共有`} persistenceKey={`project:${documentProject.id}`} scopeLabel={`共有：${documentProject.title}`} scopeOptions={documentScopeOptions("project")} documents={documentProject.sharedDocuments || []} initialDocumentId={documentJump?.scope === "project" ? documentJump.documentId : ""} initialSearchQuery={documentJump?.scope === "project" ? documentJump.query : ""} onSave={(sharedDocuments) => setData((current) => ({ ...current, goals: current.goals.map((project) => project.id === documentProject.id ? { ...project, sharedDocuments, updatedAt: new Date().toISOString() } : project) }))} onClose={() => { setDocumentsOpen(null); setDocumentJump(null); }} />}
    {documentsOpen === "tag" && documentTag && <DocumentsModal title={`${documentTag.name}・案件タグ共有`} persistenceKey={`tag:${documentTag.id}`} scopeLabel={`案件タグ：${documentTag.name}`} scopeOptions={documentScopeOptions("tag")} documents={documentTag.sharedDocuments || []} initialDocumentId={documentJump?.scope === "tag" ? documentJump.documentId : ""} initialSearchQuery={documentJump?.scope === "tag" ? documentJump.query : ""} onSave={(sharedDocuments) => setData((current) => ({ ...current, projectTags: current.projectTags.map((tag) => tag.id === documentTag.id ? { ...tag, sharedDocuments } : tag) }))} onClose={() => { setDocumentsOpen(null); setDocumentJump(null); }} />}
    {nonWorkingOpen && <NonWorkingModal periods={data.nonWorkingPeriods} onSave={(nonWorkingPeriods) => setData((current) => ({ ...current, nonWorkingPeriods }))} onClose={() => setNonWorkingOpen(false)} />}
    {reportOpen && <ReportModal tasks={data.tasks} projects={data.goals} tags={data.projectTags} activity={data.activityLog} dailyNotes={data.dailyNotes} nonWorkingPeriods={data.nonWorkingPeriods} onClose={() => setReportOpen(false)} />}
    {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    {profileOpen && <ProfileModal profile={data.userProfile} onSave={(userProfile) => setData((current) => ({ ...current, userProfile }))} onClose={() => setProfileOpen(false)} />}
    {goalsOpen && <ProjectsModal projects={data.goals} tasks={data.tasks} tags={data.projectTags} initialProjectId={projectFocusId} onSave={saveProjects} onCreateTask={createRelatedTask} onUpdateTask={updateTaskById} onSelectTask={(id) => { setSelectedId(id); setGoalsOpen(false); setProjectFocusId(""); }} onOpenGantt={(id) => { setProjectFocusId(id); setGanttProjectId(id); setGanttReturnProjectId(id); setGanttOpen(true); }} onClose={() => { setGoalsOpen(false); setProjectFocusId(""); }} />}
    {ganttOpen && <GanttModal tasks={data.tasks} projects={data.goals} tags={data.projectTags} periods={data.nonWorkingPeriods} initialProjectId={ganttProjectId} onSelect={(id) => { setSelectedId(id); setGoalsOpen(false); setProjectFocusId(""); setGanttOpen(false); setGanttProjectId(""); setGanttReturnProjectId(""); }} onClose={() => { setGanttOpen(false); setGanttProjectId(""); if (ganttReturnProjectId) { setProjectFocusId(ganttReturnProjectId); setGoalsOpen(true); } setGanttReturnProjectId(""); }} />}
    {weeklyLoadOpen && <WeeklyLoadModal tasks={data.tasks} tags={data.projectTags} periods={data.nonWorkingPeriods} onSelect={(id) => { setSelectedId(id); setWeeklyLoadOpen(false); }} onClose={() => setWeeklyLoadOpen(false)} />}
    {issuesOpen && <IssuesModal issues={data.issues} onSave={(issues) => setData((current) => ({ ...current, issues }))} onClose={() => setIssuesOpen(false)} />}
    {dataManagementOpen && <DataManagementModal data={data} backend={storageBackend} environment={environment}
      onSwitchEnvironment={(next) => {
        if (next === environment) return Promise.resolve();
        return saveAppData(data, storageBackend || "localStorage", environment).then(() => {
          setActiveEnvironment(next);
          window.location.assign(window.location.href);
        });
      }}
      onCopyProductionToTest={async () => {
        const production = environment === "production" ? data : (await initializeAppStorage(loadAppData("production"), "production")).data;
        await saveAppData(structuredClone(production), storageBackend || "localStorage", "test");
      }}
      onResetTest={async () => {
        const blank = loadAppData("test");
        blank.tasks = []; blank.activityLog = []; blank.dailyNotes = {}; blank.dailyFinalizedAt = {}; blank.goals = []; blank.issues = []; blank.inboxItems = []; blank.todayTaskOrders = {}; blank.localTools = []; blank.localToolsStoragePath = "";
        await saveAppData(blank, storageBackend || "localStorage", "test");
        if (environment === "test") window.location.reload();
      }}
      onRestore={(restored) => { setData(restored); setSelectedId(null); }} onClose={() => setDataManagementOpen(false)} />}
    {notificationsOpen && <NotificationsModal tasks={data.tasks} tags={data.projectTags} onSelect={revealTaskFromPalette} onClose={() => setNotificationsOpen(false)} />}
    {commandPalette && <CommandPalette tasks={data.tasks} tags={data.projectTags} initialTaskId={commandPalette.taskId} position={commandPalette.position} onCreate={(title, today) => createNewTask({ title, ...(today ? { plannedRanges: [{ id: generateId(), startDate: todayValue(), endDate: todayValue() }] } : {}) })} onOpenTask={revealTaskFromPalette} onTaskAction={(task, action) => quickAction(task.id, action)} onClose={() => setCommandPalette(null)} />}
    {fullSearchOpen && <FullTextSearchModal tasks={data.tasks} projects={data.goals} tags={data.projectTags} onOpen={openFullTextResult} onClose={() => setFullSearchOpen(false)} />}
{achievementsOpen && <AchievementsModal tasks={data.tasks} projects={data.goals} tags={data.projectTags} activity={data.activityLog} nonWorkingPeriods={data.nonWorkingPeriods} onSelect={(id) => { setSelectedId(id); setAchievementsOpen(false); }} onClose={() => setAchievementsOpen(false)} />}
    {workTimer && <ActiveTimerBar timer={workTimer} onPause={pauseWorkTimer} onResume={resumeWorkTimer} onOverrun={remindWorkTimer} onFinish={finishWorkTimer} onOpenTask={() => { const task = data.tasks.find((item) => item.id === workTimer.taskId); if (task) revealTaskFromPalette(task); }} />}
    {workTimer && timerFinishOpen && <TimerFinishDialog timer={workTimer} initialMemo={timerMemo} onSave={saveWorkTimer} onDiscard={discardWorkTimer} onClose={() => setTimerFinishOpen(false)} />}
  </div></NonWorkingPeriodsProvider>;
}

export default App;
