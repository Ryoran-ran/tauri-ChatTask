import { describe, expect, it, vi } from "vitest";
import {
  applyTodayOrderAiPlan, buildTodayOrderAiApplication, buildTodayOrderConsultationPrompt, buildTodayOrderFilePrompt, collectTodayOrderAiSupplementTargets, collectTodayOrderAiTaskContexts,
  parseTodayOrderAiDraft, parseTodayOrderAiPlan, resolveTodayOrderAiUnits, todayOrderAiRequestId, validateTodayOrderAiPlan,
  type TodayOrderAiPlan, type TodayOrderAiProposedGroup, type TodayOrderAiRequest, type TodayOrderAiWork,
} from "../services/todayOrderAi";
import { createTask } from "../appHelpers";

const work = (id: string): TodayOrderAiWork => ({
  id, taskId: "same-task", title: "同じ名前の作業", taskTitle: "親タスク", kind: "scheduled", status: "未着手",
  priority: "B", tag: "案件", dueDate: "2026-10-16", startDate: "2026-10-15", endDate: "2026-10-15",
  plannedHours: 1, actualHours: 0, nextAction: "調査する", description: "作業の説明", memo: "日別メモ", waitingFor: "", relatedTasks: [],
});
const request = (): TodayOrderAiRequest => ({
  snapshot: { date: "2026-10-15", units: [
    { id: "item:same-task:range-a", title: "同じ名前の作業", grouped: false, items: [work("same-task:range-a")] },
    { id: "group:parallel", title: "並行作業", grouped: true, items: [work("task-b:range-b"), work("task-c:range-c")] },
    { id: "item:recurring:task-d:2026-10-15", title: "定期作業", grouped: false, items: [{ ...work("recurring:task-d:2026-10-15"), kind: "recurring", plannedHours: null }] },
  ] },
  availableHours: 3, supplementary: "14時に打ち合わせ。先に並行作業の確認を依頼したい。",
});
const plan = (input: TodayOrderAiRequest): TodayOrderAiPlan => ({
  kind: "chattask-today-order", schemaVersion: 1, date: input.snapshot.date, requestId: todayOrderAiRequestId(input), summary: "確認依頼を先に送る。",
  order: [{ unitId: "group:parallel", reason: "相手の確認待ちを先に始める", firstStep: "確認事項を一つ送る" }, { unitId: "item:same-task:range-a", reason: "期限が近い", firstStep: "対象ファイルを開く" }],
  later: [{ unitId: "item:recurring:task-d:2026-10-15", reason: "今日は時間が少ない", firstStep: "" }], unresolvedQuestions: [],
});

const groupingPlan = (input: TodayOrderAiRequest): TodayOrderAiPlan => ({
  ...plan(input), schemaVersion: 2,
  groups: [{ proposalId: "proposal:checks", name: "確認依頼まとめ", unitIds: ["group:parallel", "item:same-task:range-a"], reason: "同じ相手へまとめて確認する" }],
  order: [{ unitId: "proposal:checks", reason: "確認待ちを先に始める", firstStep: "確認事項を整理する" }],
});

