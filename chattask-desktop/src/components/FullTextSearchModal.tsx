import { useEffect, useMemo, useRef, useState } from "react";
import type { Goal, ProjectTag, Task, TaskDocument } from "../types";

export type FullTextSearchResult =
  | { id: string; kind: "task"; taskId: string; label: string; source: string; text: string }
  | { id: string; kind: "document"; scope: "task" | "project" | "tag"; ownerId: string; documentId: string; label: string; source: string; text: string };

const excerpt = (text: string, query: string) => {
  const normalized = text.toLocaleLowerCase("ja");
  const index = normalized.indexOf(query);
  const start = Math.max(0, index - 45);
  const end = Math.min(text.length, index + query.length + 75);
  return `${start ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
};

const highlighted = (text: string, query: string) => {
  const needle = query.trim();
  if (!needle) return text;
  const normalizedText = text.toLocaleLowerCase("ja");
  const normalizedNeedle = needle.toLocaleLowerCase("ja");
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let index = normalizedText.indexOf(normalizedNeedle);
  while (index >= 0) {
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(<mark key={`${index}-${parts.length}`}>{text.slice(index, index + needle.length)}</mark>);
    cursor = index + needle.length;
    index = normalizedText.indexOf(normalizedNeedle, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length ? parts : text;
};

const documentResults = (documents: TaskDocument[], query: string, scope: "task" | "project" | "tag", ownerId: string, ownerLabel: string): FullTextSearchResult[] =>
  documents.filter((document) => document.kind !== "folder" && `${document.title}\n${document.content}`.toLocaleLowerCase("ja").includes(query)).map((document) => ({
    id: `${scope}-${ownerId}-${document.id}`,
    kind: "document",
    scope,
    ownerId,
    documentId: document.id,
    label: document.title || "無題の文書",
    source: ownerLabel,
    text: excerpt(`${document.title}\n${document.content}`, query),
  }));

export function FullTextSearchModal({ tasks, projects, tags, onOpen, onClose }: { tasks: Task[]; projects: Goal[]; tags: ProjectTag[]; onOpen: (result: FullTextSearchResult, query: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ja");
    if (!normalized) return [];
    const found: FullTextSearchResult[] = [];
    tasks.forEach((task) => {
      const fields = [
        { source: "タスク名", text: task.title },
        { source: "メモ・説明", text: [task.description, task.nextAction, task.recurrenceMemoTemplate, ...Object.values(task.dailyPlans)].filter(Boolean).join("\n") },
        ...task.history.map((history) => ({ source: history.type === "comment" ? "メモ履歴" : "操作履歴", text: history.text })),
      ];
      fields.forEach((field, index) => {
        if (!field.text.toLocaleLowerCase("ja").includes(normalized)) return;
        found.push({ id: `task-${task.id}-${field.source}-${index}`, kind: "task", taskId: task.id, label: task.title || "無題のタスク", source: field.source, text: excerpt(field.text, normalized) });
      });
      found.push(...documentResults(task.documents, normalized, "task", task.id, `${task.title}・タスク専用文書`));
    });
    projects.forEach((project) => found.push(...documentResults(project.sharedDocuments || [], normalized, "project", project.id, `${project.title}・プロジェクト共有文書`)));
    tags.forEach((tag) => found.push(...documentResults(tag.sharedDocuments || [], normalized, "tag", tag.id, `${tag.name}・案件タグ共有文書`)));
    return found.slice(0, 200);
  }, [projects, query, tags, tasks]);
  useEffect(() => setActiveIndex(0), [query]);
  const choose = (result: FullTextSearchResult) => onOpen(result, query.trim());
  const moveSelection = (direction: -1 | 1) => {
    if (!results.length) return;
    const nextIndex = Math.max(0, Math.min(results.length - 1, activeIndex + direction));
    setActiveIndex(nextIndex);
    requestAnimationFrame(() => resultRefs.current[nextIndex]?.scrollIntoView({ block: "nearest" }));
  };
  return <div className="full-search-backdrop" onPointerDown={onClose}>
    <section className="full-search-modal" role="dialog" aria-modal="true" aria-label="全文横断検索" onPointerDown={(event) => event.stopPropagation()}>
      <header><div><strong>全文横断検索</strong><small>タスク・メモ・履歴・すべての文書を検索</small></div><button type="button" onClick={onClose}>×</button></header>
      <div className="full-search-input"><span>⌕</span><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "ArrowDown") { event.preventDefault(); moveSelection(1); }
        else if (event.key === "ArrowUp") { event.preventDefault(); moveSelection(-1); }
        else if (event.key === "Enter" && results[activeIndex]) { event.preventDefault(); choose(results[activeIndex]); }
        else if (event.key === "Escape") { event.preventDefault(); onClose(); }
      }} placeholder="検索する文字を入力…" /><kbd>⌘⇧F</kbd></div>
      <div className="full-search-results">
        {results.map((result, index) => <button ref={(element) => { resultRefs.current[index] = element; }} type="button" key={result.id} className={index === activeIndex ? "active" : ""} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(result)}>
          <i>{result.kind === "document" ? "文" : "T"}</i><span><strong>{highlighted(result.label, query)}</strong><small>{highlighted(result.source, query)}</small><p>{highlighted(result.text, query)}</p></span><b>開く</b>
        </button>)}
        {query.trim() && !results.length && <p className="full-search-empty">一致する内容はありません。</p>}
        {!query.trim() && <p className="full-search-empty">文字を入力すると、すべてのタスクと文書を横断して検索します。</p>}
      </div>
      <footer>{results.length ? `${results.length}件` : ""}<span>↑↓ 選択　Enter 開く　Esc 閉じる</span></footer>
    </section>
  </div>;
}
