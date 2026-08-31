import { isTerminalStatus } from "../data/constants";
import type { AppData, PlannedRange } from "../types";

export type IntegritySeverity = "error" | "warning";

export interface IntegrityIssue {
  id: string;
  severity: IntegritySeverity;
  category: string;
  target: string;
  message: string;
  suggestion: string;
}

export interface IntegrityCheckResult {
  checkedAt: string;
  issues: IntegrityIssue[];
  checkedCounts: { tasks: number; projects: number; schedules: number };
}

const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const finiteNonNegative = (value: unknown) => value === undefined || value === null
  || (Number.isFinite(Number(value)) && Number(value) >= 0);

const rangeSignature = (range: PlannedRange) => [
  range.startDate,
  range.endDate,
  range.sourceType || "",
  range.sourceId || "",
  Number(range.plannedHours) || 0,
].join("|");

export function checkAppDataIntegrity(data: AppData): IntegrityCheckResult {
  const issues: IntegrityIssue[] = [];
  let serial = 0;
  const add = (issue: Omit<IntegrityIssue, "id">) => issues.push({ ...issue, id: `integrity-${serial += 1}` });
  const duplicateIds = (values: { id: string }[], category: string, label: string) => {
    const counts = new Map<string, number>();
    values.forEach(({ id }) => counts.set(id, (counts.get(id) || 0) + 1));
    counts.forEach((count, id) => {
      if (!id || count < 2) return;
      add({ severity: "error", category, target: `${label} ID: ${id}`, message: `同じIDが${count}件あります。`, suggestion: "バックアップを作成したうえで、重複レコードの統合またはID再発行が必要です。" });
    });
  };

  duplicateIds(data.tasks, "ID", "タスク");
  duplicateIds(data.projectTags, "ID", "案件タグ");
  duplicateIds(data.goals, "ID", "プロジェクト");
  duplicateIds(data.inboxItems, "ID", "Inbox");

  const taskById = new Map(data.tasks.map((task) => [task.id, task]));
  const tagIds = new Set(data.projectTags.map((tag) => tag.id));
  const milestones = data.goals.flatMap((goal) => goal.milestones.map((milestone) => ({ goal, milestone })));
  const works = data.goals.flatMap((goal) => (goal.workItems || []).map((work) => ({ goal, work })));
  const milestoneById = new Map(milestones.map(({ milestone }) => [milestone.id, milestone]));
  const workById = new Map(works.map(({ work }) => [work.id, work]));
  duplicateIds(milestones.map(({ milestone }) => milestone), "ID", "マイルストーン");
  duplicateIds(works.map(({ work }) => work), "ID", "プロジェクト作業");

  data.tasks.forEach((task) => {
    const target = `タスク「${task.title || task.id}」`;
    if (task.projectTagId && !tagIds.has(task.projectTagId)) add({ severity: "error", category: "参照", target, message: "存在しない案件タグを参照しています。", suggestion: "有効な案件タグへ変更するか、タグなしに戻してください。" });
    if (task.parentTaskId && !taskById.has(task.parentTaskId)) add({ severity: "error", category: "親子関係", target, message: "親タスクが見つかりません。", suggestion: "親タスクを選び直すか、親タスクなしへ変更してください。" });
    if (task.parentTaskId === task.id) add({ severity: "error", category: "親子関係", target, message: "自分自身を親タスクにしています。", suggestion: "親タスクなし、または別のタスクへ変更してください。" });
    const visited = new Set<string>([task.id]);
    let parentId = task.parentTaskId;
    while (parentId && taskById.has(parentId)) {
      if (visited.has(parentId)) {
        add({ severity: "error", category: "親子関係", target, message: "親子関係が循環しています。", suggestion: "循環しているいずれかのタスクを親タスクなしへ変更してください。" });
        break;
      }
      visited.add(parentId);
      parentId = taskById.get(parentId)?.parentTaskId || "";
    }
    if (isTerminalStatus(task.status) && !task.completedAt) add({ severity: "warning", category: "ステータス", target, message: "終了済みですが終了日時がありません。", suggestion: "一度終了状態を解除して再設定し、終了日時を記録してください。" });
    if (!isTerminalStatus(task.status) && task.completedAt) add({ severity: "warning", category: "ステータス", target, message: "未終了ですが終了日時が残っています。", suggestion: "ステータスを確認し、不要な終了日時を取り除いてください。" });
    if (!finiteNonNegative(task.plannedHours) || !finiteNonNegative(task.actualHours)) add({ severity: "error", category: "工数", target, message: "予定または実績工数が負数・不正値です。", suggestion: "0以上の数値へ修正してください。" });
    Object.entries(task.dailyActualHours || {}).forEach(([date, hours]) => {
      if (!validDate(date) || !finiteNonNegative(hours)) add({ severity: "error", category: "日別実績", target: `${target} / ${date}`, message: "日付または日別実績工数が不正です。", suggestion: "正しい日付と0以上の工数へ修正してください。" });
    });

    const signatures = new Map<string, PlannedRange[]>();
    task.plannedRanges.forEach((range) => {
      const rangeTarget = `${target} / 予定 ${range.startDate || "未設定"}〜${range.endDate || "未設定"}`;
      if (!validDate(range.startDate) || !validDate(range.endDate) || range.startDate > range.endDate) add({ severity: "error", category: "予定", target: rangeTarget, message: "予定期間の日付が不正です。", suggestion: "開始日と終了日を正しい順序で設定してください。" });
      if (!finiteNonNegative(range.plannedHours)) add({ severity: "error", category: "工数", target: rangeTarget, message: "予定工数が負数・不正値です。", suggestion: "0以上の数値へ修正してください。" });
      if (range.sourceType && !range.sourceId) add({ severity: "error", category: "プロジェクト連携", target: rangeTarget, message: "連携元の種類はありますがIDがありません。", suggestion: "プロジェクト側から予定を再保存してください。" });
      if (range.sourceId && !range.sourceType) add({ severity: "error", category: "プロジェクト連携", target: rangeTarget, message: "連携元IDはありますが種類がありません。", suggestion: "プロジェクト側から予定を再保存してください。" });
      if (range.sourceType === "project-milestone" && range.sourceId && !milestoneById.has(range.sourceId)) add({ severity: "error", category: "プロジェクト連携", target: rangeTarget, message: "連携元マイルストーンが見つかりません。", suggestion: "孤立した予定を削除するか、マイルストーンから予定を登録し直してください。" });
      if (range.sourceType === "project-work" && range.sourceId && !workById.has(range.sourceId)) add({ severity: "error", category: "プロジェクト連携", target: rangeTarget, message: "連携元の作業項目が見つかりません。", suggestion: "孤立した予定を削除するか、作業項目から予定を登録し直してください。" });
      const signature = rangeSignature(range);
      signatures.set(signature, [...(signatures.get(signature) || []), range]);
    });
    signatures.forEach((ranges) => {
      if (ranges.length < 2) return;
      add({ severity: "warning", category: "予定", target, message: `同じ期間・工数・連携元の予定が${ranges.length}件あります。`, suggestion: "意図した分割予定でなければ、重複した予定を1件に統合してください。" });
    });
  });

  data.goals.forEach((goal) => {
    const target = `プロジェクト「${goal.title || goal.id}」`;
    if (goal.projectTagId && !tagIds.has(goal.projectTagId)) add({ severity: "error", category: "参照", target, message: "存在しない案件タグを参照しています。", suggestion: "有効な案件タグへ変更してください。" });
    goal.taskIds.forEach((id) => { if (!taskById.has(id)) add({ severity: "error", category: "プロジェクト連携", target, message: `関連タスク（${id}）が見つかりません。`, suggestion: "参照を外すか、関連タスクを選び直してください。" }); });
    goal.milestones.forEach((milestone) => {
      if (milestone.linkedTaskId && !taskById.has(milestone.linkedTaskId)) add({ severity: "error", category: "プロジェクト連携", target: `${target} / マイルストーン「${milestone.title}」`, message: "関連タスクが見つかりません。", suggestion: "関連タスクを選び直してください。" });
    });
    (goal.workItems || []).forEach((work) => {
      const workTarget = `${target} / 作業「${work.title || work.id}」`;
      if (!milestoneById.has(work.milestoneId) || !goal.milestones.some((milestone) => milestone.id === work.milestoneId)) add({ severity: "error", category: "プロジェクト構造", target: workTarget, message: "所属マイルストーンが見つかりません。", suggestion: "正しいマイルストーンへ移動するか、不要な作業を削除してください。" });
      if (work.linkedTaskId && !taskById.has(work.linkedTaskId)) add({ severity: "error", category: "プロジェクト連携", target: workTarget, message: "関連タスクが見つかりません。", suggestion: "関連タスクを選び直してください。" });
      if (!finiteNonNegative(work.plannedHours) || !finiteNonNegative(work.actualHours)) add({ severity: "error", category: "工数", target: workTarget, message: "予定または実績工数が負数・不正値です。", suggestion: "0以上の数値へ修正してください。" });
      if ((work.plannedRanges || []).length > 1) add({ severity: "warning", category: "予定", target: workTarget, message: "1作業に複数の予定が登録されています。", suggestion: "現在の仕様に合わせ、作業予定を1件へ統合してください。" });
    });
  });

  return {
    checkedAt: new Date().toISOString(),
    issues,
    checkedCounts: {
      tasks: data.tasks.length,
      projects: data.goals.length,
      schedules: data.tasks.reduce((sum, task) => sum + task.plannedRanges.length, 0)
        + milestones.reduce((sum, { milestone }) => sum + (milestone.plannedRanges || []).length, 0)
        + works.reduce((sum, { work }) => sum + (work.plannedRanges || []).length, 0),
    },
  };
}
