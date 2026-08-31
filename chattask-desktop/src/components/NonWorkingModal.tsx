import { useMemo, useState } from "react";
import type { NonWorkingPeriod } from "../types";
import { generateId, todayValue } from "../utils";
import { Modal } from "./Modal";
import { WorkDatePicker } from "./WorkDatePicker";

const typeLabel = { vacation: "休暇", holiday: "祝日", other: "非稼働日", weekend: "土日休暇" };
const blank = (): NonWorkingPeriod => ({ id: "", startDate: todayValue(), endDate: "", type: "vacation", note: "" });

export function NonWorkingModal({ periods, onSave, onClose }: { periods: NonWorkingPeriod[]; onSave: (items: NonWorkingPeriod[]) => void; onClose: () => void }) {
  const [items, setItems] = useState(periods);
  const [form, setForm] = useState<NonWorkingPeriod>(blank);
  const [year, setYear] = useState(new Date().getFullYear());
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState("");
  const [hideHolidays, setHideHolidays] = useState(() => localStorage.getItem("chatTaskHideHolidaysInSettings") === "true");
  const sorted = useMemo(() => [...items].sort((a, b) => a.startDate.localeCompare(b.startDate)), [items]);
  const displayed = hideHolidays ? sorted.filter((item) => item.type !== "holiday") : sorted;
  const current = displayed.filter((item) => item.endDate >= todayValue());
  const past = displayed.filter((item) => item.endDate < todayValue()).reverse();
  const hiddenHolidayCount = hideHolidays ? sorted.filter((item) => item.type === "holiday").length : 0;
  const submit = () => {
    const endDate = form.endDate || form.startDate;
    if (!form.startDate || endDate < form.startDate) return alert("期間を正しく指定してください。");
    if (items.some((item) => item.id !== form.id && item.startDate <= endDate && item.endDate >= form.startDate)) return alert("既存の休暇・非稼働日と重複しています。");
    const saved = { ...form, id: form.id || generateId(), endDate };
    setItems((list) => form.id ? list.map((item) => item.id === form.id ? saved : item) : [...list, saved]); setForm(blank());
  };
  const importHolidays = async () => {
    if (year < 1955 || year > 2100) return alert("1955〜2100年を指定してください。");
    setImporting(true); setStatus("");
    try {
      const response = await fetch(`https://holidays-jp.github.io/api/v1/${year}/date.json`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const source = await response.json() as Record<string, string>;
      let added = 0, skipped = 0; const next = [...items];
      Object.entries(source).filter(([date]) => date.startsWith(`${year}-`)).forEach(([date, name]) => {
        if (next.some((item) => item.startDate <= date && item.endDate >= date)) skipped += 1;
        else { next.push({ id: generateId(), startDate: date, endDate: date, type: "holiday", note: name }); added += 1; }
      });
      setItems(next); setStatus(`${added}件追加${skipped ? `・${skipped}件重複` : ""}`);
    } catch { setStatus("取得できませんでした"); alert("祝日データを取得できませんでした。インターネット接続を確認してください。"); }
    finally { setImporting(false); }
  };
  const row = (item: NonWorkingPeriod) => <div className="non-working-row" key={item.id}><span className="tag-chip">{typeLabel[item.type]}</span><strong>{item.startDate === item.endDate ? item.startDate : `${item.startDate}〜${item.endDate}`}</strong><span>{item.note}</span><button onClick={() => setForm({ ...item, endDate: item.endDate === item.startDate ? "" : item.endDate })}>編集</button><button className="danger-text" onClick={() => setItems(items.filter((value) => value.id !== item.id))}>削除</button></div>;
  return <Modal title="休暇・非稼働日設定" onClose={onClose} wide><div className="holiday-import"><label>対象年<input type="number" min="1955" max="2100" value={year} onChange={(event) => setYear(Number(event.target.value))} /></label><button className="primary" disabled={importing} onClick={importHolidays}>{importing ? "取得中..." : "日本の祝日を取り込む"}</button><label className="holiday-visibility"><input type="checkbox" checked={hideHolidays} onChange={(event) => { setHideHolidays(event.target.checked); localStorage.setItem("chatTaskHideHolidaysInSettings", String(event.target.checked)); }} />祝日を一覧で非表示</label><span>{status}</span></div>{hiddenHolidayCount > 0 && <p className="holiday-hidden-notice">祝日 {hiddenHolidayCount}件を非表示にしています。祝日としての判定は継続します。</p>}<div className="non-working-list">{current.map(row)}{!current.length && <p className="empty-list">今後の休暇・非稼働日はありません。</p>}{past.length > 0 && <details><summary>過去の休暇・非稼働日 {past.length}件</summary>{past.map(row)}</details>}</div><div className="non-working-form"><WorkDatePicker ariaLabel="休暇の開始日" value={form.startDate} onChange={(startDate) => setForm({ ...form, startDate })} allowClear={false} /><span>〜</span><WorkDatePicker ariaLabel="休暇の終了日" min={form.startDate} value={form.endDate} onChange={(endDate) => setForm({ ...form, endDate })} /><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as NonWorkingPeriod["type"] })}><option value="vacation">休暇</option><option value="holiday">祝日</option><option value="other">非稼働日</option></select><input value={form.note || ""} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="メモ（任意）" /><button className="primary" onClick={submit}>{form.id ? "更新" : "追加"}</button>{form.id && <button onClick={() => setForm(blank())}>取消</button>}</div><div className="modal-actions"><button onClick={onClose}>キャンセル</button><button className="primary" onClick={() => { onSave(items); onClose(); }}>保存</button></div></Modal>;
}
