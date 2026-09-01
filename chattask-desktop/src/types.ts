export type TaskStatus =
  | "todo"
  | "doing"
  | "waiting-general"
  | "waiting-client"
  | "waiting-team"
  | "waiting-pr"
  | "recurring"
  | "done"
  | "cancelled"
  | "handed-over"
  | "pending";

export type Priority = "A" | "B" | "C" | "D";
export type TaskProgressStatus = "not-started" | "in-progress" | "waiting" | "completed";
export type TaskWaitingReason = "none" | "client" | "team" | "pr" | "other";
export type TaskKind = "normal" | "recurring";
export type WaitingKind = "go" | "confirmation" | "reply" | "material" | "work" | "other";

export interface WaitingFollowUp {
  kind: WaitingKind;
  party: string;
  startedAt: string;
  reviewDate: string;
  memo: string;
  lastCheckedAt?: string;
}

export interface WaitingHistoryEntry {
  id: string;
  followUp: WaitingFollowUp;
  status: TaskStatus;
  releasedAt: string;
  reason: "status-change" | "go";
}

export interface GithubRepository {
  id: string;
  name: string;
  url: string;
}

export interface ProjectTag {
  id: string;
  name: string;
  visible: boolean;
  color?: string;
  iconType?: "color" | "image";
  logoAttachmentId?: string;
  logoUpdatedAt?: string;
  githubRepositories?: GithubRepository[];
  /** 複数リポジトリ対応前のデータ移行用。 */
  githubRepositoryUrl?: string;
  sharedLinks?: TaskLink[];
  sharedDocuments?: TaskDocument[];
}

export interface PlannedRange {
  id: string;
  startDate: string;
  endDate: string;
  /** 同じ開始日の予定内で使用する手動表示順。 */
  sortOrder?: number;
  title?: string;
  description?: string;
  note?: string;
  plannedHours?: number;
  status?: "not-started" | "in-progress" | "completed";
  completedAt?: string;
  sourceType?: "project-milestone" | "project-work";
  sourceId?: string;
  carriedOverFrom?: string;
  carriedOverSourceRangeId?: string;
  originalEndDate?: string;
  carriedOverDates?: string[];
  /** 持ち越し元の日に実績工数があったか。持ち越し実行時の判定を保持する。 */
  carriedOverWork?: Record<string, boolean>;
  advancedFromStartDate?: string;
  advancedFromEndDate?: string;
  advancedSourceRangeId?: string;
  advanceReason?: string;
  advancedAt?: string;
}

export interface TaskLink {
  id: string;
  label: string;
  url: string;
  kind?: "url" | "file";
  attachmentId?: string;
}

export interface RelatedTaskLink {
  taskId: string;
  relation: "reference" | "previous" | "handover";
  linkedAt: string;
}

export interface HistoryEntry {
  id: string;
  type: "system" | "comment";
  text: string;
  timestamp: string;
  editedAt?: string;
  attachmentIds?: string[];
}

export interface TaskDocument {
  id: string;
  title: string;
  content: string;
  kind?: "document" | "folder" | "outline";
  parentId?: string;
  sortOrder?: number;
  folderSortMode?: "manual" | "name-asc" | "name-desc" | "updated-desc" | "updated-asc" | "created-desc" | "created-asc";
  createdAt: string;
  updatedAt: string;
}

export interface RecurrenceSettings {
  frequency: "daily" | "weekly" | "monthly";
  weekday?: number;
  monthDay?: number;
  monthlyType?: "date" | "weekday";
  weekOfMonth?: number;
  startDate: string;
  endDate?: string;
  paused?: boolean;
}

export interface RecurrenceRecord {
  date: string;
  status: "pending" | "done" | "skipped" | "moved";
  actualDate?: string;
  movedTo?: string;
  moveReason?: string;
  memo?: string;
  timestamp: string;
}

export interface TaskRepositoryBranches {
  repositoryId: string;
  branchNames: string[];
}

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  /** 旧画面との互換用。新規処理では下の3フィールドを基準にする。 */
  status: TaskStatus;
  progressStatus: TaskProgressStatus;
  waitingReason: TaskWaitingReason;
  waitingFollowUp?: WaitingFollowUp;
  lastReleasedWaitingFollowUp?: WaitingFollowUp;
  lastReleasedWaitingStatus?: TaskStatus;
  waitingHistory?: WaitingHistoryEntry[];
  taskKind: TaskKind;
  projectTagId: string;
  parentTaskId: string;
  /** リポジトリごとに記録したGitブランチ名。 */
  repositoryBranches: TaskRepositoryBranches[];
  links: TaskLink[];
  relatedTasks: RelatedTaskLink[];
  nextAction: string;
  reminderDate: string;
  dueDate: string;
  isToday: boolean;
  plannedRanges: PlannedRange[];
  /** 日程を決めずに保持している作業予定。 */
  unscheduledPlans?: PlannedRange[];
  recurrence: RecurrenceSettings | null;
  recurrenceMemoTemplate: string;
  recurrenceRecords: RecurrenceRecord[];
  dailyPlans: Record<string, string>;
  dailyPlanCompleted: Record<string, boolean>;
  dailyPlanStatuses?: Record<string, TaskStatus>;
  plannedHours?: number;
  actualHours?: number;
  dailyActualHours?: Record<string, number>;
  documents: TaskDocument[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  history: HistoryEntry[];
}

