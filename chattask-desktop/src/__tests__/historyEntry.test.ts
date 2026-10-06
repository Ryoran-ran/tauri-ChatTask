import { describe, expect, it } from "vitest";
import { historyWorkTitle } from "../historyEntry";

describe("Chat履歴の対象作業名", () => {
  it("タスク名と同じ作業名でも保存できる形で返す", () => {
    const taskTitle = "リリース準備";

    expect(historyWorkTitle(taskTitle)).toEqual({ workTitle: "リリース準備" });
  });

  it("空の作業名はこれまでどおり保存しない", () => {
    expect(historyWorkTitle("   ")).toEqual({});
    expect(historyWorkTitle()).toEqual({});
  });
});
