import type {
  TaskChecklistItem,
  TaskCodeReviewRun,
  TaskTestRun,
  TaskVerificationTimelineEntry,
} from "./review";

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
  /** 今日の作業を達成した際に、コメントの対象として保存した作業名。 */
  workTitle?: string;
  /** 達成時点で設定されていた対象作業の予定・実績工数。 */
  workPlannedHours?: number;
  workActualHours?: number;
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
  /** このタスクだけで使用するプルリクエストの作成先。 */
  pullRequestTargets?: string[];
}

export type TaskReflectionKind = "success" | "large-task" | "incident" | "rework" | "estimate" | "branch-split" | "other";
export type BranchSplitAssessment = "should-have-split" | "appropriate" | "unsure" | "not-applicable";
export type TaskReflectionTheme = "requirements" | "task-breakdown" | "branch-split" | "estimate" | "schedule" | "implementation" | "review" | "testing" | "communication" | "release" | "priority" | "documentation" | "process" | "other";

export interface TaskReflectionTodo {
  id: string;
  /** 一覧や作成タスクで使う短い対策名。 */
  title?: string;
  text: string;
  completed: boolean;
  createdAt: string;
  completedAt?: string;
  /** 振り返り対策を実行する予定日。 */
  scheduledDate?: string;
  /** 複数日・工数を伴う対策として管理する通常タスク。 */
  linkedTaskId?: string;
}

export interface TaskReflectionAiAnalysis {
  summary: string;
  successFactors?: Array<{
    text: string;
    evidence: string;
    reproducibility: "high" | "medium" | "low" | "unknown";
    continuation: string;
  }>;
  causes: Array<{ text: string; evidence: string; confidence: "high" | "medium" | "low" }>;
  countermeasures: Array<{
    /** 対策を識別できる短い名称。旧データでは未設定の場合がある。 */
    title?: string;
    text: string;
    priority: "high" | "medium" | "low";
    verification: string;
    robustness: {
      level: "high" | "medium" | "low" | "unknown";
      reason: string;
      dependsOnPerson: boolean | null;
      standardization: string;
      failureModes: string[];
    };
  }>;
  reproducibility: {
    level: "high" | "medium" | "low" | "unknown";
    reason: string;
    conditions: string[];
    verification: string;
  };
  rootCause: {
    identified: boolean | null;
    text: string;
    reasoning: string;
    missingEvidence: string[];
  };
  branchAssessment: { needed: boolean | null; reason: string };
  additionalQuestions: string[];
  importedAt: string;
}

export interface TaskReflectionFollowUpAnswer {
  question: string;
  answer: string;
  updatedAt: string;
}

export interface TaskReflection {
  id: string;
  title: string;
  kind: TaskReflectionKind;
  summary: string;
  impact: string;
  cause: string;
  lesson: string;
  /** 今回うまくできたこと。 */
  accomplishment?: string;
  /** うまくいった条件・判断・工程。 */
  successReason?: string;
  /** 次回も意識して残す行動や仕組み。 */
  keepDoing?: string;
  branchSplitAssessment: BranchSplitAssessment;
  /** 1件の振り返りで複数の失敗・改善テーマを扱う。 */
  themes?: TaskReflectionTheme[];
  otherTheme?: string;
  /** AIの回答は本人の記録を上書きせず、比較用に別保存する。 */
  aiAnalysis?: TaskReflectionAiAnalysis;
  /** AIからの追加質問に対する本人の回答。再分析時の文脈として使用する。 */
  followUpAnswers?: TaskReflectionFollowUpAnswer[];
  todos: TaskReflectionTodo[];
  reviewDate: string;
  createdAt: string;
  updatedAt: string;
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
  /** Git Diffレビューなどから取り込んだ、タスク単位の実施チェックリスト。 */
  reviewChecklist?: TaskChecklistItem[];
  /** リポジトリ単位で実施したコードレビューの履歴。 */
  codeReviewRuns?: TaskCodeReviewRun[];
  /** Diffから作成したテスト内容と実施状況の記録。 */
  testRuns?: TaskTestRun[];
  /** 動作確認中の状態変更、不具合メモ、画像などの時系列記録。 */
  verificationTimeline?: TaskVerificationTimelineEntry[];
  /** 大きな作業や問題発生時に残す、対策ToDo付きの振り返り。 */
  reflections?: TaskReflection[];
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