export interface TaskTemplate {
  id: string;
  name: string;
  keywords: string[];
  title: string;
  description: string;
  nextAction: string;
  priority: Priority;
  projectTagId: string;
  plannedHours: number;
  links: TaskLink[];
  documents: TaskDocument[];
  schedules?: Array<Pick<PlannedRange, "title" | "description" | "note" | "plannedHours" | "status"> & { startOffsetDays?: number; endOffsetDays?: number }>;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityEvent {
  id: string;
  taskId: string | null;
  taskTitle: string;
  projectTagId: string;
  type: string;
  summary: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface NonWorkingPeriod {
  id: string;
  startDate: string;
  endDate: string;
  type: "vacation" | "holiday" | "other" | "weekend";
  note?: string;
}

export interface UserProfile {
  displayName: string;
  avatarUpdatedAt: string;
}

export type GoalStatus = "not-started" | "in-progress" | "paused" | "achieved" | "archived" | "cancelled";

export interface GoalMilestone {
  id: string;
  title: string;
  completed: boolean;
  taskIds: string[];
  description?: string;
  dueDate?: string;
  linkedTaskId?: string;
  sortOrder?: number;
  status?: "not-started" | "in-progress" | "achieved";
  plannedRanges?: PlannedRange[];
  plannedHours?: number;
  baselinePlannedRanges?: PlannedRange[];
  baselinePlannedHours?: number;
  replanReason?: string;
  replannedAt?: string;
  linkedTaskScheduleSnapshot?: PlannedRange[];
  linkedTaskPlannedHoursSnapshot?: number;
  /** @deprecated 旧保存データの読み込み互換用。ステータスは連動しない。 */
  syncLinkedTaskStatus?: boolean;
  completedAt?: string;
}

export interface ProjectWorkItem {
  id: string;
  milestoneId: string;
  title: string;
  description: string;
  status: "not-started" | "in-progress" | "done";
  priority: Priority;
  dueDate: string;
  linkedTaskId: string;
  plannedHours: number;
  actualHours: number;
  plannedRanges?: PlannedRange[];
  baselinePlannedRanges?: PlannedRange[];
  baselinePlannedHours?: number;
  replanReason?: string;
  replannedAt?: string;
  linkedTaskScheduleSnapshot?: PlannedRange[];
  linkedTaskPlannedHoursSnapshot?: number;
  /** @deprecated 旧保存データの読み込み互換用。ステータスは連動しない。 */
  syncLinkedTaskStatus?: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface GoalReview {
  id: string;
  date: string;
  text: string;
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  successCriteria: string;
  dueDate: string;
  status: GoalStatus;
  projectTagId: string;
  taskIds: string[];
  milestones: GoalMilestone[];
  reviews: GoalReview[];
  originTaskId?: string;
  priority?: Priority;
  workItems?: ProjectWorkItem[];
  sharedLinks?: TaskLink[];
  sharedDocuments?: TaskDocument[];
  createdAt: string;
  updatedAt: string;
}

export type AppIssueStatus = "open" | "in-progress" | "on-hold" | "resolved";
export type AppIssueCategory = "bug" | "improvement" | "request" | "other";

export interface AppIssue {
  id: string;
  title: string;
  category: AppIssueCategory;
  status: AppIssueStatus;
  priority: Priority;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export type InboxItemStatus = "inbox" | "archived" | "promoted";

export interface InboxItem {
  id: string;
  title: string;
  body: string;
  projectTagId: string;
  status: InboxItemStatus;
  promotedTaskId?: string;
  reviewDate?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface AppData {
  version: number;
  organizationSeed: number;
  tasks: Task[];
  projectTags: ProjectTag[];
  activityLog: ActivityEvent[];
  dailyNotes: Record<string, string>;
  dailyFinalizedAt: Record<string, string>;
  nonWorkingPeriods: NonWorkingPeriod[];
  userProfile: UserProfile;
  goals: Goal[];
  issues: AppIssue[];
  inboxItems: InboxItem[];
  todayTaskOrders: Record<string, string[]>;
}

export type TaskFilter = "all" | "all-with-done" | "today" | "today-waiting" | "my-turn" | "waiting" | "deadline" | "done";
export type TaskSortKey = "today" | "priority" | "dueDate" | "updatedAt" | "createdAt" | "title";
export type AdvancedFilterField = "status" | "priority" | "tag" | "today" | "deadline" | "text";
export type AdvancedFilterOperator = "is" | "is-not" | "contains" | "not-contains";
export interface AdvancedFilterCondition {
  id: string;
  field: AdvancedFilterField;
  operator: AdvancedFilterOperator;
  value: string;
}
export interface AdvancedTaskFilter {
  mode: "and" | "or";
  conditions: AdvancedFilterCondition[];
}
export interface TaskSortRule {
  id: string;
  key: TaskSortKey;
  direction: "asc" | "desc";
}

export interface SavedTaskView {
  id: string;
  name: string;
  filter: TaskFilter;
  tagFilter: string;
  priorityFilter: "all" | Priority;
  search: string;
  density: "standard" | "compact" | "minimal";
  narrow: boolean;
  groupByTag: boolean;
  sortRules?: TaskSortRule[];
  advancedFilter?: AdvancedTaskFilter;
}
