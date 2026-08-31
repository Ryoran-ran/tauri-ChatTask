import type { Task } from "../types";
import { recurrenceLabel } from "../utils";
import { WorkDatePicker } from "./WorkDatePicker";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function RecurrenceSettingsEditor({ task, onUpdate }: {
  task: Task;
  onUpdate: (changes: Partial<Task>, history?: string) => void;
}) {
  if (task.status !== "recurring" || !task.recurrence) return null;
  const recurrence = task.recurrence;
  const updateRecurrence = (changes: Partial<NonNullable<Task["recurrence"]>>, history?: string) =>
    onUpdate({ recurrence: { ...recurrence, ...changes } }, history);
  return <div className="recurrence-settings">
    <div className="recurrence-heading"><strong>定期タスク設定</strong><label><input type="checkbox" checked={Boolean(recurrence.paused)} onChange={(event) => updateRecurrence({ paused: event.target.checked }, "定期タスク設定を変更しました。")} />一時停止</label></div>
    <div className="field-grid">
      <label>繰り返し<select value={recurrence.frequency} onChange={(event) => updateRecurrence({ frequency: event.target.value as typeof recurrence.frequency })}><option value="daily">毎日</option><option value="weekly">毎週</option><option value="monthly">毎月</option></select></label>
      {recurrence.frequency === "weekly" && <label>曜日<select value={recurrence.weekday ?? 1} onChange={(event) => updateRecurrence({ weekday: Number(event.target.value) })}>{WEEKDAYS.map((day, index) => <option value={index} key={day}>{day}曜日</option>)}</select></label>}
      {recurrence.frequency === "monthly" && <label>指定方法<select value={recurrence.monthlyType || "date"} onChange={(event) => updateRecurrence({ monthlyType: event.target.value as "date" | "weekday" })}><option value="date">日付で指定</option><option value="weekday">第○・○曜日で指定</option></select></label>}
      {recurrence.frequency === "monthly" && (recurrence.monthlyType || "date") === "date" && <label>毎月の日付<input type="number" min="1" max="31" value={recurrence.monthDay ?? 1} onChange={(event) => updateRecurrence({ monthDay: Math.max(1, Math.min(31, Number(event.target.value))) })} /></label>}
      {recurrence.frequency === "monthly" && recurrence.monthlyType === "weekday" && <><label>週<select value={recurrence.weekOfMonth ?? 1} onChange={(event) => updateRecurrence({ weekOfMonth: Number(event.target.value) })}><option value={1}>第1</option><option value={2}>第2</option><option value={3}>第3</option><option value={4}>第4</option><option value={5}>第5</option><option value={-1}>最終</option></select></label><label>曜日<select value={recurrence.weekday ?? 1} onChange={(event) => updateRecurrence({ weekday: Number(event.target.value) })}>{WEEKDAYS.map((day, index) => <option value={index} key={day}>{day}曜日</option>)}</select></label></>}
      <label>開始日<WorkDatePicker ariaLabel="定期タスクの開始日" value={recurrence.startDate} onChange={(startDate) => updateRecurrence({ startDate })} allowClear={false} /></label>
      <label>終了日<WorkDatePicker ariaLabel="定期タスクの終了日" min={recurrence.startDate} value={recurrence.endDate || ""} onChange={(endDate) => updateRecurrence({ endDate })} /></label>
      <label>1回あたりの予定工数（時間）<input type="number" min="0" step="0.25" value={Number(task.plannedHours) || ""} onChange={(event) => onUpdate({ plannedHours: Math.max(0, Number(event.target.value) || 0) })} onBlur={() => onUpdate({}, "定期タスクの1回あたりの予定工数を更新しました。")} placeholder="例：1" /></label>
    </div>
    <label className="recurrence-template">対応メモのテンプレート<textarea rows={5} value={task.recurrenceMemoTemplate} onChange={(event) => onUpdate({ recurrenceMemoTemplate: event.target.value })} onBlur={() => onUpdate({}, "定期タスクのメモテンプレートを更新しました。")} placeholder={"毎回の対応内容を入力します。\n例:\n- [ ] メールを確認\n- [ ] 結果を記録"} /></label>
    <small className="recurrence-template-help">今日のページでは日付ごとの実施メモとして展開され、個別に編集できます。</small>
    <p>{recurrenceLabel(task)}・実施済み {task.recurrenceRecords.filter((item) => item.status === "done").length}回 / スキップ {task.recurrenceRecords.filter((item) => item.status === "skipped").length}回 / 移動 {task.recurrenceRecords.filter((item) => item.status === "moved").length}回</p>
  </div>;
}
