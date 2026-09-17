import { useEffect, useMemo, useState } from "react";
import type { Goal, Habit, HabitArea, HabitRecordStatus, ProjectTag } from "../types";
import { addDays, generateId } from "../utils";
import { Modal } from "./Modal";

const AREA_LABELS: Record<HabitArea, string> = {
  health: "健康",
  learning: "学び",
  life: "生活",
  mind: "心",
  hobby: "趣味",
  other: "その他",
};
const AREA_ICONS: Record<HabitArea, string> = { health: "♥", learning: "本", life: "家", mind: "○", hobby: "★", other: "・" };
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

type HabitDraft = Pick<Habit, "title" | "area" | "projectTagId" | "projectId" | "targetPerWeek" | "weekdays" | "minimumAction">;
const emptyDraft = (): HabitDraft => ({ title: "", area: "health", projectTagId: "", projectId: "", targetPerWeek: 3, weekdays: [], minimumAction: "" });
const weekdayOf = (date: string) => new Date(`${date}T12:00:00`).getDay();
const weekStartOf = (date: string) => addDays(date, -((weekdayOf(date) + 6) % 7));

export function HabitsPanel({ habits, projects, tags, date, onChange }: { habits: Habit[]; projects: Goal[]; tags: ProjectTag[]; date: string; onChange: (habits: Habit[]) => void }) {
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerView, setManagerView] = useState<"tracker" | "settings">("tracker");
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState<HabitDraft>(emptyDraft);
  const [feedback, setFeedback] = useState<{ habitId: string; message: string } | null>(null);
  const day = weekdayOf(date);
  const weekStart = weekStartOf(date);
  const weekEnd = addDays(weekStart, 6);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const activeProjects = projects.filter((project) => !["achieved", "archived", "cancelled"].includes(project.status));
  const visibleHabits = useMemo(() => habits
    .filter((habit) => habit.active)
    .filter((habit) => !habit.weekdays.length || habit.weekdays.includes(day) || habit.records.some((record) => record.date === date))
    .sort((a, b) => a.area.localeCompare(b.area) || a.title.localeCompare(b.title, "ja")), [date, day, habits]);
  const weeklyDone = (habit: Habit) => habit.records.filter((record) => record.status === "done" && record.date >= weekStart && record.date <= weekEnd).length;
  const recordFor = (habit: Habit) => habit.records.find((record) => record.date === date);
  const todayDone = visibleHabits.filter((habit) => recordFor(habit)?.status === "done").length;
  const todayRest = visibleHabits.filter((habit) => recordFor(habit)?.status === "rest").length;
  const todayPending = visibleHabits.length - todayDone - todayRest;
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 3200);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  useEffect(() => { setFeedback(null); }, [date]);
  const setRecord = (habit: Habit, status?: HabitRecordStatus) => {
    const now = new Date().toISOString();
    const records = habit.records.filter((record) => record.date !== date);
    if (status) records.push({ date, status, updatedAt: now });
    onChange(habits.map((item) => item.id === habit.id ? { ...item, records: records.sort((a, b) => a.date.localeCompare(b.date)), updatedAt: now } : item));
    if (status === "done") {
      const count = records.filter((record) => record.status === "done" && record.date >= weekStart && record.date <= weekEnd).length;
      const remaining = Math.max(0, habit.targetPerWeek - count);
      setFeedback({ habitId: habit.id, message: remaining ? `今週 ${count}/${habit.targetPerWeek}回。目標まであと${remaining}回` : `今週${habit.targetPerWeek}回の目標を達成しました！` });
    } else setFeedback(null);
  };
  const startCreate = () => { setManagerView("settings"); setEditingId(""); setDraft(emptyDraft()); };
  const startEdit = (habit: Habit) => {
    setManagerView("settings");
    setEditingId(habit.id);
    setDraft({ title: habit.title, area: habit.area, projectTagId: habit.projectTagId, projectId: habit.projectId, targetPerWeek: habit.targetPerWeek, weekdays: [...habit.weekdays], minimumAction: habit.minimumAction });
  };
  const saveHabit = () => {
    const title = draft.title.trim();
    if (!title) return;
    const now = new Date().toISOString();
    if (editingId) {
      onChange(habits.map((habit) => habit.id === editingId ? { ...habit, ...draft, title, targetPerWeek: Math.min(7, Math.max(1, draft.targetPerWeek)), updatedAt: now } : habit));
    } else {
      onChange([...habits, { id: generateId(), ...draft, title, targetPerWeek: Math.min(7, Math.max(1, draft.targetPerWeek)), active: true, records: [], createdAt: now, updatedAt: now }]);
    }
    startCreate();
  };
  const removeHabit = (habit: Habit) => {
    if (!window.confirm(`習慣「${habit.title}」と記録を削除しますか？`)) return;
    onChange(habits.filter((item) => item.id !== habit.id));
    if (editingId === habit.id) startCreate();
  };

  return <>
    <section className="today-habits-panel">
      <header><div><span aria-hidden="true">↻</span><div><strong>今日の習慣</strong><small>{visibleHabits.length ? todayPending ? `あと${todayPending}件。小さく始めて前へ進みましょう` : todayDone ? "今日の習慣を記録できました" : "今日は休息日として記録しました" : "続けたい行動を登録できます"}</small></div></div><div className="today-habit-summary"><span><b>{todayDone}</b><small>実施</small></span><span><b>{todayRest}</b><small>休み</small></span><span><b>{todayPending}</b><small>未記録</small></span></div><button type="button" className="habit-manage-button" onClick={() => { setManagerView("tracker"); setManagerOpen(true); }}><span aria-hidden="true">▦</span>習慣トラッカー</button></header>
      {feedback && <div className="habit-achievement-feedback" role="status"><span aria-hidden="true">✓</span><div><strong>いい調子です</strong><small>{feedback.message}</small></div><button type="button" onClick={() => setFeedback(null)} aria-label="メッセージを閉じる">×</button></div>}
      {visibleHabits.length ? <div className="today-habit-list">{visibleHabits.map((habit) => {
        const record = recordFor(habit);
        const count = weeklyDone(habit);
        const rate = Math.min(100, Math.round((count / habit.targetPerWeek) * 100));
        const project = projects.find((item) => item.id === habit.projectId);
        const tag = tags.find((item) => item.id === habit.projectTagId);
        return <article key={habit.id} className={`today-habit-card area-${habit.area} ${record ? `is-${record.status}` : ""} ${feedback?.habitId === habit.id ? "is-celebrating" : ""}`}>
          <div className="today-habit-icon" aria-hidden="true">{AREA_ICONS[habit.area]}</div>
          <div className="today-habit-content"><div><small>{[AREA_LABELS[habit.area], tag?.name, project?.title].filter(Boolean).join("・")}</small><strong>{habit.title}</strong>{habit.minimumAction && <span className="habit-minimum-action"><b>まずは</b>{habit.minimumAction}</span>}</div><div className="today-habit-progress"><span><i style={{ width: `${rate}%` }} /></span><small>{count >= habit.targetPerWeek ? "今週の目標達成" : `今週 ${count}/${habit.targetPerWeek}回・あと${habit.targetPerWeek - count}回`}</small></div><div className="today-habit-week" aria-label={`${habit.title}の今週の記録`}>{weekDates.map((weekDate, index) => { const weekRecord = habit.records.find((item) => item.date === weekDate); const scheduled = !habit.weekdays.length || habit.weekdays.includes(weekdayOf(weekDate)); return <span key={weekDate} className={`${weekRecord ? `is-${weekRecord.status}` : ""} ${weekDate === date ? "is-today" : ""} ${!scheduled ? "is-off" : ""}`} title={`${weekDate}：${weekRecord?.status === "done" ? "実施" : weekRecord?.status === "rest" ? "休み" : scheduled ? "未記録" : "対象外"}`}><small>{WEEKDAYS[(index + 1) % 7]}</small><i>{weekRecord?.status === "done" ? "✓" : weekRecord?.status === "rest" ? "−" : ""}</i></span>; })}</div></div>
          <div className="today-habit-actions">{record ? <><b>{record.status === "done" ? "✓ 実施済み" : "休息日"}</b><button type="button" onClick={() => setRecord(habit)}>取り消す</button></> : <><button type="button" onClick={() => setRecord(habit, "rest")}>今日は休む</button><button type="button" className="primary" onClick={() => setRecord(habit, "done")}>{habit.minimumAction ? "最低ラインを実施" : "実施した"}</button></>}</div>
        </article>;
      })}</div> : <div className="today-habits-empty"><span>↻</span><div><strong>今日の習慣はありません</strong><small>曜日を決めない習慣は毎日表示されます。</small></div><button type="button" className="habit-create-button" onClick={() => { startCreate(); setManagerOpen(true); }}><span aria-hidden="true">＋</span>最初の習慣を作る</button></div>}
    </section>
    {managerOpen && <Modal title="習慣トラッカー" onClose={() => setManagerOpen(false)} wide>
      <div className="habit-tracker-shell">
        <nav className="habit-tracker-tabs" aria-label="習慣トラッカーの表示"><button type="button" className={managerView === "tracker" ? "active" : ""} onClick={() => setManagerView("tracker")}><span aria-hidden="true">▦</span>記録を見る</button><button type="button" className={managerView === "settings" ? "active" : ""} onClick={() => setManagerView("settings")}><span aria-hidden="true">⚙</span>習慣を管理</button></nav>
        {managerView === "tracker" ? <section className="habit-tracker-overview"><header><div><small>THIS WEEK</small><h3>今週の積み重ね</h3><p>連続日数ではなく、今週の目標に対する前進を確認できます。</p></div><div><span><b>{habits.filter((habit) => habit.active).reduce((sum, habit) => sum + weeklyDone(habit), 0)}</b><small>今週の実施</small></span><span><b>{habits.filter((habit) => habit.active && weeklyDone(habit) >= habit.targetPerWeek).length}</b><small>目標達成</small></span><span><b>{habits.reduce((sum, habit) => sum + habit.records.filter((record) => record.status === "done").length, 0)}</b><small>累計実施</small></span></div></header><div className="habit-tracker-grid">{habits.filter((habit) => habit.active).map((habit) => { const count = weeklyDone(habit); const tag = tags.find((item) => item.id === habit.projectTagId); return <article key={habit.id} className={`area-${habit.area} ${count >= habit.targetPerWeek ? "is-achieved" : ""}`}><header><i>{AREA_ICONS[habit.area]}</i><div><small>{[AREA_LABELS[habit.area], tag?.name].filter(Boolean).join("・")}</small><strong>{habit.title}</strong></div><b>{count >= habit.targetPerWeek ? "目標達成" : `あと${habit.targetPerWeek - count}回`}</b></header>{habit.minimumAction && <p><span>最低ライン</span>{habit.minimumAction}</p>}<div className="habit-tracker-week">{weekDates.map((weekDate, index) => { const record = habit.records.find((item) => item.date === weekDate); const scheduled = !habit.weekdays.length || habit.weekdays.includes(weekdayOf(weekDate)); return <span key={weekDate} className={`${record ? `is-${record.status}` : ""} ${weekDate === date ? "is-today" : ""} ${!scheduled ? "is-off" : ""}`}><small>{WEEKDAYS[(index + 1) % 7]}</small><i>{record?.status === "done" ? "✓" : record?.status === "rest" ? "休" : scheduled ? "" : "·"}</i></span>; })}</div><footer><span><i style={{ width: `${Math.min(100, Math.round((count / habit.targetPerWeek) * 100))}%` }} /></span><small>今週 {count}/{habit.targetPerWeek}回</small><button type="button" onClick={() => startEdit(habit)}>設定</button></footer></article>; })}{!habits.some((habit) => habit.active) && <div className="habit-tracker-empty"><span>↻</span><strong>継続中の習慣はありません</strong><button type="button" className="primary" onClick={startCreate}>最初の習慣を作る</button></div>}</div></section> : <div className="habit-manager">
        <aside><header><div><strong>習慣一覧</strong><small>{habits.filter((habit) => habit.active).length}件を継続中</small></div><button type="button" className="habit-add-button" onClick={startCreate}><span aria-hidden="true">＋</span>新しい習慣</button></header><div>{habits.map((habit) => <article key={habit.id} className={editingId === habit.id ? "selected" : ""}><button type="button" onClick={() => startEdit(habit)}><i className={`area-${habit.area}`}>{AREA_ICONS[habit.area]}</i><span><strong>{habit.title}</strong><small>{[AREA_LABELS[habit.area], tags.find((tag) => tag.id === habit.projectTagId)?.name, `週${habit.targetPerWeek}回`, habit.active ? "" : "一時停止中"].filter(Boolean).join("・")}</small></span></button><button type="button" className="habit-delete" onClick={() => removeHabit(habit)} aria-label={`${habit.title}を削除`}>×</button></article>)}{!habits.length && <p>まだ習慣がありません。</p>}</div></aside>
        <section className="habit-editor"><header><small>{editingId ? "EDIT HABIT" : "NEW HABIT"}</small><h3>{editingId ? "習慣を編集" : "習慣を追加"}</h3><p>ゴールがなくても登録できます。プロジェクトとの関連付けは任意です。</p></header>
          <div className="habit-editor-fields"><label className="habit-title-field">習慣名<input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例：筋トレ" /></label><label>生活領域<select value={draft.area} onChange={(event) => setDraft({ ...draft, area: event.target.value as HabitArea })}>{Object.entries(AREA_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>週の目安<input type="number" min="1" max="7" value={draft.targetPerWeek} onChange={(event) => setDraft({ ...draft, targetPerWeek: Number(event.target.value) || 1 })} /><small>回／週</small></label><label>案件タグ（任意）<select value={draft.projectTagId} onChange={(event) => setDraft({ ...draft, projectTagId: event.target.value })}><option value="">設定しない</option>{tags.filter((tag) => tag.visible || tag.id === draft.projectTagId).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label><label>関連プロジェクト（任意）<select value={draft.projectId} onChange={(event) => { const projectId = event.target.value; const project = projects.find((item) => item.id === projectId); setDraft({ ...draft, projectId, projectTagId: project?.projectTagId || draft.projectTagId }); }}><option value="">紐づけない</option>{activeProjects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label><label className="habit-minimum-field">最低ライン（任意）<input value={draft.minimumAction} onChange={(event) => setDraft({ ...draft, minimumAction: event.target.value })} placeholder="例：5分だけでも実施" /></label><fieldset><legend>実施曜日（任意）</legend><p>未選択なら毎日、今日の習慣に表示します。</p><div>{WEEKDAYS.map((label, weekday) => <label key={label}><input type="checkbox" checked={draft.weekdays.includes(weekday)} onChange={(event) => setDraft({ ...draft, weekdays: event.target.checked ? [...draft.weekdays, weekday].sort() : draft.weekdays.filter((item) => item !== weekday) })} /><span>{label}</span></label>)}</div></fieldset></div>
          {editingId && <label className="habit-active-toggle"><input type="checkbox" checked={habits.find((habit) => habit.id === editingId)?.active !== false} onChange={(event) => onChange(habits.map((habit) => habit.id === editingId ? { ...habit, active: event.target.checked, updatedAt: new Date().toISOString() } : habit))} />この習慣を継続中にする</label>}
          <footer><button type="button" className="habit-editor-close" onClick={() => setManagerOpen(false)}>閉じる</button><button type="button" className="primary habit-editor-save" disabled={!draft.title.trim()} onClick={saveHabit}><span aria-hidden="true">{editingId ? "✓" : "＋"}</span>{editingId ? "変更を保存" : "習慣を追加"}</button></footer>
        </section>
      </div>}
      </div>
    </Modal>}
  </>;
}
