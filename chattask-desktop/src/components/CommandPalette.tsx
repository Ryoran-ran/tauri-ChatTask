import { useEffect, useMemo, useRef, useState } from "react";
import { STATUS_LABELS, isTerminalStatus } from "../data/constants";
import type { ProjectTag, Task } from "../types";

type TaskAction = "open" | "today" | "doing" | "waiting" | "done";
type Command = {
  id: string;
  icon: string;
  label: string;
  detail?: string;
  run: () => void;
};

interface Props {
  tasks: Task[];
  tags: ProjectTag[];
  initialTaskId?: string;
  position?: { x: number; y: number };
  onCreate: (title: string, today: boolean) => void;
  onOpenTask: (task: Task) => void;
  onTaskAction: (task: Task, action: Exclude<TaskAction, "open">) => void;
  onClose: () => void;
}

export function CommandPalette({ tasks, tags, initialTaskId, position, onCreate, onOpenTask, onTaskAction, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [targetId, setTargetId] = useState(initialTaskId || "");
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectionSource, setSelectionSource] = useState<"keyboard" | "pointer" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const target = tasks.find((task) => task.id === targetId);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActiveIndex(0); setSelectionSource(null); }, [query, targetId]);
  useEffect(() => {
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", closeWithEscape, true);
    return () => window.removeEventListener("keydown", closeWithEscape, true);
  }, [onClose]);

  const commands = useMemo<Command[]>(() => {
    const closeAfter = (run: () => void) => () => { run(); onClose(); };
    if (target) {
      const result: Command[] = [
        { id: "open", icon: "↗", label: "タスクを開く", detail: target.title, run: closeAfter(() => onOpenTask(target)) },
        { id: "today", icon: "今", label: "今日へ追加", detail: target.title, run: closeAfter(() => onTaskAction(target, "today")) },
        { id: "doing", icon: "▶", label: "進行中にする", detail: STATUS_LABELS[target.status], run: closeAfter(() => onTaskAction(target, "doing")) },
        { id: "waiting", icon: "…", label: "待ちにする", detail: STATUS_LABELS[target.status], run: closeAfter(() => onTaskAction(target, "waiting")) },
      ];
      if (target.status !== "recurring" && !isTerminalStatus(target.status)) result.push({ id: "done", icon: "✓", label: "完了にする", detail: STATUS_LABELS[target.status], run: closeAfter(() => onTaskAction(target, "done")) });
      return result;
    }

    const normalized = query.trim().toLowerCase();
    const matchingTasks = tasks
      .filter((task) => !normalized || [task.title, task.description, ...task.repositoryBranches.flatMap((group) => group.branchNames), tags.find((tag) => tag.id === task.projectTagId)?.name || ""].join(" ").toLowerCase().includes(normalized))
      .slice(0, 12);
    const result: Command[] = [];
    if (query.trim()) {
      result.push(
        { id: "create", icon: "＋", label: `「${query.trim()}」を作成`, detail: "通常タスク", run: closeAfter(() => onCreate(query.trim(), false)) },
        { id: "create-today", icon: "今", label: `「${query.trim()}」を作成`, detail: "今日へ追加", run: closeAfter(() => onCreate(query.trim(), true)) },
      );
    }
    result.push(...matchingTasks.map((task) => ({
      id: `task-${task.id}`,
      icon: task.priority,
      label: task.title || "無題のタスク",
      detail: `${tags.find((tag) => tag.id === task.projectTagId)?.name || "タグなし"}・${STATUS_LABELS[task.status]}`,
      run: () => { setTargetId(task.id); setQuery(""); },
    })));
    return result;
  }, [onClose, onCreate, onOpenTask, onTaskAction, query, tags, target, tasks]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-command-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const keyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (targetId && !query && (event.key === "ArrowLeft" || event.key === "Backspace")) { event.preventDefault(); setTargetId(""); }
    else if (event.key === "ArrowDown") { event.preventDefault(); setSelectionSource("keyboard"); setActiveIndex((value) => Math.min(commands.length - 1, value + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setSelectionSource("keyboard"); setActiveIndex((value) => Math.max(0, value - 1)); }
    else if (event.key === "Enter" && commands[activeIndex]) { event.preventDefault(); commands[activeIndex].run(); }
    else if (event.key === "Escape") { event.preventDefault(); onClose(); }
  };

  const style = position ? {
    left: Math.min(position.x, window.innerWidth - 500),
    top: Math.min(position.y, window.innerHeight - 520),
  } : undefined;

  return <div className="command-palette-backdrop" onPointerDown={onClose}>
    <section className={`command-palette ${position ? "from-context-menu" : ""}`} style={style} role="dialog" aria-modal="true" aria-label="クイック入力とコマンド" onPointerDown={(event) => event.stopPropagation()} onPointerLeave={() => { if (selectionSource === "pointer") setSelectionSource(null); }}>
      {target && <div className="command-target"><button type="button" title="検索へ戻る（← / Backspace）" aria-label="タスク検索へ戻る" onClick={() => setTargetId("")}>←</button><span><small>操作対象</small><strong>{target.title}</strong></span></div>}
      <div className="command-search"><span>⌕</span><input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); if (targetId) setTargetId(""); }} onKeyDown={keyDown} placeholder={target ? "操作を選択…" : "タスクを検索、または新しいタスク名を入力…"} /><kbd>Esc</kbd></div>
      <div className="command-list" ref={listRef} role="listbox">
        {commands.map((command, index) => <button type="button" key={command.id} data-command-index={index} className={selectionSource && index === activeIndex ? "active" : ""} onMouseEnter={() => { setSelectionSource("pointer"); setActiveIndex(index); }} onClick={command.run} role="option" aria-selected={Boolean(selectionSource && index === activeIndex)}>
          <i>{command.icon}</i><span>{command.label}</span>{command.detail && <small>{command.detail}</small>}
        </button>)}
        {!commands.length && <p>該当するタスクはありません。</p>}
      </div>
      <footer>{target && <span><kbd>←</kbd><kbd>⌫</kbd> 検索へ戻る</span>}<span><kbd>↑</kbd><kbd>↓</kbd> 選択</span><span><kbd>Enter</kbd> 実行</span><span><kbd>Esc</kbd> 閉じる</span></footer>
    </section>
  </div>;
}
