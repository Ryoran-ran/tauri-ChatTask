import { useEffect, useRef, useState } from "react";
import type { GithubRepository, TaskChecklistItem, TaskCodeReviewRun } from "../types";
import { generateId } from "../utils";
import { Modal } from "./Modal";

type ReviewRecord = {
  category?: unknown;
  severity?: unknown;
  file?: unknown;
  location?: unknown;
  title?: unknown;
  reason?: unknown;
  suggestion?: unknown;
};

const cleanText = (value: string) => value
  .replace(/`([^`]*)`/g, "$1")
  .replace(/\*\*([^*]*)\*\*/g, "$1")
  .trim();

const parseJsonChecklist = (text: string): TaskChecklistItem[] | null => {
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned) as { reviews?: ReviewRecord[] } | ReviewRecord[];
    const reviews = Array.isArray(parsed) ? parsed : parsed.reviews;
    if (!Array.isArray(reviews)) return null;
    const now = new Date().toISOString();
    return reviews.flatMap((review) => {
      const title = String(review.title || "").trim();
      if (!title) return [];
      const file = String(review.file || "").trim();
      const location = String(review.location || "").trim();
      const rawSeverity = String(review.severity || "").toLowerCase();
      const severity = (["high", "medium", "low"].includes(rawSeverity) ? rawSeverity : undefined) as TaskChecklistItem["severity"];
      const reason = String(review.reason || "").trim();
      const suggestion = String(review.suggestion || "").trim();
      return [{ id: generateId(), title, file: file || undefined, location: location || undefined, category: String(review.category || "その他"), details: "", reason: reason || undefined, suggestion: suggestion || undefined, severity, reviewStatus: "pending", completed: false, createdAt: now }];
    });
  } catch {
    return null;
  }
};

const parseMarkdownChecklist = (text: string): TaskChecklistItem[] => {
  const items: TaskChecklistItem[] = [];
  const now = new Date().toISOString();
  let category = "その他";
  let current: TaskChecklistItem | null = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^#{2,6}\s+(?:■\s*)?(.+?)\s*$/);
    if (heading) {
      category = cleanText(heading[1]).replace(/^[^\p{L}\p{N}]+/u, "") || "その他";
      current = null;
      continue;
    }
    const checkbox = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/);
    if (checkbox) {
      current = { id: generateId(), title: cleanText(checkbox[2]), category, details: "", reviewStatus: checkbox[1].toLowerCase() === "x" ? "completed" : "pending", completed: checkbox[1].toLowerCase() === "x", createdAt: now };
      if (current.completed) current.completedAt = now;
      items.push(current);
      continue;
    }
    if (current && /^\s*>/.test(line)) {
      const detail = cleanText(line.replace(/^\s*>\s?/, ""));
      if (detail) current.details = current.details ? `${current.details}\n${detail}` : detail;
    }
  }
  return items;
};

export const parseReviewChecklist = (text: string) => parseJsonChecklist(text) ?? parseMarkdownChecklist(text);
const itemKey = (item: Pick<TaskChecklistItem, "category" | "title">) => `${item.category.trim().toLowerCase()}\n${item.title.trim().toLowerCase()}`;
const severityLabel = { high: "高", medium: "中", low: "低" } as const;
const legacyTitleParts = (item: TaskChecklistItem) => !item.file && !item.location ? item.title.match(/^(.+[/\\][^:]*)\s+\/\s+([^:]+):\s+(.+)$/) : null;
const displayFile = (item: TaskChecklistItem) => item.file || legacyTitleParts(item)?.[1] || "";
const displayCodeLocation = (item: TaskChecklistItem) => item.location || legacyTitleParts(item)?.[2] || "";
const displayLocation = (item: TaskChecklistItem) => [item.file, item.location].filter(Boolean).join(" › ") || (() => { const parts = legacyTitleParts(item); return parts ? `${parts[1]} › ${parts[2]}` : ""; })();
const displayTitle = (item: TaskChecklistItem) => legacyTitleParts(item)?.[3] || item.title;
const itemStatus = (item: TaskChecklistItem) => item.reviewStatus || (item.completed ? "completed" : "pending");
const detailParts = (item: TaskChecklistItem) => {
  const reasonMatch = item.details.match(/指摘理由:\s*([\s\S]*?)(?=\n修正案:|$)/);
  const suggestionMatch = item.details.match(/修正案:\s*([\s\S]*)$/);
  const reason = item.reason || reasonMatch?.[1]?.trim() || "";
  const suggestion = item.suggestion || suggestionMatch?.[1]?.trim() || "";
  return { reason, suggestion, other: !reason && !suggestion ? item.details.trim() : "" };
};

export function TaskReviewChecklist({ items, runs = [], repositories: configuredRepositories = [], selectedRepositoryId = "", onSelectRepository, onChange, allowImport = true }: { items: TaskChecklistItem[]; runs?: TaskCodeReviewRun[]; repositories?: GithubRepository[]; selectedRepositoryId?: string; onSelectRepository?: (repositoryId: string) => void; onChange: (items: TaskChecklistItem[], historyText?: string) => void; allowImport?: boolean }) {
  const [importOpen, setImportOpen] = useState(false);
  const [source, setSource] = useState("");
  const [message, setMessage] = useState("");
  const [copiedAction, setCopiedAction] = useState("");
  const copiedTimer = useRef<number | null>(null);
  const repositories = [...new Map([...configuredRepositories.map((repository) => [repository.id || "unassigned", repository.name || "リポジトリ未設定"] as const), ...runs.map((run) => [run.repositoryId || "unassigned", run.repositoryName || "リポジトリ未設定"] as const), ...items.map((item) => [item.repositoryId || "unassigned", item.repositoryName || "リポジトリ未設定"] as const)]).entries()];
  const activeRepositoryKey = selectedRepositoryId === "unassigned" ? "unassigned" : selectedRepositoryId || configuredRepositories[0]?.id || repositories[0]?.[0] || "unassigned";
  const scopedItems = items.filter((item) => (item.repositoryId || "unassigned") === activeRepositoryKey);
  const scopedRuns = runs.filter((run) => (run.repositoryId || "unassigned") === activeRepositoryKey);
  const activeItems = scopedItems.filter((item) => !["completed", "ignored"].includes(itemStatus(item)));
  const closedItems = scopedItems.filter((item) => ["completed", "ignored"].includes(itemStatus(item)));
  const inProgress = activeItems.filter((item) => itemStatus(item) === "in-progress").length;
  const pending = activeItems.length - inProgress;
  const repositoryActiveCount = (repositoryId: string) => items.filter((item) => (item.repositoryId || "unassigned") === repositoryId && !["completed", "ignored"].includes(itemStatus(item))).length;

  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
  }, []);

  const copyItemText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAction(key);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopiedAction(""), 1800);
    } catch {
      setCopiedAction(`${key}:error`);
    }
  };

  const aiQuestionText = (item: TaskChecklistItem) => [
    "次のコードレビュー指摘について、適切な修正方法を検討してください。",
    "",
    item.repositoryName && `リポジトリ: ${item.repositoryName}`,
    displayFile(item) && `ファイル: ${displayFile(item)}`,
    displayCodeLocation(item) && `場所: ${displayCodeLocation(item)}`,
    `チェック項目: ${displayTitle(item)}`,
    detailParts(item).reason && `指摘理由: ${detailParts(item).reason}`,
    detailParts(item).suggestion && `修正案: ${detailParts(item).suggestion}`,
    detailParts(item).other,
  ].filter((line) => line !== "").join("\n");

  const importItems = () => {
    const parsed = parseReviewChecklist(source);
    if (!parsed.length) {
      setMessage("チェック項目を見つけられませんでした。JSONまたは「- [ ]」形式を確認してください。");
      return;
    }
    const existing = new Set(items.map(itemKey));
    const additions = parsed.filter((item) => !existing.has(itemKey(item)));
    if (!additions.length) {
      setMessage("すべて取り込み済みです。");
      return;
    }
    onChange([...items, ...additions], `コードレビューへ${additions.length}件取り込みました。`);
    setImportOpen(false);
    setSource("");
    setMessage("");
  };

  const pasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) throw new Error("empty");
      setSource(text);
      setMessage("");
    } catch {
      setMessage("クリップボードを読み取れませんでした。入力欄へ貼り付けてください。");
    }
  };

  const renderItem = (item: TaskChecklistItem) => <article className={itemStatus(item)} key={item.id}>
    <div className="review-checklist-item-main"><span>{displayLocation(item) && <code>{displayLocation(item)}</code>}<strong>{displayTitle(item)}</strong><small>{item.repositoryName && <em className="review-repository-badge">{item.repositoryName}</em>}<em>{item.category}</em>{item.severity && <em className={`severity-${item.severity}`}>重要度 {severityLabel[item.severity]}</em>}{(item.reviewOccurrenceCount || item.reviewRunIds?.length || 1) > 1 && <em className="review-repeat-badge">再指摘 {(item.reviewOccurrenceCount || item.reviewRunIds?.length || 1) - 1}回</em>}</small></span></div>
    <select className={`review-checklist-status status-${itemStatus(item)}`} aria-label={`${displayTitle(item)}の対応状態`} value={itemStatus(item)} onChange={(event) => { const reviewStatus = event.target.value as NonNullable<TaskChecklistItem["reviewStatus"]>; const isCompleted = reviewStatus === "completed"; onChange(items.map((current) => current.id === item.id ? { ...current, reviewStatus, completed: isCompleted, completedAt: isCompleted ? new Date().toISOString() : undefined } : current)); }}><option value="pending">未対応</option><option value="in-progress">対応中</option><option value="completed">対応済み</option><option value="ignored">対応しない</option></select>
    <button type="button" className="danger-text" aria-label={`${item.title}を削除`} onClick={() => onChange(items.filter((current) => current.id !== item.id))}>×</button>
    <div className="review-checklist-item-actions">{displayFile(item) && <button type="button" onClick={() => void copyItemText(`${item.id}:file`, displayFile(item))}>{copiedAction === `${item.id}:file` ? "コピー済み" : copiedAction === `${item.id}:file:error` ? "コピー失敗" : "ファイルをコピー"}</button>}<button type="button" className="ai-copy" onClick={() => void copyItemText(`${item.id}:ai`, aiQuestionText(item))}>{copiedAction === `${item.id}:ai` ? "コピー済み" : copiedAction === `${item.id}:ai:error` ? "コピー失敗" : "AI質問用にコピー"}</button></div>
    {(item.details || item.reason || item.suggestion) && <details><summary>指摘理由・修正案</summary><div className="review-checklist-details">{detailParts(item).reason && <section className="reason"><strong>指摘理由</strong><p>{detailParts(item).reason}</p></section>}{detailParts(item).suggestion && <section className="suggestion"><strong>修正案</strong><p>{detailParts(item).suggestion}</p></section>}{detailParts(item).other && <section><strong>詳細</strong><p>{detailParts(item).other}</p></section>}</div></details>}
  </article>;

  return <>
    <section className="task-review-checklist">
      <header><div><strong>現在の対応</strong><small>{activeItems.length ? `${inProgress ? `対応中${inProgress}件・` : ""}未対応${pending}件` : "対応が必要な指摘はありません"}</small></div><div className="review-checklist-header-actions">{allowImport && <button type="button" onClick={() => { setMessage(""); setImportOpen(true); }}>＋ 取り込む</button>}</div></header>
      {!!repositories.length && <nav className="review-repository-tabs" aria-label="リポジトリ別チェックリスト">{repositories.map(([id, name]) => <button type="button" className={activeRepositoryKey === id ? "active" : ""} onClick={() => onSelectRepository?.(id)} key={id}>{name} <small>{repositoryActiveCount(id)}</small></button>)}</nav>}
      {!!activeItems.length && <div className="task-review-checklist-items current-review-items">{activeItems.map(renderItem)}</div>}
      {!items.length && <p>Git Diff Studioのレビュー結果を取り込むと、ここで進捗を確認できます。</p>}
      {!!items.length && !scopedItems.length && <p>選択したリポジトリのチェック項目はありません。</p>}
      {!!scopedItems.length && !activeItems.length && <p>この範囲に対応が必要な指摘はありません。</p>}
      {!!closedItems.length && <details className="review-closed-section"><summary>完了・対象外 <small>{closedItems.length}件</small></summary><div className="task-review-checklist-items">{closedItems.map(renderItem)}</div></details>}
      {!!scopedRuns.length && <section className="review-history-section"><header><strong>過去のレビュー</strong><small>{scopedRuns.length}回</small></header><div>{[...scopedRuns].reverse().map((run) => {
        const repositoryRuns = runs.filter((candidate) => (candidate.repositoryId || "unassigned") === (run.repositoryId || "unassigned"));
        const runNumber = repositoryRuns.findIndex((candidate) => candidate.id === run.id) + 1;
        const runItems = run.itemIds.map((id) => items.find((item) => item.id === id)).filter((item): item is TaskChecklistItem => Boolean(item));
        return <details className="review-run-card" key={run.id}><summary><span><strong>第{runNumber}回</strong><em>{run.repositoryName || "リポジトリ未設定"}</em></span><span>{run.baseBranch} → {run.targetBranch}</span><small>{new Date(run.createdAt).toLocaleString("ja-JP")}・指摘{run.itemIds.length}件</small></summary>{runItems.length ? <ul>{runItems.map((item) => <li key={item.id}><span className={`review-history-status ${itemStatus(item)}`}>{itemStatus(item) === "in-progress" ? "対応中" : itemStatus(item) === "completed" ? "対応済み" : itemStatus(item) === "ignored" ? "対象外" : "未対応"}</span><span>{displayTitle(item)}</span></li>)}</ul> : <p>このレビューの指摘は削除されています。</p>}</details>;
      })}</div></section>}
    </section>
    {allowImport && importOpen && <Modal title="コードレビューを取り込む" onClose={() => setImportOpen(false)}>
      <div className="review-checklist-import"><div><button type="button" onClick={() => void pasteClipboard()}>クリップボードから貼付</button><small>Git Diff Studioで生成したJSON、またはMarkdownチェックリストに対応しています。</small></div><textarea autoFocus rows={14} value={source} onChange={(event) => { setSource(event.target.value); setMessage(""); }} placeholder={'AIのJSON回答、または\n- [ ] 確認する内容\nを貼り付けてください。'} />{message && <p>{message}</p>}</div>
      <div className="modal-actions"><button type="button" onClick={() => setImportOpen(false)}>キャンセル</button><button type="button" className="primary" disabled={!source.trim()} onClick={importItems}>コードレビューに追加</button></div>
    </Modal>}
  </>;
}
