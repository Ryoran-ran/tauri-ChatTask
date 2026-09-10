import { useEffect, useMemo, useRef, useState } from "react";
import type { GithubRepository, Task, TaskChecklistItem } from "../types";
import { generateId } from "../utils";
import { Modal } from "./Modal";
import { parseReviewChecklist, TaskReviewChecklist } from "./TaskReviewChecklist";

const reviewPoints = [
  ["bug", "バグ・ロジック"],
  ["security", "セキュリティ"],
  ["performance", "パフォーマンス"],
  ["readability", "可読性・保守性"],
  ["wording", "文言・コメント"],
  ["test", "テスト不足"],
] as const;

const testPoints = [
  ["normal", "基本動作"],
  ["error", "異常時"],
  ["boundary", "境界条件"],
  ["regression", "変更影響"],
  ["integration", "関連機能"],
] as const;

type VerificationSortKey = "status" | "category" | "createdAt" | "title";
type VerificationSortRule = { id: string; key: VerificationSortKey; direction: "asc" | "desc" };
const verificationSortLabels: Record<VerificationSortKey, string> = { status: "確認状態", category: "確認観点", createdAt: "追加日時", title: "確認項目" };

const checklistKey = (item: Pick<TaskChecklistItem, "category" | "title" | "file" | "location">) => [item.category, item.file || "", item.location || "", item.title].map((value) => value.trim().toLowerCase()).join("\n");
const isEmptyReviewResult = (text: string) => {
  try {
    const parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as { reviews?: unknown[] } | unknown[];
    return Array.isArray(parsed) ? parsed.length === 0 : Array.isArray(parsed.reviews) && parsed.reviews.length === 0;
  } catch {
    return false;
  }
};

type GeneratedTestResult = {
  environment: string[];
  checks: { category: string; title: string; screen: string; preconditions: string[]; steps: string[]; expectedResult: string; status: "pending" | "in-progress" | "passed" | "failed" }[];
  assumptions: string[];
};

