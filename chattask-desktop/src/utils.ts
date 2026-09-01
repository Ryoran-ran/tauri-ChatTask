import type { NonWorkingPeriod, PlannedRange, QuickLinkRule, Task } from "./types";

export const generateId = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);

export const todayValue = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
};

export const localDateValue = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

/**
 * A carried-over range keeps its original start and the new destination as its
 * end so the history remains traceable. The dates between them are not work
 * dates, however, and must not be treated as a continuous schedule.
 */
export const isPlannedRangeForDate = (range: PlannedRange, date: string) => {
  if (range.startDate > date || range.endDate < date) return false;
  if (!range.originalEndDate || !range.carriedOverDates?.length) return true;
  if (date <= range.originalEndDate) return true;
  return date === range.endDate || range.carriedOverDates.includes(date);
};

export const isTaskPlannedForDate = (task: Task, date: string) =>
  task.plannedRanges.some((range) => isPlannedRangeForDate(range, date));

export const hasIncompletePlanForDate = (task: Task, date: string, completedProjectWorkIds?: ReadonlySet<string>) => {
  const ranges = task.plannedRanges.filter((range) => isPlannedRangeForDate(range, date)
    && !(range.sourceType === "project-work" && range.sourceId && completedProjectWorkIds?.has(range.sourceId)));
  return ranges.some((range) => {
    const carriedForward = task.plannedRanges.some((candidate) =>
      (candidate.carriedOverDates?.includes(date)
        || (candidate.carriedOverFrom === date && candidate.carriedOverSourceRangeId === range.id))
      && candidate.endDate > date
    );
    if (carriedForward) return false;
    if (range.status === "completed") return false;
    const planKey = `${date}::${range.id}`;
    return !task.dailyPlanCompleted[planKey];
  });
};

export const normalizeUrl = (value: string) => {
  const candidate = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
};

export const normalizeGithubRepositoryUrl = (value: string) => {
  if (!value.trim()) return "";
  const normalized = normalizeUrl(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    const [owner, rawRepository] = url.pathname.split("/").filter(Boolean);
    const repository = rawRepository?.replace(/\.git$/i, "");
    if (url.hostname.toLowerCase() !== "github.com" || !owner || !repository) return null;
    return `https://github.com/${owner}/${repository}`;
  } catch {
    return null;
  }
};

export const normalizeQuickLinkPrefix = (value: string) => {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
};

export const quickLinkNameForUrl = (rules: QuickLinkRule[], value: string) => {
  const candidate = normalizeQuickLinkPrefix(value);
  if (!candidate) return "";
  return [...rules]
    .map((rule) => ({ rule, prefix: normalizeQuickLinkPrefix(rule.urlPrefix) }))
    .filter((item): item is { rule: QuickLinkRule; prefix: string } => Boolean(item.prefix && candidate.startsWith(item.prefix)))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0]?.rule.name || "";
};

export const githubPullRequestUrl = (repositoryUrl: string, branchName: string) => {
  const repository = normalizeGithubRepositoryUrl(repositoryUrl);
  if (!repository || !branchName.trim()) return null;
  const branchPath = branchName.trim().split("/").map(encodeURIComponent).join("/");
  return `${repository}/compare/${branchPath}?expand=1`;
};

export const mergeRanges = (ranges: PlannedRange[]) => {
  const sorted = [...ranges].sort((a, b) => a.startDate.localeCompare(b.startDate)
    || (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER));
  const result: PlannedRange[] = [];
  for (const range of sorted) {
    const previous = result[result.length - 1];
    const nextDay = previous ? new Date(`${previous.endDate}T00:00:00Z`) : null;
    nextDay?.setUTCDate(nextDay.getUTCDate() + 1);
    const adjacent = nextDay ? nextDay.toISOString().slice(0, 10) : "";
    const sameSource = previous
      && previous.sourceType === range.sourceType
      && previous.sourceId === range.sourceId
      && previous.carriedOverFrom === range.carriedOverFrom
      && previous.carriedOverSourceRangeId === range.carriedOverSourceRangeId
      && previous.advancedFromStartDate === range.advancedFromStartDate
      && previous.advancedFromEndDate === range.advancedFromEndDate
      && (previous.title || "") === (range.title || "")
      && (previous.description || "") === (range.description || "")
      && (previous.note || "") === (range.note || "")
      && (Number(previous.plannedHours) || 0) === (Number(range.plannedHours) || 0)
      && (previous.sortOrder ?? 0) === (range.sortOrder ?? 0)
      && (previous.status || "not-started") === (range.status || "not-started")
      && (previous.completedAt || "") === (range.completedAt || "");
    if (previous && sameSource && range.startDate <= adjacent) {
      if (range.endDate > previous.endDate) previous.endDate = range.endDate;
    } else result.push({ ...range });
  }
  return result;
};

