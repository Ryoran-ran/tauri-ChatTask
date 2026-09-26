import { describe, expect, it } from "vitest";
import { createTask } from "../appHelpers";

describe("子タスク作成", () => {
  it("親タスクのリポジトリ別ブランチとPR作成先を引き継ぐ", () => {
    const parent = createTask();
    parent.repositoryBranches = [{
      repositoryId: "repository-1",
      branchNames: ["feature/parent"],
      pullRequestTargets: ["develop"],
    }];

    const child = createTask(parent);

    expect(child.parentTaskId).toBe(parent.id);
    expect(child.repositoryBranches).toEqual(parent.repositoryBranches);
  });

  it("子タスクでブランチを編集しても親タスクのデータを書き換えない", () => {
    const parent = createTask();
    parent.repositoryBranches = [{
      repositoryId: "repository-1",
      branchNames: ["feature/parent"],
      pullRequestTargets: ["develop"],
    }];

    const child = createTask(parent);
    child.repositoryBranches[0].branchNames.push("feature/child");
    child.repositoryBranches[0].pullRequestTargets?.push("release/next");

    expect(parent.repositoryBranches[0].branchNames).toEqual(["feature/parent"]);
    expect(parent.repositoryBranches[0].pullRequestTargets).toEqual(["develop"]);
  });
});
