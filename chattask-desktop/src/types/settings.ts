import type { Habit } from "./habit";
import type { Goal, ProjectTag } from "./project";
import type { ActivityEvent, Priority, Task } from "./task";

export interface NonWorkingPeriod {
  id: string;
  startDate: string;
  endDate: string;
  type: "vacation" | "holiday" | "other" | "weekend";
  note?: string;
  /** 土日・定休日ルールで休暇扱いにする曜日。0（日）〜6（土）。 */
  weekdays?: number[];
}

export interface UserProfile {
  displayName: string;
  avatarUpdatedAt: string;
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

export interface LocalTool {
  id: string;
  name: string;
  folderPath: string;
  entryFile: string;
  createdAt: string;
  updatedAt: string;
  managedCopy?: boolean;
}

export type WorkspaceMode = "work" | "personal";

/** 永続化されるアプリ全体のデータ。フィールド名と構造は保存互換のため維持する。 */
export interface AppData {
  version: number;
  workspaceMode: WorkspaceMode;
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
  localTools: LocalTool[];
  localToolsStoragePath: string;
  habits: Habit[];
}
