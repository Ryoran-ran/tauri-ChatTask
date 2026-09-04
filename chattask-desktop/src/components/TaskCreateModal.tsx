import { useState } from "react";
import { createPortal } from "react-dom";
import { PRIORITIES, STATUS_GROUPS, STATUS_LABELS } from "../data/constants";
import type { PlannedRange, ProjectTag, Task, TaskDocument, TaskTemplate } from "../types";
import { addDays, generateId, todayValue } from "../utils";
import { Modal } from "./Modal";
import { WorkDatePicker } from "./WorkDatePicker";

type TaskCreateValues = Pick<Task, "title" | "description" | "nextAction" | "status" | "priority" | "projectTagId" | "parentTaskId" | "reminderDate" | "dueDate" | "plannedRanges" | "unscheduledPlans" | "plannedHours" | "recurrence" | "recurrenceMemoTemplate" | "links" | "documents">;

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function TaskCreateModal({ tasks, tags, templates, parentId, projectTagId, onCreate, onClose }: {
  tasks: Task[];
  tags: ProjectTag[];
  templates: TaskTemplate[];
  parentId: string;
  projectTagId?: string;
  onCreate: (values: TaskCreateValues) => void;
  onClose: () => void;
}) {
  const parent = tasks.find((task) => task.id === parentId);
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    nextAction: "",
    status: "todo" as Task["status"],
    priority: "B" as Task["priority"],
    projectTagId: parent?.projectTagId || projectTagId || "",
    parentTaskId: parentId,
    reminderDate: "",
    dueDate: "",
    rangeTitle: "",
    rangeDescription: "",
    rangeStatus: "not-started" as NonNullable<PlannedRange["status"]>,
    startDate: "",
    endDate: "",
    plannedHours: "",
    recurrenceFrequency: "weekly" as "daily" | "weekly" | "monthly",
    recurrenceWeekday: new Date().getDay(),
    recurrenceMonthDay: new Date().getDate(),
    recurrenceMonthlyType: "date" as "date" | "weekday",
    recurrenceWeekOfMonth: 1,
    recurrenceStartDate: todayValue(),
    recurrenceEndDate: "",
    recurrenceMemoTemplate: "",
  });
  const [parentPickerOpen, setParentPickerOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TaskTemplate | null>(null);
  const [parentQuery, setParentQuery] = useState("");
  const parentCandidates = tasks;
  const selectedParent = parentCandidates.find((task) => task.id === draft.parentTaskId);
  const normalizedParentQuery = parentQuery.trim().toLocaleLowerCase("ja");
  const parentMatches = parentCandidates.filter((task) => !normalizedParentQuery || [task.title, task.description]
    .some((value) => String(value || "").toLocaleLowerCase("ja").includes(normalizedParentQuery)));
  const chooseParent = (parentTaskId: string) => {
    setDraft((current) => ({ ...current, parentTaskId }));
    setParentPickerOpen(false);
    setParentQuery("");
  };
  const templateQuery = draft.title.trim().toLocaleLowerCase("ja");
  const templateMatches = templateQuery && !selectedTemplate ? templates.filter((template) => [template.name, template.title, ...template.keywords].some((value) => value.toLocaleLowerCase("ja").includes(templateQuery) || templateQuery.includes(value.toLocaleLowerCase("ja")))).slice(0, 3) : [];
  const applyTemplate = (template: TaskTemplate) => {
    setSelectedTemplate(template);
    setDraft((current) => ({ ...current, title: template.title, description: template.description, nextAction: template.nextAction, priority: template.priority, projectTagId: projectTagId === undefined ? template.projectTagId : current.projectTagId, plannedHours: template.plannedHours ? String(template.plannedHours) : "" }));
  };
  const cloneDocuments = (documents: TaskDocument[]) => {
    const idMap = new Map(documents.map((document) => [document.id, generateId()]));
    const now = new Date().toISOString();
    return documents.map((document) => ({ ...document, id: idMap.get(document.id)!, parentId: document.parentId ? idMap.get(document.parentId) || "" : "", createdAt: now, updatedAt: now }));
  };
  const submit = () => {
    if (!draft.title.trim()) return;
    if (draft.status === "recurring" && draft.recurrenceEndDate && draft.recurrenceEndDate < draft.recurrenceStartDate) {
      window.alert("定期タスクの終了日は開始日以降にしてください。");
      return;
    }
    const endDate = draft.endDate || draft.startDate;
    if (draft.startDate && endDate < draft.startDate) {
      window.alert("終了日は開始日以降にしてください。");
      return;
    }
    const plannedHours = Math.max(0, Number(draft.plannedHours) || 0);
    const plannedRanges: PlannedRange[] = draft.startDate ? [{
      id: generateId(),
      startDate: draft.startDate,
      endDate,
      title: draft.rangeTitle.trim(),
      description: draft.rangeDescription,
      plannedHours,
      status: draft.rangeStatus,
      completedAt: draft.rangeStatus === "completed" ? new Date().toISOString() : undefined,
    }] : [];
    const recurring = draft.status === "recurring";
    onCreate({
      title: draft.title.trim(),
      description: draft.description,
      nextAction: draft.nextAction,
      status: draft.status,
      priority: draft.priority,
      projectTagId: draft.projectTagId,
      parentTaskId: draft.parentTaskId,
      reminderDate: recurring ? "" : draft.reminderDate,
      dueDate: recurring ? "" : draft.dueDate,
      plannedRanges: recurring ? [] : plannedRanges,
      unscheduledPlans: recurring ? [] : (selectedTemplate?.schedules || []).filter((schedule) => schedule.startOffsetDays === undefined).map((schedule, index) => ({ ...schedule, id: generateId(), startDate: "", endDate: "", sortOrder: index, status: "not-started", completedAt: undefined })),
      ...(!recurring && selectedTemplate ? { plannedRanges: [...plannedRanges, ...(selectedTemplate.schedules || []).filter((schedule) => schedule.startOffsetDays !== undefined).map((schedule, index) => { const startDate = addDays(todayValue(), schedule.startOffsetDays || 0); const endDate = addDays(todayValue(), schedule.endOffsetDays ?? schedule.startOffsetDays ?? 0); return { ...schedule, id: generateId(), startDate, endDate, sortOrder: plannedRanges.length + index, status: "not-started" as const, completedAt: undefined }; })] } : {}),
      plannedHours,
      recurrence: recurring ? {
        frequency: draft.recurrenceFrequency,
        weekday: draft.recurrenceFrequency === "weekly" || (draft.recurrenceFrequency === "monthly" && draft.recurrenceMonthlyType === "weekday") ? draft.recurrenceWeekday : undefined,
        monthDay: draft.recurrenceFrequency === "monthly" && draft.recurrenceMonthlyType === "date" ? draft.recurrenceMonthDay : undefined,
        monthlyType: draft.recurrenceFrequency === "monthly" ? draft.recurrenceMonthlyType : undefined,
        weekOfMonth: draft.recurrenceFrequency === "monthly" && draft.recurrenceMonthlyType === "weekday" ? draft.recurrenceWeekOfMonth : undefined,
        startDate: draft.recurrenceStartDate || todayValue(),
        endDate: draft.recurrenceEndDate,
        paused: false,
      } : null,
      recurrenceMemoTemplate: recurring ? draft.recurrenceMemoTemplate : "",
      links: (selectedTemplate?.links || []).map((link) => ({ ...link, id: generateId() })),
      documents: cloneDocuments(selectedTemplate?.documents || []),
    });
  };
  const recurring = draft.status === "recurring";
  return <Modal title={parent ? `「${parent.title}」の子タスクを作成` : "新規タスクを作成"} onClose={onClose}>
    <div className="task-create-form">
      <label className="task-create-title">タスク名<input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="タスク名を入力" /></label>
      {templateMatches.length > 0 && <section className="task-template-suggestions" aria-label="タスクテンプレート候補"><header><strong>テンプレート候補</strong><small>選択すると手順書・資料もセットします</small></header>{templateMatches.map((template) => <button type="button" key={template.id} onClick={() => applyTemplate(template)}><span><strong>{template.name}</strong><small>{tags.find((tag) => tag.id === template.projectTagId)?.name || "タグなし"}・予定 {template.plannedHours || 0}h</small></span><b>{template.documents.length}資料</b></button>)}</section>}
      {selectedTemplate && <div className="task-template-applied" role="status"><span>✓</span><strong>「{selectedTemplate.name}」を適用中</strong><small>{(selectedTemplate.schedules || []).length}予定・{selectedTemplate.documents.length}資料・{selectedTemplate.links.length}リンク</small><button type="button" onClick={() => setSelectedTemplate(null)}>解除</button></div>}
      <label className="task-create-description">説明<textarea rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="対応内容や完了条件" /></label>
      <div className="task-create-grid">
        <label>ステータス<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Task["status"] })}>{STATUS_GROUPS.filter((group) => group.label !== "終了").map((group) => <optgroup key={group.label} label={group.label}>{group.values.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</optgroup>)}</select></label>
        <label>優先度<select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Task["priority"] })}>{PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>
        {projectTagId === undefined && <label>案件タグ（任意）<select value={draft.projectTagId} onChange={(event) => setDraft({ ...draft, projectTagId: event.target.value })}><option value="">設定しない</option>{tags.filter((tag) => tag.visible || tag.id === draft.projectTagId).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>}
        <div className="task-create-parent-field"><span>親タスク</span><button type="button" className="parent-task-trigger" onClick={() => setParentPickerOpen(true)}><span>{selectedParent?.title || "親タスクなし"}</span><b>{selectedParent ? "変更" : "検索"}</b></button></div>
        {!recurring && <label>期限・通知日<WorkDatePicker ariaLabel="期限・通知日" value={draft.dueDate || draft.reminderDate} onChange={(date) => setDraft({ ...draft, dueDate: date, reminderDate: date })} /></label>}
        {recurring && <label>1回の予定工数（時間）<input type="number" min="0" step="0.25" value={draft.plannedHours} onChange={(event) => setDraft({ ...draft, plannedHours: event.target.value })} placeholder="例: 2" /></label>}
      </div>
      {recurring ? <fieldset className="task-create-recurrence"><legend>定期タスク設定</legend>
        <div className="task-create-recurrence-grid">
          <label>繰り返し<select value={draft.recurrenceFrequency} onChange={(event) => setDraft({ ...draft, recurrenceFrequency: event.target.value as typeof draft.recurrenceFrequency })}><option value="daily">毎日</option><option value="weekly">毎週</option><option value="monthly">毎月</option></select></label>
          {draft.recurrenceFrequency === "weekly" && <label>曜日<select value={draft.recurrenceWeekday} onChange={(event) => setDraft({ ...draft, recurrenceWeekday: Number(event.target.value) })}>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}曜日</option>)}</select></label>}
          {draft.recurrenceFrequency === "monthly" && <label>指定方法<select value={draft.recurrenceMonthlyType} onChange={(event) => setDraft({ ...draft, recurrenceMonthlyType: event.target.value as typeof draft.recurrenceMonthlyType })}><option value="date">日付で指定</option><option value="weekday">第○・○曜日で指定</option></select></label>}
          {draft.recurrenceFrequency === "monthly" && draft.recurrenceMonthlyType === "date" && <label>毎月の日付<input type="number" min="1" max="31" value={draft.recurrenceMonthDay} onChange={(event) => setDraft({ ...draft, recurrenceMonthDay: Math.min(31, Math.max(1, Number(event.target.value) || 1)) })} /></label>}
          {draft.recurrenceFrequency === "monthly" && draft.recurrenceMonthlyType === "weekday" && <><label>週<select value={draft.recurrenceWeekOfMonth} onChange={(event) => setDraft({ ...draft, recurrenceWeekOfMonth: Number(event.target.value) })}><option value={1}>第1</option><option value={2}>第2</option><option value={3}>第3</option><option value={4}>第4</option><option value={5}>第5</option><option value={-1}>最終</option></select></label><label>曜日<select value={draft.recurrenceWeekday} onChange={(event) => setDraft({ ...draft, recurrenceWeekday: Number(event.target.value) })}>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}曜日</option>)}</select></label></>}
          <label>開始日<WorkDatePicker ariaLabel="定期タスクの開始日" value={draft.recurrenceStartDate} onChange={(recurrenceStartDate) => setDraft({ ...draft, recurrenceStartDate })} allowClear={false} /></label>
          <label>終了日（任意）<WorkDatePicker ariaLabel="定期タスクの終了日" min={draft.recurrenceStartDate} value={draft.recurrenceEndDate} onChange={(recurrenceEndDate) => setDraft({ ...draft, recurrenceEndDate })} /></label>
        </div>
        <label>対応メモのテンプレート<textarea rows={3} value={draft.recurrenceMemoTemplate} onChange={(event) => setDraft({ ...draft, recurrenceMemoTemplate: event.target.value })} placeholder="各回の「この日の対応メモ」に最初から表示する内容" /></label>
        <small>定期タスク本体は完了にせず、今日のページで各回を「実施済み」「スキップ」「別日に移動」として記録します。</small>
      </fieldset> : <fieldset className="task-create-dates"><legend>最初の予定（任意）</legend>
        <div className="task-create-schedule-main">
          <label>予定の題名<input value={draft.rangeTitle} onChange={(event) => setDraft({ ...draft, rangeTitle: event.target.value })} placeholder="例：資料作成" /></label>
          <label>予定工数（時間）<input type="number" min="0" step="0.25" value={draft.plannedHours} onChange={(event) => setDraft({ ...draft, plannedHours: event.target.value })} placeholder="例：2" /></label>
          <label>予定の状態<select value={draft.rangeStatus} onChange={(event) => setDraft({ ...draft, rangeStatus: event.target.value as typeof draft.rangeStatus })}><option value="not-started">未着手</option><option value="in-progress">進行中</option><option value="completed">完了</option></select></label>
          <label className="task-create-schedule-description">予定の説明<textarea rows={2} value={draft.rangeDescription} onChange={(event) => setDraft({ ...draft, rangeDescription: event.target.value })} placeholder="実施内容や完了条件など" /></label>
        </div>
        <div className="task-create-schedule-dates"><label>開始日<WorkDatePicker ariaLabel="予定の開始日" value={draft.startDate} onChange={(startDate) => setDraft({ ...draft, startDate })} /></label><span>〜</span><label>終了日（任意）<WorkDatePicker ariaLabel="予定の終了日" min={draft.startDate} value={draft.endDate} onChange={(endDate) => setDraft({ ...draft, endDate })} /></label></div>
        <small>詳細画面の予定と同じ内容で登録します。終了日を空欄にすると開始日の1日だけ登録します。</small>
      </fieldset>}
      <div className="task-create-actions"><button type="button" onClick={onClose}>キャンセル</button><button type="button" className="primary" disabled={!draft.title.trim()} onClick={submit}>タスクを作成</button></div>
    </div>
    {parentPickerOpen && createPortal(<div className="linked-task-picker-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setParentPickerOpen(false); }}>
      <section className="linked-task-picker parent-task-picker" role="dialog" aria-modal="true" aria-label="親タスクを検索">
        <header><div><strong>親タスクを選択</strong><small>タスク名・説明で検索できます</small></div><button type="button" aria-label="閉じる" onClick={() => setParentPickerOpen(false)}>×</button></header>
        <div className="linked-task-picker-search"><input autoFocus value={parentQuery} onChange={(event) => setParentQuery(event.target.value)} placeholder="親タスクを検索..." /></div>
        <div className="linked-task-picker-results"><section><h4>{normalizedParentQuery ? "検索結果" : "すべてのタスク"}</h4>
          {parentMatches.map((task) => <button type="button" className={`linked-task-choice ${task.id === draft.parentTaskId ? "selected" : ""}`} key={task.id} onClick={() => chooseParent(task.id)}><span><strong>{task.title || "無題のタスク"}</strong><small>{task.description || "説明なし"}</small></span><span><b>{task.id === draft.parentTaskId ? "選択中" : "選択"}</b></span></button>)}
          {!parentMatches.length && <p>該当するタスクはありません。</p>}
        </section></div>
        <footer><button type="button" className="danger-text" disabled={!draft.parentTaskId} onClick={() => chooseParent("")}>親タスクを設定しない</button><button type="button" onClick={() => setParentPickerOpen(false)}>キャンセル</button></footer>
      </section>
    </div>, document.body)}
  </Modal>;
}
