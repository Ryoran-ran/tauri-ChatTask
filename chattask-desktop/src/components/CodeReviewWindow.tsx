import { useEffect, useMemo, useRef, useState } from "react";
import type { GithubRepository, Task, TaskChecklistItem } from "../types";
import { generateId } from "../utils";
import { parseReviewChecklist, TaskReviewChecklist } from "./TaskReviewChecklist";

const reviewPoints = [
  ["bug", "バグ・ロジック"],
  ["security", "セキュリティ"],
  ["performance", "パフォーマンス"],
  ["readability", "可読性・保守性"],
  ["test", "テスト不足"],
] as const;

const checklistKey = (item: Pick<TaskChecklistItem, "category" | "title" | "file" | "location">) => [item.category, item.file || "", item.location || "", item.title].map((value) => value.trim().toLowerCase()).join("\n");
const isEmptyReviewResult = (text: string) => {
  try {
    const parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as { reviews?: unknown[] } | unknown[];
    return Array.isArray(parsed) ? parsed.length === 0 : Array.isArray(parsed.reviews) && parsed.reviews.length === 0;
  } catch {
    return false;
  }
};

const buildReviewPrompt = (task: Task, repository: GithubRepository | undefined, diff: string, base: string, target: string, selectedPoints: string[]) => `あなたはシニアソフトウェアエンジニアです。次のGit Diffをコードレビューし、実際に対応すべき指摘だけを抽出してください。

変更された全ファイルと全差分ブロックを順番に確認してください。指摘件数に上限は設けず、互いに独立した問題は省略せず、それぞれ別のレビュー項目として漏れなく列挙してください。ただし、同じ原因による重複指摘や根拠の弱い推測は追加しないでください。

## 対象作業
${task.title}

## 対象リポジトリ
${repository ? `${repository.name}${repository.url ? ` (${repository.url})` : ""}` : "未設定"}

## 比較
${base || "base"} → ${target || "target"}

## 確認観点
${reviewPoints.filter(([id]) => selectedPoints.includes(id)).map(([, label]) => `- ${label}`).join("\n") || "- 総合的に確認"}

## 出力形式
説明文は付けず、次のJSONだけを必ず \`\`\`json のコードブロックで囲んで返してください。
\`\`\`json
{
  "reviews": [
    {
      "category": "バグ・ロジック",
      "severity": "high | medium | low",
      "file": "src/example.ts",
      "location": "該当行または関数名",
      "title": "対応内容を短く記載",
      "reason": "問題となる理由",
      "suggestion": "具体的な修正案"
    }
  ]
}
\`\`\`
問題がなければ、同じコードブロック形式で {"reviews": []} を返してください。

## Git Diff
${diff}`;

