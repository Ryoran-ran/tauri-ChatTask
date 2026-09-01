import { DEFAULT_TAGS, isTerminalStatus } from "../data/constants";
import { invoke } from "@tauri-apps/api/core";
import type { ActivityEvent, AppData, PlannedRange, Priority, ProjectTag, Task, TaskKind, TaskProgressStatus, TaskStatus, TaskWaitingReason } from "../types";
import { randomTagColor } from "../tagColors";
import { generateId, mergeRanges, todayValue } from "../utils";

const KEYS = {
  tasks: "chatTasksData",
  tags: "chatTaskProjectTags",
  activity: "chatTaskActivityLog",
  notes: "chatTaskDailyNotes",
  dailyFinalizedAt: "chatTaskDailyFinalizedAt",
  nonWorking: "chatTaskNonWorkingPeriods",
  profile: "chatTaskUserProfile",
  goals: "chatTaskGoals",
  issues: "chatTaskIssues",
  organizationSeed: "chatTaskOrganizationSeed",
  inbox: "chatTaskInboxItems",
  todayTaskOrders: "chatTaskTodayTaskOrders",
};

export type AppEnvironment = "production" | "test";
const ENVIRONMENT_KEY = "chatTaskActiveEnvironment";
export const getActiveEnvironment = (): AppEnvironment =>
  localStorage.getItem(ENVIRONMENT_KEY) === "test" ? "test" : "production";
export const setActiveEnvironment = (environment: AppEnvironment) =>
  localStorage.setItem(ENVIRONMENT_KEY, environment);
const environmentKey = (key: string, environment: AppEnvironment) =>
  environment === "test" ? `${key}:test` : key;

const parse = <T,>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

export const classifyLegacyStatus = (status: TaskStatus): {
  progressStatus: TaskProgressStatus;
  waitingReason: TaskWaitingReason;
  taskKind: TaskKind;
} => {
  const waitingReasons: Partial<Record<TaskStatus, TaskWaitingReason>> = {
    "waiting-client": "client",
    "waiting-team": "team",
    "waiting-pr": "pr",
    "waiting-general": "other",
  };
  return {
    progressStatus: isTerminalStatus(status)
      ? "completed"
      : status === "doing"
        ? "in-progress"
        : status.startsWith("waiting-") || status === "pending"
          ? "waiting"
          : "not-started",
    waitingReason: waitingReasons[status] || "none",
    taskKind: status === "recurring" ? "recurring" : "normal",
  };
};