const parseTestResult = (text: string): GeneratedTestResult | null => {
  try {
    const parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.checks)) return null;
    const checks = parsed.checks.flatMap((rawCheck) => {
      if (!rawCheck || typeof rawCheck !== "object") return [];
      const check = rawCheck as Record<string, unknown>;
      const title = String(check.title || "").trim();
      if (!title) return [];
      return [{
        category: String(check.category || "基本動作").trim(),
        title,
        screen: String(check.screen || "").trim(),
        preconditions: Array.isArray(check.preconditions) ? check.preconditions.map(String).filter(Boolean) : [],
        steps: Array.isArray(check.steps) ? check.steps.map(String).filter(Boolean) : [],
        expectedResult: String(check.expectedResult || "").trim(),
        status: "pending" as const,
      }];
    });
    return {
      environment: Array.isArray(parsed.environment) ? parsed.environment.map(String).filter(Boolean) : [],
      checks,
      assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions.map(String).filter(Boolean) : [],
    };
  } catch {
    return null;
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
${selectedPoints.includes("wording") ? `
「文言・コメント」では、誤字脱字だけでなく、実装内容と食い違うコメント、意味が古くなったコメント、不要なコメントアウト、誤解を招くUI文言・エラーメッセージも確認してください。` : ""}

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

const buildTestPrompt = (task: Task, repository: GithubRepository | undefined, diff: string, base: string, target: string, selectedPoints: string[]) => `あなたはデスクトップ・Webアプリの品質確認に詳しいQA担当者です。次のGit Diffを確認し、利用者がアプリを実際に操作して変更内容を確認するための動作確認手順を作成してください。

単体テストや自動テストのコードは作成せず、画面操作、確認する表示、保存・再起動後の状態など、人が確認できる手順にしてください。変更された全ファイルと全差分ブロックを確認し、今回の変更に直接関係する確認項目を優先してください。実際に確認していない項目を成功したとは記載しないでください。

## 手順の書き方
- ソースコード上の変数名、型名、カラム名、テーブル名、localStorageのキーなど、画面に表示されない内部名を事前条件・操作手順・期待結果へ書かないでください。
- 事前条件は、アプリの通常操作で利用者が用意できる状態を、画面名・ボタン名・入力するサンプル値を使って具体的に記載してください。
- 操作手順は、利用者が画面を見ながらそのまま実施できる粒度にしてください。
- 期待結果は、画面の文言、件数、色、表示位置、保存後または再起動後の状態など、利用者が確認できる内容にしてください。
- データベースの直接編集や開発者による特殊なデータ準備が必要な確認はchecksへ含めず、その理由をassumptionsへ記載してください。

## 対象作業
${task.title}

## 対象リポジトリ
${repository ? `${repository.name}${repository.url ? ` (${repository.url})` : ""}` : "未設定"}

## 比較
${base || "base"} → ${target || "target"}

## 動作確認の観点
${testPoints.filter(([id]) => selectedPoints.includes(id)).map(([, label]) => `- ${label}`).join("\n") || "- 変更内容に必要な観点を総合的に確認"}

## 出力形式
説明文は付けず、次のJSONだけを必ず \`\`\`json のコードブロック1つで囲んで返してください。
\`\`\`json
{
  "environment": ["デスクトップ版", "macOS"],
  "checks": [
    {
      "category": "基本動作",
      "title": "確認内容を短く記載",
      "screen": "タスク詳細 > コードレビュー",
      "preconditions": ["タスクを1件作成し、コードレビュー項目を2件取り込んでおく"],
      "steps": ["対象タスクの「…」メニューを開く", "「コードレビュー」を選ぶ"],
      "expectedResult": "コードレビュー画面に未対応2件と表示される"
    }
  ],
  "assumptions": ["Diffだけでは判断できない前提や確認事項"]
}
\`\`\`
動作確認が不要な場合も同じ形式で "checks": [] を返してください。文字列内の改行や引用符は正しいJSONとしてエスケープしてください。

確認項目を水増しせず、利用者の操作と目で確認できる結果を具体的に記載してください。

## Git Diff
${diff}`;

export function CodeReviewWindow({ task, repositories, onUpdate }: { task: Task; repositories: GithubRepository[]; onUpdate: (changes: Partial<Task>, historyText?: string) => void }) {
  type ReviewView = "prompt" | "checklist" | "closed" | "history" | "tests" | "tests-closed" | "tests-history";
  const taskId = task.id;
  const viewStorageKey = `chatTaskCodeReviewView:${taskId}`;
  const promptModeStorageKey = `chatTaskCodeReviewPromptMode:${taskId}`;
  const repositoryStorageKey = `chatTaskCodeReviewRepository:${taskId}`;
  const verificationSortStorageKey = `chatTaskVerificationSortRules:${taskId}`;
  const [activeView, setActiveView] = useState<ReviewView>(() => {
    const saved = localStorage.getItem(viewStorageKey);
    return saved === "checklist" || saved === "closed" || saved === "history" || saved === "tests" || saved === "tests-closed" || saved === "tests-history" ? saved : "prompt";
  });
  const [promptMode, setPromptMode] = useState<"review" | "test">(() => localStorage.getItem(promptModeStorageKey) === "test" ? "test" : "review");
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
  const [testResult, setTestResult] = useState("");
  const [message, setMessage] = useState("");
  const [deletingTestRunId, setDeletingTestRunId] = useState("");
  const [copiedVerificationKey, setCopiedVerificationKey] = useState("");
  const [verificationSortOpen, setVerificationSortOpen] = useState(false);
  const [verificationSortRules, setVerificationSortRules] = useState<VerificationSortRule[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(verificationSortStorageKey) || "null") as VerificationSortRule[] | null;
      return Array.isArray(stored) ? stored.filter((rule) => rule && verificationSortLabels[rule.key] && ["asc", "desc"].includes(rule.direction)) : [{ id: "status-default", key: "status", direction: "asc" }];
    } catch {
      return [{ id: "status-default", key: "status", direction: "asc" }];
    }
  });
  const [commandCopied, setCommandCopied] = useState(false);
  const commandCopiedTimer = useRef<number | null>(null);
  const verificationCopiedTimer = useRef<number | null>(null);
  const [selectedPoints, setSelectedPoints] = useState<string[]>(reviewPoints.map(([id]) => id));
  const [selectedTestPoints, setSelectedTestPoints] = useState<string[]>(testPoints.map(([id]) => id));

  const checklist = task.reviewChecklist || [];
  const selectedRepository = repositories.find((repository) => repository.id === selectedRepositoryId);
  const completed = useMemo(() => checklist.filter((item) => (item.reviewStatus || (item.completed ? "completed" : "pending")) === "completed").length, [checklist]);
  const ignored = useMemo(() => checklist.filter((item) => item.reviewStatus === "ignored").length, [checklist]);
  const inProgress = useMemo(() => checklist.filter((item) => item.reviewStatus === "in-progress").length, [checklist]);
  const reviewed = completed + ignored;
  const actionableReviewCount = checklist.length - ignored;
  const diffCommand = `git --no-pager diff ${base.trim() || "main"}...${target.trim() || "HEAD"} | pbcopy`;
  const verificationEntries = (task.testRuns || []).flatMap((run) => (run.checks || []).map((check, index) => ({ run, check, index })));
  const verificationRepositories = [...new Map([...repositories.map((repository) => [repository.id || "unassigned", repository.name || "リポジトリ未設定"] as const), ...(task.testRuns || []).map((run) => [run.repositoryId || "unassigned", run.repositoryName || "リポジトリ未設定"] as const)]).entries()];
  const activeVerificationRepositoryId = selectedRepositoryId || verificationRepositories[0]?.[0] || "unassigned";
  const scopedVerificationEntries = verificationEntries.filter(({ run }) => (run.repositoryId || "unassigned") === activeVerificationRepositoryId);
  const activeVerificationEntries = scopedVerificationEntries.filter(({ check }) => !["passed", "ignored"].includes(check.status));
  const closedVerificationEntries = scopedVerificationEntries.filter(({ check }) => ["passed", "ignored"].includes(check.status));
  const scopedVerificationRuns = (task.testRuns || []).filter((run) => (run.repositoryId || "unassigned") === activeVerificationRepositoryId);
  const legacyTestRuns = (task.testRuns || []).filter((run) => !run.checks);
  const verificationCount = (repositoryId: string) => verificationEntries.filter(({ run, check }) => (run.repositoryId || "unassigned") === repositoryId && !["passed", "ignored"].includes(check.status)).length;
  const activeVerificationTotal = verificationEntries.filter(({ check }) => !["passed", "ignored"].includes(check.status)).length;
  const closedVerificationTotal = verificationEntries.filter(({ check }) => ["passed", "ignored"].includes(check.status)).length;
  const completedVerificationTotal = verificationEntries.filter(({ check }) => check.status === "passed").length;
  const actionableVerificationCount = verificationEntries.filter(({ check }) => check.status !== "ignored").length;
  const pendingVerificationCount = activeVerificationEntries.filter(({ check }) => check.status === "pending").length;
  const inProgressVerificationCount = activeVerificationEntries.filter(({ check }) => check.status === "in-progress").length;
  const failedVerificationCount = activeVerificationEntries.filter(({ check }) => check.status === "failed").length;
  const sortVerificationEntries = (entries: typeof verificationEntries) => [...entries].sort((a, b) => {
    const statusRank = { failed: 1, "in-progress": 2, pending: 3, passed: 4, ignored: 5 } as const;
    for (const rule of verificationSortRules) {
      let comparison = 0;
      if (rule.key === "status") comparison = statusRank[a.check.status] - statusRank[b.check.status];
      else if (rule.key === "category") comparison = a.check.category.localeCompare(b.check.category, "ja");
      else if (rule.key === "createdAt") comparison = a.run.createdAt.localeCompare(b.run.createdAt);
      else comparison = a.check.title.localeCompare(b.check.title, "ja");
      if (comparison) return rule.direction === "asc" ? comparison : -comparison;
    }
    return 0;
  });
  const sortedActiveVerificationEntries = sortVerificationEntries(activeVerificationEntries);
  const sortedClosedVerificationEntries = sortVerificationEntries(closedVerificationEntries);

  useEffect(() => () => {
    if (commandCopiedTimer.current !== null) window.clearTimeout(commandCopiedTimer.current);
    if (verificationCopiedTimer.current !== null) window.clearTimeout(verificationCopiedTimer.current);
  }, []);

  useEffect(() => {
    localStorage.setItem(branchStorageKey, JSON.stringify({ base, target }));
  }, [base, branchStorageKey, target]);

  useEffect(() => {
    localStorage.setItem(verificationSortStorageKey, JSON.stringify(verificationSortRules));
  }, [verificationSortRules, verificationSortStorageKey]);

  useEffect(() => {
    if (selectedRepositoryId && selectedRepositoryId !== "unassigned" && !repositories.some((repository) => repository.id === selectedRepositoryId)) {
      setSelectedRepositoryId(repositories[0]?.id || "");
    }
  }, [repositories, selectedRepositoryId]);

  const selectView = (view: ReviewView) => {
    setActiveView(view);
    localStorage.setItem(viewStorageKey, view);
  };

  const selectPromptMode = (mode: "review" | "test") => {
    setPromptMode(mode);
    localStorage.setItem(promptModeStorageKey, mode);
    setPrompt("");
    setMessage("");
  };

  const updateChecklist = (items: TaskChecklistItem[], historyText?: string) => {
    onUpdate({ reviewChecklist: items }, historyText);
  };
  const updateReviewData = (items: TaskChecklistItem[], runs: NonNullable<Task["codeReviewRuns"]>, historyText?: string) => {
    onUpdate({ reviewChecklist: items, codeReviewRuns: runs }, historyText);
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
    setPrompt(promptMode === "review"
      ? buildReviewPrompt(task, selectedRepository, diff.trim(), base.trim(), target.trim(), selectedPoints)
      : buildTestPrompt(task, selectedRepository, diff.trim(), base.trim(), target.trim(), selectedTestPoints));
    setMessage(promptMode === "review" ? "AIへ渡すレビュープロンプトを作成しました。" : "AIへ渡す動作確認プロンプトを作成しました。");
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setMessage(promptMode === "review" ? "レビュープロンプトをコピーしました。" : "動作確認プロンプトをコピーしました。");
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

  const saveTestRun = () => {
    const content = testResult.trim();
    if (!content) {
      setMessage("AIが作成した動作確認項目を入力してください。");
      return;
    }
    const parsed = parseTestResult(content);
    if (!parsed) {
      setMessage("動作確認の回答をJSONコードブロック1つの形式で貼り付けてください。");
      return;
    }
    const now = new Date().toISOString();
    onUpdate({
      testRuns: [...(task.testRuns || []), {
        id: generateId(),
        repositoryId: selectedRepository?.id || "",
        repositoryName: selectedRepository?.name || "リポジトリ未設定",
        baseBranch: base.trim() || "main",
        targetBranch: target.trim() || "HEAD",
        testPoints: [...selectedTestPoints],
        content: JSON.stringify(parsed, null, 2),
        ...parsed,
        status: "planned",
        createdAt: now,
        updatedAt: now,
      }],
    }, `${selectedRepository?.name || "リポジトリ未設定"}の動作確認項目を記録しました。`);
    setTestResult("");
    setMessage("");
    selectView("tests");
  };

  const updateVerificationStatus = (runId: string, checkIndex: number, status: NonNullable<NonNullable<Task["testRuns"]>[number]["checks"]>[number]["status"]) => {
    const now = new Date().toISOString();
    onUpdate({
      testRuns: (task.testRuns || []).map((run) => {
        if (run.id !== runId || !run.checks) return run;
        const checks = run.checks.map((check, index) => index === checkIndex ? { ...check, status } : check);
        const runStatus = checks.every((check) => check.status === "passed" || check.status === "ignored")
          ? "passed"
          : checks.some((check) => check.status === "failed")
            ? "failed"
            : checks.some((check) => check.status === "in-progress" || check.status === "passed") ? "implemented" : "planned";
        return { ...run, checks, status: runStatus, updatedAt: now };
      }),
    }, "動作確認項目の状態を変更しました。");
  };

  const deleteVerificationCheck = (runId: string, checkIndex: number) => {
    onUpdate({
      testRuns: (task.testRuns || []).flatMap((run) => {
        if (run.id !== runId || !run.checks) return [run];
        const checks = run.checks.filter((_, index) => index !== checkIndex);
        return checks.length ? [{ ...run, checks, updatedAt: new Date().toISOString() }] : [];
      }),
    }, "動作確認項目を削除しました。");
    setDeletingTestRunId("");
  };

  const moveVerificationSortRule = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= verificationSortRules.length) return;
    const next = [...verificationSortRules];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    setVerificationSortRules(next);
  };

  const copyVerificationQuestion = async (run: NonNullable<Task["testRuns"]>[number], check: NonNullable<NonNullable<Task["testRuns"]>[number]["checks"]>[number], key: string) => {
    const statusLabel = { pending: "未実施", "in-progress": "確認中", passed: "確認済み", failed: "問題あり", ignored: "対象外" }[check.status];
    const text = [
      "次のアプリ動作確認について、確認の目的と具体的な実施方法を説明してください。",
      "ソースコードの変数名やデータベースのカラム名ではなく、実際の画面名・ボタン名・操作内容を使って説明してください。通常の画面操作だけでは準備できない場合は、その点も明記してください。",
      "",
      `対象タスク: ${task.title}`,
      `対象リポジトリ: ${run.repositoryName}`,
      check.screen && `対象画面: ${check.screen}`,
      `確認項目: ${check.title}`,
      `確認観点: ${check.category}`,
      `現在の状態: ${statusLabel}`,
      "",
      "事前条件:",
      ...(check.preconditions.length ? check.preconditions.map((condition) => `- ${condition}`) : ["- なし"]),
      "",
      "操作手順:",
      ...(check.steps.length ? check.steps.map((step, index) => `${index + 1}. ${step}`) : ["- 未設定"]),
      "",
      `期待結果: ${check.expectedResult || "未設定"}`,
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedVerificationKey(key);
      if (verificationCopiedTimer.current !== null) window.clearTimeout(verificationCopiedTimer.current);
      verificationCopiedTimer.current = window.setTimeout(() => setCopiedVerificationKey(""), 1800);
    } catch {
      setCopiedVerificationKey(`${key}:error`);
    }
  };

  const renderVerificationEntry = ({ run, check, index }: (typeof verificationEntries)[number]) => {
    const deleteKey = `${run.id}:${index}`;
    return <article className={`verification-${check.status}`} key={deleteKey}>
      <div className="review-checklist-item-main"><span><code>{check.screen || `${run.baseBranch} → ${run.targetBranch}`}</code><strong>{check.title}</strong><small><em className="review-repository-badge">{run.repositoryName}</em><em>{check.category}</em>{run.environment?.map((environment) => <em className="verification-environment-badge" key={environment}>{environment}</em>)}</small></span></div>
      <select className={`review-checklist-status status-${check.status}`} aria-label={`${check.title}の確認状態`} value={check.status} onChange={(event) => updateVerificationStatus(run.id, index, event.target.value as typeof check.status)}><option value="pending">未実施</option><option value="in-progress">確認中</option><option value="passed">確認済み</option><option value="failed">問題あり</option><option value="ignored">対象外</option></select>
      <button type="button" className="danger-text" aria-label={`${check.title}を削除`} onClick={() => setDeletingTestRunId(deleteKey)}>×</button>
      <div className="review-checklist-item-actions"><button type="button" className="ai-copy" onClick={() => void copyVerificationQuestion(run, check, deleteKey)}>{copiedVerificationKey === deleteKey ? "コピー済み" : copiedVerificationKey === `${deleteKey}:error` ? "コピー失敗" : "AI質問用にコピー"}</button></div>
      {deletingTestRunId === deleteKey && <div className="verification-item-delete"><span>削除しますか？</span><button type="button" onClick={() => setDeletingTestRunId("")}>戻る</button><button type="button" className="danger" onClick={() => deleteVerificationCheck(run.id, index)}>削除する</button></div>}
      <details><summary>事前条件・操作手順・期待結果</summary><div className="review-checklist-details verification-details">{check.preconditions.length > 0 && <section><strong>事前条件</strong><ul>{check.preconditions.map((condition) => <li key={condition}>{condition}</li>)}</ul></section>}<section><strong>操作手順</strong>{check.steps.length > 0 ? <ol>{check.steps.map((step) => <li key={step}>{step}</li>)}</ol> : <p>操作手順はありません。</p>}</section><section className="suggestion"><strong>期待結果</strong><p>{check.expectedResult || "期待結果は未設定です。"}</p></section></div></details>
    </article>;
  };

  const deleteTestRun = (id: string) => {
    onUpdate({ testRuns: (task.testRuns || []).filter((run) => run.id !== id) }, "動作確認記録を削除しました。");
    setDeletingTestRunId("");
  };

  return <main className="code-review-window">
    <header className="code-review-window-header">
      <div><span>CODE REVIEW</span><h1>コードレビュー</h1><p>{task.title}</p></div>
      {activeView === "prompt"
        ? <div className="code-review-progress-pair"><div className="code-review-progress"><small>レビュー進捗</small><strong>{completed}<span> / {actionableReviewCount}</span></strong></div><div className="code-review-progress verification"><small>動作確認進捗</small><strong>{completedVerificationTotal}<span> / {actionableVerificationCount}</span></strong></div></div>
        : ["tests", "tests-closed", "tests-history"].includes(activeView)
          ? <div className="code-review-progress"><small>動作確認進捗</small><strong>{completedVerificationTotal}<span> / {actionableVerificationCount}</span></strong></div>
          : <div className="code-review-progress"><small>レビュー進捗</small><strong>{completed}<span> / {actionableReviewCount}</span></strong></div>}
    </header>

    <nav className="code-review-view-tabs" aria-label="コードレビュー画面">
      <div className="code-review-nav-group common-group" role="group" aria-label="共通">
        <p>共通</p>
        <button type="button" className={activeView === "prompt" ? "active" : ""} aria-pressed={activeView === "prompt"} onClick={() => selectView("prompt")}><span>⌘</span><div><strong>プロンプト生成</strong><small>レビュー・動作確認を作成</small></div></button>
      </div>
      <div className="code-review-nav-group review-group" role="group" aria-label="コードレビュー">
        <p>コードレビュー</p>
        <button type="button" className={activeView === "checklist" ? "active" : ""} aria-pressed={activeView === "checklist"} onClick={() => selectView("checklist")}><span>✓</span><div><strong>チェックリスト</strong><small>{checklist.length ? `${inProgress ? `${inProgress}件対応中・` : ""}未対応${checklist.length - reviewed - inProgress}件` : "レビュー結果の対応を管理"}</small></div></button>
        <button type="button" className={activeView === "closed" ? "active" : ""} aria-pressed={activeView === "closed"} onClick={() => selectView("closed")}><span>○</span><div><strong>完了・対象外</strong><small>{reviewed ? `${reviewed}件` : "完了した指摘を確認"}</small></div></button>
        <button type="button" className={activeView === "history" ? "active" : ""} aria-pressed={activeView === "history"} onClick={() => selectView("history")}><span>↶</span><div><strong>過去のレビュー</strong><small>{task.codeReviewRuns?.length ? `${task.codeReviewRuns.length}回` : "レビュー履歴を確認"}</small></div></button>
      </div>
      <div className="code-review-nav-group test-group" role="group" aria-label="動作確認">
        <p>動作確認</p>
        <button type="button" className={activeView === "tests" ? "active" : ""} aria-pressed={activeView === "tests"} onClick={() => selectView("tests")}><span>✓</span><div><strong>確認記録</strong><small>{activeVerificationTotal ? `未完了${activeVerificationTotal}件` : "操作手順と結果を記録"}</small></div></button>
        <button type="button" className={activeView === "tests-closed" ? "active" : ""} aria-pressed={activeView === "tests-closed"} onClick={() => selectView("tests-closed")}><span>○</span><div><strong>完了・対象外</strong><small>{closedVerificationTotal ? `${closedVerificationTotal}件` : "確認済みの項目"}</small></div></button>
        <button type="button" className={activeView === "tests-history" ? "active" : ""} aria-pressed={activeView === "tests-history"} onClick={() => selectView("tests-history")}><span>↶</span><div><strong>過去の確認</strong><small>{task.testRuns?.length ? `${task.testRuns.length}回` : "取り込み履歴を確認"}</small></div></button>
      </div>
    </nav>

    {activeView === "prompt" && <div className="code-review-workspace">
      <section className="code-review-input-panel">
        <header><strong>1. 差分を準備</strong><small>比較対象とGit Diffを入力</small></header>
        <div className="code-review-prompt-mode" role="group" aria-label="生成するプロンプト">
          <button type="button" className={promptMode === "review" ? "active" : ""} aria-pressed={promptMode === "review"} onClick={() => selectPromptMode("review")}><strong>コードレビュー</strong><small>問題点と修正案を確認</small></button>
          <button type="button" className={promptMode === "test" ? "active" : ""} aria-pressed={promptMode === "test"} onClick={() => selectPromptMode("test")}><strong>動作確認</strong><small>アプリの確認手順を作成</small></button>
        </div>
        <label className="code-review-repository">対象リポジトリ<select value={selectedRepositoryId} onChange={(event) => selectRepository(event.target.value)} disabled={!repositories.length}>{!repositories.length && <option value="">リポジトリ未設定</option>}{selectedRepositoryId === "unassigned" && <option value="unassigned">以前の未分類項目</option>}{repositories.map((repository) => <option value={repository.id} key={repository.id}>{repository.name}</option>)}</select>{!repositories.length && <small>案件タグの設定からリポジトリを登録できます。</small>}</label>
        <div className="code-review-compare-settings">
          <label className="code-review-branch-field"><span>基準</span><input aria-label="基準ブランチ" value={base} onChange={(event) => setBase(event.target.value)} placeholder="main" /></label>
          <span className="code-review-compare-arrow" aria-hidden="true">→</span>
          <div className={`code-review-target-summary ${customTargetOpen ? "editing" : ""}`}><div><span>比較先</span>{customTargetOpen ? <input autoFocus aria-label="任意の比較先" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="feature/example" /> : <p><strong>HEAD</strong><small>現在のブランチ</small></p>}</div><button type="button" onClick={() => { if (customTargetOpen) setTarget(""); setCustomTargetOpen((current) => !current); }}>{customTargetOpen ? "HEADへ戻す" : "変更"}</button></div>
        </div>
        <div className="code-review-command"><code><span aria-hidden="true">$</span>{diffCommand}</code><button type="button" className={`primary ${commandCopied ? "copied" : ""}`} onClick={() => void copyDiffCommand()}>{commandCopied ? <><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4 4L19 7" /></svg>コピー済み</> : <><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" /></svg>コマンドをコピー</>}</button></div>
        <p className="code-review-command-help">ターミナルで実行すると、比較結果がクリップボードへ格納されます。</p>
        {promptMode === "review"
          ? <fieldset><legend>確認観点</legend><div>{reviewPoints.map(([id, label]) => <label key={id}><input type="checkbox" checked={selectedPoints.includes(id)} onChange={(event) => setSelectedPoints((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))} />{label}</label>)}</div></fieldset>
          : <fieldset><legend>動作確認の観点</legend><div>{testPoints.map(([id, label]) => <label key={id}><input type="checkbox" checked={selectedTestPoints.includes(id)} onChange={(event) => setSelectedTestPoints((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))} />{label}</label>)}</div></fieldset>}
        <div className="code-review-textarea"><div className="code-review-diff-label"><strong>Git Diff</strong><button type="button" className="secondary" onClick={() => void pasteDiff()}>クリップボードから貼付</button></div><textarea aria-label="Git Diff" value={diff} onChange={(event) => setDiff(event.target.value)} placeholder="git diff の内容を貼り付けてください" spellCheck={false} /></div>
        <button type="button" className="primary code-review-main-action" disabled={!diff.trim()} onClick={generatePrompt}>{promptMode === "review" ? "レビュープロンプトを作成" : "動作確認プロンプトを作成"}</button>
      </section>

      <section className={`code-review-output-panel ${promptMode === "test" ? "test-prompt-mode" : ""}`}>
        <header><strong>{promptMode === "review" ? "2. AIでレビュー" : "2. AIで動作確認を作成"}</strong><small>{promptMode === "review" ? "プロンプトを送り、回答を取り込む" : "プロンプトを送り、操作手順を作成する"}</small></header>
        <label className="code-review-textarea compact">生成したプロンプト<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="左側でDiffを入力すると作成できます" spellCheck={false} /></label>
        <button type="button" disabled={!prompt.trim()} onClick={() => void copyPrompt()}>プロンプトをコピー</button>
        {promptMode === "review" && <><label className="code-review-textarea compact">AIの回答<textarea value={result} onChange={(event) => setResult(event.target.value)} placeholder="AIが返したJSONを貼り付けてください" spellCheck={false} /></label><button type="button" className="primary" disabled={!result.trim()} onClick={importResult}>チェックリストを作成</button></>}
        {promptMode === "test" && <><label className="code-review-textarea compact">AIが作成した動作確認<textarea value={testResult} onChange={(event) => setTestResult(event.target.value)} placeholder="AIが返したJSONコードブロックを貼り付けてください" spellCheck={false} /></label><button type="button" className="primary" disabled={!testResult.trim()} onClick={saveTestRun}>確認記録として保存</button><p className="code-review-test-note">JSONを検証して、事前条件・操作手順・期待結果に分けて保存します。</p></>}
        {message && <p className="code-review-message" role="status">{message}</p>}
      </section>
    </div>}

    {activeView !== "prompt" && !["tests", "tests-closed", "tests-history"].includes(activeView) && <div className={`code-review-checklist-view section-${activeView}`}><TaskReviewChecklist taskId={task.id} items={checklist} runs={task.codeReviewRuns || []} repositories={repositories} selectedRepositoryId={selectedRepositoryId} onSelectRepository={selectRepository} onChange={updateChecklist} onChangeReviewData={updateReviewData} allowImport={false} section={activeView === "checklist" ? "active" : activeView === "closed" ? "closed" : "history"} /></div>}
    {["tests", "tests-closed", "tests-history"].includes(activeView) && <div className={`code-review-checklist-view verification-checklist-view section-${activeView}`}><section className="task-review-checklist">
      <header><div><strong>{activeView === "tests-closed" ? "完了・対象外" : activeView === "tests-history" ? "過去の動作確認" : "現在の動作確認"}</strong><small>{activeView === "tests-closed" ? `${closedVerificationEntries.length}件` : activeView === "tests-history" ? `${scopedVerificationRuns.length}回` : activeVerificationEntries.length ? `${inProgressVerificationCount ? `確認中${inProgressVerificationCount}件・` : ""}${failedVerificationCount ? `問題あり${failedVerificationCount}件・` : ""}未実施${pendingVerificationCount}件` : "確認が必要な項目はありません"}</small></div>{activeView !== "tests-history" && <div className="review-checklist-header-actions"><button type="button" onClick={() => setVerificationSortOpen(true)}>↕ 並び替え <small>{verificationSortRules.length}条件</small></button></div>}</header>
      {!!verificationRepositories.length && <nav className="review-repository-tabs" aria-label="リポジトリ別の動作確認">{verificationRepositories.map(([id, name]) => { const count = activeView === "tests-closed" ? verificationEntries.filter(({ run, check }) => (run.repositoryId || "unassigned") === id && ["passed", "ignored"].includes(check.status)).length : activeView === "tests-history" ? (task.testRuns || []).filter((run) => (run.repositoryId || "unassigned") === id).length : verificationCount(id); return <button type="button" className={activeVerificationRepositoryId === id ? "active" : ""} onClick={() => selectRepository(id)} key={id}>{name} <small>{count}</small></button>; })}</nav>}
      {activeView === "tests" && !!activeVerificationEntries.length && <div className="task-review-checklist-items current-review-items">{sortedActiveVerificationEntries.map(renderVerificationEntry)}</div>}
      {activeView === "tests" && !activeVerificationEntries.length && <p>選択したリポジトリに未完了の動作確認はありません。</p>}
      {activeView === "tests-closed" && !!closedVerificationEntries.length && <div className="task-review-checklist-items current-review-items">{sortedClosedVerificationEntries.map(renderVerificationEntry)}</div>}
      {activeView === "tests-closed" && !closedVerificationEntries.length && <p>選択したリポジトリに完了・対象外の項目はありません。</p>}
      {activeView === "tests-history" && !!scopedVerificationRuns.length && <section className="review-history-section"><div>{[...scopedVerificationRuns].reverse().map((run) => { const repositoryRuns = (task.testRuns || []).filter((candidate) => (candidate.repositoryId || "unassigned") === (run.repositoryId || "unassigned")); const runNumber = repositoryRuns.findIndex((candidate) => candidate.id === run.id) + 1; return <details className="review-run-card" key={run.id}><summary><span><strong>第{runNumber}回</strong><em>{run.repositoryName}</em></span><span>{run.baseBranch} → {run.targetBranch}</span><small>{new Date(run.createdAt).toLocaleString("ja-JP")}・確認{run.checks?.length || 0}件</small></summary>{run.checks?.length ? <ul>{run.checks.map((check, index) => <li key={`${run.id}:${index}`}><span className={`review-history-status ${check.status}`}>{check.status === "in-progress" ? "確認中" : check.status === "passed" ? "確認済み" : check.status === "failed" ? "問題あり" : check.status === "ignored" ? "対象外" : "未実施"}</span><span>{check.title}</span></li>)}</ul> : <p>以前の形式で保存された記録です。</p>}<div className="review-run-actions">{deletingTestRunId === run.id ? <div className="review-run-delete-confirm"><span>この取り込みを削除しますか？</span><button type="button" onClick={() => setDeletingTestRunId("")}>やめる</button><button type="button" className="danger" onClick={() => deleteTestRun(run.id)}>削除する</button></div> : <button type="button" className="danger-text" onClick={() => setDeletingTestRunId(run.id)}>取り込み単位で削除</button>}</div></details>; })}</div></section>}
      {activeView === "tests-history" && !scopedVerificationRuns.length && <p>選択したリポジトリの動作確認履歴はありません。</p>}
      {activeView !== "tests-history" && !!legacyTestRuns.length && <details className="review-run-history verification-legacy-runs"><summary>以前のテスト記録 <small>{legacyTestRuns.length}件</small></summary><div>{legacyTestRuns.map((run) => <article key={run.id}><strong>{run.repositoryName}</strong><span>{run.baseBranch} → {run.targetBranch}</span><small>{new Date(run.createdAt).toLocaleString("ja-JP")}</small></article>)}</div></details>}
    </section></div>}
    {verificationSortOpen && <Modal title="動作確認の並び替え" onClose={() => setVerificationSortOpen(false)}><div className="sort-editor-dialog review-sort-dialog">
      <header><div><strong>並び替え条件</strong><p>上にある条件から順番に適用します。</p></div></header>
      <div className="task-sort-rules">{verificationSortRules.map((rule, index) => <div key={rule.id}>
        <b>{index + 1}</b>
        <select value={rule.key} onChange={(event) => setVerificationSortRules(verificationSortRules.map((item) => item.id === rule.id ? { ...item, key: event.target.value as VerificationSortKey } : item))}>{Object.entries(verificationSortLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>
        <select aria-label={`${verificationSortLabels[rule.key]}の方向`} value={rule.direction} onChange={(event) => setVerificationSortRules(verificationSortRules.map((item) => item.id === rule.id ? { ...item, direction: event.target.value as "asc" | "desc" } : item))}><option value="asc">昇順</option><option value="desc">降順</option></select>
        <button type="button" disabled={index === 0} onClick={() => moveVerificationSortRule(index, -1)}>↑</button><button type="button" disabled={index === verificationSortRules.length - 1} onClick={() => moveVerificationSortRule(index, 1)}>↓</button><button type="button" aria-label={`${verificationSortLabels[rule.key]}を削除`} onClick={() => setVerificationSortRules(verificationSortRules.filter((item) => item.id !== rule.id))}>×</button>
      </div>)}</div>
      {verificationSortRules.length < Object.keys(verificationSortLabels).length && <button type="button" onClick={() => { const key = (Object.keys(verificationSortLabels) as VerificationSortKey[]).find((candidate) => !verificationSortRules.some((rule) => rule.key === candidate)); if (key) setVerificationSortRules([...verificationSortRules, { id: generateId(), key, direction: key === "createdAt" ? "desc" : "asc" }]); }}>＋ 並び替え条件を追加</button>}
      <footer><button type="button" className="review-sort-reset" onClick={() => setVerificationSortRules([{ id: generateId(), key: "status", direction: "asc" }])}>初期設定に戻す</button><button type="button" className="primary" onClick={() => setVerificationSortOpen(false)}>完了</button></footer>
    </div></Modal>}
  </main>;
}