describe("今日の着手順のAI相談", () => {
  it("相談と会話の最後のファイル出力を分け、同じ相談データを識別する", () => {
    const input = request();
    const consultation = buildTodayOrderConsultationPrompt(input);
    const file = buildTodayOrderFilePrompt(input);
    expect(consultation).toContain(input.supplementary);
    expect(consultation).toContain("最大3問");
    expect(consultation).toContain("確定サマリー");
    expect(consultation).not.toContain('"kind": "chattask-today-order"');
    expect(consultation).toContain(todayOrderAiRequestId(input));
    expect(file).toContain(todayOrderAiRequestId(input));
    expect(file).toContain("新しい優先順位の判断や推測を追加しない");
    expect(consultation).toContain("グループ化を提案する");
    expect(consultation).toContain("利用者が納得してから確定");
    expect(file).toContain('"schemaVersion": 2');
    expect(file).toContain("新たなグループ化も提案しない");
    for (const unit of input.snapshot.units) {
      expect(consultation).toContain(unit.id);
      expect(file).toContain(unit.id);
    }
  });

  it("サマリーの貼り戻しなしで、同じ会話の最新の合意だけを出力するよう指示する", () => {
    const input = request();
    const consultation = buildTodayOrderConsultationPrompt(input);
    const file = buildTodayOrderFilePrompt(input);
    expect(consultation).toContain("合意内容の確認はこのチャット内で完結");
    expect(consultation).toContain("会話の最後にファイル作成用プロンプト");
    expect(file).toContain("このチャットで最後に利用者と合意した内容");
    expect(file).toContain("サマリーをアプリへ貼り戻す必要はありません");
    expect(file).toContain("相談履歴がない、一致しない、または利用者との合意がまだない場合はJSONを作らず");
    expect(file).toContain("最後に合意した条件を優先し、初期情報で上書きしない");
    expect(file).toContain("後から撤回した案は使わない");
    expect(file).toContain("未確定事項、IDとの対応不明、対象の漏れ、矛盾がある場合はJSONを作らず");
    expect(file).toContain(`chattask-today-order-${input.snapshot.date}.json`);
    expect(file).not.toContain("confirmedSummary");
    expect(validateTodayOrderAiPlan(plan(input), input)).toHaveLength(3);
  });

  it("未設定工数と0時間の利用可能時間を区別する", () => {
    const input = { ...request(), availableHours: 0 };
    const prompt = buildTodayOrderConsultationPrompt(input);
    expect(prompt).toContain('"availableHours": 0');
    expect(prompt).toContain('"plannedHours": null');
    expect(validateTodayOrderAiPlan(plan(input), input)).toHaveLength(3);
  });

  it("JSONファイル・BOM付きJSON・コードブロックを同じ提案として読み込める", () => {
    const expected = plan(request());
    const json = JSON.stringify(expected);
    for (const source of [json, `\uFEFF${json}`, `\`\`\`json\n${json}\n\`\`\``, `\`\`\`\n${json}\n\`\`\``]) {
      expect(parseTodayOrderAiPlan(source)).toEqual(expected);
    }
  });

  it("グループ内の作業順・所属を維持し、後回し項目も末尾に残す", () => {
    const input = request();
    const snapshot = structuredClone(input);
    expect(applyTodayOrderAiPlan(plan(input), input, input.snapshot)).toEqual([
      "task-b:range-b", "task-c:range-c", "same-task:range-a", "recurring:task-d:2026-10-15",
    ]);
    expect(input).toEqual(snapshot);
  });

  it("全項目を後回しにする合意も、削除せず対応順へ残す", () => {
    const input = request();
    const response = plan(input);
    response.later = [...response.order, ...response.later]; response.order = [];
    expect(applyTodayOrderAiPlan(response, input, input.snapshot)).toHaveLength(4);
  });

  it("同名・同一Task内の複数予定もIDで区別する", () => {
    const input = request();
    input.snapshot.units = ["a", "b"].map(id => ({ id: `item:same-task:${id}`, title: "同じ名前", grouped: false, items: [work(`same-task:${id}`)] }));
    const response = { ...plan(input), order: [...input.snapshot.units].reverse().map(unit => ({ unitId: unit.id, reason: "合意済み", firstStep: "着手する" })), later: [] };
    expect(applyTodayOrderAiPlan(response, input, input.snapshot)).toEqual(["same-task:b", "same-task:a"]);
  });

  it("日付違いのファイルを反映しない", () => {
    const input = request();
    expect(() => validateTodayOrderAiPlan({ ...plan(input), date: "2026-10-14" }, input)).toThrow("別の日");
  });

  it("補足や利用可能時間の変更後は古いJSONを反映しない", () => {
    const input = request();
    const response = plan(input);
    for (const changed of [{ ...input, supplementary: "急ぎの約束が増えた" }, { ...input, availableHours: 1 }]) {
      expect(() => validateTodayOrderAiPlan(response, changed)).toThrow("変わっています");
    }
    expect(todayOrderAiRequestId(structuredClone(input))).toBe(response.requestId);
    expect(todayOrderAiRequestId({ supplementary: input.supplementary, availableHours: input.availableHours, snapshot: input.snapshot })).toBe(response.requestId);
  });

  it("相談後の対応順・工数・メモ・グループ変更を適用時にも再確認する", () => {
    const input = request();
    const changedOrder = structuredClone(input.snapshot); changedOrder.units.reverse();
    const changedHours = structuredClone(input.snapshot); changedHours.units[0].items[0].plannedHours = 5;
    const changedMemo = structuredClone(input.snapshot); changedMemo.units[0].items[0].memo = "新しい約束";
    const changedGroup = structuredClone(input.snapshot); changedGroup.units[1].items.reverse();
    for (const current of [changedOrder, changedHours, changedMemo, changedGroup]) {
      expect(() => applyTodayOrderAiPlan(plan(input), input, current)).toThrow("相談後");
    }
  });

  it("未知ID・重複・項目の欠落・グループの分割を受け付けない", () => {
    const input = request();
    const unknown = plan(input); unknown.order[0].unitId = "invented";
    const duplicate = plan(input); duplicate.later = [duplicate.order[0]];
    const missing = plan(input); missing.later = [];
    const split = plan(input); split.order[0].unitId = "task-b:range-b";
    for (const response of [unknown, duplicate, missing, split]) {
      expect(() => validateTodayOrderAiPlan(response, input)).toThrow();
    }
  });

  it("未確定事項がある提案は確定扱いにしない", () => {
    const input = request();
    expect(() => validateTodayOrderAiPlan({ ...plan(input), unresolvedQuestions: ["先方との期限を確認"] }, input)).toThrow("未確定事項");
  });

  it.each([-1, 25, NaN, Infinity])("利用可能時間 %s を拒否する", hours => {
    const input = { ...request(), availableHours: hours };
    expect(() => validateTodayOrderAiPlan(plan(input), input)).toThrow("0〜24");
  });

  it("作業が存在しない場合は空の提案も適用しない", () => {
    const input = request(); input.snapshot.units = [];
    expect(() => validateTodayOrderAiPlan({ ...plan(input), order: [], later: [] }, input)).toThrow("不足");
  });

  it("壊れたJSON・他機能のJSON・不正なフィールドを拒否する", () => {
    const valid = plan(request());
    for (const response of ["not json", "説明\n" + JSON.stringify(valid), "null", "[]", JSON.stringify({ ...valid, kind: "other" }), JSON.stringify({ ...valid, schemaVersion: 2 }), JSON.stringify({ ...valid, unresolvedQuestions: [123] }), JSON.stringify({ ...valid, order: {} }), JSON.stringify({ ...valid, order: [{ unitId: 1 }] })]) {
      expect(() => parseTodayOrderAiPlan(response)).toThrow();
    }
  });

  it("作業以外を変更する余分なフィールドは取り込まない", () => {
    const input = request();
    const parsed = parseTodayOrderAiPlan(JSON.stringify({ ...plan(input), deleteTasks: ["same-task"], status: "done" }));
    expect(parsed).not.toHaveProperty("deleteTasks");
    expect(parsed).not.toHaveProperty("status");
    expect(applyTodayOrderAiPlan(parsed, input, input.snapshot)).toHaveLength(4);
  });

  it("日別の相談下書きを復元し、不正な保存値は初期値へ戻す", () => {
    const draft = { tab: "review", availableHours: "3", supplementary: "補足", taskSupplements: { "same-task": "このTaskの補足" }, responseText: "JSON", snapshotJson: "snapshot" };
    expect(parseTodayOrderAiDraft(JSON.stringify({ version: 1, ...draft }))).toEqual(draft);
    expect(parseTodayOrderAiDraft(JSON.stringify({ version: 1, ...draft, confirmedSummary: "旧サマリー" }))).toEqual(draft);
    for (const source of [null, "broken", "null", "[]", '{"version":2}']) {
      expect(parseTodayOrderAiDraft(source)).toEqual({ tab: "consult", availableHours: "", supplementary: "", taskSupplements: {}, responseText: "", snapshotJson: "" });
    }
    expect(parseTodayOrderAiDraft('{"version":1,"supplementary":123}').supplementary).toBe("");
    expect(parseTodayOrderAiDraft('{"version":1,"tab":"invalid"}').tab).toBe("consult");
    expect(parseTodayOrderAiDraft('{"version":1,"supplementary":"旧下書き"}')).toMatchObject({ tab: "consult", supplementary: "旧下書き", taskSupplements: {} });
  });
});

