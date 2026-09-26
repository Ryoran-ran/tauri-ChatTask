import { describe, expect, it } from "vitest";
import { changedFilesFromGitDiff, ignoredDecisionPrompt, relevantIgnoredReviewDecisions } from "../reviewIgnoreDecisions";
import type { Task, TaskChecklistItem } from "../types";

const item = (overrides: Partial<TaskChecklistItem>): TaskChecklistItem => ({
  id: overrides.id || crypto.randomUUID(),
  title: "指摘",
  category: "バグ・ロジック",
  details: "",
  reviewStatus: "ignored",
  completed: false,
  createdAt: "2026-09-25T00:00:00.000Z",
  ...overrides,
});

describe("reviewIgnoreDecisions", () => {
  it("Git Diffから変更後のファイルを抽出する", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "diff --git a/src/old.ts b/src/new.ts",
      "--- a/src/old.ts",
      "+++ b/src/new.ts",
    ].join("\n");
    expect([...changedFilesFromGitDiff(diff)]).toEqual(["src/a.ts", "src/new.ts"]);
  });

  it("同じリポジトリかつ変更ファイルに関係する対応しない判断だけを返す", () => {
    const matching = item({ id: "matching", repositoryId: "repo-a", file: "src/a.ts", ignoredReasonCategory: "as-designed" });
    const fileless = item({ id: "fileless", repositoryId: "repo-a", ignoredReasonCategory: "accepted-risk" });
    const otherFile = item({ id: "other-file", repositoryId: "repo-a", file: "src/b.ts" });
    const otherRepository = item({ id: "other-repo", repositoryId: "repo-b", file: "src/a.ts" });
    const active = item({ id: "active", repositoryId: "repo-a", file: "src/a.ts", reviewStatus: "pending" });
    const task = { reviewChecklist: [matching, fileless, otherFile, otherRepository, active] } as Task;
    const result = relevantIgnoredReviewDecisions(task, "repo-a", "diff --git a/src/a.ts b/src/a.ts\n+++ b/src/a.ts");
    expect(result.map(({ id }) => id)).toEqual(["matching"]);
  });

  it("判断分類と任意の補足をAI向け文章に含める", () => {
    const prompt = ignoredDecisionPrompt([item({ title: "既知の仕様", file: "src/a.ts", ignoredReasonCategory: "as-designed", ignoredReasonNote: "互換性維持のため" })]);
    expect(prompt).toContain("判断: 仕様どおり");
    expect(prompt).toContain("補足: 互換性維持のため");
  });
});
