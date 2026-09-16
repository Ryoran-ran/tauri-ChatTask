import { useMemo, useState } from "react";
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
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState<HabitDraft>(emptyDraft);
  const day = weekdayOf(date);
  const weekStart = weekStartOf(date);
  const weekEnd = addDays(weekStart, 6);
  const activeProjects = projects.filter((project) => !["achieved", "archived", "cancelled"].includes(project.status));
  const visibleHabits = useMemo(() => habits
    .filter((habit) => habit.active)
    .filter((habit) => !habit.weekdays.length || habit.weekdays.includes(day) || habit.records.some((record) => record.date === date))
    .sort((a, b) => a.area.localeCompare(b.area) || a.title.localeCompare(b.title, "ja")), [date, day, habits]);
  const weeklyDone = (habit: Habit) => habit.records.filter((record) => record.status === "done" && record.date >= weekStart && record.date <= weekEnd).length;
  const recordFor = (habit: Habit) => habit.records.find((record) => record.date === date);
  const setRecord = (habit: Habit, status?: HabitRecordStatus) => {
    const now = new Date().toISOString();
    const records = habit.records.filter((record) => record.date !== date);
    if (status) records.push({ date, status, updatedAt: now });
    onChange(habits.map((item) => item.id === habit.id ? { ...item, records: records.sort((a, b) => a.date.localeCompare(b.date)), updatedAt: now } : item));
  };
  const startCreate = () => { setEditingId(""); setDraft(emptyDraft()); };
  const startEdit = (habit: Habit) => {
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
      <header><div><span aria-hidden="true">↻</span><div><strong>今日の習慣</strong><small>仕事の休日設定とは別に記録されます</small></div></div><button type="button" className="habit-manage-button" onClick={() => setManagerOpen(true)}><span aria-hidden="true">⚙</span>習慣を管理</button></header>
      {visibleHabits.length ? <div className="today-habit-list">{visibleHabits.map((habit) => {
        const record = recordFor(habit);
        const count = weeklyDone(habit);
        const rate = Math.min(100, Math.round((count / habit.targetPerWeek) * 100));
        const project = projects.find((item) => item.id === habit.projectId);
        const tag = tags.find((item) => item.id === habit.projectTagId);
        return <article key={habit.id} className={`today-habit-card area-${habit.area} ${record ? `is-${record.status}` : ""}`}>
          <div className="today-habit-icon" aria-hidden="true">{AREA_ICONS[habit.area]}</div>
          <div className="today-habit-content"><div><small>{[AREA_LABELS[habit.area], tag?.name, project?.title].filter(Boolean).join("・")}</small><strong>{habit.title}</strong>{habit.minimumAction && <span>最低ライン：{habit.minimumAction}</span>}</div><div className="today-habit-progress"><span><i style={{ width: `${rate}%` }} /></span><small>今週 {count}/{habit.targetPerWeek}回</small></div></div>
          <div className="today-habit-actions">{record ? <><b>{record.status === "done" ? "✓ 実施済み" : "休息日"}</b><button type="button" onClick={() => setRecord(habit)}>取り消す</button></> : <><button type="button" onClick={() => setRecord(habit, "rest")}>今日は休む</button><button type="button" className="primary" onClick={() => setRecord(habit, "done")}>実施した</button></>}</div>
        </article>;
      })}</div> : <div className="today-habits-empty"><span>↻</span><div><strong>今日の習慣はありません</strong><small>曜日を決めない習慣は毎日表示されます。</small></div><button type="button" className="habit-create-button" onClick={() => setManagerOpen(true)}><span aria-hidden="true">＋</span>最初の習慣を作る</button></div>}
    </section>
    {managerOpen && <Modal title="習慣を管理" onClose={() => setManagerOpen(false)} wide>
      <div className="habit-manager">
        <aside><header><div><strong>習慣一覧</strong><small>{habits.filter((habit) => habit.active).length}件を継続中</small></div><button type="button" className="habit-add-button" onClick={startCreate}><span aria-hidden="true">＋</span>新しい習慣</button></header><div>{habits.map((habit) => <article key={habit.id} className={editingId === habit.id ? "selected" : ""}><button type="button" onClick={() => startEdit(habit)}><i className={`area-${habit.area}`}>{AREA_ICONS[habit.area]}</i><span><strong>{habit.title}</strong><small>{[AREA_LABELS[habit.area], tags.find((tag) => tag.id === habit.projectTagId)?.name, `週${habit.targetPerWeek}回`, habit.active ? "" : "一時停止中"].filter(Boolean).join("・")}</small></span></button><button type="button" className="habit-delete" onClick={() => removeHabit(habit)} aria-label={`${habit.title}を削除`}>×</button></article>)}{!habits.length && <p>まだ習慣がありません。</p>}</div></aside>
        <section className="habit-editor"><header><small>{editingId ? "EDIT HABIT" : "NEW HABIT"}</small><h3>{editingId ? "習慣を編集" : "習慣を追加"}</h3><p>ゴールがなくても登録できます。プロジェクトとの関連付けは任意です。</p></header>
          <div className="habit-editor-fields"><label className="habit-title-field">習慣名<input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例：筋トレ" /></label><label>生活領域<select value={draft.area} onChange={(event) => setDraft({ ...draft, area: event.target.value as HabitArea })}>{Object.entries(AREA_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>週の目安<input type="number" min="1" max="7" value={draft.targetPerWeek} onChange={(event) => setDraft({ ...draft, targetPerWeek: Number(event.target.value) || 1 })} /><small>回／週</small></label><label>案件タグ（任意）<select value={draft.projectTagId} onChange={(event) => setDraft({ ...draft, projectTagId: event.target.value })}><option value="">設定しない</option>{tags.filter((tag) => tag.visible || tag.id === draft.projectTagId).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label><label>関連プロジェクト（任意）<select value={draft.projectId} onChange={(event) => { const projectId = event.target.value; const project = projects.find((item) => item.id === projectId); setDraft({ ...draft, projectId, projectTagId: project?.projectTagId || draft.projectTagId }); }}><option value="">紐づけない</option>{activeProjects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label><label className="habit-minimum-field">最低ライン（任意）<input value={draft.minimumAction} onChange={(event) => setDraft({ ...draft, minimumAction: event.target.value })} placeholder="例：5分だけでも実施" /></label><fieldset><legend>実施曜日（任意）</legend><p>未選択なら毎日、今日の習慣に表示します。</p><div>{WEEKDAYS.map((label, weekday) => <label key={label}><input type="checkbox" checked={draft.weekdays.includes(weekday)} onChange={(event) => setDraft({ ...draft, weekdays: event.target.checked ? [...draft.weekdays, weekday].sort() : draft.weekdays.filter((item) => item !== weekday) })} /><span>{label}</span></label>)}</div></fieldset></div>
          {editingId && <label className="habit-active-toggle"><input type="checkbox" checked={habits.find((habit) => habit.id === editingId)?.active !== false} onChange={(event) => onChange(habits.map((habit) => habit.id === editingId ? { ...habit, active: event.target.checked, updatedAt: new Date().toISOString() } : habit))} />この習慣を継続中にする</label>}
          <footer><button type="button" className="habit-editor-close" onClick={() => setManagerOpen(false)}>閉じる</button><button type="button" className="primary habit-editor-save" disabled={!draft.title.trim()} onClick={saveHabit}><span aria-hidden="true">{editingId ? "✓" : "＋"}</span>{editingId ? "変更を保存" : "習慣を追加"}</button></footer>
        </section>
      </div>
    </Modal>}
  </>;
}
