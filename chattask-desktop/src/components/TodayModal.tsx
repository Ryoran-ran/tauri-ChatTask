import { useEffect, useRef, useState } from "react";
import { STATUS_LABELS, WAITING_STATUSES, isTerminalStatus } from "../data/constants";
import type { ActivityEvent, Goal, InboxItem, NonWorkingPeriod, PlannedRange, ProjectTag, RecurrenceRecord, Task } from "../types";
import { addDays, generateId, getNextWorkingDate, getNonWorkingPeriod, isPlannedRangeForDate, isRecurringDue, isTaskPlannedForDate, localDateValue, plannedHoursForDate, plannedRangeHoursForDate, recurrenceLabel, todayValue } from "../utils";
import { Modal } from "./Modal";
import { WorkDatePicker } from "./WorkDatePicker";
import { EffortSummaryModal } from "./EffortSummaryModal";
import { TagIcon } from "./TagIcon";
import { readExecutionGroups, saveExecutionGroups as persistExecutionGroups, type ExecutionGroup, type ExecutionItem, type ExecutionUnit, type Occurrence, type ScheduledItem } from "./todayExecutionGroups";
export function TodayModal({ tasks, projects, tags, inboxItems, todayOrder, onTodayOrder, onOpenInbox, onReviewInbox, activity, periods, date, note, finalizedAt, activeTimerTaskId, onDate, onNote, onFinalize, onUnfinalize, onUpdateTask, onCancelCompletion, onStartTimer, onSelect, onOpenDocuments, onClose }: { tasks: Task[]; projects: Goal[]; tags: ProjectTag[]; inboxItems: InboxItem[]; todayOrder: string[]; onTodayOrder: (order: string[]) => void; onOpenInbox: (itemId?: string) => void; onReviewInbox: (id: string) => void; activity: ActivityEvent[]; periods: NonWorkingPeriod[]; date: string; note: string; finalizedAt: string; activeTimerTaskId?: string; onDate: (date: string) => void; onNote: (note: string) => void; onFinalize: () => void; onUnfinalize: () => void; onUpdateTask: (id: string, changes: Partial<Task>, history?: string) => void; onCancelCompletion: (taskId: string, completionEventId: string) => void; onStartTimer: (task: Task, planKey: string, minutes: number, hasPlannedHours: boolean) => boolean; onSelect: (id: string) => void; onOpenDocuments: (id: string) => void; onClose: () => void }) {
  const [moveTarget, setMoveTarget] = useState<Occurrence | null>(null); const [moveDate, setMoveDate] = useState(""); const [moveReason, setMoveReason] = useState("");
  const [actualDrafts, setActualDrafts] = useState<Record<string, string>>({});
  const [completionCancelConfirmId, setCompletionCancelConfirmId] = useState("");
  const [showCompletedRecurring, setShowCompletedRecurring] = useState(() => localStorage.getItem("chatTaskShowCompletedRecurring") === "true");
  const [showSkippedRecurring, setShowSkippedRecurring] = useState(() => localStorage.getItem("chatTaskShowSkippedRecurring") === "true");
  const [memoOpen, setMemoOpen] = useState(false);
  const [effortSummaryOpen, setEffortSummaryOpen] = useState(false);
  const [inboxExpanded, setInboxExpanded] = useState(false);
  const [selectedCarryTaskIds, setSelectedCarryTaskIds] = useState<Set<string>>(() => new Set());
  const [carrySelectionMode, setCarrySelectionMode] = useState(false);
  const [groupByTag, setGroupByTag] = useState(() => localStorage.getItem("chatTaskTodayGroupByTag") === "true");
  const [todayView, setTodayView] = useState<"board" | "order">(() => localStorage.getItem("chatTaskTodayView") === "order" ? "order" : "board");
  const [executionGroupsState, setExecutionGroupsState] = useState(() => ({ date, groups: readExecutionGroups(date) }));
  const [executionGroupDialogOpen, setExecutionGroupDialogOpen] = useState(false);
  const [executionGroupName, setExecutionGroupName] = useState("");
  const [selectedExecutionGroupKeys, setSelectedExecutionGroupKeys] = useState<Set<string>>(() => new Set());
  const [expandedExecutionGroupIds, setExpandedExecutionGroupIds] = useState<Set<string>>(() => new Set());
  const [executionLaterOpen, setExecutionLaterOpen] = useState(false);
  const [dragOrderKey, setDragOrderKey] = useState("");
  const [copiedCalendarKey, setCopiedCalendarKey] = useState("");
  const [expandedTaskKeys, setExpandedTaskKeys] = useState<Set<string>>(() => new Set());
  const [entryTarget, setEntryTarget] = useState<ScheduledItem | null>(null);
  const [carryHistoryTarget, setCarryHistoryTarget] = useState<ScheduledItem | null>(null);
  const [recurrenceDetailTarget, setRecurrenceDetailTarget] = useState<Occurrence | null>(null);
  const [recurrenceMemoDraft, setRecurrenceMemoDraft] = useState("");
  const [timerTarget, setTimerTarget] = useState<{ task: Task; planKey: string; suggestedMinutes: number; hasPlannedHours: boolean } | null>(null);
  const [customTimerMinutes, setCustomTimerMinutes] = useState("30");
  const [advanceTargetKey, setAdvanceTargetKey] = useState("");
  const [advanceSearch, setAdvanceSearch] = useState("");
  const [advanceDate, setAdvanceDate] = useState(date);
  const [advanceHours, setAdvanceHours] = useState("");
  const [advanceReason, setAdvanceReason] = useState("");
  const [advanceDialogOpen, setAdvanceDialogOpen] = useState(false);
  const [workingDateOverrides, setWorkingDateOverrides] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("chatTaskWorkingDateOverrides") || "[]");
      return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : [];
    } catch {
      return [];
    }
  });
  const openTimer = useRef<number | null>(null);
  const finalized = Boolean(finalizedAt);
  const inboxReviewItems = inboxItems.filter((item) => item.status === "inbox" && item.reviewDate && !item.reviewedAt && (date === todayValue() ? item.reviewDate <= date : item.reviewDate === date)).sort((a, b) => (a.reviewDate || "").localeCompare(b.reviewDate || "") || b.updatedAt.localeCompare(a.updatedAt));
  const scheduledNonWorking = getNonWorkingPeriod(date, periods);
  const holidayWork = Boolean(scheduledNonWorking && workingDateOverrides.includes(date));
  const nonWorking = getNonWorkingPeriod(date, periods, workingDateOverrides);
  const toggleHolidayWork = () => {
    if (!scheduledNonWorking || finalized) return;
    setWorkingDateOverrides((current) => {
      const next = current.includes(date) ? current.filter((item) => item !== date) : [...current, date].sort();
      localStorage.setItem("chatTaskWorkingDateOverrides", JSON.stringify(next));
      return next;
    });
  };
  // 保留は日々の未完了・持ち越し対象から外し、変更当日の専用枠だけに表示する。
  const completedProjectSources = new Map<string, string | undefined>();
  projects.forEach((project) => {
    project.milestones.forEach((milestone) => {
      if (milestone.status === "achieved" || milestone.completed) completedProjectSources.set(`project-milestone:${milestone.id}`, milestone.completedAt);
    });
    (project.workItems || []).forEach((work) => {
      if (work.status === "done") completedProjectSources.set(`project-work:${work.id}`, work.completedAt);
    });
  });
  const isCompletedProjectSource = (range: PlannedRange) => Boolean(
    range.sourceType && range.sourceId && completedProjectSources.has(`${range.sourceType}:${range.sourceId}`));
  const isAfterProjectSourceCompletion = (range: PlannedRange) => {
    if (!range.sourceType || !range.sourceId) return false;
    const completedAt = completedProjectSources.get(`${range.sourceType}:${range.sourceId}`);
    return Boolean(completedAt && date > localDateValue(completedAt));
  };
  const scheduleTitle = (task: Task, range: PlannedRange) => {
    if (range.sourceType === "project-work" && range.sourceId) {
      const work = projects.flatMap((project) => project.workItems || []).find((item) => item.id === range.sourceId);
      if (work?.title.trim()) return work.title.trim();
    }
    if (range.sourceType === "project-milestone" && range.sourceId) {
      const milestone = projects.flatMap((project) => project.milestones).find((item) => item.id === range.sourceId);
      if (milestone?.title.trim()) return milestone.title.trim();
    }
    return range.title?.trim() || task.title;
  };
  const calendarTitle = (task: Task, range?: PlannedRange) => {
    const taskTitle = task.title.trim();
    if (!range) return taskTitle;
    const workTitle = scheduleTitle(task, range).trim();
    return workTitle && workTitle !== taskTitle ? `${workTitle} | ${taskTitle}` : taskTitle;
  };
  const copyCalendarTitle = async (key: string, task: Task, range?: PlannedRange) => {
    const text = calendarTitle(task, range);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopiedCalendarKey(key);
    window.setTimeout(() => setCopiedCalendarKey((current) => current === key ? "" : current), 1600);
  };
  const calendarCopyButton = (key: string, task: Task, range?: PlannedRange) => <button
    type="button"
    className={`today-calendar-copy ${copiedCalendarKey === key ? "is-copied" : ""}`}
    title={`${calendarTitle(task, range)} をカレンダー用にコピー`}
    aria-label={`${calendarTitle(task, range)}をカレンダー用にコピー`}
    onClick={() => void copyCalendarTitle(key, task, range)}
  ><span aria-hidden="true">▣</span>{copiedCalendarKey === key ? "コピー済み" : "予定をコピー"}</button>;
  const scheduledItems: ScheduledItem[] = tasks.flatMap((task) => {
    const activeRanges = [...task.plannedRanges]
      // 予定データ自体は残すが、プロジェクト作業・マイルストーンの達成日より
      // 後の日付では「今日すること」「対応順」へ再表示しない。
      .filter((range) => isPlannedRangeForDate(range, date) && !isAfterProjectSourceCompletion(range))
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
    return activeRanges.map((range) => {
      // 表示対象を絞る前の件数からキーを決め、上位項目の完了でキーが変化しないようにする。
      // 日別メモ・達成・実績を予定単位で分離するため、常に予定IDを含める。
      const planKey = `${date}::${range.id}`;
      return { task, range, planKey };
    });
  });
  // 持ち越しはカレンダー上の翌日ではなく、土日・祝日・休暇を除いた次の営業日へ送る。
  const carryDestination = getNextWorkingDate(date, periods, workingDateOverrides);
  const advanceCandidates: ScheduledItem[] = tasks.flatMap((task) => isTerminalStatus(task.status) || task.status === "recurring" ? [] : task.plannedRanges
    .filter((range) => range.startDate > date && range.status !== "completed"
      && !isCompletedProjectSource(range)
      && (!range.sourceId || range.sourceType === "project-work"))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate))
    .map((range) => ({ task, range, planKey: `${range.startDate}::${range.id}` })));
  const normalizedAdvanceSearch = advanceSearch.trim().toLocaleLowerCase("ja");
  const visibleAdvanceCandidates = advanceCandidates.filter(({ task, range }) => !normalizedAdvanceSearch || [
    task.title, range.title, range.description, range.note, range.startDate, range.endDate, range.sourceType === "project-work" ? "プロジェクト 作業項目" : "",
  ].some((value) => String(value || "").toLocaleLowerCase("ja").includes(normalizedAdvanceSearch)));
  const carryItemKey = ({ task, range }: ScheduledItem) => `${task.id}:${range.id}`;
  const itemActualHours = ({ task, planKey }: ScheduledItem) => {
    return Number(task.dailyActualHours?.[planKey]) || 0;
  };
  const itemCarriedForward = ({ task, range: sourceRange }: ScheduledItem) => task.plannedRanges.some((range) =>
    ((range.carriedOverDates?.includes(date) && range.id === sourceRange.id)
      || (range.carriedOverFrom === date &&
      (range.carriedOverSourceRangeId === sourceRange.id || (!range.carriedOverSourceRangeId &&
      (range.title || "") === (sourceRange.title || "") &&
      (range.description || range.note || "") === (sourceRange.description || sourceRange.note || ""))))));
  const itemDailyAchieved = ({ task, planKey }: ScheduledItem) => Boolean(task.dailyPlanCompleted[planKey]);
  // 今日ページでは予定範囲や上位項目の完了を、日別作業の達成として扱わない。
  const itemCompleted = (item: ScheduledItem) => itemDailyAchieved(item);
  const itemStatus = ({ task, planKey }: ScheduledItem) => task.dailyPlanStatuses?.[planKey] || task.status;
  const incomplete = (task: Task) => !isTerminalStatus(task.status) && task.status !== "recurring" && task.status !== "pending";
  // マイルストーン・プロジェクト作業の完了状態では日別記録を隠さない。
  // 対応済み記録は保持するが、終了済みタスクの未対応予定は「やること」へ戻さない。
  const carriedForwardItems = scheduledItems.filter((item) => incomplete(item.task) && !itemCompleted(item) && itemCarriedForward(item)).map((item) => ({ ...item, carriedForward: true }));
  // Keep the schedule itself, but a non-working day is not an actionable workday.
  // Completed daily records remain visible below as history.
  const planned = nonWorking ? [] : scheduledItems.filter((item) => incomplete(item.task) && !itemCompleted(item) && !itemCarriedForward(item) && !WAITING_STATUSES.includes(itemStatus(item)));
  const waiting = nonWorking ? [] : scheduledItems.filter((item) => incomplete(item.task) && !itemCompleted(item) && !itemCarriedForward(item) && WAITING_STATUSES.includes(itemStatus(item)));
  const waitingReviews = nonWorking ? [] : tasks.filter((task) => incomplete(task)
    && Boolean(task.waitingFollowUp?.reviewDate)
    && (date === todayValue() ? task.waitingFollowUp!.reviewDate <= date : task.waitingFollowUp!.reviewDate === date));
  // 今日ページの「達成」と、予定・作業自体の「完了」は別の記録として扱う。
  const achieved = scheduledItems.filter((item) => itemDailyAchieved(item));
  const carryCandidates = [...planned, ...waiting].filter((item) => incomplete(item.task) && !itemCarriedForward(item));
  const carryableItemKeys = new Set(carryCandidates.map(carryItemKey));
  const overdue = tasks.filter((task) => incomplete(task) && !isTaskPlannedForDate(task, date) && task.plannedRanges.some((range) => range.startDate < date));
  const reminders = tasks.filter((task) => incomplete(task) && task.reminderDate && task.reminderDate <= date && !isTaskPlannedForDate(task, date));
  const cancelledCompletionIds = new Set(activity.filter((event) => event.type === "task-completion-cancelled")
    .map((event) => event.details?.completionEventId)
    .filter((id): id is string => typeof id === "string"));
  const completionEvents = activity.filter((event) =>
    event.taskId
    && localDateValue(event.timestamp) === date
    && !cancelledCompletionIds.has(event.id)
    && (event.type === "task-completed" || (event.type === "task-updated" && !/再開|取り消/.test(event.summary) && /「完了」へ変更|完了にしました|タスクを完了しました/.test(event.summary))));
  const completionEventByTask = new Map<string, ActivityEvent>();
  completionEvents.forEach((event) => { if (event.taskId) completionEventByTask.set(event.taskId, event); });
  const completionTaskIds = new Set(completionEventByTask.keys());
  const endedWithoutCompletionOnDate = (task: Task) =>
    (task.status === "cancelled" || task.status === "handed-over")
    && Boolean(task.completedAt && localDateValue(task.completedAt) === date);
  const completed = tasks.filter((task) =>
    (completionTaskIds.has(task.id) && !endedWithoutCompletionOnDate(task))
    || (task.status === "done" && task.completedAt && localDateValue(task.completedAt) === date));
  const stopped = tasks.filter(endedWithoutCompletionOnDate);
  const heldOnDate = (task: Task) => task.status === "pending" && (
    activity.some((event) => event.taskId === task.id
      && localDateValue(event.timestamp) === date
      && event.details?.toStatus === "pending")
    || task.history.some((entry) => localDateValue(entry.timestamp) === date
      && /ステータス.*「?保留」?.*変更/.test(entry.text))
  );
  const held = tasks.filter(heldOnDate);
  const occurrences: Occurrence[] = [];
  tasks.filter((task) => task.status === "recurring").forEach((task) => {
    if (isRecurringDue(task, date, periods, workingDateOverrides)) occurrences.push({ task, occurrenceDate: date });
    task.recurrenceRecords.forEach((record) => { const display = record.status === "moved" ? record.movedTo : record.actualDate; if (display === date && record.date !== date && !occurrences.some((item) => item.task.id === task.id && item.occurrenceDate === record.date)) occurrences.push({ task, occurrenceDate: record.date }); });
  });
  const completedRecurringCount = occurrences.filter(({ task, occurrenceDate }) => task.recurrenceRecords.find((item) => item.date === occurrenceDate)?.status === "done").length;
  const skippedRecurringCount = occurrences.filter(({ task, occurrenceDate }) => task.recurrenceRecords.find((item) => item.date === occurrenceDate)?.status === "skipped").length;
  const isHiddenRecurringOccurrence = ({ task, occurrenceDate }: Occurrence) => {
    const record = task.recurrenceRecords.find((item) => item.date === occurrenceDate);
    return record?.status === "moved" && occurrenceDate === date;
  };
  const visibleOccurrences = occurrences.filter((occurrence) => {
    if (isHiddenRecurringOccurrence(occurrence)) return false;
    const status = occurrence.task.recurrenceRecords.find((item) => item.date === occurrence.occurrenceDate)?.status;
    if (status === "done" && !showCompletedRecurring) return false;
    if (status === "skipped" && !showSkippedRecurring) return false;
    return true;
  });
  const orderableOccurrences = nonWorking ? [] : visibleOccurrences.filter(({ task, occurrenceDate }) => {
    const status = task.recurrenceRecords.find((item) => item.date === occurrenceDate)?.status;
    // 移動先では記録が "moved" のままでも、その日に対応する未実施項目として並べられるようにする。
    // 移動元の項目は visibleOccurrences の前段で非表示にしている。
    return status !== "done" && status !== "skipped";
  });
  const unsetOrderPrefix = "unset:";
  const executionItemKey = (item: ExecutionItem) => item.kind === "scheduled"
    ? carryItemKey(item.scheduled)
    : `recurring:${item.occurrence.task.id}:${item.occurrence.occurrenceDate}`;
  const orderableItems: ExecutionItem[] = [
    ...planned.map((scheduled): ExecutionItem => ({ kind: "scheduled", scheduled })),
    ...waiting.map((scheduled): ExecutionItem => ({ kind: "scheduled", scheduled })),
    ...orderableOccurrences.map((occurrence): ExecutionItem => ({ kind: "recurring", occurrence })),
  ];
  const activeOrderKeys = new Set(orderableItems.map(executionItemKey));
  const storedQueueKeys = todayOrder.filter((key) => !key.startsWith(unsetOrderPrefix) && activeOrderKeys.has(key));
  const storedUnsetKeys = todayOrder.filter((key) => key.startsWith(unsetOrderPrefix)).map((key) => key.slice(unsetOrderPrefix.length)).filter((key) => activeOrderKeys.has(key));
  const representedOrderKeys = new Set([...storedQueueKeys, ...storedUnsetKeys]);
  const newOrderKeys = orderableItems.map(executionItemKey).filter((key) => !representedOrderKeys.has(key));
  const executionQueueKeys = [...storedQueueKeys, ...newOrderKeys];
  const itemByOrderKey = new Map(orderableItems.map((item) => [executionItemKey(item), item]));
  const executionQueue = executionQueueKeys.map((key) => itemByOrderKey.get(key)).filter((item): item is ExecutionItem => Boolean(item));
  const executionUnset = storedUnsetKeys.map((key) => itemByOrderKey.get(key)).filter((item): item is ExecutionItem => Boolean(item));
  const dashboardOccurrences = occurrences.filter((occurrence) => !isHiddenRecurringOccurrence(occurrence));
  const dashboardCountableOccurrences = dashboardOccurrences.filter(({ task, occurrenceDate }) =>
    task.recurrenceRecords.find((item) => item.date === occurrenceDate)?.status !== "skipped");
  const recurringDone = dashboardCountableOccurrences.filter(({ task, occurrenceDate }) => task.recurrenceRecords.find((item) => item.date === occurrenceDate)?.status === "done").length;
  const dashboardTaskMap = new Map<string, Task>();
  [...planned, ...waiting, ...achieved].forEach(({ task }) => dashboardTaskMap.set(task.id, task));
  dashboardOccurrences.map(({ task }) => task).forEach((task) => dashboardTaskMap.set(task.id, task));
  const dashboardTasks = [...dashboardTaskMap.values()];
  // 画面に表示している単位だけを集計する。予定範囲の完了状態は、日別作業の
  // 対応済みやタスク完了と重複するため、別件として加算しない。
  const dashboardTotal = planned.length + waiting.length + waitingReviews.length + achieved.length;
  const dashboardCompleted = achieved.length;
  const dashboardRemaining = Math.max(0, dashboardTotal - dashboardCompleted);
  const dashboardRemainingItems = [
    ...planned.map(({ task, range }) => ({ key: `planned:${task.id}:${range.id}`, kind: "予定", title: range.title || range.note || task.title })),
    ...waiting.map(({ task, range }) => ({ key: `waiting:${task.id}:${range.id}`, kind: "待ち", title: range.title || range.note || task.title })),
    ...waitingReviews.map((task) => ({ key: `waiting-review:${task.id}`, kind: "状況確認", title: task.title })),
  ];
  const dashboardPlannedHours = dashboardTasks.reduce((sum, task) => sum + (task.status === "recurring" ? Number(task.plannedHours) || 0 : plannedHoursForDate(task, date, periods, workingDateOverrides)), 0);
  const dashboardActualHours = tasks.reduce((sum, task) => sum + Object.entries(task.dailyActualHours || {}).reduce((taskTotal, [planKey, hours]) => (
    planKey === date || planKey.startsWith(`${date}::`) ? taskTotal + (Number(hours) || 0) : taskTotal
  ), 0), 0);
  const dashboardProgress = dashboardTotal ? Math.round((dashboardCompleted / dashboardTotal) * 100) : 0;
  const formatHours = (hours: number) => Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  const toggleCompletedRecurring = (value: boolean) => {
    setShowCompletedRecurring(value);
    localStorage.setItem("chatTaskShowCompletedRecurring", String(value));
  };
  const changeGroupByTag = (value: boolean) => {
    setGroupByTag(value);
    localStorage.setItem("chatTaskTodayGroupByTag", String(value));
  };
  useEffect(() => () => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
  }, []);
  useEffect(() => {
    setMemoOpen(false);
    setSelectedCarryTaskIds(new Set());
    setCarrySelectionMode(false);
    setMoveTarget(null);
    setEntryTarget(null);
    setCarryHistoryTarget(null);
    setRecurrenceDetailTarget(null);
    setExpandedTaskKeys(new Set());
    setExecutionGroupsState({ date, groups: readExecutionGroups(date) });
    setExecutionGroupDialogOpen(false);
    setExecutionGroupName("");
    setSelectedExecutionGroupKeys(new Set());
    setExpandedExecutionGroupIds(new Set());
    setExecutionLaterOpen(false);
    setAdvanceDialogOpen(false);
    setAdvanceTargetKey("");
    setAdvanceSearch("");
    setAdvanceDate(date);
  }, [date]);
  useEffect(() => {
    setEntryTarget((current) => {
      if (!current) return null;
      const latestTask = tasks.find((task) => task.id === current.task.id);
      if (!latestTask) return null;
      const latestRange = latestTask.plannedRanges.find((range) => range.id === current.range.id) || current.range;
      if (latestTask === current.task && latestRange === current.range) return current;
      return { ...current, task: latestTask, range: latestRange };
    });
  }, [tasks]);
  useEffect(() => {
    setCarryHistoryTarget((current) => {
      if (!current) return null;
      const latestTask = tasks.find((task) => task.id === current.task.id);
      return latestTask ? { ...current, task: latestTask } : null;
    });
  }, [tasks]);
  useEffect(() => {
    setRecurrenceDetailTarget((current) => {
      if (!current) return null;
      const latestTask = tasks.find((task) => task.id === current.task.id);
      return latestTask ? { ...current, task: latestTask } : null;
    });
  }, [tasks]);
  useEffect(() => {
    if (!finalized) return;
    setSelectedCarryTaskIds(new Set());
    setCarrySelectionMode(false);
    setMoveTarget(null);
  }, [finalized]);
  const openTask = (task: Task) => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => {
      onSelect(task.id);
      onClose();
      openTimer.current = null;
    }, 220);
  };
  const finalizeDay = () => {
    const statusSnapshots = new Map<string, Record<string, Task["status"]>>();
    scheduledItems.forEach((item) => {
      const statuses = statusSnapshots.get(item.task.id) || { ...(item.task.dailyPlanStatuses || {}) };
      statuses[item.planKey] = itemStatus(item);
      statusSnapshots.set(item.task.id, statuses);
    });
    statusSnapshots.forEach((dailyPlanStatuses, taskId) => onUpdateTask(taskId, { dailyPlanStatuses }));
    onFinalize();
  };
  const unfinalizeDay = () => {
    onUnfinalize();
  };
  const withCommentMemo = (task: Task, changes: Partial<Task>, content: string, workTitle?: string, plannedHours?: number, actualHours?: number): Partial<Task> => {
    const text = content.trim();
    if (!text) return changes;
    const normalizedWorkTitle = workTitle?.trim();
    return {
      ...changes,
      history: [...task.history, {
        id: generateId(),
        type: "comment",
        text,
        timestamp: new Date().toISOString(),
        ...(normalizedWorkTitle && normalizedWorkTitle !== task.title.trim() ? { workTitle: normalizedWorkTitle } : {}),
        ...(Number(plannedHours) > 0 ? { workPlannedHours: Number(plannedHours) } : {}),
        ...(Number(actualHours) > 0 ? { workActualHours: Number(actualHours) } : {}),
      }],
    };
  };
  const setOccurrence = (task: Task, occurrenceDate: string, status: "done" | "skipped" | "pending", memoOverride?: string) => {
    if (finalized) return;
    const existing = task.recurrenceRecords.find((item) => item.date === occurrenceDate);
    const records = task.recurrenceRecords.filter((item) => item.date !== occurrenceDate);
    const memo = memoOverride ?? existing?.memo ?? task.recurrenceMemoTemplate;
    if (status !== "pending" || memo) records.push({
      ...existing,
      date: occurrenceDate,
      status,
      actualDate: date,
      memo,
      timestamp: new Date().toISOString(),
    });
    const changes = status === "done" || status === "skipped"
      ? withCommentMemo(task, { recurrenceRecords: records }, memo)
      : { recurrenceRecords: records };
    onUpdateTask(task.id, changes, status === "done" ? "定期タスクを実施しました。" : status === "skipped" ? "定期タスクをスキップしました。" : "定期タスクの記録を取り消しました。");
  };
  const updateOccurrenceMemo = (task: Task, occurrenceDate: string, memo: string) => {
    if (finalized) return;
    const existing = task.recurrenceRecords.find((item) => item.date === occurrenceDate);
    const record: RecurrenceRecord = {
      date: occurrenceDate,
      status: existing?.status || "pending",
      actualDate: existing?.actualDate || date,
      movedTo: existing?.movedTo,
      moveReason: existing?.moveReason,
      memo,
      timestamp: existing?.timestamp || new Date().toISOString(),
    };
    onUpdateTask(task.id, { recurrenceRecords: [...task.recurrenceRecords.filter((item) => item.date !== occurrenceDate), record] });
  };
  const closeRecurrenceDetail = () => {
    if (recurrenceDetailTarget && !finalized) updateOccurrenceMemo(recurrenceDetailTarget.task, recurrenceDetailTarget.occurrenceDate, recurrenceMemoDraft);
    setRecurrenceDetailTarget(null);
  };
  const changeOccurrenceDate = (task: Task, occurrenceDate: string, nextDate: string) => {
    if (finalized || !nextDate) return;
    const existing = task.recurrenceRecords.find((item) => item.date === occurrenceDate);
    const currentDisplayDate = existing?.status === "moved" && existing.movedTo ? existing.movedTo : occurrenceDate;
    if (nextDate === currentDisplayDate) return;
    const conflicts = task.recurrenceRecords.some((item) => item.date !== occurrenceDate && (item.date === nextDate || item.movedTo === nextDate));
    if (conflicts) return alert("変更先の日付には、すでにこの定期タスクの記録があります。");
    const record: RecurrenceRecord = {
      ...existing,
      date: occurrenceDate,
      status: nextDate === occurrenceDate ? "pending" : "moved",
      actualDate: existing?.actualDate || date,
      movedTo: nextDate === occurrenceDate ? undefined : nextDate,
      memo: existing?.memo ?? task.recurrenceMemoTemplate,
      timestamp: new Date().toISOString(),
    };
    onUpdateTask(task.id, {
      recurrenceRecords: [...task.recurrenceRecords.filter((item) => item.date !== occurrenceDate), record],
    }, `定期タスクの日付を${currentDisplayDate}から${nextDate}へ変更しました。`);
  };
  const submitMove = () => {
    if (finalized) return;
    if (!moveTarget || !moveDate || moveDate === moveTarget.occurrenceDate) return alert("元の予定日とは異なる日付を指定してください。");
    const existing = moveTarget.task.recurrenceRecords.find((item) => item.date === moveTarget.occurrenceDate);
    const record: RecurrenceRecord = { date: moveTarget.occurrenceDate, status: "moved", movedTo: moveDate, moveReason: moveReason.trim(), memo: existing?.memo ?? moveTarget.task.recurrenceMemoTemplate, timestamp: new Date().toISOString() };
    onUpdateTask(moveTarget.task.id, { recurrenceRecords: [...moveTarget.task.recurrenceRecords.filter((item) => item.date !== moveTarget.occurrenceDate), record] }, `定期タスクを${moveDate}へ移動しました。`); setMoveTarget(null);
  };
  const openAdvanceDialog = () => {
    if (!advanceCandidates.length) return alert("前倒しできる未来の予定はありません。");
    const first = advanceCandidates[0];
    setAdvanceTargetKey(`${first.task.id}:${first.range.id}`);
    setAdvanceSearch("");
    setAdvanceDate(date);
    setAdvanceHours(Number(first.range.plannedHours) > 0 ? String(first.range.plannedHours) : "");
    setAdvanceReason("");
    setAdvanceDialogOpen(true);
  };
  const advanceSchedule = () => {
    const target = advanceCandidates.find(({ task, range }) => `${task.id}:${range.id}` === advanceTargetKey);
    if (!target || !advanceDate) return;
    if (advanceDate >= target.range.startDate) return alert("現在の開始日より前の日付を指定してください。");
    const totalHours = Math.max(0, Number(target.range.plannedHours) || 0);
    const requestedHours = totalHours > 0 ? Math.max(0, Number(advanceHours) || 0) : 0;
    if (totalHours > 0 && (requestedHours <= 0 || requestedHours > totalHours)) return alert(`前倒し工数は0より大きく、${formatHours(totalHours)}h以下で指定してください。`);
    const partial = totalHours > 0 && requestedHours < totalHours;
    const duration = Math.max(0, Math.round((new Date(`${target.range.endDate}T00:00:00Z`).getTime() - new Date(`${target.range.startDate}T00:00:00Z`).getTime()) / 86_400_000));
    const movedRange: PlannedRange = {
      ...target.range,
      id: partial ? generateId() : target.range.id,
      startDate: advanceDate,
      endDate: partial ? advanceDate : addDays(advanceDate, duration),
      plannedHours: partial ? requestedHours : target.range.plannedHours,
      advancedFromStartDate: target.range.advancedFromStartDate || target.range.startDate,
      advancedFromEndDate: target.range.advancedFromEndDate || target.range.endDate,
      advancedSourceRangeId: partial ? target.range.id : undefined,
      advanceReason: advanceReason.trim(),
      advancedAt: new Date().toISOString(),
    };
    const plannedRanges = partial
      ? target.task.plannedRanges.flatMap((range) => range.id === target.range.id
        ? [{ ...range, plannedHours: totalHours - requestedHours }, movedRange]
        : [range])
      : target.task.plannedRanges.map((range) => range.id === target.range.id ? movedRange : range);
    onUpdateTask(target.task.id, {
      plannedRanges,
    }, `予定「${target.range.title || target.task.title}」${partial ? `のうち${formatHours(requestedHours)}hを` : "を"}${target.range.startDate}から${advanceDate}へ前倒ししました。${advanceReason.trim() ? ` 理由：${advanceReason.trim()}` : ""}`);
    setAdvanceDialogOpen(false);
  };
  const cancelAdvance = (task: Task, range: PlannedRange) => {
    if (!range.advancedFromStartDate || !range.advancedFromEndDate || finalized) return;
    if (range.advancedSourceRangeId) {
      const source = task.plannedRanges.find((item) => item.id === range.advancedSourceRangeId);
      onUpdateTask(task.id, {
        plannedRanges: task.plannedRanges
          .filter((item) => item.id !== range.id)
          .map((item) => item.id === range.advancedSourceRangeId
            ? { ...item, plannedHours: (Number(item.plannedHours) || 0) + (Number(range.plannedHours) || 0) }
            : item),
      }, `予定「${range.title || task.title}」の一部前倒しを取り消しました。`);
      if (!source) alert("元の予定が見つからなかったため、前倒し分だけを削除しました。");
      return;
    }
    onUpdateTask(task.id, {
      plannedRanges: task.plannedRanges.map((item) => item.id === range.id ? {
        ...item,
        startDate: range.advancedFromStartDate!,
        endDate: range.advancedFromEndDate!,
        advancedFromStartDate: undefined,
        advancedFromEndDate: undefined,
        advancedSourceRangeId: undefined,
        advanceReason: undefined,
        advancedAt: undefined,
      } : item),
    }, `予定「${range.title || task.title}」の前倒しを取り消しました。`);
  };
  const carryTasks = (selectedOnly = false, explicitTargets?: ScheduledItem[]) => {
    if (finalized) return;
    const destination = carryDestination;
    const targets = explicitTargets || carryCandidates.filter((item) => !selectedOnly || selectedCarryTaskIds.has(carryItemKey(item)));
    if (!explicitTargets && selectedOnly && !selectedCarryTaskIds.size) return alert("次の営業日に回すタスクを選択してください。");
    if (!targets.length) return alert("持ち越す未完了タスクはありません。");
    const targetsByTask = new Map<string, ScheduledItem[]>();
    targets.forEach((item) => targetsByTask.set(item.task.id, [...(targetsByTask.get(item.task.id) || []), item]));
    const carryTaskItems = (task: Task, items: ScheduledItem[]) => {
      const dailyPlanStatuses = { ...(task.dailyPlanStatuses || {}) };
      const dailyPlans = { ...(task.dailyPlans || {}) };
      const targetIds = new Set(items.map(({ range }) => range.id));
      const sourcePlanKeys = new Map(items.map((item) => [item.range.id, item.planKey]));
      const integrations = new Map<string, { source: ScheduledItem; destination: PlannedRange; destinationPlanKey: string }>();
      items.forEach((item) => {
        const destinationRanges = task.plannedRanges.filter((range) => range.startDate <= destination && range.endDate >= destination);
        // 同じタスクに翌日の別予定があっても統合しない。同一予定が翌日まで
        // 続いている場合か、過去の持ち越しで明示的に紐づいた予定だけを統合する。
        const destinationRange = destinationRanges.find((range) => range.id === item.range.id)
          || destinationRanges.find((range) => range.carriedOverSourceRangeId === item.range.id);
        if (!destinationRange) return;
        const destinationPlanKey = destinationRanges.length > 1 || destinationRange.sourceId || destinationRange.carriedOverSourceRangeId || destinationRange.carriedOverDates?.length
          ? `${destination}::${destinationRange.id}`
          : destination;
        integrations.set(item.range.id, { source: item, destination: destinationRange, destinationPlanKey });
        const sourceMemo = (task.dailyPlans[item.planKey] || item.range.description || item.range.note || "").trim();
        const existingMemo = (dailyPlans[destinationPlanKey] || "").trim();
        if (sourceMemo && !existingMemo.includes(sourceMemo)) dailyPlans[destinationPlanKey] = [existingMemo, `【${date}から持ち越し】\n${sourceMemo}`].filter(Boolean).join("\n\n");
        const statusAtCarry = dailyPlanStatuses[item.planKey] || task.status;
        dailyPlanStatuses[item.planKey] = statusAtCarry;
        if (!dailyPlanStatuses[destinationPlanKey]) dailyPlanStatuses[destinationPlanKey] = statusAtCarry;
      });
      const plannedRanges = task.plannedRanges.map((range) => {
        if (!targetIds.has(range.id)) return range;
        const sourcePlanKey = sourcePlanKeys.get(range.id) || date;
        const sourceItem = items.find((item) => item.range.id === range.id);
        const workedOnCarryDate = sourceItem ? itemActualHours(sourceItem) > 0 : false;
        const integration = integrations.get(range.id);
        if (integration) {
          return {
            ...range,
            carriedOverDates: [...new Set([...(range.carriedOverDates || []), date])].sort(),
            carriedOverWork: { ...(range.carriedOverWork || {}), [date]: workedOnCarryDate },
          };
        }
        const extendedRange = {
          ...range,
          endDate: range.endDate > destination ? range.endDate : destination,
          originalEndDate: range.originalEndDate || range.endDate,
          carriedOverDates: [...new Set([...(range.carriedOverDates || []), date])].sort(),
          carriedOverWork: { ...(range.carriedOverWork || {}), [date]: workedOnCarryDate },
          completedAt: undefined,
        };
        const destinationPlanKey = `${destination}::${range.id}`;
        const statusAtCarry = dailyPlanStatuses[sourcePlanKey] || task.status;
        dailyPlanStatuses[sourcePlanKey] = statusAtCarry;
        dailyPlanStatuses[destinationPlanKey] = statusAtCarry;
        return extendedRange;
      }).map((range) => {
        const integration = [...integrations.values()].find(({ source, destination: destinationRange }) => source.range.id !== destinationRange.id && destinationRange.id === range.id);
        return integration ? { ...range, carriedOverFrom: date, carriedOverSourceRangeId: integration.source.range.id } : range;
      });
      onUpdateTask(task.id, {
        // 別々に登録された予定は、題名や工数が同じでも別カードのまま保持する。
        plannedRanges,
        dailyPlans,
        dailyPlanStatuses,
      }, `${date}の予定${items.length > 1 ? `${items.length}件` : `「${items[0].range.title || items[0].task.title}」`}を${integrations.size ? `${destination}の既存予定へ統合` : `残して${destination}へ持ち越し`}しました。`);
    };
    if (!explicitTargets && selectedOnly) {
      targetsByTask.forEach((items) => carryTaskItems(items[0].task, items));
      setSelectedCarryTaskIds(new Set());
      setCarrySelectionMode(false);
      return;
    }
    const confirmation = explicitTargets?.length === 1
      ? `「${explicitTargets[0].range.title || explicitTargets[0].task.title}」を${destination}へ持ち越しますか？\n\n前倒しと当日の作業記録は履歴に残ります。`
      : `${targets.length}件を${destination}へ持ち越しますか？`;
    if (!confirm(confirmation)) return;
    targetsByTask.forEach((items) => carryTaskItems(items[0].task, items));
  };
  const updateDailyActual = (task: Task, value: number, planKey = date) => {
    if (finalized) return;
    const hours = Math.max(0, value || 0);
    const dailyActualHours = { ...(task.dailyActualHours || {}), [planKey]: hours };
    onUpdateTask(task.id, {
      dailyActualHours,
      actualHours: Object.values(dailyActualHours).reduce((sum, dailyHours) => sum + (Number(dailyHours) || 0), 0),
    });
  };
  const chooseTimer = (task: Task, planKey: string, plannedHours: number) => {
    if (finalized) return;
    const suggestedMinutes = plannedHours > 0 ? Math.max(1, Math.round(plannedHours * 60)) : 30;
    setCustomTimerMinutes(String(suggestedMinutes));
    setTimerTarget({ task, planKey, suggestedMinutes, hasPlannedHours: plannedHours > 0 });
  };
  const startTimer = (minutes: number) => {
    if (!timerTarget || minutes <= 0) return;
    if (onStartTimer(timerTarget.task, timerTarget.planKey, minutes, timerTarget.hasPlannedHours)) {
      setTimerTarget(null);
      onClose();
    }
  };
  const commitDailyActual = (task: Task, key: string, planKey = date) => {
    const draft = actualDrafts[key];
    if (draft === undefined) return;
    updateDailyActual(task, Number(draft), planKey);
    setActualDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };
  const statusBadge = (task: Task, item?: ScheduledItem) => {
    const delayed = Boolean(item?.range.originalEndDate && date > item.range.originalEndDate && !itemCompleted(item));
    // 日別作業の達成と、親タスク自体の完了は別の状態として表示する。
    // 完了カードだけはタスク状態を使い、予定カードには親タスクの完了を伝播させない。
    if (item && itemDailyAchieved(item) && !item.planKey.startsWith("completion::")) {
      return <span className="today-status-badge done" title="この日の作業は対応済みです">対応済み</span>;
    }
    const taskCompletionCard = Boolean(item?.planKey.startsWith("completion::"));
    const projectSourceCompleted = Boolean(item && isCompletedProjectSource(item.range));
    const status = taskCompletionCard
      ? task.status
      : item?.range.status === "completed" || projectSourceCompleted
        ? "done"
        : item ? (task.dailyPlanStatuses?.[item.planKey] || (isTerminalStatus(task.status) ? "todo" : task.status)) : task.status;
    const tone = delayed ? "overdue" : status === "done" ? "done" : WAITING_STATUSES.includes(status) ? "waiting" : status === "doing" ? "doing" : "todo";
    const label = !taskCompletionCard && (item?.range.status === "completed" || projectSourceCompleted) ? "作業完了" : STATUS_LABELS[status];
    return <span className={`today-status-badge ${tone}`} title={taskCompletionCard ? "タスクのステータスです" : "この日の作業ステータスです"}>{delayed ? "遅延" : label}</span>;
  };
  const actualInput = (task: Task, item?: ScheduledItem) => {
    const scheduleNotes = item ? [item.range.description || item.range.note].filter(Boolean) : task.plannedRanges.filter((range) => range.startDate <= date && range.endDate >= date && (range.description || range.note)).map((range) => range.description || range.note);
    const dailyPlannedHours = item
      ? plannedRangeHoursForDate(item.range, date, periods, workingDateOverrides)
      : task.status === "recurring" ? Number(task.plannedHours) || 0 : plannedHoursForDate(task, date, periods, workingDateOverrides);
    const planKey = item?.planKey || date;
    const draftKey = `${task.id}:${planKey}`;
    const storedValue = task.dailyActualHours?.[planKey];
    const inputValue = actualDrafts[draftKey] ?? (storedValue === undefined ? "" : String(storedValue));
    return <>{scheduleNotes.length > 0 && <div className="today-schedule-note"><strong>予定内容</strong>{scheduleNotes.map((text, index) => <p key={`${index}-${text}`}>{text}</p>)}</div>}<label className="today-effort">この日の実績工数（時間）<input type="number" min="0" step="0.25" value={inputValue} disabled={finalized} onChange={(event) => setActualDrafts((current) => ({ ...current, [draftKey]: event.target.value }))} onBlur={() => commitDailyActual(task, draftKey, planKey)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /><small>実績累計 {formatHours(Number(task.actualHours) || 0)}h / 1日あたりの予定 {formatHours(dailyPlannedHours)}h</small></label></>;
  };
  const taskCard = (item: ScheduledItem, completionEvent?: ActivityEvent, carrySelectable = false, taskOnly = false, showNextSchedule = false, showCalendarCopy = true) => {
    const { task, range, planKey } = item;
    const cardKey = `${task.id}:${planKey}`;
    const dailyAchieved = Boolean(task.dailyPlanCompleted[planKey]);
    const taskDone = isTerminalStatus(task.status);
    const confirmingCancel = completionEvent && completionCancelConfirmId === completionEvent.id;
    const carriedToTomorrow = task.plannedRanges.some((plannedRange) => plannedRange.carriedOverDates?.includes(date));
    const nextPlannedRange = showNextSchedule
      ? task.plannedRanges
        .filter((plannedRange) => plannedRange.status !== "completed" && plannedRange.startDate > date)
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate))[0]
      : undefined;
    const nextScheduleLabel = nextPlannedRange
      ? nextPlannedRange.startDate === nextPlannedRange.endDate
        ? nextPlannedRange.startDate
        : `${nextPlannedRange.startDate}〜${nextPlannedRange.endDate}`
      : "";
    const historicalCarry = Boolean(item.carriedForward);
    const expanded = expandedTaskKeys.has(cardKey);
    const plannedSummaryHours = Number(range.plannedHours) > 0 ? plannedRangeHoursForDate(range, date, periods, workingDateOverrides) : plannedHoursForDate(task, date, periods, workingDateOverrides);
    const actualSummaryHours = itemActualHours(item);
    const dailyPlanText = (task.dailyPlans[planKey] || "").trim();
    const carrySelectionKey = carryItemKey(item);
    const carryChoiceVisible = carrySelectable && carrySelectionMode && carryableItemKeys.has(carrySelectionKey);
    const carrySelected = selectedCarryTaskIds.has(carrySelectionKey);
    const toggleCarrySelection = (checked: boolean) => setSelectedCarryTaskIds((current) => {
      const next = new Set(current);
      if (checked) next.add(carrySelectionKey);
      else next.delete(carrySelectionKey);
      return next;
    });
    return <article key={cardKey} className={`today-card ${expanded ? "is-expanded" : "is-compact"} ${dailyAchieved ? "today-card-achieved" : ""} ${taskDone ? "today-card-completed" : ""} ${historicalCarry ? "today-card-carried-history" : ""} ${carryChoiceVisible ? "is-carry-selectable" : ""} ${carrySelected ? "is-carry-selected" : ""}`}>
      <div className="today-card-summary">
        {range.advancedFromStartDate && !finalized && !historicalCarry && !taskDone && !dailyAchieved && <details className="today-advance-menu">
          <summary aria-label="前倒しした予定の操作" title="前倒しした予定の操作">…</summary>
          <div>
            <strong>前倒しした予定</strong>
            <button type="button" onClick={() => {
              if (confirm(`この予定を元の日付（${range.advancedFromStartDate}${range.advancedFromEndDate !== range.advancedFromStartDate ? `〜${range.advancedFromEndDate}` : ""}）へ戻しますか？\n\n当日の作業記録は残ります。`)) cancelAdvance(task, range);
            }}><span aria-hidden="true">↩</span><span>元の日付へ戻す<small>{range.advancedFromStartDate}{range.advancedFromEndDate !== range.advancedFromStartDate ? `〜${range.advancedFromEndDate}` : ""}</small></span></button>
            <button type="button" onClick={() => carryTasks(false, [item])}><span aria-hidden="true">→</span><span>次の営業日へ持ち越す<small>{carryDestination}</small></span></button>
          </div>
        </details>}
        {carryChoiceVisible && <label className="today-carry-select today-carry-select-summary"><input type="checkbox" checked={carrySelected} disabled={finalized} onChange={(event) => toggleCarrySelection(event.target.checked)} /><span>次の営業日に回す</span></label>}
        <button className="today-task-title" onClick={() => openTask(task)}>{scheduleTitle(task, range)}</button>
        {scheduleTitle(task, range) !== task.title && <small className="today-source-task" title={task.title}>関連Task：{task.title}</small>}
        {!expanded && dailyPlanText && dailyPlanText !== (range.description || range.note) && <p className="today-plan-preview" title={`その日のメモ：${dailyPlanText}`}>{dailyPlanText}</p>}
        {showNextSchedule && !historicalCarry && !carriedToTomorrow && nextPlannedRange && <span className="tomorrow-schedule-badge">次の予定 {nextScheduleLabel}</span>}
        {historicalCarry && <span className="carryover-badge">→ {carryDestination}へ持ち越し済み</span>}
        {historicalCarry && <span className={`carry-work-badge ${range.carriedOverWork?.[date] ?? (actualSummaryHours > 0) ? "worked" : "not-worked"}`}>{range.carriedOverWork?.[date] ?? (actualSummaryHours > 0) ? "作業あり" : "作業なし"}</span>}
        <div className="today-card-actions">
          <span className={`priority priority-${task.priority}`}>{task.priority}</span>
          {statusBadge(task, item)}
          <small className="today-card-effort-summary">予定 {formatHours(plannedSummaryHours)}h / 実績 {formatHours(actualSummaryHours)}h</small>
          {!taskOnly && !historicalCarry && !taskDone && !dailyAchieved && <button type="button" className={`today-timer-start ${activeTimerTaskId === task.id ? "is-running" : ""}`} disabled={finalized || activeTimerTaskId === task.id} onClick={() => chooseTimer(task, planKey, plannedSummaryHours)}>{activeTimerTaskId === task.id ? "計測中" : "開始"}</button>}
          {showCalendarCopy && !historicalCarry && calendarCopyButton(`scheduled:${cardKey}`, task, taskOnly ? undefined : range)}
          <button type="button" className="today-card-expand" onClick={() => dailyAchieved ? setEntryTarget({ ...item, completionEvent }) : taskDone || taskOnly ? openTask(task) : historicalCarry ? setCarryHistoryTarget(item) : setEntryTarget({ ...item, completionEvent })}>{taskDone || taskOnly || historicalCarry ? "詳細" : "記録"}</button>
        </div>
      </div>
      {expanded && <div className="today-card-detail">
      {dailyAchieved && <span className="achievement-badge">✓ この日の対応済み</span>}
      {range.originalEndDate && date > range.originalEndDate && <span className="carryover-badge">期限 {range.originalEndDate}から遅延</span>}
      {range.advancedFromStartDate && <span className="advance-badge">← {range.advancedFromStartDate}{range.advancedFromEndDate !== range.advancedFromStartDate ? `〜${range.advancedFromEndDate}` : ""}から前倒し</span>}
      {carriedToTomorrow && <span className="carryover-badge">→ {carryDestination}へ持ち越し済み</span>}
      {!finalized && completionEvent && (confirmingCancel ? <span className="completion-cancel-confirm"><button type="button" onClick={() => setCompletionCancelConfirmId("")}>やめる</button><button type="button" className="danger" onClick={() => { onCancelCompletion(task.id, completionEvent.id); setCompletionCancelConfirmId(""); }}>取り消しを実行</button></span> : <button type="button" className="completion-cancel-button" onClick={() => setCompletionCancelConfirmId(completionEvent.id)}>完了を取り消す</button>)}
      {actualInput(task, item)}
      {!taskDone && <><textarea className={dailyAchieved ? "plan-completed" : ""} value={task.dailyPlans[planKey] || ""} readOnly={finalized} onChange={(event) => onUpdateTask(task.id, { dailyPlans: { ...task.dailyPlans, [planKey]: event.target.value } })} placeholder="この日にすること" /><div className="today-card-checks"><label className="check-label"><input type="checkbox" checked={dailyAchieved} disabled={finalized} onChange={(event) => { const achieved = event.target.checked; const changes = { dailyPlanCompleted: { ...task.dailyPlanCompleted, [planKey]: achieved } }; const title = scheduleTitle(task, range); onUpdateTask(task.id, achieved ? withCommentMemo(task, changes, task.dailyPlans[planKey] || "", title, plannedSummaryHours, actualSummaryHours) : changes, achieved ? `${date}の予定「${title}」を達成しました。` : `${date}の予定「${title}」を未達成へ戻しました。`); }} />{dailyAchieved ? "達成済み" : "達成"}</label></div></>}
      </div>}
    </article>;
  };
  const updateEntryPlan = (value: string) => {
    if (!entryTarget) return;
    const dailyPlans = { ...entryTarget.task.dailyPlans, [entryTarget.planKey]: value };
    setEntryTarget((current) => current ? { ...current, task: { ...current.task, dailyPlans } } : current);
    onUpdateTask(entryTarget.task.id, { dailyPlans });
  };
  const toggleEntryAchievement = () => {
    if (!entryTarget || finalized) return;
    const achieved = !entryTarget.task.dailyPlanCompleted[entryTarget.planKey];
    const dailyPlanCompleted = { ...entryTarget.task.dailyPlanCompleted, [entryTarget.planKey]: achieved };
    setEntryTarget((current) => current ? { ...current, task: { ...current.task, dailyPlanCompleted } } : current);
    const changes = { dailyPlanCompleted };
    const title = scheduleTitle(entryTarget.task, entryTarget.range);
    const plannedHours = Number(entryTarget.range.plannedHours) > 0
      ? plannedRangeHoursForDate(entryTarget.range, date, periods, workingDateOverrides)
      : plannedHoursForDate(entryTarget.task, date, periods, workingDateOverrides);
    const actualHours = itemActualHours(entryTarget);
    onUpdateTask(entryTarget.task.id, achieved ? withCommentMemo(entryTarget.task, changes, entryTarget.task.dailyPlans[entryTarget.planKey] || "", title, plannedHours, actualHours) : changes, achieved ? `${date}の予定「${title}」を達成しました。` : `${date}の予定「${title}」を未達成へ戻しました。`);
  };
  const cancelCarryForward = () => {
    if (!carryHistoryTarget?.carriedForward || finalized) return;
    const task = carryHistoryTarget.task;
    const carriedRanges = task.plannedRanges.filter((range) =>
      (range.carriedOverDates?.includes(date) && range.id === carryHistoryTarget.range.id)
      || (range.carriedOverFrom === date &&
      (range.carriedOverSourceRangeId === carryHistoryTarget.range.id || (!range.carriedOverSourceRangeId &&
        (range.title || "") === (carryHistoryTarget.range.title || "") &&
        (range.description || range.note || "") === (carryHistoryTarget.range.description || carryHistoryTarget.range.note || "")))));
    const carriedRangeIds = new Set(carriedRanges.map((range) => range.id));
    const integratedDestinations = task.plannedRanges.filter((range) => range.carriedOverFrom === date && Boolean(range.carriedOverSourceRangeId && carriedRangeIds.has(range.carriedOverSourceRangeId)));
    const destinationKeys = new Set([
      ...carriedRanges.map((range) => `${carryDestination}::${range.id}`),
      ...integratedDestinations.map((range) => `${carryDestination}::${range.id}`),
    ]);
    const integratedDestinationKeys = new Set(integratedDestinations.map((range) => `${carryDestination}::${range.id}`));
    const dailyPlans = { ...task.dailyPlans };
    const dailyPlanCompleted = { ...task.dailyPlanCompleted };
    const dailyPlanStatuses = { ...(task.dailyPlanStatuses || {}) };
    const dailyActualHours = { ...(task.dailyActualHours || {}) };
    destinationKeys.forEach((key) => {
      const sourceRangeId = task.plannedRanges.find((range) => key === `${carryDestination}::${range.id}`)?.carriedOverSourceRangeId;
      const sourceRange = sourceRangeId ? carriedRanges.find((range) => range.id === sourceRangeId) : undefined;
      const sourceMemo = sourceRange ? (task.dailyPlans[`${date}::${sourceRange.id}`] || task.dailyPlans[date] || sourceRange.description || sourceRange.note || "").trim() : "";
      if (sourceMemo && dailyPlans[key]) {
        const addition = `【${date}から持ち越し】\n${sourceMemo}`;
        const restored = dailyPlans[key].split("\n\n").filter((part) => part !== addition).join("\n\n").trim();
        if (restored) dailyPlans[key] = restored;
        else delete dailyPlans[key];
      } else {
        delete dailyPlans[key];
      }
      delete dailyPlanCompleted[key];
      if (!integratedDestinationKeys.has(key)) delete dailyPlanStatuses[key];
      delete dailyActualHours[key];
    });
    onUpdateTask(task.id, {
      plannedRanges: task.plannedRanges.map((range) => {
        if (integratedDestinations.some((destinationRange) => destinationRange.id === range.id)) return { ...range, carriedOverFrom: undefined, carriedOverSourceRangeId: undefined };
        if (!carriedRanges.some((carried) => carried.id === range.id)) return range;
        if (range.carriedOverDates?.includes(date)) {
          const carriedOverDates = range.carriedOverDates.filter((item) => item !== date);
          const carriedOverWork = { ...(range.carriedOverWork || {}) };
          delete carriedOverWork[date];
          const endDate = carriedOverDates.length ? addDays(carriedOverDates[carriedOverDates.length - 1], 1) : range.originalEndDate || date;
          return { ...range, endDate, carriedOverDates, carriedOverWork: Object.keys(carriedOverWork).length ? carriedOverWork : undefined, originalEndDate: carriedOverDates.length ? range.originalEndDate : undefined };
        }
        return range;
      }),
      dailyPlans,
      dailyPlanCompleted,
      dailyPlanStatuses,
      dailyActualHours,
      actualHours: Object.values(dailyActualHours).reduce((sum, dailyHours) => sum + (Number(dailyHours) || 0), 0),
    }, `${carryDestination}への持ち越しを取り消しました。`);
    setCarryHistoryTarget(null);
  };
  const sectionHeading = (title: string, count: number) => <div className="today-section-heading"><span>{title}<small>{count}件</small></span></div>;
  const executionGroups = executionGroupsState.date === date ? executionGroupsState.groups : [];
  const executionItemMap = new Map(executionQueue.map((item) => [executionItemKey(item), item]));
  const activeExecutionGroups = executionGroups.filter((group) => group.itemKeys.some((key) => activeOrderKeys.has(key)));
  const executionGroupByItemKey = new Map<string, ExecutionGroup>();
  activeExecutionGroups.forEach((group) => group.itemKeys.forEach((key) => executionGroupByItemKey.set(key, group)));
  const executionUnits: ExecutionUnit[] = [];
  const addedExecutionGroupIds = new Set<string>();
  executionQueue.forEach((item) => {
    const itemKey = executionItemKey(item);
    const group = executionGroupByItemKey.get(itemKey);
    if (!group) {
      executionUnits.push({ key: `item:${itemKey}`, items: [item] });
      return;
    }
    if (addedExecutionGroupIds.has(group.id)) return;
    addedExecutionGroupIds.add(group.id);
    executionUnits.push({ key: `group:${group.id}`, group, items: group.itemKeys.map((key) => executionItemMap.get(key)).filter((candidate): candidate is ExecutionItem => Boolean(candidate)) });
  });
  const groupedExecutionItemKeys = new Set(activeExecutionGroups.flatMap((group) => group.itemKeys));
  const groupableExecutionItems = executionQueue.filter((item) => !groupedExecutionItemKeys.has(executionItemKey(item)));
  const saveExecutionGroups = (groups: ExecutionGroup[]) => {
    setExecutionGroupsState({ date, groups });
    persistExecutionGroups(date, groups);
  };
  const executionQueueSignature = executionQueue.map(executionItemKey).join("|");
  useEffect(() => {
    if (executionGroupsState.date !== date || activeExecutionGroups.length === executionGroups.length) return;
    saveExecutionGroups(activeExecutionGroups);
  }, [date, executionQueueSignature, executionGroupsState]);
  const persistExecutionOrder = (queue: ExecutionItem[], unset = executionUnset) => {
    onTodayOrder([
      ...queue.map(executionItemKey),
      ...unset.map((item) => `${unsetOrderPrefix}${executionItemKey(item)}`),
    ]);
  };
  const moveExecutionUnit = (key: string, targetIndex: number) => {
    if (finalized) return;
    const currentIndex = executionUnits.findIndex((unit) => unit.key === key);
    if (currentIndex < 0) return;
    const next = [...executionUnits];
    const [moving] = next.splice(currentIndex, 1);
    next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, moving);
    persistExecutionOrder(next.flatMap((unit) => unit.items));
  };
  const removeFromExecutionOrder = (item: ExecutionItem) => {
    if (finalized) return;
    persistExecutionOrder(executionQueue.filter((candidate) => executionItemKey(candidate) !== executionItemKey(item)), [...executionUnset, item]);
  };
  const addToExecutionOrder = (item: ExecutionItem) => {
    if (finalized) return;
    persistExecutionOrder([...executionQueue, item], executionUnset.filter((candidate) => executionItemKey(candidate) !== executionItemKey(item)));
  };
  const openExecutionGroupDialog = () => {
    setExecutionGroupName("");
    setSelectedExecutionGroupKeys(new Set());
    setExecutionGroupDialogOpen(true);
  };
  const createExecutionGroup = () => {
    if (finalized || selectedExecutionGroupKeys.size < 2) return;
    const selectedItems = executionQueue.filter((item) => selectedExecutionGroupKeys.has(executionItemKey(item)));
    if (selectedItems.length < 2) return;
    const firstSelectedIndex = executionQueue.findIndex((item) => selectedExecutionGroupKeys.has(executionItemKey(item)));
    const unselectedItems = executionQueue.filter((item) => !selectedExecutionGroupKeys.has(executionItemKey(item)));
    const insertionIndex = executionQueue.slice(0, firstSelectedIndex).filter((item) => !selectedExecutionGroupKeys.has(executionItemKey(item))).length;
    const nextQueue = [...unselectedItems.slice(0, insertionIndex), ...selectedItems, ...unselectedItems.slice(insertionIndex)];
    const group: ExecutionGroup = { id: generateId(), name: executionGroupName.trim() || "作業グループ", itemKeys: selectedItems.map(executionItemKey) };
    persistExecutionOrder(nextQueue);
    saveExecutionGroups([...activeExecutionGroups, group]);
    setExecutionGroupDialogOpen(false);
  };
  const dissolveExecutionGroup = (groupId: string) => {
    if (finalized) return;
    saveExecutionGroups(activeExecutionGroups.filter((group) => group.id !== groupId));
  };
  const removeFromExecutionGroup = (group: ExecutionGroup, key: string) => {
    if (finalized) return;
    const itemKeys = group.itemKeys.filter((itemKey) => itemKey !== key);
    saveExecutionGroups(itemKeys.filter((itemKey) => activeOrderKeys.has(itemKey)).length < 2
      ? activeExecutionGroups.filter((candidate) => candidate.id !== group.id)
      : activeExecutionGroups.map((candidate) => candidate.id === group.id ? { ...candidate, itemKeys } : candidate));
  };
  const moveExecutionGroupMember = (unit: ExecutionUnit, key: string, difference: number) => {
    if (finalized || !unit.group) return;
    const liveKeys = unit.items.map(executionItemKey);
    const currentIndex = liveKeys.indexOf(key);
    const otherKey = liveKeys[currentIndex + difference];
    if (currentIndex < 0 || !otherKey) return;
    const itemKeys = [...unit.group.itemKeys];
    const currentStoredIndex = itemKeys.indexOf(key);
    const otherStoredIndex = itemKeys.indexOf(otherKey);
    [itemKeys[currentStoredIndex], itemKeys[otherStoredIndex]] = [itemKeys[otherStoredIndex], itemKeys[currentStoredIndex]];
    const updatedGroup = { ...unit.group, itemKeys };
    saveExecutionGroups(activeExecutionGroups.map((group) => group.id === updatedGroup.id ? updatedGroup : group));
    const updatedItems = itemKeys.map((itemKey) => executionItemMap.get(itemKey)).filter((item): item is ExecutionItem => Boolean(item));
    persistExecutionOrder(executionUnits.flatMap((candidate) => candidate.key === unit.key ? updatedItems : candidate.items));
  };
  const executionOrderRow = (item: ExecutionItem, orderLabel: string, tier: "active" | "next" | "later", unit: ExecutionUnit, unitIndex: number, memberIndex?: number) => {
    const key = executionItemKey(item);
    const task = item.kind === "scheduled" ? item.scheduled.task : item.occurrence.task;
    const title = item.kind === "scheduled" ? scheduleTitle(task, item.scheduled.range) : task.title;
    const plannedHours = item.kind === "scheduled" ? plannedRangeHoursForDate(item.scheduled.range, date, periods, workingDateOverrides) : Number(task.plannedHours) || 0;
    const kindLabel = item.kind === "recurring" ? "定期" : WAITING_STATUSES.includes(itemStatus(item.scheduled)) ? "待ち" : "作業";
    const grouped = Boolean(unit.group);
    return <li key={key} className={`${dragOrderKey === unit.key ? "is-dragging" : ""} execution-tier-${tier} ${grouped ? "execution-group-member" : ""}`} draggable={!finalized && !grouped}
      onDragStart={() => { setDragOrderKey(unit.key); if (laterExecutionUnits.length) setExecutionLaterOpen(true); }} onDragEnd={() => setDragOrderKey("")}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { if (grouped) return; event.preventDefault(); if (dragOrderKey && dragOrderKey !== unit.key) moveExecutionUnit(dragOrderKey, unitIndex); setDragOrderKey(""); }}>
      <span className="execution-order-number">{orderLabel}</span>
      <span className={`priority priority-${task.priority}`}>{task.priority}</span>
      <button type="button" className="execution-order-main" onClick={() => openTask(task)}>
        <strong>{title}</strong>
        {item.kind === "scheduled" && <small className="execution-order-related">関連Task：{task.title}</small>}
        <small><b>{kindLabel}</b> · {tags.find((tag) => tag.id === task.projectTagId)?.name || "タグなし"} · 予定 {formatHours(plannedHours)}h</small>
      </button>
      {item.kind === "scheduled" ? statusBadge(task, item.scheduled) : <span className="today-status-badge todo">未実施</span>}
      <div className="execution-order-task-actions">
        <button type="button" className={`today-timer-start ${activeTimerTaskId === task.id ? "is-running" : ""}`} disabled={finalized || activeTimerTaskId === task.id} onClick={() => chooseTimer(task, item.kind === "scheduled" ? item.scheduled.planKey : date, plannedHours)}>{activeTimerTaskId === task.id ? "計測中" : "開始"}</button>
        {calendarCopyButton(`order:${key}`, task, item.kind === "scheduled" ? item.scheduled.range : undefined)}
        {item.kind === "scheduled"
          ? <button type="button" className="today-card-expand" onClick={() => setEntryTarget(item.scheduled)}>記録</button>
          : <><button type="button" className="today-card-move" disabled={finalized} onClick={() => { setMoveTarget(item.occurrence); setMoveDate(addDays(date, 1)); setMoveReason(""); }}>別日に対応</button><button type="button" className="today-card-documents" onClick={() => onOpenDocuments(task.id)}><span aria-hidden="true">▤</span>文書{task.documents.length > 0 && <small>{task.documents.length}</small>}</button><button type="button" className="today-card-expand" onClick={() => { setRecurrenceMemoDraft(task.recurrenceRecords.find((record) => record.date === item.occurrence.occurrenceDate)?.memo ?? task.recurrenceMemoTemplate); setRecurrenceDetailTarget(item.occurrence); }}>詳細</button></>}
      </div>
      <div className="execution-order-controls" aria-label={`${title}の順番操作`}>
        {unit.group && memberIndex !== undefined ? <><button type="button" title="グループ内で一つ上へ" disabled={finalized || memberIndex === 0} onClick={() => moveExecutionGroupMember(unit, key, -1)}>↑</button><button type="button" title="グループ内で一つ下へ" disabled={finalized || memberIndex === unit.items.length - 1} onClick={() => moveExecutionGroupMember(unit, key, 1)}>↓</button><button type="button" title="グループから外す" disabled={finalized} onClick={() => removeFromExecutionGroup(unit.group!, key)}>×</button></> : <><button type="button" title="先頭へ" disabled={finalized || unitIndex === 0} onClick={() => moveExecutionUnit(unit.key, 0)}>⇤</button><button type="button" title="一つ上へ" disabled={finalized || unitIndex === 0} onClick={() => moveExecutionUnit(unit.key, unitIndex - 1)}>↑</button><button type="button" title="一つ下へ" disabled={finalized || unitIndex === executionUnits.length - 1} onClick={() => moveExecutionUnit(unit.key, unitIndex + 1)}>↓</button><button type="button" title="最後へ" disabled={finalized || unitIndex === executionUnits.length - 1} onClick={() => moveExecutionUnit(unit.key, executionUnits.length - 1)}>⇥</button><button type="button" title="順番から外す" disabled={finalized} onClick={() => removeFromExecutionOrder(item)}>×</button></>}
      </div>
    </li>;
  };
  const currentExecutionUnits = executionUnits.slice(0, 1);
  const nextExecutionUnits = executionUnits.slice(1, 4);
  const laterExecutionUnits = executionUnits.slice(4);
  const renderExecutionUnit = (unit: ExecutionUnit, unitIndex: number, tier: "active" | "next" | "later") => unit.group
    ? <li key={unit.key} className={`execution-work-group execution-tier-${tier} ${dragOrderKey === unit.key ? "is-dragging" : ""}`} draggable={!finalized}
      onDragStart={() => { setDragOrderKey(unit.key); if (laterExecutionUnits.length) setExecutionLaterOpen(true); }} onDragEnd={() => setDragOrderKey("")}
      onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (dragOrderKey && dragOrderKey !== unit.key) moveExecutionUnit(dragOrderKey, unitIndex); setDragOrderKey(""); }}>
      <header><span className="execution-order-number">{unitIndex + 1}</span><div><strong>{unit.group.name}</strong><small>残り {unit.items.length}件 / 全{unit.group.itemKeys.length}件</small></div><span className="execution-group-badge">並行作業</span><button type="button" className="execution-group-toggle" disabled={tier === "active"} onClick={() => setExpandedExecutionGroupIds((current) => { const next = new Set(current); if (next.has(unit.group!.id)) next.delete(unit.group!.id); else next.add(unit.group!.id); return next; })}>{tier === "active" || expandedExecutionGroupIds.has(unit.group.id) ? "▲" : "▼"}<span>{tier === "active" || expandedExecutionGroupIds.has(unit.group.id) ? "閉じる" : "開く"}</span></button><div className="execution-group-controls"><button type="button" title="一つ上へ" disabled={finalized || unitIndex === 0} onClick={() => moveExecutionUnit(unit.key, unitIndex - 1)}>↑</button><button type="button" title="一つ下へ" disabled={finalized || unitIndex === executionUnits.length - 1} onClick={() => moveExecutionUnit(unit.key, unitIndex + 1)}>↓</button><button type="button" disabled={finalized} onClick={() => dissolveExecutionGroup(unit.group!.id)}>グループ解除</button></div></header>
      {(tier === "active" || expandedExecutionGroupIds.has(unit.group.id)) && <ol className="execution-order-list">{unit.items.map((item, memberIndex) => executionOrderRow(item, `${unitIndex + 1}.${memberIndex + 1}`, tier, unit, unitIndex, memberIndex))}</ol>}
    </li>
    : executionOrderRow(unit.items[0], String(unitIndex + 1), tier, unit, unitIndex);
  const executionOrderSection = () => <section className="today-section execution-order-section">
    <div className="execution-order-heading">
      {sectionHeading("今日の対応順", executionQueue.length)}
      <div><small>グループもドラッグして順番を変更できます</small><button type="button" disabled={finalized || groupableExecutionItems.length < 2} onClick={openExecutionGroupDialog}>＋ 作業グループを作成</button></div>
    </div>
    {executionUnits.length ? <div className="execution-priority-groups">
      <section className="execution-focus-group">
        <header><div><strong>今すること</strong><span>{currentExecutionUnits[0]?.group ? "グループ内の作業がすべて終わったら次へ進みます" : "最優先の作業"}</span></div></header>
        <ol className="execution-unit-list">{currentExecutionUnits.map((unit, index) => renderExecutionUnit(unit, index, "active"))}</ol>
      </section>
      {nextExecutionUnits.length > 0 && <section className="execution-next-group"><header><strong>次にすること <small>{nextExecutionUnits.length}項目</small></strong><span>上から順に着手</span></header><ol className="execution-unit-list">{nextExecutionUnits.map((unit, offset) => renderExecutionUnit(unit, offset + 1, "next"))}</ol></section>}
      {laterExecutionUnits.length > 0 && <section className="execution-later-group"><button type="button" className="execution-later-toggle" aria-expanded={executionLaterOpen} onClick={() => setExecutionLaterOpen((current) => !current)}><span><strong>今日中にすること</strong><small>{laterExecutionUnits.length}項目</small></span><b>{executionLaterOpen ? "折りたたむ ▲" : "一覧を表示 ▼"}</b></button>{executionLaterOpen && <ol className="execution-unit-list">{laterExecutionUnits.map((unit, offset) => renderExecutionUnit(unit, offset + 4, "later"))}</ol>}</section>}
    </div> : <p className="muted">順番を設定できる作業はありません。</p>}
    {executionUnset.length > 0 && <div className="execution-order-unset"><h4>順番未設定 <small>{executionUnset.length}件</small></h4>{executionUnset.map((item) => { const task = item.kind === "scheduled" ? item.scheduled.task : item.occurrence.task; const title = item.kind === "scheduled" ? scheduleTitle(task, item.scheduled.range) : task.title; return <button type="button" key={executionItemKey(item)} disabled={finalized} onClick={() => addToExecutionOrder(item)}><span>＋</span><strong>{title}</strong><small>順番の最後へ追加</small></button>; })}</div>}
    {executionGroupDialogOpen && <div className="move-dialog-backdrop" onPointerDown={() => setExecutionGroupDialogOpen(false)}><section className="move-panel execution-group-dialog" role="dialog" aria-modal="true" aria-label="作業グループを作成" onPointerDown={(event) => event.stopPropagation()}><header><div><small>並行して対応するタスクをまとめる</small><h3>作業グループを作成</h3></div><button type="button" aria-label="閉じる" onClick={() => setExecutionGroupDialogOpen(false)}>×</button></header><label>グループ名<input autoFocus value={executionGroupName} onChange={(event) => setExecutionGroupName(event.target.value)} placeholder="例：マージ依頼まとめ" /></label><div className="execution-group-candidates">{groupableExecutionItems.map((item) => { const key = executionItemKey(item); const task = item.kind === "scheduled" ? item.scheduled.task : item.occurrence.task; const title = item.kind === "scheduled" ? scheduleTitle(task, item.scheduled.range) : task.title; return <label className={selectedExecutionGroupKeys.has(key) ? "selected" : ""} key={key}><input type="checkbox" checked={selectedExecutionGroupKeys.has(key)} onChange={(event) => setSelectedExecutionGroupKeys((current) => { const next = new Set(current); if (event.target.checked) next.add(key); else next.delete(key); return next; })} /><span><strong>{title}</strong><small className="execution-group-related-task">関連Task：{task.title}</small><small className="execution-group-candidate-tag">案件タグ：{tags.find((tag) => tag.id === task.projectTagId)?.name || "タグなし"}</small></span></label>; })}</div><footer><span>2件以上選択してください</span><button type="button" onClick={() => setExecutionGroupDialogOpen(false)}>キャンセル</button><button type="button" className="primary" disabled={selectedExecutionGroupKeys.size < 2} onClick={createExecutionGroup}>グループを作成（{selectedExecutionGroupKeys.size}件）</button></footer></section></div>}
  </section>;
  const grouped = <T,>(list: T[], taskFor: (item: T) => Task) => {
    const result = new Map<string, { tag?: ProjectTag; items: T[] }>();
    list.forEach((item) => {
      const task = taskFor(item);
      const tag = tags.find((candidate) => candidate.id === task.projectTagId);
      const key = tag?.id || "";
      const group = result.get(key) || { tag, items: [] };
      group.items.push(item);
      result.set(key, group);
    });
    return [...result.values()].sort((a, b) => a.tag && !b.tag ? -1 : !a.tag && b.tag ? 1 : (a.tag?.name || "").localeCompare(b.tag?.name || "", "ja"));
  };
  const groupBlock = <T,>(list: T[], taskFor: (item: T) => Task, render: (item: T) => React.ReactNode) => groupByTag
    ? <div className="today-tag-groups">{grouped(list, taskFor).map((group) => <section className="today-tag-group" key={group.tag?.id || "untagged"}><header>{group.tag ? <TagIcon tag={group.tag} className="today-tag-group-icon" /> : <i style={{ background: "#94a3b8" }} />}<strong>{group.tag?.name || "タグなし"}</strong><small>{group.items.length}件</small></header>{group.items.map(render)}</section>)}</div>
    : <>{list.map(render)}</>;
  const scheduledSectionCard = (title: string, list: ScheduledItem[], empty: string, carrySelectable = false) => <section className={`today-section ${title === "この日の対応済み（作業）" ? "achieved-section" : ""}`}>{sectionHeading(title, list.length)}{list.length ? groupBlock(list, (item) => item.task, (item) => taskCard(item, undefined, carrySelectable)) : <p className="muted">{empty}</p>}</section>;
  const waitingReviewSection = () => <section className="today-section waiting-review-section">
    {sectionHeading("待ち作業の状況確認", waitingReviews.length)}
    {waitingReviews.length ? groupBlock(waitingReviews, (task) => task, (task) => {
      const info = task.waitingFollowUp!;
      return <article className="today-waiting-review" key={task.id}>
        <button type="button" className="today-task-title" onClick={() => openTask(task)}>{task.title}</button>
        <p>{info.party ? `${info.party}を待っています` : "相手は未設定です"}<small>{info.reviewDate < date ? `${info.reviewDate}から確認待ち` : "今日が確認日"}</small></p>
        {info.memo && <em>{info.memo}</em>}
        <div><button type="button" onClick={() => window.dispatchEvent(new CustomEvent("chattask-open-waiting", { detail: { taskId: task.id } }))}>待ち情報を編集</button><button type="button" className="primary" disabled={finalized} onClick={() => onUpdateTask(task.id, { waitingFollowUp: { ...info, lastCheckedAt: new Date().toISOString(), reviewDate: addDays(date, 3) } }, `待ち状況を確認し、次に見る日を${addDays(date, 3)}へ変更しました。`)}>確認を送った</button></div>
      </article>;
    }) : <p className="muted">今日確認する待ち作業はありません。</p>}
  </section>;
  const taskSectionCard = (title: string, list: Task[], empty: string) => {
    const taskOnly = title === "保留" || title === "持ち越し";
    return <section className={`today-section ${title === "作業中止" ? "stopped-section" : title === "保留" ? "pending-section" : ""}`}>{sectionHeading(title, list.length)}{list.length ? groupBlock(list, (task) => task, (task) => { const range = taskOnly ? { id: `task-summary-${task.id}`, startDate: date, endDate: date } : task.plannedRanges.find((item) => item.startDate <= date && item.endDate >= date) || { id: `virtual-${task.id}`, startDate: date, endDate: date }; return taskCard({ task, range, planKey: date }, title === "この日に完了" ? completionEventByTask.get(task.id) : undefined, false, taskOnly, title === "持ち越し", false); }) : <p className="muted">{empty}</p>}</section>;
  };
  const completionSectionCard = () => <section className="today-section completed-section">
    {sectionHeading("この日に完了（タスク）", completed.length)}
    {completed.length ? groupBlock(completed, (task) => task, (task) => {
      // 完了欄は予定名ではなく、完了したタスクそのものを表示する。
      const taskSummaryRange: PlannedRange = { id: `completed-task-${task.id}`, startDate: date, endDate: date };
      return taskCard({ task, range: taskSummaryRange, planKey: `completion::${date}` }, completionEventByTask.get(task.id), false, false, false, false);
    }) : <p className="muted">完了したタスクはありません。</p>}
  </section>;
  const recurrenceSummary = ({ task, occurrenceDate }: Occurrence) => {
    const record = task.recurrenceRecords.find((item) => item.date === occurrenceDate);
    const final = record?.status === "done" || record?.status === "skipped";
    const key = `recurring:${task.id}:${occurrenceDate}`;
    const occurrenceMemo = (record?.memo ?? task.recurrenceMemoTemplate).trim();
    return <article className={`recurrence-summary-card ${final ? "is-final" : ""}`} key={key}>
      <button className="today-task-title" onClick={() => openTask(task)}>{task.title}</button>
      {occurrenceMemo && <p className="recurrence-memo-preview" title={occurrenceMemo}><small>この日の対応メモ</small>{occurrenceMemo}</p>}
      <div><span className="tag-chip">{recurrenceLabel(task)}</span><small>1回あたり {formatHours(Number(task.plannedHours) || 0)}h</small></div>
      <div><small>{occurrenceDate !== date ? `${occurrenceDate}分` : record?.status === "moved" ? `${record.movedTo}へ移動` : final ? record.status === "done" ? "実施済み" : "スキップ" : "未実施"}</small>{!final && <button type="button" className={`today-timer-start ${activeTimerTaskId === task.id ? "is-running" : ""}`} disabled={finalized || activeTimerTaskId === task.id} onClick={() => chooseTimer(task, date, Number(task.plannedHours) || .5)}>{activeTimerTaskId === task.id ? "計測中" : "開始"}</button>}{calendarCopyButton(`recurring:${key}`, task)}{!final && !finalized && <button type="button" className="today-card-move" onClick={() => { setMoveTarget({ task, occurrenceDate }); setMoveDate(addDays(date, 1)); setMoveReason(""); }}>別日に対応</button>}<button type="button" className="today-card-documents" onClick={() => onOpenDocuments(task.id)} aria-label={`文書を開く${task.documents.length > 0 ? `（${task.documents.length}件）` : ""}`}><span aria-hidden="true">▤</span>文書{task.documents.length > 0 && <small>{task.documents.length}</small>}</button><button type="button" className="today-card-expand" onClick={() => { setRecurrenceMemoDraft(record?.memo ?? task.recurrenceMemoTemplate); setRecurrenceDetailTarget({ task, occurrenceDate }); }}>詳細</button></div>
    </article>;
  };
  const recurrenceDetail = ({ task, occurrenceDate }: Occurrence) => {
    const record = task.recurrenceRecords.find((item) => item.date === occurrenceDate);
    const final = record?.status === "done" || record?.status === "skipped";
    const displayDate = record?.status === "moved" && record.movedTo ? record.movedTo : occurrenceDate;
    return <div className="recurrence-detail-backdrop" onPointerDown={closeRecurrenceDetail}><article className="recurrence-detail-dialog" role="dialog" aria-modal="true" aria-label="定期タスクの詳細" onPointerDown={(event) => event.stopPropagation()}>
      <header><div><small>定期タスクの詳細</small><strong>{task.title}</strong><span>{recurrenceLabel(task)}</span></div><button type="button" aria-label="閉じる" onClick={closeRecurrenceDetail}>×</button></header>
      <label className="recurrence-detail-date">対象日<WorkDatePicker ariaLabel="定期タスクの対象日" value={displayDate} disabled={finalized || final} onChange={(date) => changeOccurrenceDate(task, occurrenceDate, date)} allowClear={false} /></label>
      {actualInput(task)}
      {record?.moveReason && <p>移動理由: {record.moveReason}</p>}
      <label className="recurrence-memo">この日の対応メモ<textarea rows={4} value={recurrenceMemoDraft} readOnly={finalized} onChange={(event) => setRecurrenceMemoDraft(event.target.value)} onBlur={() => !finalized && updateOccurrenceMemo(task, occurrenceDate, recurrenceMemoDraft)} placeholder="この回に対応する内容" /></label>
      <footer><small>{occurrenceDate !== date ? `${occurrenceDate}分` : record?.status === "moved" ? `${record.movedTo}へ移動` : final ? record.status === "done" ? "実施済み" : "スキップ" : "未実施"}</small>{finalized ? <span className="finalized-inline-label">確定済み</span> : final || (record?.status === "moved" && occurrenceDate === date) ? <button onClick={() => setOccurrence(task, occurrenceDate, "pending", recurrenceMemoDraft)}>取り消し</button> : <><button onClick={() => setOccurrence(task, occurrenceDate, "skipped", recurrenceMemoDraft)}>スキップ</button><button className="primary" onClick={() => setOccurrence(task, occurrenceDate, "done", recurrenceMemoDraft)}>実施済み</button></>}</footer>
    </article></div>;
  };
  const recurringGroupList = groupByTag ? grouped(visibleOccurrences, (item) => item.task) : [{ tag: undefined, items: visibleOccurrences }];
  return <Modal title="今日のページ" onClose={onClose} wide fullScreen>
    <div className="today-toolbar-row">
      <div className="today-toolbar"><button onClick={() => onDate(addDays(date, -1))}>←</button><WorkDatePicker ariaLabel="今日のページの日付" value={date} onChange={onDate} allowClear={false} /><button onClick={() => onDate(addDays(date, 1))}>→</button><button onClick={() => onDate(todayValue())}>今日</button></div>
      <div className="today-finalization-actions">
      <button type="button" onClick={() => setEffortSummaryOpen(true)}>工数集計</button>
      {finalized
          ? <button type="button" className="danger" title={`${new Date(finalizedAt).toLocaleString("ja-JP")} に確定済み`} onClick={unfinalizeDay}>取消</button>
          : <button type="button" className="primary" onClick={finalizeDay}>確定</button>}
      </div>
    </div>
    <aside className="today-left-rail">
    <section className="today-dashboard" aria-label={`${date}のダッシュボード`}>
      <header>
        <div><small>DAILY DASHBOARD</small><h3>{date.replace(/-/g, "/")} の状況</h3></div>
        <strong>{dashboardProgress}%</strong>
      </header>
      <div className="today-dashboard-progress" role="progressbar" aria-label="今日の作業達成率" aria-valuemin={0} aria-valuemax={100} aria-valuenow={dashboardProgress}><i style={{ width: `${dashboardProgress}%` }} /></div>
      <div className="today-dashboard-grid">
        <div><span>予定作業</span><strong>{dashboardTotal}</strong><small>件</small></div>
        <div className="is-completed"><span>対応済み作業</span><strong>{dashboardCompleted}</strong><small>件</small></div>
        <div><span>未対応作業</span><strong>{dashboardRemaining}</strong><small>件</small></div>
        <div className="is-completed"><span>定期実施</span><strong>{recurringDone}</strong><small>/{dashboardCountableOccurrences.length}件</small></div>
        <div className={overdue.length ? "is-alert" : ""}><span>持ち越し</span><strong>{overdue.length}</strong><small>件</small></div>
        <div className="is-completed"><span>完了タスク</span><strong>{completed.length}</strong><small>件</small></div>
      </div>
      {dashboardRemainingItems.length > 0 && <div className="today-dashboard-remaining"><strong>未対応の内訳</strong><ul>{dashboardRemainingItems.slice(0, 3).map((item) => <li key={item.key}><span>{item.kind}</span><b title={item.title}>{item.title}</b></li>)}</ul>{dashboardRemainingItems.length > 3 && <small>ほか {dashboardRemainingItems.length - 3}件</small>}</div>}
      <div className="today-dashboard-effort">
        <span>工数</span>
        <strong>予定 {formatHours(dashboardPlannedHours)}h</strong>
        <i aria-hidden="true">/</i>
        <strong>実績 {formatHours(dashboardActualHours)}h</strong>
        {dashboardPlannedHours > 0 && <small>{Math.round((dashboardActualHours / dashboardPlannedHours) * 100)}%</small>}
      </div>
    </section>
      <section className="today-inbox-panel">
        <div className="today-inbox-heading">
          <button type="button" className="today-inbox-expand" onClick={() => setInboxExpanded((value) => !value)} aria-expanded={inboxExpanded} aria-label={inboxExpanded ? "Inbox一覧を折りたたむ" : "Inbox一覧を展開する"}>{inboxExpanded ? "▼" : "▶"}</button>
          <button type="button" className="today-inbox-toggle" onClick={() => onOpenInbox()}><span><strong>Inbox</strong><small>{inboxItems.filter((item) => item.status === "inbox").length}件</small></span><em>タスクにする前のメモ</em></button>
        </div>
        {inboxExpanded && <div className="today-inbox-body">{inboxItems.filter((item) => item.status === "inbox").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4).map((item) => <button key={item.id} onClick={() => onOpenInbox(item.id)}><strong>{item.title || "無題のメモ"}</strong><small>{tags.find((tag) => tag.id === item.projectTagId)?.name || "タグなし"}</small></button>)}{!inboxItems.some((item) => item.status === "inbox") && <p>Inboxは空です。</p>}<button className="today-inbox-open" onClick={() => onOpenInbox()}>Inboxを開く</button></div>}
      </section>
      <section className="today-inbox-review-panel">
        <header><span><strong>確認するInbox</strong><small>{inboxReviewItems.length}件</small></span><em>作業になるか確認</em></header>
        <div>{inboxReviewItems.map((item) => <article key={item.id}><button type="button" onClick={() => onOpenInbox(item.id)}><strong>{item.title || "無題のメモ"}</strong><small>{item.reviewDate! < date ? `${item.reviewDate!.replace(/-/g, "/")} から未確認` : "今日確認"}</small></button><button type="button" className="today-inbox-reviewed" title="確認済みにする" aria-label={`${item.title || "無題のメモ"}を確認済みにする`} onClick={() => onReviewInbox(item.id)}><span aria-hidden="true">✓</span></button></article>)}{!inboxReviewItems.length && <p>今日確認するInboxはありません。</p>}</div>
      </section>
    </aside>
    <section className={`today-note-panel ${memoOpen ? "is-open" : ""} ${finalized ? "is-readonly" : ""}`}>
      <button type="button" className="today-note-toggle" aria-expanded={memoOpen} onClick={() => setMemoOpen((current) => !current)}>
        <span><strong>この日のメモ</strong><small>{note.trim() || "クリックしてメモを入力"}</small></span>
        <b>{memoOpen ? "閉じる" : note.trim() ? "編集" : "開く"}</b>
      </button>
      {memoOpen && <textarea autoFocus={!note.trim() && !finalized} rows={4} value={note} readOnly={finalized} onChange={(event) => onNote(event.target.value)} placeholder="この日の気づき、申し送り、振り返りなど" />}
    </section>
    {scheduledNonWorking && <div className={`non-working-banner ${holidayWork ? "is-holiday-work" : ""}`}><div><strong>{holidayWork ? "休日出勤" : scheduledNonWorking.type === "weekend" ? "土日休暇" : scheduledNonWorking.type === "holiday" ? "祝日" : "休暇"}</strong>{scheduledNonWorking.note && ` — ${scheduledNonWorking.note}`}<small>{holidayWork ? "この日は稼働日として、作業表示と予定工数の配分に含めます。" : "この日の未達成予定は持ち越し対象に含めません。"}</small></div><button type="button" disabled={finalized} onClick={toggleHolidayWork}>{holidayWork ? "休日扱いに戻す" : "この日を稼働日にする"}</button></div>}
    {!nonWorking && !finalized && <div className="carry-row">
      <button type="button" className="advance-schedule-button" onClick={openAdvanceDialog}>未来の予定を前倒し</button>
      {carrySelectionMode && <button type="button" className="carry-selection-cancel" onClick={() => { setCarrySelectionMode(false); setSelectedCarryTaskIds(new Set()); }}>選択をやめる</button>}
      <button type="button" className={carrySelectionMode ? "carry-selection-active" : ""} onClick={() => carrySelectionMode ? carryTasks(true) : setCarrySelectionMode(true)}>{carrySelectionMode ? `選択したタスクを${carryDestination}へ回す（${selectedCarryTaskIds.size}件）` : `タスクを選んで${carryDestination}へ回す`}</button>
      <button onClick={() => carryTasks()}>未完了タスクを{carryDestination}へ持ち越す</button>
    </div>}
    <div className="today-view-switch">
      <div className="today-mode-switch" role="group" aria-label="今日することの表示方法">
        <button type="button" className={todayView === "board" ? "active" : ""} onClick={() => { setTodayView("board"); localStorage.setItem("chatTaskTodayView", "board"); }}>ボード</button>
        <button type="button" className={todayView === "order" ? "active" : ""} onClick={() => { setTodayView("order"); localStorage.setItem("chatTaskTodayView", "order"); }}>対応順</button>
      </div>
      {todayView === "board" && <label className="today-group-toggle"><input type="checkbox" checked={groupByTag} onChange={(event) => changeGroupByTag(event.target.checked)} />案件タグ別</label>}
      <span>「記録」で対応内容を入力</span>
    </div>
    <div className="today-sections">
      {todayView === "order" && !nonWorking ? executionOrderSection() : scheduledSectionCard(nonWorking ? "休暇日の予定" : "この日にやること", planned, "予定されたタスクはありません。", !nonWorking)}
      {waitingReviewSection()}
      {scheduledSectionCard("待ち・確認", waiting, "確認対象はありません。", !nonWorking)}
      <section className="today-section recurring-section"><div className="recurring-section-heading">{sectionHeading("定期タスク", visibleOccurrences.length)}<div className="recurring-visibility-controls">{completedRecurringCount > 0 && <label><input type="checkbox" checked={showCompletedRecurring} onChange={(event) => toggleCompletedRecurring(event.target.checked)} />実施済みを表示（{completedRecurringCount}件）</label>}{skippedRecurringCount > 0 && <label><input type="checkbox" checked={showSkippedRecurring} onChange={(event) => { setShowSkippedRecurring(event.target.checked); localStorage.setItem("chatTaskShowSkippedRecurring", String(event.target.checked)); }} />スキップ済みを表示（{skippedRecurringCount}件）</label>}</div></div>{visibleOccurrences.length ? <div className="recurring-lanes">{recurringGroupList.map((group) => {
        return <section className="recurring-lane-group" key={group.tag?.id || "all"}>{groupByTag && <header>{group.tag ? <TagIcon tag={group.tag} className="today-tag-group-icon" /> : <i style={{ background: "#94a3b8" }} />}<strong>{group.tag?.name || "タグなし"}</strong><small>{group.items.length}件</small></header>}<div className="recurring-lane">{group.items.map(recurrenceSummary)}</div></section>;
      })}</div> : <p className="muted">{completedRecurringCount || skippedRecurringCount ? "この日の定期タスクは処理済みです。表示設定から確認・取り消しができます。" : "この日の定期タスクはありません。"}</p>}</section>
      {held.length > 0 && taskSectionCard("保留", held, "保留にしたタスクはありません。")}
      {taskSectionCard("持ち越し", overdue, "持ち越しタスクはありません。")}
      {taskSectionCard("期限・リマインド", reminders, "該当するタスクはありません。")}
      {scheduledSectionCard("次の営業日へ持ち越し済み", carriedForwardItems, "次の営業日へ持ち越したタスクはありません。")}
      {scheduledSectionCard("この日の対応済み（作業）", achieved, "対応済みの作業はありません。")}
      {completionSectionCard()}
      {taskSectionCard("作業中止", stopped, "中止・引き継ぎで終了したタスクはありません。")}
    </div>
    {advanceDialogOpen && <div className="move-dialog-backdrop" onPointerDown={() => setAdvanceDialogOpen(false)}><section className="move-panel advance-schedule-panel" role="dialog" aria-modal="true" aria-label="未来の予定を前倒し" onPointerDown={(event) => event.stopPropagation()}>
      <header><div><small>翌日以降の未実施予定から選択</small><h3>未来の予定を前倒し</h3></div><button type="button" aria-label="閉じる" onClick={() => setAdvanceDialogOpen(false)}>×</button></header>
      <div className="advance-schedule-body">
        <div className="advance-schedule-picker">
          <label className="advance-schedule-search"><span>前倒しする予定 <small>{visibleAdvanceCandidates.length}件</small></span><input type="search" autoFocus value={advanceSearch} onChange={(event) => setAdvanceSearch(event.target.value)} placeholder="予定名・タスク名・日付で検索" /></label>
          <div className="advance-schedule-results" role="listbox" aria-label="前倒しする予定の候補">
            {visibleAdvanceCandidates.map(({ task, range }) => {
              const key = `${task.id}:${range.id}`;
              const selected = key === advanceTargetKey;
              return <button type="button" role="option" aria-selected={selected} className={selected ? "selected" : ""} key={key} onClick={() => { setAdvanceTargetKey(key); setAdvanceHours(Number(range.plannedHours) > 0 ? String(range.plannedHours) : ""); }}>
                <time><b>{range.startDate}</b>{range.endDate !== range.startDate && <small>〜 {range.endDate}</small>}</time>
                <span><strong>{range.title || range.note || task.title}{range.sourceType === "project-work" && <em className="advance-project-work-badge">プロジェクト作業</em>}</strong>{(range.title || range.note) && <small>{task.title}</small>}</span>
                <span className="advance-result-side">{Number(range.plannedHours) > 0 && <b>{formatHours(Number(range.plannedHours))}h</b>}{selected && <i><span aria-hidden="true">✓</span>選択中</i>}</span>
              </button>;
            })}
            {!visibleAdvanceCandidates.length && <p>一致する未来の予定はありません。</p>}
          </div>
        </div>
        {(() => { const selected = advanceCandidates.find(({ task, range }) => `${task.id}:${range.id}` === advanceTargetKey); return selected ? <div className="advance-schedule-settings"><div className="advance-schedule-source"><span>選択中</span><strong>{selected.range.title || selected.range.note || selected.task.title}</strong><small>関連Task：{selected.task.title}</small></div><div className="advance-schedule-fields"><label>前倒し先の日付<WorkDatePicker ariaLabel="前倒し先の日付" value={advanceDate} max={addDays(selected.range.startDate, -1)} onChange={setAdvanceDate} allowClear={false} /><small>{selected.range.startDate}より前の日を指定</small></label>{Number(selected.range.plannedHours) > 0 && <label>前倒しする工数<input type="number" min=".25" step=".25" max={selected.range.plannedHours} value={advanceHours} onChange={(event) => setAdvanceHours(event.target.value)} /><small>全体 {formatHours(Number(selected.range.plannedHours))}h。一部なら元予定を残します。</small></label>}<label>理由（任意）<select value={advanceReason} onChange={(event) => setAdvanceReason(event.target.value)}><option value="">未選択</option><option>余裕ができた</option><option>優先度が上がった</option><option>後続作業を早めるため</option><option>期限変更</option><option>その他</option></select></label></div><p className="advance-schedule-note">当初の予定日は履歴に残ります。プロジェクト作業は、変更後の期間・工数を作業項目へ反映します。</p></div> : null; })()}
      </div>
      <div className="advance-schedule-actions"><span>前倒し先：<strong>{advanceDate || "未指定"}</strong></span><button type="button" className="advance-action-cancel" onClick={() => setAdvanceDialogOpen(false)}>キャンセル</button><button type="button" className="primary advance-action-submit" disabled={!advanceTargetKey || !advanceDate} onClick={advanceSchedule}><span aria-hidden="true">←</span>前倒しを実行</button></div>
    </section></div>}
    {!finalized && moveTarget && <div className="move-dialog-backdrop" onPointerDown={() => setMoveTarget(null)}><section className="move-panel" role="dialog" aria-modal="true" aria-label="定期タスクを別日に移動" onPointerDown={(event) => event.stopPropagation()}><h3>「{moveTarget.task.title}」の{moveTarget.occurrenceDate}分を別日に対応</h3><label>対応日<WorkDatePicker ariaLabel="定期タスクの移動先" value={moveDate} onChange={setMoveDate} allowClear={false} /></label><label>移動理由<textarea value={moveReason} onChange={(event) => setMoveReason(event.target.value)} placeholder="移動理由（任意）" /></label><div><button onClick={() => setMoveTarget(null)}>キャンセル</button><button className="primary" onClick={submitMove}>この日に移動</button></div></section></div>}
    {recurrenceDetailTarget && recurrenceDetail(recurrenceDetailTarget)}
    {carryHistoryTarget && <div className="today-entry-dialog-backdrop" onPointerDown={() => setCarryHistoryTarget(null)}><section className="today-entry-dialog carry-history-dialog" role="dialog" aria-modal="true" aria-label="持ち越し履歴の詳細" onPointerDown={(event) => event.stopPropagation()}><header><div><small>{date} の持ち越し履歴</small><strong>{carryHistoryTarget.range.note || carryHistoryTarget.task.title}</strong><span>{carryDestination}へ持ち越し済み</span></div><button type="button" onClick={() => setCarryHistoryTarget(null)} aria-label="閉じる">×</button></header><div className={`carry-work-summary ${carryHistoryTarget.range.carriedOverWork?.[date] ?? (itemActualHours(carryHistoryTarget) > 0) ? "worked" : "not-worked"}`}><strong>{carryHistoryTarget.range.carriedOverWork?.[date] ?? (itemActualHours(carryHistoryTarget) > 0) ? "作業あり" : "作業なし"}</strong><span>当日の実績 {formatHours(itemActualHours(carryHistoryTarget))}h</span></div>{carryHistoryTarget.task.dailyPlans[carryHistoryTarget.planKey] && <div className="carry-history-plan"><small>この日にすること</small><p>{carryHistoryTarget.task.dailyPlans[carryHistoryTarget.planKey]}</p></div>}{!finalized && <button type="button" className="today-entry-cancel-completion" onClick={cancelCarryForward}>持ち越しを取り消す</button>}<footer><span>{finalized ? "確定済みのため変更できません" : "元の日の記録は編集せずに保持されています"}</span><button type="button" className="primary" onClick={() => setCarryHistoryTarget(null)}>閉じる</button></footer></section></div>}
    {entryTarget && <div className="today-entry-dialog-backdrop" onPointerDown={() => setEntryTarget(null)}><section className="today-entry-dialog" role="dialog" aria-modal="true" aria-label="この日の対応を記録" onPointerDown={(event) => event.stopPropagation()}><header><div><small>{date} の対応内容</small><strong>{entryTarget.range.note || entryTarget.task.title}</strong>{entryTarget.range.sourceId && entryTarget.range.note && <span>{entryTarget.task.title}</span>}</div><button type="button" onClick={() => setEntryTarget(null)} aria-label="閉じる">×</button></header>{actualInput(entryTarget.task, entryTarget)}<label className="today-entry-plan-label">この日にすること<textarea value={entryTarget.task.dailyPlans[entryTarget.planKey] || ""} readOnly={finalized} autoFocus={!finalized} onChange={(event) => updateEntryPlan(event.target.value)} placeholder="対応内容・確認事項・申し送りなどを記録" /></label>{!isTerminalStatus(entryTarget.task.status) && <button type="button" className={`today-entry-achievement ${entryTarget.task.dailyPlanCompleted[entryTarget.planKey] ? "is-achieved" : ""}`} aria-pressed={Boolean(entryTarget.task.dailyPlanCompleted[entryTarget.planKey])} disabled={finalized} onClick={toggleEntryAchievement}>{entryTarget.task.dailyPlanCompleted[entryTarget.planKey] ? "✓ 達成済み（押すと解除）" : "達成にする"}</button>}{!finalized && entryTarget.completionEvent && (completionCancelConfirmId === entryTarget.completionEvent.id ? <div className="today-entry-completion-cancel"><span>この日の完了を取り消しますか？</span><div><button type="button" onClick={() => setCompletionCancelConfirmId("")}>やめる</button><button type="button" className="danger" onClick={() => { onCancelCompletion(entryTarget.task.id, entryTarget.completionEvent!.id); setCompletionCancelConfirmId(""); setEntryTarget(null); }}>取り消しを実行</button></div></div> : <button type="button" className="today-entry-cancel-completion" onClick={() => setCompletionCancelConfirmId(entryTarget.completionEvent!.id)}>完了を取り消す</button>)}<footer><span>{finalized ? "確定済みのため閲覧のみです" : "入力内容は自動保存されます"}</span><button type="button" className="primary" onClick={() => setEntryTarget(null)}>閉じる</button></footer></section></div>}
    {timerTarget && <div className="timer-dialog-backdrop" onPointerDown={() => setTimerTarget(null)}><section className="timer-start-dialog" role="dialog" aria-modal="true" aria-label="作業時間を選択" onPointerDown={(event) => event.stopPropagation()}><header><div><small>予定の目安を確認して開始</small><strong>{timerTarget.task.title}</strong></div><button type="button" onClick={() => setTimerTarget(null)}>×</button></header><p>{timerTarget.hasPlannedHours ? "この日の予定工数の2倍を超えたら、止め忘れ確認を1度だけ通知します。" : "予定工数が未設定のため、3時間経過時に止め忘れ確認を1度だけ通知します。"}タイマーは0分から経過時間を計測します。</p><div className="timer-presets"><button type="button" className="suggested" onClick={() => startTimer(timerTarget.suggestedMinutes)}>{timerTarget.suggestedMinutes}分</button>{[15, 30, 60].filter((minutes) => minutes !== timerTarget.suggestedMinutes).map((minutes) => <button type="button" key={minutes} onClick={() => startTimer(minutes)}>{minutes}分</button>)}</div><label>予定目安<input type="number" min="1" step="1" value={customTimerMinutes} onChange={(event) => setCustomTimerMinutes(event.target.value)} /><span>分</span><button type="button" className="primary" onClick={() => startTimer(Number(customTimerMinutes))}>開始</button></label></section></div>}
    {effortSummaryOpen && <EffortSummaryModal tasks={tasks} projects={projects} tags={tags} date={date} onClose={() => setEffortSummaryOpen(false)} />}
  </Modal>;
}