export function CodeReviewWindow({ task, repositories, onUpdate }: { task: Task; repositories: GithubRepository[]; onUpdate: (changes: Partial<Task>, historyText?: string) => void }) {
  const taskId = task.id;
  const viewStorageKey = `chatTaskCodeReviewView:${taskId}`;
  const repositoryStorageKey = `chatTaskCodeReviewRepository:${taskId}`;
  const [activeView, setActiveView] = useState<"prompt" | "checklist">(() => localStorage.getItem(viewStorageKey) === "checklist" ? "checklist" : "prompt");
  const [selectedRepositoryId, setSelectedRepositoryId] = useState(() => {
    const saved = localStorage.getItem(repositoryStorageKey) || "";
    return saved === "unassigned" || repositories.some((repository) => repository.id === saved) ? saved : repositories[0]?.id || "";
  });
  const branchStorageKey = `chatTaskCodeReviewBranches:${taskId}:${selectedRepositoryId || "unassigned"}`;
  const initialBranches = (() => {
    try { return JSON.parse(localStorage.getItem(branchStorageKey) || "{}") as { base?: string; target?: string }; } catch { return {}; }
  })();
  const [base, setBase] = useState(initialBranches.base || "main");
  const [target, setTarget] = useState(initialBranches.target || "");
  const [customTargetOpen, setCustomTargetOpen] = useState(Boolean(initialBranches.target));
  const [diff, setDiff] = useState("");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState("");
  const [message, setMessage] = useState("");
  const [commandCopied, setCommandCopied] = useState(false);
  const commandCopiedTimer = useRef<number | null>(null);
  const [selectedPoints, setSelectedPoints] = useState<string[]>(reviewPoints.map(([id]) => id));

  const checklist = task.reviewChecklist || [];
  const selectedRepository = repositories.find((repository) => repository.id === selectedRepositoryId);
  const completed = useMemo(() => checklist.filter((item) => (item.reviewStatus || (item.completed ? "completed" : "pending")) === "completed").length, [checklist]);
  const ignored = useMemo(() => checklist.filter((item) => item.reviewStatus === "ignored").length, [checklist]);
  const inProgress = useMemo(() => checklist.filter((item) => item.reviewStatus === "in-progress").length, [checklist]);
  const reviewed = completed + ignored;
  const diffCommand = `git --no-pager diff ${base.trim() || "main"}...${target.trim() || "HEAD"} | pbcopy`;

  useEffect(() => () => {
    if (commandCopiedTimer.current !== null) window.clearTimeout(commandCopiedTimer.current);
  }, []);

  useEffect(() => {
    localStorage.setItem(branchStorageKey, JSON.stringify({ base, target }));
  }, [base, branchStorageKey, target]);

  useEffect(() => {
    if (selectedRepositoryId && selectedRepositoryId !== "unassigned" && !repositories.some((repository) => repository.id === selectedRepositoryId)) {
      setSelectedRepositoryId(repositories[0]?.id || "");
    }
  }, [repositories, selectedRepositoryId]);

  const selectView = (view: "prompt" | "checklist") => {
    setActiveView(view);
    localStorage.setItem(viewStorageKey, view);
  };

  const updateChecklist = (items: TaskChecklistItem[], historyText?: string) => {
    onUpdate({ reviewChecklist: items }, historyText);
  };

  const selectRepository = (repositoryId: string) => {
    localStorage.setItem(branchStorageKey, JSON.stringify({ base, target }));
    const nextKey = `chatTaskCodeReviewBranches:${taskId}:${repositoryId || "unassigned"}`;
    let saved: { base?: string; target?: string } = {};
    try { saved = JSON.parse(localStorage.getItem(nextKey) || "{}"); } catch { saved = {}; }
    setSelectedRepositoryId(repositoryId);
    setBase(saved.base || "main");
    setTarget(saved.target || "");
    setCustomTargetOpen(Boolean(saved.target));
    localStorage.setItem(repositoryStorageKey, repositoryId);
    setPrompt("");
    setMessage("");
  };

  const generatePrompt = () => {
    if (!diff.trim()) {
      setMessage("Git Diffを入力してください。");
      return;
    }
    setPrompt(buildReviewPrompt(task, selectedRepository, diff.trim(), base.trim(), target.trim(), selectedPoints));
    setMessage("AIへ渡すプロンプトを作成しました。");
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setMessage("プロンプトをコピーしました。");
    } catch {
      setMessage("コピーできませんでした。テキスト欄からコピーしてください。");
    }
  };

  const copyDiffCommand = async () => {
    try {
      await navigator.clipboard.writeText(diffCommand);
      setMessage("");
      setCommandCopied(true);
      if (commandCopiedTimer.current !== null) window.clearTimeout(commandCopiedTimer.current);
      commandCopiedTimer.current = window.setTimeout(() => setCommandCopied(false), 1800);
    } catch {
      setMessage("コマンドをコピーできませんでした。");
    }
  };

  const pasteDiff = async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) {
        setMessage("クリップボードに差分がありません。");
        return;
      }
      setDiff(clipboardText);
      setMessage("クリップボードからGit Diffを貼り付けました。");
    } catch {
      setMessage("クリップボードを読み取れませんでした。入力欄へ直接貼り付けてください。");
    }
  };

  const importResult = () => {
    const parsed = parseReviewChecklist(result);
    const noFindings = isEmptyReviewResult(result);
    if (!parsed.length && !noFindings) {
      setMessage("チェック項目を見つけられませんでした。AIの回答形式を確認してください。");
      return;
    }
    const runId = generateId();
    const createdAt = new Date().toISOString();
    const repositoryId = selectedRepository?.id || "";
    const seen = new Set<string>();
    const uniqueItems = parsed.filter((item) => {
      const key = checklistKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const nextChecklist = [...checklist];
    const runItemIds: string[] = [];
    let addedCount = 0;
    let repeatedCount = 0;
    uniqueItems.forEach((parsedItem) => {
      const existingIndex = nextChecklist.findIndex((item) => (item.repositoryId || "") === repositoryId && checklistKey(item) === checklistKey(parsedItem));
      if (existingIndex >= 0) {
        const existing = nextChecklist[existingIndex];
        const previousRunIds = existing.reviewRunIds?.length ? existing.reviewRunIds : existing.reviewRunId ? [existing.reviewRunId] : [];
        const existingStatus = existing.reviewStatus || (existing.completed ? "completed" : "pending");
        nextChecklist[existingIndex] = {
          ...existing,
          file: parsedItem.file || existing.file,
          location: parsedItem.location || existing.location,
          reason: parsedItem.reason || existing.reason,
          suggestion: parsedItem.suggestion || existing.suggestion,
          severity: parsedItem.severity || existing.severity,
          repositoryId: selectedRepository?.id,
          repositoryName: selectedRepository?.name || "リポジトリ未設定",
          reviewRunIds: [...new Set([...previousRunIds, runId])],
          reviewOccurrenceCount: Math.max(1, existing.reviewOccurrenceCount || previousRunIds.length || 1) + 1,
          lastReviewedAt: createdAt,
          reviewStatus: ["completed", "ignored"].includes(existingStatus) ? "pending" : existingStatus,
          completed: false,
          completedAt: undefined,
        };
        runItemIds.push(existing.id);
        repeatedCount += 1;
        return;
      }
      const nextItem: TaskChecklistItem = {
        ...parsedItem,
        repositoryId: selectedRepository?.id,
        repositoryName: selectedRepository?.name || "リポジトリ未設定",
        reviewRunId: runId,
        reviewRunIds: [runId],
        reviewOccurrenceCount: 1,
        lastReviewedAt: createdAt,
      };
      nextChecklist.push(nextItem);
      runItemIds.push(nextItem.id);
      addedCount += 1;
    });
    onUpdate({
      reviewChecklist: nextChecklist,
      codeReviewRuns: [...(task.codeReviewRuns || []), {
        id: runId,
        repositoryId,
        repositoryName: selectedRepository?.name || "リポジトリ未設定",
        baseBranch: base.trim() || "main",
        targetBranch: target.trim() || "HEAD",
        itemIds: runItemIds,
        createdAt,
      }],
    }, `${selectedRepository?.name || "リポジトリ未設定"}のコードレビューを取り込みました（${noFindings ? "指摘なし" : `新規${addedCount}件${repeatedCount ? `・再指摘${repeatedCount}件` : ""}`}）。`);
    setResult("");
    setMessage(noFindings ? "指摘なしのレビューとして履歴に保存しました。" : `新規${addedCount}件${repeatedCount ? `、再指摘${repeatedCount}件` : ""}を取り込みました。`);
    selectView("checklist");
  };

  return <main className="code-review-window">
    <header className="code-review-window-header">
      <div><span>CODE REVIEW</span><h1>コードレビュー</h1><p>{task.title}</p></div>
      <div className="code-review-progress"><small>確認進捗</small><strong>{reviewed}<span> / {checklist.length}</span></strong></div>
    </header>

    <nav className="code-review-view-tabs" aria-label="コードレビュー画面">
      <button type="button" className={activeView === "prompt" ? "active" : ""} aria-pressed={activeView === "prompt"} onClick={() => selectView("prompt")}><span>⌘</span><div><strong>プロンプト生成</strong><small>Diffからレビュー結果を作成</small></div></button>
      <button type="button" className={activeView === "checklist" ? "active" : ""} aria-pressed={activeView === "checklist"} onClick={() => selectView("checklist")}><span>✓</span><div><strong>チェックリスト</strong><small>{checklist.length ? `${inProgress ? `${inProgress}件対応中・` : ""}未対応${checklist.length - reviewed - inProgress}件` : "レビュー結果の対応を管理"}</small></div></button>
    </nav>

    {activeView === "prompt" && <div className="code-review-workspace">
      <section className="code-review-input-panel">
        <header><strong>1. 差分を準備</strong><small>比較対象とGit Diffを入力</small></header>
        <label className="code-review-repository">対象リポジトリ<select value={selectedRepositoryId} onChange={(event) => selectRepository(event.target.value)} disabled={!repositories.length}>{!repositories.length && <option value="">リポジトリ未設定</option>}{selectedRepositoryId === "unassigned" && <option value="unassigned">以前の未分類項目</option>}{repositories.map((repository) => <option value={repository.id} key={repository.id}>{repository.name}</option>)}</select>{!repositories.length && <small>案件タグの設定からリポジトリを登録できます。</small>}</label>
        <div className="code-review-compare-settings">
          <label className="code-review-branch-field"><span>基準</span><input aria-label="基準ブランチ" value={base} onChange={(event) => setBase(event.target.value)} placeholder="main" /></label>
          <span className="code-review-compare-arrow" aria-hidden="true">→</span>
          <div className={`code-review-target-summary ${customTargetOpen ? "editing" : ""}`}><div><span>比較先</span>{customTargetOpen ? <input autoFocus aria-label="任意の比較先" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="feature/example" /> : <p><strong>HEAD</strong><small>現在のブランチ</small></p>}</div><button type="button" onClick={() => { if (customTargetOpen) setTarget(""); setCustomTargetOpen((current) => !current); }}>{customTargetOpen ? "HEADへ戻す" : "変更"}</button></div>
        </div>
        <div className="code-review-command"><code><span aria-hidden="true">$</span>{diffCommand}</code><button type="button" className={`primary ${commandCopied ? "copied" : ""}`} onClick={() => void copyDiffCommand()}>{commandCopied ? <><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4 4L19 7" /></svg>コピー済み</> : <><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" /></svg>コマンドをコピー</>}</button></div>
        <p className="code-review-command-help">ターミナルで実行すると、比較結果がクリップボードへ格納されます。</p>
        <fieldset><legend>確認観点</legend><div>{reviewPoints.map(([id, label]) => <label key={id}><input type="checkbox" checked={selectedPoints.includes(id)} onChange={(event) => setSelectedPoints((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))} />{label}</label>)}</div></fieldset>
        <div className="code-review-textarea"><div className="code-review-diff-label"><strong>Git Diff</strong><button type="button" className="secondary" onClick={() => void pasteDiff()}>クリップボードから貼付</button></div><textarea aria-label="Git Diff" value={diff} onChange={(event) => setDiff(event.target.value)} placeholder="git diff の内容を貼り付けてください" spellCheck={false} /></div>
        <button type="button" className="primary code-review-main-action" disabled={!diff.trim()} onClick={generatePrompt}>レビュープロンプトを作成</button>
      </section>

      <section className="code-review-output-panel">
        <header><strong>2. AIでレビュー</strong><small>プロンプトを送り、回答を取り込む</small></header>
        <label className="code-review-textarea compact">生成したプロンプト<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="左側でDiffを入力すると作成できます" spellCheck={false} /></label>
        <button type="button" disabled={!prompt.trim()} onClick={() => void copyPrompt()}>プロンプトをコピー</button>
        <label className="code-review-textarea compact">AIの回答<textarea value={result} onChange={(event) => setResult(event.target.value)} placeholder="AIが返したJSONを貼り付けてください" spellCheck={false} /></label>
        <button type="button" className="primary" disabled={!result.trim()} onClick={importResult}>チェックリストを作成</button>
        {message && <p className="code-review-message" role="status">{message}</p>}
      </section>
    </div>}

    {activeView === "checklist" && <div className="code-review-checklist-view"><TaskReviewChecklist items={checklist} runs={task.codeReviewRuns || []} repositories={repositories} selectedRepositoryId={selectedRepositoryId} onSelectRepository={selectRepository} onChange={updateChecklist} allowImport={false} /></div>}
  </main>;
}