describe("タスクごとのAI相談用補足", () => {
  const inputWithTwoTasks = (): TodayOrderAiRequest => {
    const input = request();
    input.snapshot.units[1].items[0] = { ...input.snapshot.units[1].items[0], taskId: "another-task", taskTitle: "親タスク" };
    input.taskSupplements = { "same-task": "依頼先に午前中の対応を約束した", "another-task": "仕様の確認が先に必要" };
    return input;
  };

  it("単体・既存グループ・定期作業をまたぐ同一Taskの入力対象を一つにまとめる", () => {
    const input = inputWithTwoTasks();
    const targets = collectTodayOrderAiSupplementTargets(input.snapshot);
    expect(targets).toHaveLength(2);
    expect(targets[0]).toEqual({ taskId: "same-task", title: "親タスク", workTitles: ["同じ名前の作業", "同じ名前の作業", "同じ名前の作業"] });
    expect(targets[1].taskId).toBe("another-task");
    expect(collectTodayOrderAiSupplementTargets({ date: input.snapshot.date, units: [] })).toEqual([]);
  });

  it("相談対象の作業から入力欄を作り、取得できたTaskの正式名称を使う", () => {
    const input = request();
    input.snapshot.tasks = collectTodayOrderAiTaskContexts(input.snapshot.units, [{ ...createTask(), id: "same-task", title: "正式なTask名" }, { ...createTask(), id: "unrelated", title: "対象外" }], []);
    expect(collectTodayOrderAiSupplementTargets(input.snapshot).map(target => target.title)).toEqual(["正式なTask名"]);
  });

  it("同名の別タスクもIDで区別し、両プロンプトに補足を正確に紐づける", () => {
    const input = inputWithTwoTasks();
    const before = structuredClone(input);
    for (const prompt of [buildTodayOrderConsultationPrompt(input), buildTodayOrderFilePrompt(input)]) {
      const data = JSON.parse(prompt.match(/```json\n([\s\S]*?)\n```$/)![1]);
      expect(data.taskSupplements).toEqual([
        { taskId: "another-task", title: "親タスク", supplementary: "仕様の確認が先に必要" },
        { taskId: "same-task", title: "親タスク", supplementary: "依頼先に午前中の対応を約束した" },
      ]);
      expect(data.supplementary).toBe(input.supplementary);
      expect(prompt).toContain("taskId");
    }
    expect(buildTodayOrderConsultationPrompt(input)).toContain("別のタスクへ適用しない");
    expect(input).toEqual(before);
  });

  it("対象外のタスク補足や空欄はAIへ渡さず、古い入力で相談IDも変えない", () => {
    const input = request();
    const withHidden = { ...input, taskSupplements: { removed: "AIへ送らない情報", "same-task": "  \n " } };
    for (const prompt of [buildTodayOrderConsultationPrompt(withHidden), buildTodayOrderFilePrompt(withHidden)]) {
      expect(prompt).not.toContain("AIへ送らない情報");
      const data = JSON.parse(prompt.match(/```json\n([\s\S]*?)\n```$/)![1]);
      expect(data.taskSupplements).toEqual([]);
    }
    expect(todayOrderAiRequestId(withHidden)).toBe(todayOrderAiRequestId(input));
  });

  it("タスク別補足の変更や紐づけ先の変更で古いJSONを無効にする", () => {
    const input = inputWithTwoTasks();
    const response = plan(input);
    const changed = { ...input, taskSupplements: { ...input.taskSupplements, "same-task": "午後で良くなった" } };
    const moved = { ...input, taskSupplements: { "same-task": input.taskSupplements!["another-task"], "another-task": input.taskSupplements!["same-task"] } };
    for (const next of [changed, moved]) expect(() => validateTodayOrderAiPlan(response, next)).toThrow("変わっています");
    const reordered = { ...input, taskSupplements: Object.fromEntries(Object.entries(input.taskSupplements!).reverse()) };
    expect(todayOrderAiRequestId(reordered)).toBe(response.requestId);
    expect(validateTodayOrderAiPlan(response, reordered)).toHaveLength(3);
  });

  it("下書きの不正なタスク補足だけを除外し、全体の補足や有効な入力は保持する", () => {
    const draft = parseTodayOrderAiDraft(JSON.stringify({ version: 1, supplementary: "共通", taskSupplements: { a: "補足", b: 3, c: null, d: {}, e: "" } }));
    expect(draft.supplementary).toBe("共通");
    expect(draft.taskSupplements).toEqual({ a: "補足", e: "" });
    for (const taskSupplements of [null, [], "invalid", 3]) {
      expect(parseTodayOrderAiDraft(JSON.stringify({ version: 1, taskSupplements })).taskSupplements).toEqual({});
    }
  });
});

