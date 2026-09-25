import type { GithubRepository, Task } from "./types";

const uniqueBranchNames = (values: Array<string | undefined>) => [...new Set(values
  .map((value) => value?.trim() || "")
  .filter(Boolean))];

/** Branches known to ChatTask that can be used as a review/test comparison base. */
export const reviewBaseBranchCandidates = (task: Task, repository: GithubRepository | undefined) => {
  const taskBranches = task.repositoryBranches.find((group) => group.repositoryId === (repository?.id || ""));
  return uniqueBranchNames([
    ...(repository?.pullRequestTargets || []),
    ...(taskBranches?.pullRequestTargets || []),
    "main",
    ...(taskBranches?.branchNames || []),
  ]);
};

export const defaultReviewBaseBranch = (task: Task, repository: GithubRepository | undefined) =>
  reviewBaseBranchCandidates(task, repository)[0] || "main";
