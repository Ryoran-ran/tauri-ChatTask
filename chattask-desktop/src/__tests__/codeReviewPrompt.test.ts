import { describe, expect, it } from "vitest";
import { buildReviewPrompt } from "../components/CodeReviewWindow";
import type { GithubRepository, Task } from "../types";

const task = { id: "task-1", title: "宅建免許を更新する", reviewChecklist: [] } as unknown as Task;
const primaryRepository: GithubRepository = { id: "repo-1", name: "顧客サイト", url: "https://example.com/customer" };
const relatedRepository: GithubRepository = { id: "repo-2", name: "管理画面", url: "https://example.com/admin" };

describe("コードレビュープロンプト", () => {
  it("水平検索を選ぶと関連リポジトリと未確認範囲の確認方法を含める", () => {
    const prompt = buildReviewPrompt(
      task,
      primaryRepository,
      [primaryRepository, relatedRepository],
      "diff --git a/src/license.ts b/src/license.ts",
      "main",
      "HEAD",
      ["horizontal"],
    );

    expect(prompt).toContain("水平検索・横断影響");
    expect(prompt).toContain("管理画面 (https://example.com/admin)");
    expect(prompt).toContain("提供されていないリポジトリのコードを確認済みとは断定しない");
    expect(prompt).toContain("具体的な検索語");
  });

  it("水平検索を選ばなければ横断確認の追加指示を含めない", () => {
    const prompt = buildReviewPrompt(
      task,
      primaryRepository,
      [primaryRepository, relatedRepository],
      "diff --git a/src/license.ts b/src/license.ts",
      "main",
      "HEAD",
      ["bug"],
    );

    expect(prompt).not.toContain("提供されていないリポジトリのコードを確認済みとは断定しない");
  });
});
