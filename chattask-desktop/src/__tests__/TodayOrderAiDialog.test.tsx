import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TodayOrderAiDialog, TodayOrderAiGroupingPreview } from "../components/TodayOrderAiDialog";
import type { TodayOrderAiSnapshot } from "../services/todayOrderAi";
import { collectTodayOrderAiTaskContexts } from "../services/todayOrderAi";
import { createTask } from "../appHelpers";

vi.mock("../components/Modal", () => ({ Modal: ({ children }: { children: ReactNode }) => <>{children}</> }));
afterEach(() => vi.unstubAllGlobals());
const snapshot: TodayOrderAiSnapshot = {
  date: "2026-10-15",
  units: [{ id: "group:one", title: "確認依頼まとめ", grouped: true, items: [{
    id: "task:range", taskId: "task", title: "依頼文の作成", taskTitle: "親タスク", kind: "scheduled", status: "未着手",
    priority: "B", tag: "案件", dueDate: "2026-10-16", startDate: "2026-10-15", endDate: "2026-10-15",
    plannedHours: null, actualHours: 0, nextAction: "", description: "", memo: "", waitingFor: "", relatedTasks: [],
  }] }],
};
function render(draft: Record<string, unknown> = {}, environment = "production", source = snapshot) {
  const stored = new Map<string, string>([
    ["chatTaskActiveEnvironment", environment],
    [`chatTaskTodayOrderAiDraft:${environment}:${snapshot.date}`, JSON.stringify({ version: 1, ...draft })],
  ]);
  vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null });
  return renderToStaticMarkup(<TodayOrderAiDialog snapshot={source} disabled={false} onApply={() => null} onClose={() => {}} />);
}
const attributes = (html: string, text: string) => {
  const match = html.match(new RegExp(`<button\\b([^>]*)>${text}</button>`));
  expect(match).not.toBeNull();
  return match![1];
};