export const normalizeTask = (source: Partial<Task> & Record<string, unknown>): Task => {
  const now = new Date().toISOString();
  const legacyPriority: Record<string, Priority> = { high: "A", medium: "B", low: "C" };
  const rawPriority = String(source.priority || "B");
  const priority = (["A", "B", "C", "D"].includes(rawPriority) ? rawPriority : legacyPriority[rawPriority] || "B") as Priority;
  const rawStatus = String(source.status || "todo");
  const status = (rawStatus === "doing-me"
    ? "doing"
    : rawStatus === "waiting-staging" || rawStatus === "waiting-prod"
      ? "waiting-pr"
      : rawStatus) as TaskStatus;
  const classification = classifyLegacyStatus(status);
  const legacyDates = Array.isArray(source.plannedDates) ? source.plannedDates as string[] : source.plannedDate ? [String(source.plannedDate)] : [];
  const rawRanges: PlannedRange[] = Array.isArray(source.plannedRanges)
    ? source.plannedRanges.filter((item): item is Task["plannedRanges"][number] => Boolean(item?.startDate && item?.endDate))
    : legacyDates.map((date) => ({ id: generateId(), startDate: date, endDate: date }));
  const migratedRangeIds = new Map<string, string>();
  const removedRangeIds = new Set<string>();
  const ranges = rawRanges.map((range) => ({ ...range }));
  ranges.forEach((carried) => {
    if (!carried.carriedOverSourceRangeId || !carried.carriedOverFrom) return;
    const sourceRange = ranges.find((range) => range.id === carried.carriedOverSourceRangeId);
    if (!sourceRange) return;
    sourceRange.originalEndDate = sourceRange.originalEndDate || sourceRange.endDate;
    if (carried.endDate > sourceRange.endDate) sourceRange.endDate = carried.endDate;
    sourceRange.carriedOverDates = [...new Set([...(sourceRange.carriedOverDates || []), carried.carriedOverFrom])].sort();
    migratedRangeIds.set(carried.id, sourceRange.id);
    removedRangeIds.add(carried.id);
  });
  const normalizedRanges = mergeRanges(ranges.filter((range) => !removedRangeIds.has(range.id)));
  const migratePlannedRecord = <T,>(record: Record<string, T> | undefined) => Object.fromEntries(
    Object.entries(record || {}).map(([key, value]) => {
      const separator = key.indexOf("::");
      if (separator < 0) {
        // 旧形式の日付だけの記録は、その日の予定が1件に特定できる場合だけ予定IDへ移す。
        const matches = normalizedRanges.filter((range) => range.startDate <= key && range.endDate >= key);
        return matches.length === 1 ? [`${key}::${matches[0].id}`, value] : [key, value];
      }
      const rangeId = key.slice(separator + 2);
      return [`${key.slice(0, separator)}::${migratedRangeIds.get(rangeId) || rangeId}`, value];
    }),
  );
  const recurrence = source.recurrence as Task["recurrence"] || (status === "recurring" ? { frequency: "weekly" as const, weekday: new Date().getDay(), monthDay: new Date().getDate(), startDate: todayValue(), endDate: "", paused: false } : null);
  const legacyBranchNames = Array.isArray(source.branchNames)
    ? [...new Set(source.branchNames.map((name) => String(name).trim()).filter(Boolean))]
    : String(source.branchName || "").trim() ? [String(source.branchName).trim()] : [];
  const repositoryBranches = Array.isArray(source.repositoryBranches)
    ? source.repositoryBranches.map((group) => {
      const value = group && typeof group === "object" ? group as unknown as Record<string, unknown> : {};
      return { repositoryId: String(value.repositoryId || ""), branchNames: Array.isArray(value.branchNames) ? [...new Set(value.branchNames.map((name) => String(name).trim()).filter(Boolean))] : [] };
    }).filter((group) => group.branchNames.length)
    : legacyBranchNames.length ? [{ repositoryId: "", branchNames: legacyBranchNames }] : [];
  const task: Task = {
    id: String(source.id || generateId()), title: String(source.title || "無題のタスク"), description: String(source.description || ""),
    priority, status,
    progressStatus: (source.progressStatus as TaskProgressStatus) || classification.progressStatus,
    waitingReason: String(source.waitingReason || "") === "staging" || String(source.waitingReason || "") === "production"
      ? "pr"
      : (source.waitingReason as TaskWaitingReason) || classification.waitingReason,
    waitingFollowUp: source.waitingFollowUp && typeof source.waitingFollowUp === "object"
      ? source.waitingFollowUp as Task["waitingFollowUp"]
      : undefined,
    lastReleasedWaitingFollowUp: source.lastReleasedWaitingFollowUp && typeof source.lastReleasedWaitingFollowUp === "object"
      ? source.lastReleasedWaitingFollowUp as Task["lastReleasedWaitingFollowUp"]
      : undefined,
    lastReleasedWaitingStatus: typeof source.lastReleasedWaitingStatus === "string"
      ? source.lastReleasedWaitingStatus as Task["lastReleasedWaitingStatus"]
      : undefined,
    waitingHistory: Array.isArray(source.waitingHistory) ? source.waitingHistory as Task["waitingHistory"] : [],
    taskKind: (source.taskKind as TaskKind) || classification.taskKind,
    projectTagId: String(source.projectTagId || ""), parentTaskId: String(source.parentTaskId || ""),
    repositoryBranches,
    links: Array.isArray(source.links) ? source.links as Task["links"] : [],
    relatedTasks: Array.isArray(source.relatedTasks) ? source.relatedTasks as Task["relatedTasks"] : [], nextAction: String(source.nextAction || ""),
    reminderDate: String(source.reminderDate || ""), dueDate: String(source.dueDate || ""), isToday: false, plannedRanges: normalizedRanges,
    recurrence,
    recurrenceMemoTemplate: String(source.recurrenceMemoTemplate || ""),
    recurrenceRecords: Array.isArray(source.recurrenceRecords) ? source.recurrenceRecords as Task["recurrenceRecords"] : [],
    dailyPlans: migratePlannedRecord(source.dailyPlans && typeof source.dailyPlans === "object" ? source.dailyPlans as Record<string, string> : {}),
    dailyPlanCompleted: migratePlannedRecord(source.dailyPlanCompleted && typeof source.dailyPlanCompleted === "object" ? source.dailyPlanCompleted as Record<string, boolean> : {}),
    dailyPlanStatuses: migratePlannedRecord(source.dailyPlanStatuses && typeof source.dailyPlanStatuses === "object" ? source.dailyPlanStatuses as Task["dailyPlanStatuses"] : {}),
    plannedHours: Math.max(0, Number(source.plannedHours) || 0),
    actualHours: Math.max(0, Number(source.actualHours) || 0),
    dailyActualHours: source.dailyActualHours && typeof source.dailyActualHours === "object"
      ? Object.fromEntries(
        Object.entries(migratePlannedRecord(source.dailyActualHours as Record<string, unknown>))
          .map(([date, hours]) => [date, Math.max(0, Number(hours) || 0)]),
      )
      : {},
    documents: Array.isArray(source.documents) ? source.documents as Task["documents"] : [],
    createdAt: String(source.createdAt || now), updatedAt: String(source.updatedAt || now), completedAt: source.completedAt ? String(source.completedAt) : null,
    history: Array.isArray(source.history) ? source.history as Task["history"] : [],
  };
  const dailyActualValues = Object.values(task.dailyActualHours || {});
  if (dailyActualValues.length) {
    task.actualHours = dailyActualValues.reduce((sum, hours) => sum + (Number(hours) || 0), 0);
  }
  task.isToday = task.plannedRanges.some((range) => range.startDate <= todayValue() && range.endDate >= todayValue());
  return task;
};

