import { useMemo, useState } from "react";
import { STATUS_LABELS, isTerminalStatus } from "../data/constants";
import type { RelatedTaskLink, Task } from "../types";
import { Modal } from "./Modal";

type Tab = "linked" | "suggested" | "search";
const RELATION_LABELS: Record<RelatedTaskLink["relation"], string> = { reference: "参考", previous: "前回対応", handover: "引き継ぎ元" };
const searchableText = (task: Task) => [task.title, task.description, ...task.history.map((item) => item.text)].join(" ").toLowerCase();
const bigrams = (value: string) => {
  const normalized = value.replace(/[\s\p{P}\p{S}]/gu, "");
  const result = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2));
  return result;
};
const similarity = (source: Task, candidate: Task) => {
  const left = bigrams(searchableText(source));
  const right = bigrams(searchableText(candidate));
  let overlap = 0;
  left.forEach((token) => { if (right.has(token)) overlap += 1; });
  const union = new Set([...left, ...right]).size || 1;
  return Math.round(overlap / union * 100) + (source.projectTagId && source.projectTagId === candidate.projectTagId ? 25 : 0) + (isTerminalStatus(candidate.status) ? 10 : 0);
};

export function RelatedTasksModal({ task, allTasks, onUpdate, onOpen, onClose }: { task: Task; allTasks: Task[]; onUpdate: (links: RelatedTaskLink[]) => void; onOpen: (id: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(task.relatedTasks.length ? "linked" : "suggested");
  const [query, setQuery] = useState("");
  const [relation, setRelation] = useState<RelatedTaskLink["relation"]>("reference");
  const linkedIds = new Set(task.relatedTasks.map((item) => item.taskId));
  const suggestions = useMemo(() => allTasks.filter((item) => item.id !== task.id && !linkedIds.has(item.id)).map((item) => ({ task: item, score: similarity(task, item) })).filter((item) => item.score >= 12).sort((a, b) => b.score - a.score).slice(0, 5), [task, allTasks]);
  const normalizedQuery = query.trim().toLowerCase();
  const searchResults = allTasks.filter((item) => item.id !== task.id && !linkedIds.has(item.id) && (!normalizedQuery || searchableText(item).includes(normalizedQuery))).sort((a, b) => Number(isTerminalStatus(b.status)) - Number(isTerminalStatus(a.status))).slice(0, 50);
  const add = (taskId: string) => onUpdate([...task.relatedTasks, { taskId, relation, linkedAt: new Date().toISOString() }]);
  const remove = (taskId: string) => onUpdate(task.relatedTasks.filter((item) => item.taskId !== taskId));
  const updateRelation = (taskId: string, next: RelatedTaskLink["relation"]) => onUpdate(task.relatedTasks.map((item) => item.taskId === taskId ? { ...item, relation: next } : item));
  const row = (candidate: Task, score?: number) => <article className="related-task-row" key={candidate.id}><button type="button" className="related-task-main" onClick={() => { onClose(); onOpen(candidate.id); }}><strong>{candidate.title || "無題のタスク"}</strong><small>{STATUS_LABELS[candidate.status]}{candidate.completedAt ? `・${candidate.completedAt.slice(0, 10)}` : ""}{score ? `・類似度 ${Math.min(100, score)}%` : ""}</small><p>{candidate.description || "説明はありません。"}</p></button><button type="button" className="related-task-link-button" onClick={() => add(candidate.id)}>紐づける</button></article>;
  return <Modal title="関連タスク" onClose={onClose} wide>
    <div className="related-tasks-modal">
      <header><div><strong>{task.title}</strong><small>過去の対応を参照し、必要なタスクだけ紐づけます。</small></div><label>関係性<select value={relation} onChange={(event) => setRelation(event.target.value as RelatedTaskLink["relation"])}>{Object.entries(RELATION_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></header>
      <nav><button className={tab === "linked" ? "active" : ""} onClick={() => setTab("linked")}>紐づけ済み <small>{task.relatedTasks.length}</small></button><button className={tab === "suggested" ? "active" : ""} onClick={() => setTab("suggested")}>類似候補</button><button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}>過去タスク検索</button></nav>
      {tab === "search" && <div className="related-task-search"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タスク名・説明・メモ・作業記録を検索..." /></div>}
      <div className="related-task-results">
        {tab === "linked" && task.relatedTasks.map((link) => { const linked = allTasks.find((item) => item.id === link.taskId); return linked ? <article className="related-task-row linked" key={link.taskId}><button type="button" className="related-task-main" onClick={() => { onClose(); onOpen(linked.id); }}><strong>{linked.title}</strong><small>{STATUS_LABELS[linked.status]}{linked.completedAt ? `・${linked.completedAt.slice(0, 10)}` : ""}</small><p>{linked.description || "説明はありません。"}</p></button><select aria-label={`${linked.title}との関係性`} value={link.relation} onChange={(event) => updateRelation(link.taskId, event.target.value as RelatedTaskLink["relation"])}>{Object.entries(RELATION_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button type="button" className="danger-text" onClick={() => remove(link.taskId)}>解除</button></article> : null; })}
        {tab === "suggested" && suggestions.map((item) => row(item.task, item.score))}
        {tab === "search" && searchResults.map((item) => row(item))}
        {tab === "linked" && !task.relatedTasks.length && <p className="related-task-empty">紐づけられたタスクはありません。</p>}
        {tab === "suggested" && !suggestions.length && <p className="related-task-empty">十分に似ている過去タスクは見つかりませんでした。検索から追加できます。</p>}
        {tab === "search" && !searchResults.length && <p className="related-task-empty">該当するタスクはありません。</p>}
      </div>
      <footer><span>紐づけても元のタスク内容は変更されません。</span><button type="button" onClick={onClose}>閉じる</button></footer>
    </div>
  </Modal>;
}