describe("AIから提案されたグループ化", () => {
  it("新形式のJSONからグループ名・対象・理由を読み込む", () => {
    const input = request();
    const response = groupingPlan(input);
    expect(parseTodayOrderAiPlan(JSON.stringify(response))).toEqual(response);
    expect(validateTodayOrderAiPlan(response, input).map(item => item.unitId)).toEqual(["proposal:checks", "item:recurring:task-d:2026-10-15"]);
  });

  it("既存グループと単体作業を一階層へまとめ、内部順を保持する", () => {
    const input = request();
    const response = groupingPlan(input);
    const units = resolveTodayOrderAiUnits(input.snapshot, response.groups);
    const proposed = units.find(unit => unit.id === "proposal:checks")!;
    expect(proposed.title).toBe("確認依頼まとめ");
    expect(proposed.grouped).toBe(true);
    expect(proposed.items.map(item => item.id)).toEqual(["task-b:range-b", "task-c:range-c", "same-task:range-a"]);
    expect(units.map(unit => unit.id)).not.toContain("group:parallel");
    expect(applyTodayOrderAiPlan(response, input, input.snapshot)).toEqual(["task-b:range-b", "task-c:range-c", "same-task:range-a", "recurring:task-d:2026-10-15"]);
  });

  it("新規グループを作っても対象外の既存グループを維持する", () => {
    const input = request();
    const response: TodayOrderAiPlan = {
      ...groupingPlan(input),
      groups: [{ proposalId: "proposal:solo", name: "単体作業まとめ", unitIds: ["item:same-task:range-a", "item:recurring:task-d:2026-10-15"], reason: "同じ準備で進める" }],
      order: [{ unitId: "proposal:solo", reason: "まとめる", firstStep: "準備する" }, plan(input).order[0]], later: [],
    };
    const groups = [{ id: "parallel", name: "並行作業", itemKeys: ["task-b:range-b", "task-c:range-c"] }];
    const result = buildTodayOrderAiApplication(response, input, input.snapshot, groups, () => "new-id");
    expect(result.groups).toEqual([...groups, { id: "new-id", name: "単体作業まとめ", itemKeys: ["same-task:range-a", "recurring:task-d:2026-10-15"] }]);
    expect(result.queueKeys).toEqual(["same-task:range-a", "recurring:task-d:2026-10-15", "task-b:range-b", "task-c:range-c"]);
  });

  it("統合元の非表示・一時待ちメンバーも引き継ぎ、対応順へは復活させない", () => {
    const input = request();
    const currentGroups = [
      { id: "parallel", name: "並行作業", itemKeys: ["task-b:range-b", "held:range", "task-c:range-c", "completed:range"] },
      { id: "unrelated", name: "別のグループ", itemKeys: ["other-1", "other-2"] },
    ];
    const snapshot = structuredClone(currentGroups);
    const result = buildTodayOrderAiApplication(groupingPlan(input), input, input.snapshot, currentGroups, () => "generated-id");
    expect(result.groups).toEqual([
      currentGroups[1],
      { id: "generated-id", name: "確認依頼まとめ", itemKeys: ["task-b:range-b", "held:range", "task-c:range-c", "completed:range", "same-task:range-a"] },
    ]);
    expect(result.queueKeys).not.toContain("held:range");
    expect(result.queueKeys).not.toContain("completed:range");
    expect(result.groups.flatMap(group => group.itemKeys)).not.toContain("group:parallel");
    expect(currentGroups).toEqual(snapshot);
  });

  it("複数のグループを同時作成しても全作業を一度だけ配置する", () => {
    const input = request();
    input.snapshot.units = ["a", "b", "c", "d"].map(id => ({ id: `item:${id}`, title: id, grouped: false, items: [work(id)] }));
    const response: TodayOrderAiPlan = {
      ...groupingPlan(input),
      groups: [
        { proposalId: "proposal:one", name: "1", unitIds: ["item:a", "item:c"], reason: "同じ確認" },
        { proposalId: "proposal:two", name: "2", unitIds: ["item:b", "item:d"], reason: "同じ準備" },
      ],
      order: [{ unitId: "proposal:two", reason: "先", firstStep: "準備" }], later: [{ unitId: "proposal:one", reason: "後", firstStep: "" }],
    };
    let sequence = 0;
    const result = buildTodayOrderAiApplication(response, input, input.snapshot, [], () => `new-${++sequence}`);
    expect(result.queueKeys).toEqual(["b", "d", "a", "c"]);
    expect(result.groups).toHaveLength(2);
    expect(new Set(result.groups.flatMap(group => group.itemKeys)).size).toBe(4);
  });

  it("元項目の重複・未知ID・入れ子・1件だけのグループ化を拒否する", () => {
    const input = request();
    const base = groupingPlan(input).groups![0];
    const invalid: TodayOrderAiProposedGroup[][] = [
      [{ ...base, unitIds: ["item:same-task:range-a"] }],
      [{ ...base, unitIds: ["item:same-task:range-a", "item:same-task:range-a"] }],
      [{ ...base, unitIds: ["group:parallel", "unknown"] }],
      [base, { ...base, proposalId: "proposal:two" }],
      [base, { ...base, proposalId: "proposal:two", unitIds: ["proposal:checks", "item:recurring:task-d:2026-10-15"] }],
      [{ ...base, proposalId: "group:parallel" }],
      [{ ...base, name: "" }], [{ ...base, reason: "" }],
      [base, { ...base, unitIds: ["item:recurring:task-d:2026-10-15", "item:same-task:range-a"] }],
    ];
    for (const groups of invalid) expect(() => validateTodayOrderAiPlan({ ...groupingPlan(input), groups }, input)).toThrow();
  });

  it("グループ化した元項目を重ねて並べたり、新規グループを省略したりできない", () => {
    const input = request();
    const duplicateSource = groupingPlan(input); duplicateSource.order.push(plan(input).order[0]);
    const missingGroup = groupingPlan(input); missingGroup.order = [];
    expect(() => validateTodayOrderAiPlan(duplicateSource, input)).toThrow("対象にない");
    expect(() => validateTodayOrderAiPlan(missingGroup, input)).toThrow("不足");
  });

  it("予定が変わった場合はグループIDの作成前に停止する", () => {
    const input = request();
    const changed = structuredClone(input.snapshot); changed.units.reverse();
    const createId = vi.fn(() => "new-id");
    expect(() => buildTodayOrderAiApplication(groupingPlan(input), input, changed, [], createId)).toThrow("相談後");
    expect(createId).not.toHaveBeenCalled();
  });

  it("新規グループ用のIDが既存グループと衝突したら停止する", () => {
    const input = request();
    const groups = [{ id: "parallel", name: "並行作業", itemKeys: ["task-b:range-b", "task-c:range-c"] }];
    expect(() => buildTodayOrderAiApplication(groupingPlan(input), input, input.snapshot, groups, () => "parallel")).toThrow("ID");
  });

  it("以前の並べ替えJSONはグループを変更せず引き続き使える", () => {
    const input = request();
    const groups = [{ id: "parallel", name: "並行作業", itemKeys: ["task-b:range-b", "task-c:range-c"] }];
    const createId = vi.fn(() => "unused");
    const result = buildTodayOrderAiApplication(parseTodayOrderAiPlan(JSON.stringify(plan(input))), input, input.snapshot, groups, createId);
    expect(result.groups).toEqual(groups);
    expect(createId).not.toHaveBeenCalled();
    expect(result.queueKeys).toEqual(applyTodayOrderAiPlan(plan(input), input, input.snapshot));
  });

  it("新形式のグループ定義の不備と旧形式へのグループ混入を拒否する", () => {
    const input = request();
    const base = groupingPlan(input);
    for (const response of [
      { ...base, groups: null }, { ...base, groups: [{}] },
      { ...base, groups: [{ ...base.groups![0], unitIds: "not-array" }] },
      { ...base, groups: [{ ...base.groups![0], unitIds: [123, null] }] },
      { ...base, schemaVersion: 1 }, { ...base, schemaVersion: 3 },
    ]) expect(() => parseTodayOrderAiPlan(JSON.stringify(response))).toThrow();
    expect(parseTodayOrderAiPlan(JSON.stringify({ ...plan(input), schemaVersion: 2, groups: [] })).groups).toEqual([]);
  });
});

