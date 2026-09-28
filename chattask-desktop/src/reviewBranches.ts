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

/** A new review starts from main. Saved repository-specific choices are restored by the caller. */
export const defaultReviewBaseBranch = (_task: Task, _repository: GithubRepository | undefined) => "main";

export const gitDiffClipboardCommand = (mode: "branch" | "working", base: string, target: string) => mode === "working"
  ? "git --no-pager diff | pbcopy"
  : `git --no-pager diff ${base.trim() || "main"}...${target.trim() || "HEAD"} | pbcopy`;
