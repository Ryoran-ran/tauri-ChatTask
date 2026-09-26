import type { ReviewIgnoredReasonCategory, Task, TaskChecklistItem } from "./types";

export const reviewIgnoredReasonLabels: Record<ReviewIgnoredReasonCategory, string> = {
  "as-designed": "仕様どおり",
  "false-positive": "誤検出",
  "accepted-risk": "リスクを許容",
  "out-of-scope": "今回の対象外",
  "separate-task": "別タスクで対応",
  other: "その他",
};

export const reviewIgnoredReasonOptions = Object.entries(reviewIgnoredReasonLabels) as [ReviewIgnoredReasonCategory, string][];

const normalizeFilePath = (value: string) => value.trim()
  .replace(/^['"]|['"]$/g, "")
  .replace(/^(?:a|b)\//, "")
  .replace(/^\.\//, "");

export const changedFilesFromGitDiff = (diff: string) => {
  const files = new Set<string>();
  for (const line of diff.split(/\r?\n/)) {
    const header = line.match(/^diff --git (?:"?a\/)(.+?)"? (?:"?b\/)(.+?)"?$/);
    if (header) {
      files.add(normalizeFilePath(header[2]));
      continue;
    }
    const added = line.match(/^\+\+\+\s+(?:"?b\/)?(.+?)"?$/);
    if (added && added[1] !== "/dev/null") files.add(normalizeFilePath(added[1]));
  }
  return files;
};

export const relevantIgnoredReviewDecisions = (task: Task, repositoryId: string, diff: string): TaskChecklistItem[] => {
  const changedFiles = changedFilesFromGitDiff(diff);
  const repositoryKey = repositoryId || "unassigned";
  return (task.reviewChecklist || [])
    .filter((item) => item.reviewStatus === "ignored")
    .filter((item) => (item.repositoryId || "unassigned") === repositoryKey)
    .filter((item) => Boolean(item.file) && changedFiles.has(normalizeFilePath(item.file || "")))
    .sort((a, b) => (b.ignoredAt || b.createdAt).localeCompare(a.ignoredAt || a.createdAt))
    .slice(0, 30);
};

export const ignoredDecisionPrompt = (items: TaskChecklistItem[]) => items.length
  ? items.map((item) => {
    const category = item.ignoredReasonCategory ? reviewIgnoredReasonLabels[item.ignoredReasonCategory] : "理由未登録（旧データ）";
    return [
      `- ${item.file ? `${item.file}: ` : ""}${item.title}`,
      `  - 判断: ${category}`,
      item.ignoredReasonNote ? `  - 補足: ${item.ignoredReasonNote}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n")
  : "- 該当なし";
