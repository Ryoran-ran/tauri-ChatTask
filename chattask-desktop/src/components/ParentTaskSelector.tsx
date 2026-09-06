import { useState } from "react";
import { createPortal } from "react-dom";
import type { Task } from "../types";

interface Props {
  task: Task;
  candidates: Task[];
  onChange: (parentTaskId: string) => void;
}

export function ParentTaskSelector({ task, candidates, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const parent = candidates.find((item) => item.id === task.parentTaskId);
  const normalizedQuery = query.trim().toLowerCase();
  const matches = candidates.filter((item) => !normalizedQuery || `${item.title} ${item.description}`.toLowerCase().includes(normalizedQuery));
  const choose = (parentTaskId: string) => {
    onChange(parentTaskId);
    setOpen(false);
    setQuery("");
  };

  return <div className="parent-task-field">
    <small>親タスク</small>
    <button type="button" className="parent-task-trigger" onClick={() => setOpen(true)}><span>{parent?.title || "親タスクなし"}</span><b>{parent ? "変更" : "検索"}</b></button>
    {open && createPortal(<div className="linked-task-picker-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="linked-task-picker parent-task-picker" role="dialog" aria-modal="true" aria-label="親タスクを検索">
        <header><div><strong>親タスクを選択</strong><small>タスク名・説明で検索できます</small></div><button type="button" onClick={() => setOpen(false)}>×</button></header>
        <div className="linked-task-picker-search"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="親タスクを検索..." /></div>
        <div className="linked-task-picker-results"><section><h4>{normalizedQuery ? "検索結果" : "すべてのタスク"}</h4>
          {matches.map((item) => <button type="button" className={`linked-task-choice ${item.id === task.parentTaskId ? "selected" : ""}`} key={item.id} onClick={() => choose(item.id)}><span><strong>{item.title || "無題のタスク"}</strong><small>{item.description || "説明なし"}</small></span><span><b>{item.id === task.parentTaskId ? "選択中" : "選択"}</b></span></button>)}
          {!matches.length && <p>該当するタスクはありません。</p>}
        </section></div>
        <footer><button type="button" className="danger-text" disabled={!task.parentTaskId} onClick={() => choose("")}>親タスクとの関連を解除</button><button type="button" onClick={() => setOpen(false)}>キャンセル</button></footer>
      </section>
    </div>, document.body)}
  </div>;
}
