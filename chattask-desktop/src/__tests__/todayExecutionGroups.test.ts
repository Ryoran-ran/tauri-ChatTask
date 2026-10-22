import { afterEach, describe, expect, it, vi } from "vitest";
import { readExecutionGroups, regroupExecutionItems, reorderExecutionGroupMembers, saveExecutionGroups, type ExecutionGroup } from "../components/todayExecutionGroups";

const group = (id: string, itemKeys: string[]): ExecutionGroup => ({ id, name: id, itemKeys });
afterEach(() => vi.unstubAllGlobals());

describe("今日の作業グループの繰り返し作成", () => {
  it("グループ内の任意の位置へ移動し、非表示の作業の保存位置を保つ", () => {
    const current = group("first", ["a", "completed", "b", "c"]);
    expect(reorderExecutionGroupMembers(current, ["a", "b", "c"], "a", "c")).toEqual(["b", "completed", "c", "a"]);
    expect(reorderExecutionGroupMembers(current, ["a", "b", "c"], "c", "a")).toEqual(["c", "completed", "a", "b"]);
    expect(reorderExecutionGroupMembers(current, ["a", "b", "c"], "a", "missing")).toBeNull();
    expect(current.itemKeys).toEqual(["a", "completed", "b", "c"]);
  });
  it("2個目、3個目を作成しても既存グループと作業を保持する", () => {
    const queue = ["a", "b", "c", "d", "e", "f"];
    let result = regroupExecutionItems(queue, [], group("first", ["a", "b"]))!;
    result = regroupExecutionItems(result.queueKeys, result.groups, group("second", ["c", "d"]))!;
    result = regroupExecutionItems(result.queueKeys, result.groups, group("third", ["e", "f"]))!;
    expect(result.groups).toEqual([group("first", ["a", "b"]), group("second", ["c", "d"]), group("third", ["e", "f"])]);
    expect(result.queueKeys).toEqual(queue);
  });

  it("全作業がグループ済みでも何度でも平坦に組み替えられる", () => {
    const initial = [group("old", ["a", "b", "c", "d", "e", "f"])];
    const snapshot = structuredClone(initial);
    let result = regroupExecutionItems(["a", "b", "c", "d", "e", "f"], initial, group("split", ["a", "c"]))!;
    expect(result.groups).toEqual([group("old", ["b", "d", "e", "f"]), group("split", ["a", "c"])]);
    result = regroupExecutionItems(result.queueKeys, result.groups, group("mixed", ["a", "b"]))!;
    expect(result.groups).toEqual([group("old", ["d", "e", "f"]), group("mixed", ["a", "b"])]);
    expect(result.queueKeys).toEqual(["a", "b", "c", "d", "e", "f"]);
    const members = result.groups.flatMap(candidate => candidate.itemKeys);
    expect(new Set(members).size).toBe(members.length);
    expect(members.every(key => !result.groups.some(candidate => key === candidate.id))).toBe(true);
    expect(initial).toEqual(snapshot);
  });

  it("既存グループを横断して再編し、残った1件は通常の作業へ戻す", () => {
    const result = regroupExecutionItems(["a", "b", "c", "d", "e"], [group("one", ["a", "b"]), group("two", ["c", "d"])], group("new", ["b", "c", "e"]))!;
    expect(result.groups).toEqual([group("new", ["b", "c", "e"])]);
    expect(result.queueKeys).toEqual(["a", "b", "c", "e", "d"]);
  });

  it("同じ作業をもう一度選んでもグループや所属を重複させない", () => {
    const result = regroupExecutionItems(["a", "b"], [group("old", ["a", "b"])], group("new", ["a", "b"]))!;
    expect(result.groups).toEqual([group("new", ["a", "b"])]);
    expect(result.queueKeys).toEqual(["a", "b"]);
  });

  it("選んでいないグループの並び順を崩さず新しいグループを挿入する", () => {
    const result = regroupExecutionItems(["a", "b", "c", "d", "e", "f"], [group("existing", ["b", "c", "d"])], group("new", ["a", "e"]))!;
    expect(result.queueKeys).toEqual(["a", "e", "b", "c", "d", "f"]);
    expect(result.groups[0]).toEqual(group("existing", ["b", "c", "d"]));
  });

  it("選択元に2件以上残る場合は元のグループの内部順序を保持する", () => {
    const result = regroupExecutionItems(["c", "a", "b", "d", "e"], [group("existing", ["c", "a", "b", "d"])], group("new", ["a", "e"]))!;
    expect(result.groups).toEqual([group("existing", ["c", "b", "d"]), group("new", ["a", "e"])]);
    expect(result.queueKeys).toEqual(["c", "b", "d", "a", "e"]);
  });

  it("非表示の完了済み項目を対応順へ復活させない", () => {
    const result = regroupExecutionItems(["a", "b", "c", "d"], [group("existing", ["a", "completed", "b", "c"])], group("new", ["c", "d"]))!;
    expect(result.groups).toEqual([group("existing", ["a", "completed", "b"]), group("new", ["c", "d"])]);
    expect(result.queueKeys).toEqual(["a", "b", "c", "d"]);
  });

  it("有効な選択が2件未満なら保存用の変更を返さない", () => {
    const groups = [group("existing", ["a", "b"])];
    for (const keys of [[], ["a"], ["a", "a"], ["a", "missing"], ["group:existing", "a"]]) {
      expect(regroupExecutionItems(["a", "b"], groups, group("new", keys))).toBeNull();
    }
    expect(groups).toEqual([group("existing", ["a", "b"])]);
  });

  it("組み替え後も同じ日の保存形式で再読み込みでき、別の日を変更しない", () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
    const previous = [group("previous", ["x", "y"])];
    saveExecutionGroups("2026-10-14", previous);
    saveExecutionGroups("2026-10-15", [group("old", ["a", "b", "c", "d"])]);
    const result = regroupExecutionItems(["a", "b", "c", "d"], readExecutionGroups("2026-10-15"), group("new", ["c", "d"]))!;
    saveExecutionGroups("2026-10-15", result.groups);
    expect(readExecutionGroups("2026-10-15")).toEqual([group("old", ["a", "b"]), group("new", ["c", "d"])]);
    expect(readExecutionGroups("2026-10-14")).toEqual(previous);
  });
});