const historyActivity = (tasks: Task[]): ActivityEvent[] => tasks.flatMap((task) => task.history.map((entry) => ({
  id: generateId(), taskId: task.id, taskTitle: task.title, projectTagId: task.projectTagId,
  type: entry.type === "comment" ? "memo" : "history", summary: entry.type === "comment" ? "メモを追加" : entry.text,
  details: entry.type === "comment" ? { text: entry.text } : {}, timestamp: entry.timestamp,
})));

const normalizeTags = (tags: ProjectTag[]): ProjectTag[] => tags.map((tag) => ({
  ...tag,
  githubRepositories: Array.isArray(tag.githubRepositories)
    ? tag.githubRepositories.map((repository) => ({ id: String(repository.id || generateId()), name: String(repository.name || ""), url: String(repository.url || "") }))
    : tag.githubRepositoryUrl ? [{ id: generateId(), name: "GitHub", url: String(tag.githubRepositoryUrl) }] : [],
  githubRepositoryUrl: undefined,
  color: /^#[0-9a-f]{6}$/i.test(tag.color || "") ? tag.color : randomTagColor(),
  iconType: tag.iconType === "image" && tag.logoAttachmentId ? "image" : "color",
  sharedLinks: Array.isArray(tag.sharedLinks) ? tag.sharedLinks : [],
  sharedDocuments: Array.isArray(tag.sharedDocuments) ? tag.sharedDocuments : [],
}));

const createOrganizationSeed = (environment: AppEnvironment = getActiveEnvironment()) => {
  const key = environmentKey(KEYS.organizationSeed, environment);
  const storedSeed = Number(localStorage.getItem(key));
  if (Number.isInteger(storedSeed) && storedSeed > 0) return storedSeed;
  const legacySeed = Number(localStorage.getItem("chatTaskCitySeed"));
  const seed = Number.isInteger(legacySeed) && legacySeed > 0
    ? legacySeed
    : Math.floor(Math.random() * 2_147_483_646) + 1;
  localStorage.setItem(key, String(seed));
  return seed;
};

export const loadAppData = (environment: AppEnvironment = getActiveEnvironment()): AppData => {
  const get = (key: string) => localStorage.getItem(environmentKey(key, environment));
  const rawTasks = parse<Record<string, unknown>[]>(get(KEYS.tasks), []);
  const tasks = rawTasks.map(normalizeTask);
  const savedActivity = parse<ActivityEvent[]>(get(KEYS.activity), []);
  return {
    version: 12,
    organizationSeed: createOrganizationSeed(environment),
    tasks,
    projectTags: normalizeTags(parse(get(KEYS.tags), DEFAULT_TAGS.map((tag) => ({ ...tag })))),
    activityLog: savedActivity.length ? savedActivity : historyActivity(tasks),
    dailyNotes: parse(get(KEYS.notes), {}), dailyFinalizedAt: parse(get(KEYS.dailyFinalizedAt), {}),
    nonWorkingPeriods: parse(get(KEYS.nonWorking), []), userProfile: parse(get(KEYS.profile), { displayName: "あなた", avatarUpdatedAt: "" }),
    goals: parse(get(KEYS.goals), []), issues: parse(get(KEYS.issues), []), inboxItems: parse(get(KEYS.inbox), []),
    todayTaskOrders: parse(get(KEYS.todayTaskOrders), {}),
  };
};

const saveToLocalStorage = (data: AppData, environment: AppEnvironment) => {
  const set = (key: string, value: unknown) => localStorage.setItem(environmentKey(key, environment), typeof value === "string" ? value : JSON.stringify(value));
  set(KEYS.organizationSeed, String(data.organizationSeed)); set(KEYS.tasks, data.tasks); set(KEYS.tags, data.projectTags);
  set(KEYS.activity, data.activityLog); set(KEYS.notes, data.dailyNotes); set(KEYS.dailyFinalizedAt, data.dailyFinalizedAt);
  set(KEYS.nonWorking, data.nonWorkingPeriods); set(KEYS.profile, data.userProfile); set(KEYS.goals, data.goals);
  set(KEYS.issues, data.issues); set(KEYS.inbox, data.inboxItems); set(KEYS.todayTaskOrders, data.todayTaskOrders);
};

