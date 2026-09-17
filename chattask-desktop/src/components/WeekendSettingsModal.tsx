import { useMemo, useState } from "react";
import type { NonWorkingPeriod } from "../types";
import { generateId, todayValue } from "../utils";
import { Modal } from "./Modal";
import { WorkDatePicker } from "./WorkDatePicker";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function WeekendSettingsModal({ periods, onSave, onClose }: { periods: NonWorkingPeriod[]; onSave: (periods: NonWorkingPeriod[]) => void; onClose: () => void }) {
  const [items, setItems] = useState(() => periods.filter((item) => item.type === "weekend"));
  const sorted = useMemo(() => [...items].sort((a, b) => a.startDate.localeCompare(b.startDate)), [items]);
  const current = [...sorted].reverse().find((item) => item.startDate <= todayValue());
  const [editingId, setEditingId] = useState("");
  const [startDate, setStartDate] = useState(todayValue());
  const [weekdays, setWeekdays] = useState<number[]>(current?.weekdays || [0, 6]);

  const reset = () => {
    setEditingId("");
    setStartDate(todayValue());
    setWeekdays(current?.weekdays || [0, 6]);
  };
  const edit = (item: NonWorkingPeriod) => {
    setEditingId(item.id);
    setStartDate(item.startDate);
    setWeekdays([...(item.weekdays || [])]);
  };
  const saveRule = () => {
    if (!startDate) return window.alert("適用開始日を指定してください。");
    const duplicate = items.find((item) => item.id !== editingId && item.startDate === startDate);
    if (duplicate && !window.confirm(`${startDate}からの設定は既にあります。置き換えますか？`)) return;
    const existing = items.find((item) => item.id === editingId);
    const rule: NonWorkingPeriod = { id: existing?.id || generateId(), startDate, endDate: "", type: "weekend", weekdays: [...weekdays].sort((a, b) => a - b), note: "休みの曜日設定" };
    setItems((list) => [...list.filter((item) => item.id !== editingId && item.id !== duplicate?.id), rule]);
    setEditingId(rule.id);
  };
  const remove = (item: NonWorkingPeriod) => {
    const past = item.startDate <= todayValue();
    if (!window.confirm(past ? `この履歴を削除すると、${item.startDate}以降の過去の日付判定も変わります。登録間違いを修正する場合だけ削除してください。` : `${item.startDate}からの適用予定を削除しますか？`)) return;
    setItems((list) => list.filter((value) => value.id !== item.id));
    if (editingId === item.id) reset();
  };
  const saveAll = () => {
    const otherPeriods = periods.filter((item) => item.type !== "weekend");
    onSave([...otherPeriods, ...items]);
    onClose();
  };
  const dayText = (item?: NonWorkingPeriod) => (item?.weekdays || []).map((day) => `${WEEKDAYS[day]}曜`).join("・") || "休みなし";

  return <Modal title="休みの曜日設定" onClose={onClose} wide>
    <div className="weekend-settings-screen">
      <header><div><small>DAYS OFF</small><h3>共通の休み曜日を設定</h3><p>仕事用・日常用で同じ設定を使います。開始日ごとに履歴を保持し、登録間違いは過去分も修正できます。</p></div><span><small>現在の設定</small><strong>{current ? dayText(current) : "土曜・日曜"}</strong></span></header>
      <div className="weekend-settings-layout">
        <section className="weekend-settings-history"><header><strong>設定履歴</strong><small>{sorted.length}件</small></header><div><article className={`weekend-settings-initial ${!sorted.length ? "current" : ""}`}><span>初期設定</span><strong>土曜・日曜</strong><small>最初の変更より前</small></article>{sorted.map((item) => <article key={item.id} className={`${item.id === editingId ? "editing" : ""} ${item.id === current?.id ? "current" : ""}`}><button type="button" onClick={() => edit(item)}><span>{item.startDate}から</span><strong>{dayText(item)}</strong><small>{item.id === current?.id ? "現在適用中" : item.startDate > todayValue() ? "適用予定" : "過去の設定"}</small></button><button type="button" className="danger-text" onClick={() => remove(item)}>削除</button></article>)}</div></section>
        <section className="weekend-settings-editor"><header><small>{editingId ? "EDIT RULE" : "NEW RULE"}</small><h3>{editingId ? "設定履歴を修正" : "新しい設定を追加"}</h3></header><label>適用開始日<WorkDatePicker ariaLabel="休み設定の適用開始日" value={startDate} onChange={setStartDate} allowClear={false} /></label><fieldset><legend>休みとして扱う曜日</legend><p>未選択にすると、曜日による休みはありません。</p><div>{WEEKDAYS.map((label, day) => <label key={label}><input type="checkbox" checked={weekdays.includes(day)} onChange={(event) => setWeekdays(event.target.checked ? [...weekdays, day].sort() : weekdays.filter((value) => value !== day))} /><span>{label}</span></label>)}</div></fieldset><div className="weekend-settings-preview"><span>この設定</span><strong>{weekdays.length ? weekdays.map((day) => `${WEEKDAYS[day]}曜日`).join("・") : "休みなし"}</strong><small>{startDate || "開始日未設定"}から適用</small></div><footer>{editingId && <button type="button" onClick={reset}>新規設定に戻す</button>}<button type="button" className="primary" onClick={saveRule}>{editingId ? "履歴を更新" : "設定を追加"}</button></footer></section>
      </div>
      <div className="weekend-settings-warning"><strong>過去の設定を修正すると</strong><span>該当期間の休暇表示、予定工数の配分、週間予定などが再計算されます。登録間違いの訂正時に使用してください。</span></div>
      <footer><button type="button" onClick={onClose}>キャンセル</button><button type="button" className="primary" onClick={saveAll}>保存</button></footer>
    </div>
  </Modal>;
}
