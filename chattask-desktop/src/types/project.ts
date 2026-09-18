import type { PlannedRange, Priority, TaskDocument, TaskLink } from "./task";

export interface GithubRepository {
  id: string;
  name: string;
  url: string;
  /** このリポジトリでよく使用するプルリクエストの作成先。 */
  pullRequestTargets?: string[];
}

export interface QuickLinkRule {
  id: string;
  name: string;
  urlPrefix: string;
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
  quickLinkRules?: QuickLinkRule[];
  sharedLinks?: TaskLink[];
  sharedDocuments?: TaskDocument[];
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
