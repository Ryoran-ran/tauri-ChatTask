export interface TaskChecklistItem {
  id: string;
  title: string;
  file?: string;
  line?: string;
  functionName?: string;
  location?: string;
  category: string;
  details: string;
  reason?: string;
  suggestion?: string;
  severity?: "high" | "medium" | "low";
  reviewStatus?: "pending" | "in-progress" | "completed" | "ignored";
  repositoryId?: string;
  repositoryName?: string;
  reviewRunId?: string;
  /** この指摘が検出されたレビュー回。再指摘も同じ項目へ集約する。 */
  reviewRunIds?: string[];
  reviewOccurrenceCount?: number;
  lastReviewedAt?: string;
  completed: boolean;
  createdAt: string;
  completedAt?: string;
}

export interface TaskCodeReviewRun {
  id: string;
  repositoryId: string;
  repositoryName: string;
  baseBranch: string;
  targetBranch: string;
  itemIds: string[];
  /** 正常にレビューが完了し、指摘が0件だった記録。 */
  noFindings?: boolean;
  createdAt: string;
}

export interface TaskTestRun {
  id: string;
  repositoryId: string;
  repositoryName: string;
  baseBranch: string;
  targetBranch: string;
  /** 動作確認1回分の対象リポジトリ。旧データは上の単一リポジトリ項目を使用する。 */
  repositories?: {
    id: string;
    name: string;
    baseBranch: string;
    targetBranch: string;
  }[];
  testPoints: string[];
  content: string;
  framework?: {
    name: string;
    setupRequired: boolean;
    installCommands: string[];
  };
  tests?: {
    category: string;
    title: string;
    file: string;
    reason: string;
    code: string;
  }[];
  runCommands?: string[];
  assumptions?: string[];
  environment?: string[];
  checks?: {
    id: string;
    category: string;
    title: string;
    screen: string;
    file: string;
    line: string;
    functionName: string;
    repositories?: string[];
    preconditions: string[];
    steps: string[];
    expectedResult: string;
    status: "pending" | "in-progress" | "passed" | "failed" | "ignored";
  }[];
  status: "planned" | "implemented" | "passed" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface TaskVerificationTimelineEntry {
  id: string;
  kind: "note" | "issue" | "retest" | "status" | "system" | "reply";
  text: string;
  /** 返信元のタイムライン記録。返信は1階層で表示する。 */
  parentEntryId?: string;
  checkId?: string;
  checkTitle?: string;
  /** 関連する複数の動作確認項目。checkId/checkTitleは旧データとの互換用。 */
  checkIds?: string[];
  checkTitles?: string[];
  attachmentIds?: string[];
  fromStatus?: "pending" | "in-progress" | "passed" | "failed" | "ignored";
  toStatus?: "pending" | "in-progress" | "passed" | "failed" | "ignored";
  createdAt: string;
}