describe("今日のAI相談画面", () => {
  it("タスクごとの補足欄に対象の作業を表示し、同じタスクには一つの欄だけを表示する", () => {
    const first = snapshot.units[0].items[0];
    const source: TodayOrderAiSnapshot = { ...snapshot, units: [snapshot.units[0],
      { id: "item:second", title: "次の作業", grouped: false, items: [{ ...first, id: "task:second", title: "送信内容の確認" }] },
      { id: "item:other", title: "別Taskの作業", grouped: false, items: [{ ...first, id: "other:range", taskId: "other", title: "仕様を確認" }] },
    ] };
    const html = render({ taskSupplements: { task: "午前中の対応を約束", other: "仕様確認が必要", removed: "対象外の秘密" } }, "production", source);
    expect(html).toContain("タスクごとの補足情報（任意）");
    const fields = html.match(/<textarea\b[^>]*id="[^"]*-supplement-\d+"[^>]*>[\s\S]*?<\/textarea>/g)!;
    expect(fields).toHaveLength(2);
    expect(fields[0]).toContain("午前中の対応を約束");
    expect(fields[1]).toContain("仕様確認が必要");
    expect(html).toContain("対象作業：依頼文の作成、送信内容の確認");
    expect(html).toContain("対象作業：仕様を確認");
    expect(html).not.toContain("対象外の秘密");
    expect(html).toContain("登録済みのタスクの説明や作業メモは変更しません");
  });

  it("AIに渡すTaskの説明・次のアクション・期限を画面で確認できる", () => {
    const task = { ...createTask(), id: "task", title: "関連Task", description: "作業の背景となる説明", nextAction: "確認依頼を送る", dueDate: "2026-10-16" };
    const source = { ...snapshot, tasks: collectTodayOrderAiTaskContexts(snapshot.units, [task], []) };
    const html = render({}, "production", source);
    expect(html).toContain("AIに渡すTask情報（1件）");
    expect(html).toContain("作業の背景となる説明");
    expect(html).toContain("次のアクション：確認依頼を送る");
    expect(html).toContain("期限 2026-10-16");
  });
  it("グループ化の確認で名称・理由・元の項目と既存グループの統合を表示する", () => {
    const html = renderToStaticMarkup(<TodayOrderAiGroupingPreview snapshot={snapshot} groups={[
      { proposalId: "proposal:one", name: "依頼まとめ", unitIds: ["group:one"], reason: "同じ相手にまとめて確認するため" },
    ]} />);
    expect(html).toContain("新しくまとめるグループ");
    expect(html).toContain("依頼まとめ");
    expect(html).toContain("同じ相手にまとめて確認するため");
    expect(html).toContain("確認依頼まとめ");
    expect(html).toContain("既存グループの中の作業をまとめて移動");
    expect(html).toContain("同じ階層");
  });

  it("グループ化の提案がなければ追加の確認枠を表示しない", () => {
    expect(renderToStaticMarkup(<TodayOrderAiGroupingPreview snapshot={snapshot} groups={[]} />)).toBe("");
  });
  it.each(["consult", "file", "review"])("%s タブだけを表示し、他のパネルと入力内容は保持する", tab => {
    const html = render({ tab, supplementary: "補足を保持", taskSupplements: { task: "タスク別補足を保持" }, responseText: "JSONを保持" });
    expect(html).toContain('role="tablist"');
    for (const id of ["consult", "file", "review"]) {
      const button = html.match(new RegExp(`<button\\b[^>]*id="[^"]*-${id}-tab"[^>]*>`))![0];
      const panel = html.match(new RegExp(`<section\\b[^>]*id="[^"]*-${id}-panel"[^>]*>`))![0];
      expect(button).toContain(`aria-selected="${tab === id}"`);
      expect(panel.includes('hidden=""')).toBe(tab !== id);
    }
    for (const value of ["補足を保持", "タスク別補足を保持", "JSONを保持"]) expect(html).toContain(value);
  });
  it("サマリー入力なしで相談・ファイル出力指示・取り込みを順番に表示する", () => {
    const html = render({ supplementary: "午後に打ち合わせ" });
    expect(html).toContain("午後に打ち合わせ");
    expect(html).not.toContain("AIと合意した確定サマリー");
    expect(html).toContain("2. 会話の最後にファイル出力を依頼する");
    expect(html).toContain("サマリーをここに貼り付ける必要はありません");
    expect(html).toContain("相談していた同じAIチャットの最後に貼り付けてください");
    expect(html).toContain('type="file"');
    expect(html).toContain("グループ");
    expect(html).toContain("工数未設定");
    expect(attributes(html, "相談用プロンプトをコピー")).not.toContain("disabled");
    expect(attributes(html, "ファイル作成用プロンプトをコピー")).not.toContain("disabled");
    expect(html).toContain('aria-label="ファイル作成用プロンプト"');
    expect(html).not.toContain("この対応順を反映");
  });

  it("旧下書きでもサマリー入力を求めず、他の入力を復元できる", () => {
    const html = render({ tab: "file", availableHours: "2.5", supplementary: "合意前の補足", confirmedSummary: "旧サマリー", responseText: "保存したJSON", snapshotJson: JSON.stringify(snapshot) });
    expect(html).not.toContain("旧サマリー");
    expect(html).toContain('value="2.5"');
    expect(html).toContain("合意前の補足");
    expect(html).toContain("全体の補足（任意）");
    expect(html).toContain('aria-label="全体の補足"');
    expect(html).toContain("保存したJSON");
    expect(attributes(html, "ファイル作成用プロンプトをコピー")).not.toContain("disabled");
  });

  it("保存後に予定が変わっていれば古い相談からのデータ化を止める", () => {
    const html = render({ snapshotJson: "old snapshot" });
    expect(html).toContain("相談後に予定や対応順が変わりました");
    expect(attributes(html, "ファイル作成用プロンプトをコピー")).toContain("disabled");
  });

  it("別環境の下書きを混ぜず、テスト環境の下書きを復元する", () => {
    expect(render({ supplementary: "テスト用補足" }, "test")).toContain("テスト用補足");
  });

  it("利用可能時間が不正ならプロンプトのコピーを止める", () => {
    const html = render({ availableHours: "25" });
    expect(attributes(html, "相談用プロンプトをコピー")).toContain("disabled");
    expect(attributes(html, "ファイル作成用プロンプトをコピー")).toContain("disabled");
  });
});
