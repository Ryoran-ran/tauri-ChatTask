import type { Goal, NonWorkingPeriod, ProjectWorkItem } from "./types";
import { getNonWorkingPeriod, rangeDates } from "./utils";

export type WorkCapacityStatus = "unset" | "invalid" | "completed" | "comfortable" | "feasible" | "tight" | "over";

export interface WorkCapacityAssessment {
  status: WorkCapacityStatus;
  workingDates: string[];
  requiredHours: number;
  grossCapacityHours: number;
  competingHours: number;
  availableHours: number;
  shortageHours: number;
  loadRate: number | null;
  missingEstimateCount: number;
  estimatedExtensionDays: number;
  exceedsDeadline: boolean;
}

const capacity = (value: number) => Math.min(24, Math.max(0.25, Number(value) || 6));

export const projectWorkWorkingDates = (work: ProjectWorkItem, periods: NonWorkingPeriod[]) => {
  const startDate = work.targetWorkStartDate || "";
  const endDate = work.targetWorkEndDate || "";
  if (!startDate || !endDate || endDate < startDate) return [];
  return rangeDates([{ id: `project-target-${work.id}`, startDate, endDate }], 3660)
    .filter((date) => !getNonWorkingPeriod(date, periods));
};

export const projectWorkRequiredHours = (work: ProjectWorkItem) => work.status === "done"
  ? 0
  : Math.max(0, Number(work.plannedHours) || 0);

interface DailyWorkLoad {
  plannedHours: number;
  missingEstimateCount: number;
  contributions: { projectId: string; projectTitle: string; workTitle: string; hours: number }[];
}

const collectDailyLoads = (
  projects: Goal[],
  periods: NonWorkingPeriod[],
  excludedProjectId?: string,
  excludedWorkId?: string,
  includeContributions = true,
) => {
  const loads = new Map<string, DailyWorkLoad>();
  let unscheduledWorkCount = 0;
  projects.forEach((project) => (project.workItems || []).forEach((work) => {
    if (work.status === "done") return;
    if (project.id === excludedProjectId && work.id === excludedWorkId) return;
    const dates = projectWorkWorkingDates(work, periods);
    if (!dates.length) { unscheduledWorkCount++; return; }
    const hoursPerDay = projectWorkRequiredHours(work) / dates.length;
    dates.forEach((date) => {
      const load = loads.get(date) || { plannedHours: 0, missingEstimateCount: 0, contributions: [] };
      load.plannedHours += hoursPerDay;
      if (!(Number(work.plannedHours) > 0)) load.missingEstimateCount++;
      if (includeContributions) load.contributions.push({ projectId: project.id, projectTitle: project.title, workTitle: work.title, hours: hoursPerDay });
      loads.set(date, load);
    });
  }));
  return { loads, unscheduledWorkCount };
};

export interface ProjectDailyCapacity extends DailyWorkLoad {
  date: string;
  capacityHours: number;
  currentProjectHours: number;
  otherProjectHours: number;
  nonWorking: boolean;
  over: boolean;
}

/** 表示期間ではなく目標期間全体の営業日へ均等配分する。表示フィルターは渡さない。 */
export function assessProjectDailyCapacity({ projects, periods, dates, dailyCapacityHours, currentProjectId }: {
  projects: Goal[]; periods: NonWorkingPeriod[]; dates: string[]; dailyCapacityHours: number; currentProjectId: string;
}) {
  const { loads, unscheduledWorkCount } = collectDailyLoads(projects, periods);
  const days: ProjectDailyCapacity[] = dates.map(date => {
    const load = loads.get(date) || { plannedHours: 0, missingEstimateCount: 0, contributions: [] };
    const nonWorking = Boolean(getNonWorkingPeriod(date, periods));
    const capacityHours = nonWorking ? 0 : capacity(dailyCapacityHours);
    const currentProjectHours = load.contributions.filter(item => item.projectId === currentProjectId).reduce((sum, item) => sum + item.hours, 0);
    return { ...load, date, capacityHours, currentProjectHours, otherProjectHours: Math.max(0, load.plannedHours - currentProjectHours), nonWorking, over: load.plannedHours - capacityHours > 1e-9 };
  });
  return { days, unscheduledWorkCount };
}

export const assessProjectWorkCapacity = ({
  projectId,
  work,
  deadline,
  projects,
  periods,
  dailyCapacityHours,
}: {
  projectId: string;
  work: ProjectWorkItem;
  deadline?: string;
  projects: Goal[];
  periods: NonWorkingPeriod[];
  dailyCapacityHours: number;
}): WorkCapacityAssessment => {
  const requiredHours = projectWorkRequiredHours(work);
  const missingEstimateCount = work.status !== "done" && !(Number(work.plannedHours) > 0) ? 1 : 0;
  const startDate = work.targetWorkStartDate || "";
  const endDate = work.targetWorkEndDate || "";
  const emptyResult = (status: WorkCapacityStatus): WorkCapacityAssessment => ({
    status,
    workingDates: [],
    requiredHours,
    grossCapacityHours: 0,
    competingHours: 0,
    availableHours: 0,
    shortageHours: requiredHours,
    loadRate: null,
    missingEstimateCount,
    estimatedExtensionDays: 0,
    exceedsDeadline: Boolean(endDate && deadline && endDate > deadline),
  });
  if (!startDate || !endDate) return emptyResult("unset");
  if (endDate < startDate) return emptyResult("invalid");
  if (work.status === "done") return emptyResult("completed");

  const workingDates = projectWorkWorkingDates(work, periods);
  const dailyHours = capacity(dailyCapacityHours);
  const grossCapacityHours = workingDates.length * dailyHours;
  const { loads: competing } = collectDailyLoads(projects, periods, projectId, work.id, false);
  const competingHours = workingDates.reduce((sum, date) => sum + (competing.get(date)?.plannedHours || 0), 0);
  const availableHours = workingDates.reduce((sum, date) => sum + Math.max(0, dailyHours - (competing.get(date)?.plannedHours || 0)), 0);
  const shortageHours = Math.max(0, requiredHours - availableHours);
  const loadRate = availableHours > 0 ? requiredHours / availableHours : requiredHours > 0 ? Infinity : 0;
  const status: WorkCapacityStatus = shortageHours > 0
    ? "over"
    : loadRate > 0.9
      ? "tight"
      : loadRate >= 0.7
        ? "feasible"
        : "comfortable";
  return {
    status,
    workingDates,
    requiredHours,
    grossCapacityHours,
    competingHours,
    availableHours,
    shortageHours,
    loadRate: Number.isFinite(loadRate) ? loadRate : null,
    missingEstimateCount,
    estimatedExtensionDays: shortageHours > 0 ? Math.ceil(shortageHours / dailyHours) : 0,
    exceedsDeadline: Boolean(deadline && endDate > deadline),
  };
};