describe("着手順の判断に使うTask情報", () => {
  const targetTask = () => ({
    ...createTask(), id: "same-task", title: "Task全体", description: "Task全体の目的と背景", nextAction: "先に仕様を確認する",
    projectTagId: "tag", dueDate: "2026-10-16", reminderDate: "2026-10-15", plannedHours: 10, actualHours: 3,
  });

  it("同じTaskの複数作業があってもTask情報は一度だけ出力する", () => {
    const input = request();
    const task = targetTask();
    const contexts = collectTodayOrderAiTaskContexts(input.snapshot.units, [task], [{ id: "tag", name: "案件名", visible: true }]);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      id: "same-task", title: "Task全体", description: "Task全体の目的と背景", nextAction: "先に仕様を確認する",
      tag: "案件名", dueDate: "2026-10-16", reminderDate: "2026-10-15", totalPlannedHours: 10, totalActualHours: 3,
    });
  });

  it("作業固有の説明とTask全体の背景を両方のプロンプトへ含める", () => {
    const input = request();
    input.snapshot.units[0].items[0].description = "作業固有の手順";
    input.snapshot.tasks = collectTodayOrderAiTaskContexts(input.snapshot.units, [targetTask()], []);
    const consultation = buildTodayOrderConsultationPrompt(input);
    const data = JSON.parse(/```json\n([\s\S]*)\n```/.exec(consultation)![1]);
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].description).toBe("Task全体の目的と背景");
    expect(data.units[0].items[0].description).toBe("作業固有の手順");
    expect(consultation).toContain("二重計上しない");
    expect(consultation).toContain("作業も個別に着手順を検討");
    const file = buildTodayOrderFilePrompt(input);
    expect(file).toContain("Task全体の目的と背景");
    expect(file).toContain("作業固有の手順");
  });

  it("Task全体の進捗・待ち相手と作業の当日の状態を区別する", () => {
    const input = request();
    const task = targetTask();
    task.status = "doing"; task.progressStatus = "waiting"; task.waitingReason = "client";
    task.waitingFollowUp = { kind: "confirmation", party: "確認先", memo: "仕様の返答待ち", reviewDate: "2026-10-16", startedAt: "2026-10-14" };
    const contexts = collectTodayOrderAiTaskContexts(input.snapshot.units, [task], []);
    expect(contexts[0]).toMatchObject({ status: "進行中", progressStatus: "待ち", waitingReason: "先方", waitingFollowUp: { party: "確認先", memo: "仕様の返答待ち" } });
    expect(input.snapshot.units[0].items[0].status).toBe("未着手");
    contexts[0].waitingFollowUp!.memo = "別のメモ";
    expect(task.waitingFollowUp.memo).toBe("仕様の返答待ち");
  });

  it("上位Taskの階層と関連Taskの名称・状態を付ける", () => {
    const task = targetTask();
    task.parentTaskId = "parent";
    task.relatedTasks = [{ taskId: "related", relation: "previous", linkedAt: "2026-10-15" }];
    const parent = { ...createTask(), id: "parent", title: "上位Task", parentTaskId: "root" };
    const root = { ...createTask(), id: "root", title: "最上位Task" };
    const related = { ...createTask(), id: "related", title: "関連する前の作業", dueDate: "2026-10-14" };
    const unrelated = { ...createTask(), id: "unrelated", description: "相談対象ではない別Taskの本文" };
    const contexts = collectTodayOrderAiTaskContexts(request().snapshot.units, [task, parent, root, related, unrelated], []);
    expect(contexts).toHaveLength(1);
    expect(contexts[0].parentTasks.map(item => item.title)).toEqual(["最上位Task", "上位Task"]);
    expect(contexts[0].relatedTasks[0]).toMatchObject({ taskId: "related", title: "関連する前の作業", status: "未対応", dueDate: "2026-10-14", relation: "previous" });
    expect(JSON.stringify(contexts)).not.toContain("相談対象ではない別Taskの本文");
  });

  it("壊れた親子関係や見つからない関連Taskがあっても捏造せず扱う", () => {
    const task = targetTask(); task.parentTaskId = "parent";
    task.relatedTasks = [{ taskId: "missing", relation: "reference", linkedAt: "2026-10-15" }];
    const parent = { ...createTask(), id: "parent", title: "親", parentTaskId: task.id };
    const contexts = collectTodayOrderAiTaskContexts(request().snapshot.units, [task, parent], []);
    expect(contexts[0].parentTasks).toHaveLength(1);
    expect(contexts[0].relatedTasks[0]).toMatchObject({ taskId: "missing", title: "Task情報なし", status: "不明" });
    expect(collectTodayOrderAiTaskContexts(request().snapshot.units, [], [])).toEqual([]);
  });

  it("Task情報の更新後は、作業順が同じでも古い提案を拒否する", () => {
    const input = request();
    input.snapshot.tasks = collectTodayOrderAiTaskContexts(input.snapshot.units, [targetTask()], []);
    const response = plan(input);
    const changed = structuredClone(input);
    changed.snapshot.tasks![0].description = "目的が変わった";
    expect(() => validateTodayOrderAiPlan(response, changed)).toThrow("変わっています");
    expect(() => applyTodayOrderAiPlan(response, input, changed.snapshot)).toThrow("相談後");
  });
});
