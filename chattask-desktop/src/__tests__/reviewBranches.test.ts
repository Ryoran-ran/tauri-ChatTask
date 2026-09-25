import { describe, expect, it } from "vitest";
import { createTask } from "../appHelpers";
import { defaultReviewBaseBranch, reviewBaseBranchCandidates } from "../reviewBranches";
import type { GithubRepository } from "../types";

const repository: GithubRepository = {
  id: "repository-1",
  name: "ChatTask",
  url: "https://github.com/example/chattask",
  pullRequestTargets: ["develop", "release/next", "develop"],
};

describe("コードレビュー・動作確認の基準ブランチ候補", () => {
  it("共通・タスク固有のPR先と関連ブランチを重複なく返す", () => {
    const task = createTask();
    task.repositoryBranches = [{
      repositoryId: repository.id,
      pullRequestTargets: ["staging", "develop"],
      branchNames: ["feature/example", "staging"],
    }];

    expect(reviewBaseBranchCandidates(task, repository)).toEqual([
      "develop",
      "release/next",
      "staging",
      "main",
      "feature/example",
    ]);
  });

  it("設定済みのPR作成先を既定の基準ブランチにする", () => {
    const task = createTask();

    expect(defaultReviewBaseBranch(task, repository)).toBe("develop");
  });

  it("候補が未設定ならmainを使用する", () => {
    const task = createTask();
    const emptyRepository = { ...repository, pullRequestTargets: [] };

    expect(defaultReviewBaseBranch(task, emptyRepository)).toBe("main");
  });
});
