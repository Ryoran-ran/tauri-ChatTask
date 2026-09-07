import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { NonWorkingPeriod } from "../types";
import { addDays, getNonWorkingPeriod, todayValue } from "../utils";

const NonWorkingPeriodsContext = createContext<NonWorkingPeriod[]>([]);

export function NonWorkingPeriodsProvider({ periods, children }: { periods: NonWorkingPeriod[]; children: ReactNode }) {
  return <NonWorkingPeriodsContext.Provider value={periods}>{children}</NonWorkingPeriodsContext.Provider>;
}

const monthValue = (date: string) => date.slice(0, 7);
const shiftMonth = (month: string, offset: number) => {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
};
const dateLabel = (date: string) => date ? `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日` : "日付を選択";
const holidayLabel = (period: ReturnType<typeof getNonWorkingPeriod>) => {
  if (!period) return "";
  const type = period.type === "weekend" ? "土日休暇" : period.type === "holiday" ? "祝日" : period.type === "vacation" ? "休暇" : "非稼働日";
  return period.note ? `${type}・${period.note}` : type;
};

export function WorkDatePicker({ value, onChange, ariaLabel, min, max, allowClear = true, autoFocus = false, disabled = false, className = "", formatValue, showNonWorkingStatus = true, pickerMode = "day" }: { value: string; onChange: (value: string) => void; ariaLabel: string; min?: string; max?: string; allowClear?: boolean; autoFocus?: boolean; disabled?: boolean; className?: string; formatValue?: (value: string) => string; showNonWorkingStatus?: boolean; pickerMode?: "day" | "month" | "year" }) {
  const periods = useContext(NonWorkingPeriodsContext);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthValue(value || todayValue()));
  const [viewMode, setViewMode] = useState<"day" | "month" | "year">(pickerMode);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 304 });
  const rootRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLElement>(null);
  const selectedPeriod = pickerMode === "day" && showNonWorkingStatus && value ? getNonWorkingPeriod(value, periods) : null;
  useEffect(() => { if (value) setMonth(monthValue(value)); }, [value]);
  useEffect(() => { setViewMode(pickerMode); setOpen(false); }, [pickerMode]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !calendarRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = rootRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const width = Math.min(Math.max(trigger.width, 304), window.innerWidth - 16);
      const height = calendarRef.current?.getBoundingClientRect().height || 390;
      const left = Math.max(8, Math.min(trigger.left, window.innerWidth - width - 8));
      const below = window.innerHeight - trigger.bottom - 8;
      const top = below >= height ? trigger.bottom + 6 : Math.max(8, trigger.top - height - 6);
      setPosition({ top, left, width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, month, pickerMode, viewMode]);
  const days = useMemo(() => {
    const first = `${month}-01`;
    const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
    return Array.from({ length: 42 }, (_, index) => addDays(first, index - weekday));
  }, [month]);
  const choose = (date: string) => {
    if ((min && date < min) || (max && date > max)) return;
    onChange(date);
    setOpen(false);
  };
  const pickerYear = Number(month.slice(0, 4));
  const yearChoices = Array.from({ length: 12 }, (_, index) => pickerYear - 5 + index);
  const shiftPicker = (direction: -1 | 1) => setMonth(viewMode === "day" ? shiftMonth(month, direction) : viewMode === "month" ? shiftMonth(month, direction * 12) : shiftMonth(month, direction * 12 * 12));
  const togglePicker = () => {
    if (open) setOpen(false);
    else { setViewMode(pickerMode); setOpen(true); }
  };
  return <div className={`work-date-picker ${className}`} ref={rootRef}>
    <button autoFocus={autoFocus} type="button" disabled={disabled} className={`work-date-trigger ${selectedPeriod ? "is-non-working" : ""}`} aria-label={ariaLabel} aria-expanded={open} onClick={togglePicker}><span>{value ? formatValue?.(value) || dateLabel(value) : "未設定"}</span><b aria-hidden="true">▦</b></button>
    {selectedPeriod && <small className="work-date-warning">{dateLabel(value)}は{holidayLabel(selectedPeriod)}です</small>}
    {open && createPortal(<section ref={calendarRef} className="work-date-calendar" style={{ top: position.top, left: position.left, width: position.width }} role="dialog" aria-label={`${ariaLabel}のカレンダー`}>
      <header><button type="button" aria-label={viewMode === "day" ? "前月" : viewMode === "month" ? "前年" : "前の年一覧"} onClick={() => shiftPicker(-1)}>‹</button>{viewMode === "year" ? <strong>{yearChoices[0]}〜{yearChoices[yearChoices.length - 1]}年</strong> : <button type="button" className="work-date-period-switch" aria-label={viewMode === "day" ? "月を選択" : "年を選択"} onClick={() => setViewMode(viewMode === "day" ? "month" : "year")}>{viewMode === "day" ? `${pickerYear}年 ${Number(month.slice(5, 7))}月` : `${pickerYear}年`}<span aria-hidden="true">▦</span></button>}<button type="button" aria-label={viewMode === "day" ? "翌月" : viewMode === "month" ? "翌年" : "次の年一覧"} onClick={() => shiftPicker(1)}>›</button></header>
      {viewMode === "day" && <><div className="work-date-weekdays"><span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span></div>
      <div className="work-date-days">{days.map((date) => {
        const period = getNonWorkingPeriod(date, periods);
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
        const disabled = Boolean((min && date < min) || (max && date > max));
        const outside = monthValue(date) !== month;
        return <button type="button" key={date} disabled={disabled} title={holidayLabel(period) || date} className={`${outside ? "is-outside" : ""} ${date === todayValue() ? "is-today" : ""} ${date === value ? "is-selected" : ""} ${period ? period.type === "weekend" ? weekday === 6 ? "is-saturday" : "is-sunday" : "is-registered-holiday" : ""}`} onClick={() => choose(date)}><span>{Number(date.slice(8, 10))}</span>{period && <i aria-hidden="true" />}</button>;
      })}</div></>}
      {viewMode === "month" && <div className="work-date-months">{Array.from({ length: 12 }, (_, index) => {
        const monthNumber = index + 1;
        const candidate = `${pickerYear}-${String(monthNumber).padStart(2, "0")}-01`;
        const selected = value.slice(0, 7) === candidate.slice(0, 7);
        return <button type="button" className={selected ? "is-selected" : ""} key={candidate} onClick={() => { if (pickerMode === "day") { setMonth(candidate.slice(0, 7)); setViewMode("day"); } else choose(candidate); }}>{monthNumber}月</button>;
      })}</div>}
      {viewMode === "year" && <div className="work-date-years">{yearChoices.map((year) => {
        const candidate = `${year}-01-01`;
        return <button type="button" className={value.slice(0, 4) === String(year) ? "is-selected" : ""} key={year} onClick={() => { if (pickerMode === "year") choose(candidate); else { setMonth(`${year}-${month.slice(5, 7)}`); setViewMode("month"); } }}>{year}年</button>;
      })}</div>}
      <footer>{pickerMode === "day" ? <div className="work-date-legend"><span className="saturday">土曜</span><span className="holiday">日曜・祝日・休暇</span></div> : <div />}<div>{allowClear && value && <button type="button" onClick={() => { onChange(""); setOpen(false); }}>{pickerMode === "day" ? "日付" : pickerMode === "month" ? "月" : "年"}を消す</button>}<button type="button" onClick={() => { setMonth(monthValue(todayValue())); choose(todayValue()); }}>{pickerMode === "day" ? "今日" : pickerMode === "month" ? "今月" : "今年"}</button></div></footer>
    </section>, document.body)}
  </div>;
}