export const rangeDates = (ranges: PlannedRange[], limit = 366) => {
  const result: string[] = [];
  for (const range of ranges) {
    const cursor = new Date(`${range.startDate}T00:00:00Z`);
    const end = new Date(`${range.endDate}T00:00:00Z`);
    while (cursor <= end && result.length < limit) {
      result.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return [...new Set(result)].sort();
};

export const plannedRangeHoursForDate = (range: PlannedRange, date: string, periods: NonWorkingPeriod[] = [], workingDateOverrides: string[] = []) => {
  if (!isPlannedRangeForDate(range, date) || getNonWorkingPeriod(date, periods, workingDateOverrides)) return 0;
  const workingDates = rangeDates([range]).filter((candidate) =>
    isPlannedRangeForDate(range, candidate) && !getNonWorkingPeriod(candidate, periods, workingDateOverrides));
  const hours = Math.max(0, Number(range.plannedHours) || 0);
  return workingDates.length && hours > 0 ? hours / workingDates.length : 0;
};

export const plannedHoursForDate = (task: Task, date: string, periods: NonWorkingPeriod[] = [], workingDateOverrides: string[] = []) => {
  if (getNonWorkingPeriod(date, periods, workingDateOverrides)) return 0;
  const activeRanges = task.plannedRanges.filter((range) => isPlannedRangeForDate(range, date));
  if (!activeRanges.length) return 0;
  const allocatedRangeHours = activeRanges.reduce((sum, range) => sum + plannedRangeHoursForDate(range, date, periods, workingDateOverrides), 0);
  if (allocatedRangeHours > 0) return allocatedRangeHours;
  const scheduledDays = rangeDates(task.plannedRanges).filter((candidate) =>
    task.plannedRanges.some((range) => isPlannedRangeForDate(range, candidate))
    && !getNonWorkingPeriod(candidate, periods, workingDateOverrides)).length;
  return scheduledDays ? Math.max(0, Number(task.plannedHours) || 0) / scheduledDays : 0;
};

export const addDays = (dateValue: string, days: number) => {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const getNonWorkingPeriod = (dateValue: string, periods: NonWorkingPeriod[], workingDateOverrides: string[] = []) => {
  if (workingDateOverrides.includes(dateValue)) return null;
  const configured = periods.find((period) => period.startDate <= dateValue && period.endDate >= dateValue);
  if (configured) return configured;
  const day = new Date(`${dateValue}T00:00:00Z`).getUTCDay();
  return [0, 6].includes(day) ? { id: `weekend-${dateValue}`, startDate: dateValue, endDate: dateValue, type: "weekend" as const, note: "", automatic: true } : null;
};

export const getNextWorkingDate = (dateValue: string, periods: NonWorkingPeriod[] = [], workingDateOverrides: string[] = []) => {
  let candidate = addDays(dateValue, 1);
  // 設定ミスで極端に長い休暇期間があっても、無限ループにはしない。
  for (let offset = 0; offset < 3660 && getNonWorkingPeriod(candidate, periods, workingDateOverrides); offset += 1) {
    candidate = addDays(candidate, 1);
  }
  return candidate;
};

export const isRecurringDue = (task: Task, dateValue: string, periods: NonWorkingPeriod[] = [], workingDateOverrides: string[] = []) => {
  if (task.status !== "recurring" || !task.recurrence || task.recurrence.paused) return false;
  const settings = task.recurrence;
  if (dateValue < settings.startDate || (settings.endDate && dateValue > settings.endDate)) return false;
  const date = new Date(`${dateValue}T00:00:00Z`);
  if (settings.frequency === "daily") return !getNonWorkingPeriod(dateValue, periods, workingDateOverrides);
  if (settings.frequency === "weekly") return date.getUTCDay() === Number(settings.weekday);
  if (settings.monthlyType === "weekday") {
    if (date.getUTCDay() !== Number(settings.weekday)) return false;
    const week = Number(settings.weekOfMonth) || 1;
    if (week === -1) {
      const nextWeek = new Date(date);
      nextWeek.setUTCDate(date.getUTCDate() + 7);
      return nextWeek.getUTCMonth() !== date.getUTCMonth();
    }
    return Math.floor((date.getUTCDate() - 1) / 7) + 1 === week;
  }
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return date.getUTCDate() === Math.min(Number(settings.monthDay) || 1, lastDay);
};

export const recurrenceLabel = (task: Task) => {
  if (!task.recurrence) return "";
  if (task.recurrence.frequency === "daily") return "毎日";
  if (task.recurrence.frequency === "weekly") return `毎週${["日", "月", "火", "水", "木", "金", "土"][Number(task.recurrence.weekday) || 0]}曜日`;
  if (task.recurrence.monthlyType === "weekday") {
    const week = Number(task.recurrence.weekOfMonth) || 1;
    const weekLabel = week === -1 ? "最終" : `第${week}`;
    return `毎月${weekLabel}${["日", "月", "火", "水", "木", "金", "土"][Number(task.recurrence.weekday) || 0]}曜日`;
  }
  return `毎月${task.recurrence.monthDay || 1}日`;
};

export const removeDateFromRanges = (ranges: PlannedRange[], date: string) => ranges.flatMap((range) => {
  if (date < range.startDate || date > range.endDate) return [range];
  if (range.startDate === date && range.endDate === date) return [];
  if (range.startDate === date) return [{ ...range, startDate: addDays(date, 1) }];
  if (range.endDate === date) return [{ ...range, endDate: addDays(date, -1) }];
  return [{ ...range, endDate: addDays(date, -1) }, { id: generateId(), startDate: addDays(date, 1), endDate: range.endDate }];
});
