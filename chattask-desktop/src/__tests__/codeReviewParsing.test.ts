import { describe, expect, it } from "vitest";
import { parseReviewChecklist } from "../components/TaskReviewChecklist";

describe("コードレビュー結果の取り込み", () => {
  it("指摘ごとのコミット名をそれぞれ保存する", () => {
    const items = parseReviewChecklist(`\`\`\`json
{
  "reviews": [
    {
      "category": "バグ・ロジック",
      "severity": "high",
      "file": "src/a.ts",
      "line": "10",
      "functionName": "first",
      "title": "1件目の指摘",
      "reason": "理由1",
      "suggestion": "修正1",
      "suggestedCommitMessage": "fix: 1件目の不整合を修正"
    },
    {
      "category": "保守性",
      "severity": "medium",
      "file": "src/b.ts",
      "line": "20",
      "functionName": "second",
      "title": "2件目の指摘",
      "reason": "理由2",
      "suggestion": "修正2",
      "suggestedCommitMessage": "refactor: 2件目の処理を分離"
    }
  ]
}
\`\`\``);

    expect(items.map((item) => item.suggestedCommitMessage)).toEqual([
      "fix: 1件目の不整合を修正",
      "refactor: 2件目の処理を分離",
    ]);
  });

  it("旧形式の全体コミット名を個別指摘へ誤って割り当てない", () => {
    const [item] = parseReviewChecklist(JSON.stringify({
      suggestedCommitMessage: "fix: 全指摘をまとめて修正",
      reviews: [{ title: "個別の指摘", category: "バグ・ロジック" }],
    }));

    expect(item.suggestedCommitMessage).toBeUndefined();
  });

  it("文字列以外のコミット名は取り込まない", () => {
    const [item] = parseReviewChecklist(JSON.stringify({
      reviews: [{ title: "個別の指摘", category: "バグ・ロジック", suggestedCommitMessage: { message: "不正な値" } }],
    }));

    expect(item.suggestedCommitMessage).toBeUndefined();
  });
});