export type StorageBackend = "sqlite" | "localStorage";

export interface StorageInitialization {
  data: AppData;
  backend: StorageBackend;
}

export interface AppBackupInfo {
  fileName: string;
  path: string;
  createdAt: number;
  size: number;
}

const isTauriRuntime = () => "__TAURI_INTERNALS__" in window;

const initializationPromises = new Map<AppEnvironment, Promise<StorageInitialization>>();
let sqliteSaveQueue: Promise<void> = Promise.resolve();

export const initializeAppStorage = async (legacyData: AppData, environment: AppEnvironment = getActiveEnvironment()): Promise<StorageInitialization> => {
  if (!isTauriRuntime()) return { data: legacyData, backend: "localStorage" };
  if (!initializationPromises.has(environment)) {
    initializationPromises.set(environment, invoke<AppData>("initialize_app_database", { legacyData, environment })
      .then((stored) => ({
        data: parseImportedData(JSON.stringify(stored)),
        backend: "sqlite" as const,
      }))
      .catch((error) => {
        initializationPromises.delete(environment);
        throw error;
      }));
  }
  return initializationPromises.get(environment)!;
};

export const saveAppData = async (data: AppData, backend: StorageBackend, environment: AppEnvironment = getActiveEnvironment()) => {
  if (backend === "sqlite") {
    const snapshot = structuredClone(data);
    sqliteSaveQueue = sqliteSaveQueue
      .catch(() => undefined)
      .then(() => invoke<void>("save_app_data_sqlite", { data: snapshot, environment }));
    return sqliteSaveQueue;
  }
  saveToLocalStorage(data, environment);
};

export const createAppBackup = async (data: AppData, environment: AppEnvironment): Promise<AppBackupInfo> =>
  invoke<AppBackupInfo>("create_app_backup", { data, environment });

export const listAppBackups = async (environment: AppEnvironment): Promise<AppBackupInfo[]> =>
  invoke<AppBackupInfo[]>("list_app_backups", { environment });

export const restoreAppBackup = async (fileName: string, environment: AppEnvironment): Promise<AppData> => {
  const restored = await invoke<AppData>("restore_app_backup", { fileName, environment });
  return parseImportedData(JSON.stringify(restored));
};

export const parseImportedData = (text: string): AppData => {
  const imported = JSON.parse(text) as AppData | Record<string, unknown>[];
  const tasks = Array.isArray(imported) ? imported : imported.tasks;
  if (!Array.isArray(tasks)) throw new Error("タスクデータがありません");
  const normalizedTasks = tasks.map((item) => normalizeTask(item as Record<string, unknown>));
  const importedActivity = !Array.isArray(imported) && Array.isArray(imported.activityLog) ? imported.activityLog : [];
  return {
    version: 12,
    organizationSeed: !Array.isArray(imported) && Number.isInteger(Number(imported.organizationSeed)) && Number(imported.organizationSeed) > 0
      ? Number(imported.organizationSeed)
      : createOrganizationSeed(),
    tasks: normalizedTasks,
    projectTags: normalizeTags(!Array.isArray(imported) && Array.isArray(imported.projectTags) ? imported.projectTags : DEFAULT_TAGS.map((tag) => ({ ...tag }))),
    activityLog: importedActivity.length ? importedActivity : historyActivity(normalizedTasks),
    dailyNotes: !Array.isArray(imported) && imported.dailyNotes ? imported.dailyNotes : {},
    dailyFinalizedAt: !Array.isArray(imported) && imported.dailyFinalizedAt ? imported.dailyFinalizedAt : {},
    nonWorkingPeriods: !Array.isArray(imported) && Array.isArray(imported.nonWorkingPeriods) ? imported.nonWorkingPeriods : [],
    userProfile: !Array.isArray(imported) && imported.userProfile ? imported.userProfile : { displayName: "あなた", avatarUpdatedAt: "" },
    goals: !Array.isArray(imported) && Array.isArray(imported.goals) ? imported.goals : [],
    issues: !Array.isArray(imported) && Array.isArray(imported.issues) ? imported.issues : [],
    inboxItems: !Array.isArray(imported) && Array.isArray(imported.inboxItems) ? imported.inboxItems : [],
    todayTaskOrders: !Array.isArray(imported) && imported.todayTaskOrders && typeof imported.todayTaskOrders === "object" ? imported.todayTaskOrders as Record<string, string[]> : {},
  };
};
