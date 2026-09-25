import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from "react";
import type { GithubRepository, Task, TaskChecklistItem } from "../types";
import { generateId } from "../utils";
import { addAttachment, listAttachments, removeAttachment, type Attachment } from "../services/attachments";
import { AttachmentCards } from "./AttachmentCards";
import { Modal } from "./Modal";
import { parseReviewChecklist, TaskReviewChecklist } from "./TaskReviewChecklist";
import { defaultReviewBaseBranch, reviewBaseBranchCandidates } from "../reviewBranches";
import "./CodeReviewActivityBar.css";

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

const verificationStatusLabels = { pending: "未実施", "in-progress": "確認中", passed: "確認済み", failed: "問題あり", ignored: "対象外" } as const;
const timelineKindLabels = { note: "メモ", issue: "不具合", retest: "再確認", status: "状態変更", system: "システム", reply: "返信" } as const;

type VerificationCheckOption = { id: string; label: string; detail: string };
const timelineEntryCheckIds = (entry: NonNullable<Task["verificationTimeline"]>[number]) => entry.checkIds?.length ? entry.checkIds : entry.checkId ? [entry.checkId] : [];
const timelineEntryCheckTitles = (entry: NonNullable<Task["verificationTimeline"]>[number]) => entry.checkTitles?.length ? entry.checkTitles : entry.checkTitle ? [entry.checkTitle] : [];
const timelineDateKey = (value: string) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};
const timelineDateLabel = (value: string) => {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const shortDate = date.toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" });
  if (timelineDateKey(value) === timelineDateKey(today.toISOString())) return `今日・${shortDate}`;
  if (timelineDateKey(value) === timelineDateKey(yesterday.toISOString())) return `昨日・${shortDate}`;
  return date.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
};

function VerificationCheckPicker({ options, selectedIds, lockedIds = [], onChange }: { options: VerificationCheckOption[]; selectedIds: string[]; lockedIds?: string[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds);
  const normalizedQuery = query.trim().toLocaleLowerCase("ja");
  const visibleOptions = options.filter((option) => !normalizedQuery || `${option.label} ${option.detail}`.toLocaleLowerCase("ja").includes(normalizedQuery));
  const selectedOptions = selectedIds.flatMap((id) => {
    const option = options.find((candidate) => candidate.id === id);
    return option ? [option] : [{ id, label: "削除済みの確認項目", detail: "" }];
  });
  const toggle = (id: string) => {
    if (lockedIds.includes(id)) return;
    setDraftIds((current) => current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id]);
  };
  const removeSelected = (id: string) => {
    if (!lockedIds.includes(id)) onChange(selectedIds.filter((selectedId) => selectedId !== id));
  };
  const close = () => { setOpen(false); setQuery(""); };
  return <div className="verification-check-picker-summary">
    <div className="verification-check-picker-selected">{selectedOptions.length ? selectedOptions.map((option) => <span key={option.id}>{option.label}<button type="button" aria-label={`${option.label}の選択を解除`} disabled={lockedIds.includes(option.id)} onClick={() => removeSelected(option.id)}>×</button></span>) : <small>確認項目は選択されていません</small>}</div>
    <button type="button" className="verification-check-picker-open" onClick={() => { setDraftIds(selectedIds); setQuery(""); setOpen(true); }}>⌕ 確認項目を選択</button>
    {open && <Modal title="関連する確認項目を選択" wide onClose={close}><div className="verification-check-picker-dialog">
      <div className="verification-check-picker-search"><span aria-hidden="true">⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="タイトル・画面名・リポジトリ名で検索" /><small>{draftIds.length}件選択</small></div>
      <div className="verification-check-picker-options">{visibleOptions.length ? visibleOptions.map((option) => <label key={option.id}><input type="checkbox" checked={draftIds.includes(option.id)} disabled={lockedIds.includes(option.id)} onChange={() => toggle(option.id)} /><span><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</span></label>) : <p>一致する確認項目はありません。</p>}</div>
      <footer><span>{draftIds.length}件を関連付けます</span><button type="button" onClick={close}>キャンセル</button><button type="button" className="primary" onClick={() => { onChange(draftIds); close(); }}>選択を反映</button></footer>
    </div></Modal>}
  </div>;
}

type VerificationSortKey = "status" | "category" | "createdAt" | "title";
type VerificationSortRule = { id: string; key: VerificationSortKey; direction: "asc" | "desc" };
const verificationSortLabels: Record<VerificationSortKey, string> = { status: "確認状態", category: "確認観点", createdAt: "追加日時", title: "確認項目" };

const checklistKey = (item: Pick<TaskChecklistItem, "category" | "title" | "file" | "line" | "functionName" | "location">) => [item.category, item.file || "", item.line || "", item.functionName || item.location || "", item.title].map((value) => value.trim().toLowerCase()).join("\n");
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
  checks: { id: string; category: string; title: string; screen: string; file: string; line: string; functionName: string; repositories: string[]; preconditions: string[]; steps: string[]; expectedResult: string; status: "pending" | "in-progress" | "passed" | "failed" }[];
  assumptions: string[];
};

type TestPromptSource = {
  repository: GithubRepository;
  base: string;
  target: string;
  diff: string;
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
        id: generateId(),
        category: String(check.category || "基本動作").trim(),
        title,
        screen: String(check.screen || "").trim(),
        file: String(check.file || "").trim(),
        line: String(check.line || "").trim(),
        functionName: String(check.functionName || "").trim(),
        repositories: Array.isArray(check.repositories) ? check.repositories.map(String).filter(Boolean) : [],
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
各reviewsのsuggestedCommitMessageには、その指摘だけを修正したときに使用するコミット名を提案してください。変更種別が明確なら Conventional Commits（fix:, refactor:, test:, docs:, chore:など）を使い、修正内容が一目で分かる簡潔な日本語にしてください。複数の指摘をまとめた名前や、現在のGit Diff全体を表す名前にはしないでください。
各位置情報は次の役割を厳守してください。
- file: リポジトリを基準にしたファイルパスだけを記載します。行番号や関数名を含めません。
- line: Git Diffで問題を確認できる変更後の行番号だけを「410」または「410-435」の形式で記載します。関数名を含めません。特定できなければ空文字にします。
- functionName: 問題が含まれる関数・メソッド・コンポーネント・型などの名前だけを記載します。行番号を含めません。該当しなければ空文字にします。
\`\`\`json
{
  "reviews": [
    {
      "category": "バグ・ロジック",
      "severity": "high | medium | low",
      "file": "src/example.ts",
      "line": "410-435",
      "functionName": "exampleFunction",
      "title": "対応内容を短く記載",
      "reason": "問題となる理由",
      "suggestion": "具体的な修正案",
      "suggestedCommitMessage": "fix: 指摘内容に対応する短いコミット名"
    }
  ]
}
\`\`\`
問題がなければ、同じコードブロック形式で {"reviews": []} を返してください。

## Git Diff
${diff}`;

const buildTestPrompt = (task: Task, sources: TestPromptSource[], selectedPoints: string[]) => `あなたはデスクトップ・Webアプリの品質確認に詳しいQA担当者です。次の1つ以上のリポジトリのGit Diffを横断して確認し、利用者がアプリを実際に操作して変更内容を確認するための動作確認手順を作成してください。

単体テストや自動テストのコードは作成せず、画面操作、確認する表示、保存・再起動後の状態など、人が確認できる手順にしてください。変更された全ファイルと全差分ブロックを確認し、今回の変更に直接関係する確認項目を優先してください。実際に確認していない項目を成功したとは記載しないでください。

## 手順の書き方
- ソースコード上の変数名、型名、カラム名、テーブル名、localStorageのキーなど、画面に表示されない内部名を事前条件・操作手順・期待結果へ書かないでください。
- 事前条件は、アプリの通常操作で利用者が用意できる状態を、画面名・ボタン名・入力するサンプル値を使って具体的に記載してください。
- 操作手順は、利用者が画面を見ながらそのまま実施できる粒度にしてください。
- 期待結果は、画面の文言、件数、色、表示位置、保存後または再起動後の状態など、利用者が確認できる内容にしてください。
- データベースの直接編集や開発者による特殊なデータ準備が必要な確認はchecksへ含めず、その理由をassumptionsへ記載してください。
- fileにはファイルパス、lineには変更後の行番号、functionNameには関数・メソッド・コンポーネントなどの名前を分けて記載してください。lineへ関数名を入れないでください。
- repositoriesには、その確認項目に関係する対象リポジトリ名を、下記の対象リポジトリ名から選んで配列で記載してください。複数リポジトリにまたがる確認では複数指定してください。

## 対象作業
${task.title}

## 対象リポジトリと比較
${sources.map(({ repository, base, target }) => `- ${repository.name}${repository.url ? ` (${repository.url})` : ""}: ${base || "main"} → ${target || "HEAD"}`).join("\n")}

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
      "file": "src/components/TaskDetail.tsx",
      "line": "578",
      "functionName": "TaskDetail",
      "repositories": ["${sources[0]?.repository.name || "対象リポジトリ名"}"],
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

## リポジトリ別Git Diff
${sources.map(({ repository, base, target, diff }) => `### ${repository.name}（${base || "main"} → ${target || "HEAD"}）\n${diff}`).join("\n\n")}`;

export function CodeReviewWindow({ task, repositories, onUpdate }: { task: Task; repositories: GithubRepository[]; onUpdate: (changes: Partial<Task>, historyText?: string) => void }) {
  type ReviewView = "review-prompt" | "checklist" | "closed" | "history" | "test-prompt" | "tests" | "timeline" | "tests-closed" | "tests-history";
  const taskId = task.id;
  const viewStorageKey = `chatTaskCodeReviewView:${taskId}`;
  const repositoryStorageKey = `chatTaskCodeReviewRepository:${taskId}`;
  const testSourcesStorageKey = `chatTaskVerificationPromptSources:${taskId}`;
  const navigationCollapsedStorageKey = `chatTaskCodeReviewNavigationCollapsed:${taskId}`;
  const verificationSortStorageKey = `chatTaskVerificationSortRules:${taskId}`;
  const [activeView, setActiveView] = useState<ReviewView>(() => {
    const saved = localStorage.getItem(viewStorageKey);
    if (saved === "prompt") return localStorage.getItem(`chatTaskCodeReviewPromptMode:${taskId}`) === "test" ? "test-prompt" : "review-prompt";
    return saved === "checklist" || saved === "closed" || saved === "history" || saved === "test-prompt" || saved === "tests" || saved === "timeline" || saved === "tests-closed" || saved === "tests-history" ? saved : "review-prompt";
  });
  const [lastReviewView, setLastReviewView] = useState<ReviewView>(() => ["test-prompt", "tests", "timeline", "tests-closed", "tests-history"].includes(activeView) ? "review-prompt" : activeView);
  const [lastTestView, setLastTestView] = useState<ReviewView>(() => ["test-prompt", "tests", "timeline", "tests-closed", "tests-history"].includes(activeView) ? activeView : "test-prompt");
  const [navigationCollapsed, setNavigationCollapsed] = useState(() => localStorage.getItem(navigationCollapsedStorageKey) === "true");
  const [selectedRepositoryId, setSelectedRepositoryId] = useState(() => {
    const saved = localStorage.getItem(repositoryStorageKey) || "";
    return saved === "unassigned" || repositories.some((repository) => repository.id === saved) ? saved : repositories[0]?.id || "";
  });
  const repositoryById = (repositoryId: string) => repositories.find((repository) => repository.id === repositoryId);
  const branchStorageKey = `chatTaskCodeReviewBranches:${taskId}:${selectedRepositoryId || "unassigned"}`;
  const initialBranches = (() => {
    try { return JSON.parse(localStorage.getItem(branchStorageKey) || "{}") as { base?: string; target?: string }; } catch { return {}; }
  })();
  const [base, setBase] = useState(initialBranches.base || defaultReviewBaseBranch(task, repositoryById(selectedRepositoryId)));
  const [target, setTarget] = useState(initialBranches.target || "");
  const [customTargetOpen, setCustomTargetOpen] = useState(Boolean(initialBranches.target));
  const [diff, setDiff] = useState("");
  const [prompt, setPrompt] = useState("");
  const [testPrompt, setTestPrompt] = useState("");
  const [testSourceSettings, setTestSourceSettings] = useState<Record<string, { selected: boolean; base: string; target: string; diff: string }>>(() => {
    let stored: Record<string, { selected?: boolean; base?: string; target?: string }> = {};
    try { stored = JSON.parse(localStorage.getItem(testSourcesStorageKey) || "{}"); } catch { stored = {}; }
    return Object.fromEntries(repositories.map((repository, index) => [repository.id, {
      selected: stored[repository.id]?.selected ?? index === 0,
      base: stored[repository.id]?.base || defaultReviewBaseBranch(task, repository),
      target: stored[repository.id]?.target || "",
      diff: "",
    }]));
  });
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
  const [diffMode, setDiffMode] = useState<"branch" | "working">("branch");
  const [testCommandCopiedId, setTestCommandCopiedId] = useState("");
  const [testDiffMode, setTestDiffMode] = useState<"branch" | "working">("branch");
  const [testCommandRepositoryId, setTestCommandRepositoryId] = useState(() => repositories[0]?.id || "");
  const commandCopiedTimer = useRef<number | null>(null);
  const verificationCopiedTimer = useRef<number | null>(null);
  const [selectedPoints, setSelectedPoints] = useState<string[]>(reviewPoints.map(([id]) => id));
  const [selectedTestPoints, setSelectedTestPoints] = useState<string[]>(testPoints.map(([id]) => id));
  const [timelineText, setTimelineText] = useState("");
  const [timelineKind, setTimelineKind] = useState<"note" | "issue" | "retest">("note");
  const [timelineCheckIds, setTimelineCheckIds] = useState<string[]>([]);
  const [timelineFilterCheckId, setTimelineFilterCheckId] = useState("");
  const [previewVerificationCheckId, setPreviewVerificationCheckId] = useState("");
  const [timelineComposerOpen, setTimelineComposerOpen] = useState(false);
  const [editingTimelineEntryId, setEditingTimelineEntryId] = useState("");
  const [editingTimelineText, setEditingTimelineText] = useState("");
  const [editingTimelineKind, setEditingTimelineKind] = useState<"note" | "issue" | "retest">("note");
  const [editingTimelineCheckIds, setEditingTimelineCheckIds] = useState<string[]>([]);
  const [deletingTimelineEntryId, setDeletingTimelineEntryId] = useState("");
  const [timelineThreadEntryId, setTimelineThreadEntryId] = useState("");
  const [replyText, setReplyText] = useState("");
  const [replyAttachments, setReplyAttachments] = useState<Attachment[]>([]);
  const [replyAttachmentBusy, setReplyAttachmentBusy] = useState(false);
  const [replyAttachmentError, setReplyAttachmentError] = useState("");
  const [replyDragging, setReplyDragging] = useState(false);
  const [timelineAttachments, setTimelineAttachments] = useState<Attachment[]>([]);
  const [pendingTimelineAttachments, setPendingTimelineAttachments] = useState<Attachment[]>([]);
  const [timelineAttachmentBusy, setTimelineAttachmentBusy] = useState(false);
  const [timelineAttachmentError, setTimelineAttachmentError] = useState("");
  const [timelineDragging, setTimelineDragging] = useState(false);
  const timelineFileInputRef = useRef<HTMLInputElement>(null);
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  const timelineListRef = useRef<HTMLDivElement>(null);

  const checklist = task.reviewChecklist || [];
  const verificationTimeline = task.verificationTimeline || [];
  const selectedRepository = repositories.find((repository) => repository.id === selectedRepositoryId);
  const baseBranchCandidates = reviewBaseBranchCandidates(task, selectedRepository);
  const selectedTestSources = repositories.flatMap((repository) => {
    const settings = testSourceSettings[repository.id];
    return settings?.selected ? [{ repository, base: settings.base, target: settings.target, diff: settings.diff }] : [];
  });
  const selectedTestCommandSource = selectedTestSources.find(({ repository }) => repository.id === testCommandRepositoryId) || selectedTestSources[0];
  const testDiffCommand = testDiffMode === "working"
    ? "git --no-pager diff | pbcopy"
    : selectedTestCommandSource
      ? `git --no-pager diff ${selectedTestCommandSource.base.trim() || "main"}...${selectedTestCommandSource.target.trim() || "HEAD"} | pbcopy`
      : "git --no-pager diff main...HEAD | pbcopy";
  const completed = useMemo(() => checklist.filter((item) => (item.reviewStatus || (item.completed ? "completed" : "pending")) === "completed").length, [checklist]);
  const ignored = useMemo(() => checklist.filter((item) => item.reviewStatus === "ignored").length, [checklist]);
  const inProgress = useMemo(() => checklist.filter((item) => item.reviewStatus === "in-progress").length, [checklist]);
  const reviewed = completed + ignored;
  const actionableReviewCount = checklist.length - ignored;
  const diffCommand = diffMode === "working"
    ? "git --no-pager diff | pbcopy"
    : `git --no-pager diff ${base.trim() || "main"}...${target.trim() || "HEAD"} | pbcopy`;
  const verificationEntries = (task.testRuns || []).flatMap((run) => (run.checks || []).map((check, index) => ({ run, check, index })));
  const verificationCheckOptions = verificationEntries.map(({ run, check }) => ({ id: check.id, label: check.title, detail: [(check.repositories?.length ? check.repositories : run.repositories?.length ? run.repositories.map((repository) => repository.name) : [run.repositoryName || "リポジトリ未設定"]).join("・"), check.screen].filter(Boolean).join("・") }));
  const timelineFilterEntry = verificationEntries.find(({ check }) => check.id === timelineFilterCheckId);
  const previewVerificationEntry = verificationEntries.find(({ check }) => check.id === previewVerificationCheckId);
  const scopedVerificationTimeline = timelineFilterCheckId
    ? verificationTimeline.filter((entry) => entry.checkId === timelineFilterCheckId || entry.checkIds?.includes(timelineFilterCheckId))
    : verificationTimeline;
  const visibleVerificationTimeline = scopedVerificationTimeline.filter((entry) => !entry.parentEntryId);
  const timelineThreadEntry = verificationTimeline.find((entry) => entry.id === timelineThreadEntryId);
  const timelineThreadReplies = timelineThreadEntry ? verificationTimeline.filter((entry) => entry.parentEntryId === timelineThreadEntry.id) : [];
  const activeVerificationEntries = verificationEntries.filter(({ check }) => !["passed", "ignored"].includes(check.status));
  const closedVerificationEntries = verificationEntries.filter(({ check }) => ["passed", "ignored"].includes(check.status));
  const scopedVerificationRuns = task.testRuns || [];
  const legacyTestRuns = (task.testRuns || []).filter((run) => !run.checks);
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
    let active = true;
    void listAttachments(taskId).then((attachments) => { if (active) setTimelineAttachments(attachments); }).catch(() => { if (active) setTimelineAttachments([]); });
    return () => { active = false; };
  }, [taskId]);

  useEffect(() => {
    if (activeView !== "timeline") return;
    timelineListRef.current?.scrollTo({ top: timelineListRef.current.scrollHeight, behavior: "smooth" });
  }, [activeView, timelineFilterCheckId, visibleVerificationTimeline.length]);

  useEffect(() => {
    localStorage.setItem(branchStorageKey, JSON.stringify({ base, target }));
  }, [base, branchStorageKey, target]);

  useEffect(() => {
    localStorage.setItem(verificationSortStorageKey, JSON.stringify(verificationSortRules));
  }, [verificationSortRules, verificationSortStorageKey]);

  useEffect(() => {
    setTestSourceSettings((current) => Object.fromEntries(repositories.map((repository, index) => [repository.id, current[repository.id] || { selected: index === 0, base: defaultReviewBaseBranch(task, repository), target: "", diff: "" }])));
  }, [repositories, task]);

  useEffect(() => {
    localStorage.setItem(testSourcesStorageKey, JSON.stringify(Object.fromEntries(Object.entries(testSourceSettings).map(([id, settings]) => [id, { selected: settings.selected, base: settings.base, target: settings.target }]))));
  }, [testSourceSettings, testSourcesStorageKey]);

  useEffect(() => {
    if (selectedRepositoryId && selectedRepositoryId !== "unassigned" && !repositories.some((repository) => repository.id === selectedRepositoryId)) {
      setSelectedRepositoryId(repositories[0]?.id || "");
    }
  }, [repositories, selectedRepositoryId]);

  const selectView = (view: ReviewView) => {
    setActiveView(view);
    if (["test-prompt", "tests", "timeline", "tests-closed", "tests-history"].includes(view)) setLastTestView(view);
    else setLastReviewView(view);
    localStorage.setItem(viewStorageKey, view);
  };

  const openTimeline = (checkId = "") => {
    setPreviewVerificationCheckId("");
    setTimelineFilterCheckId(checkId);
    setTimelineCheckIds(checkId ? [checkId] : []);
    setTimelineComposerOpen(false);
    setTimelineThreadEntryId("");
    selectView("timeline");
  };

  const activeArea = ["test-prompt", "tests", "timeline", "tests-closed", "tests-history"].includes(activeView) ? "test" : "review";
  const selectArea = (area: "review" | "test") => {
    if (activeArea === area) {
      setNavigationCollapsed((current) => {
        localStorage.setItem(navigationCollapsedStorageKey, String(!current));
        return !current;
      });
      return;
    }
    setNavigationCollapsed(false);
    localStorage.setItem(navigationCollapsedStorageKey, "false");
    selectView(area === "review" ? lastReviewView : lastTestView);
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
    setBase(saved.base || defaultReviewBaseBranch(task, repositoryById(repositoryId)));
    setTarget(saved.target || "");
    setCustomTargetOpen(Boolean(saved.target));
    localStorage.setItem(repositoryStorageKey, repositoryId);
    setPrompt("");
    setMessage("");
  };

  const generateReviewPrompt = () => {
    if (!diff.trim()) {
      setMessage("Git Diffを入力してください。");
      return;
    }
    setPrompt(buildReviewPrompt(task, selectedRepository, diff.trim(), base.trim(), target.trim(), selectedPoints));
    setMessage("AIへ渡すレビュープロンプトを作成しました。");
  };

  const generateTestPrompt = () => {
    if (!selectedTestSources.length) {
      setMessage("対象リポジトリを1つ以上選択してください。");
      return;
    }
    if (selectedTestSources.some((source) => !source.diff.trim())) {
      setMessage("選択したすべてのリポジトリにGit Diffを入力してください。");
      return;
    }
    setTestPrompt(buildTestPrompt(task, selectedTestSources.map((source) => ({ ...source, diff: source.diff.trim() })), selectedTestPoints));
    setMessage("選択したリポジトリをまとめた動作確認プロンプトを作成しました。");
  };

  const copyPrompt = async (kind: "review" | "test") => {
    const value = kind === "review" ? prompt : testPrompt;
    try {
      await navigator.clipboard.writeText(value);
      setMessage(kind === "review" ? "レビュープロンプトをコピーしました。" : "動作確認プロンプトをコピーしました。");
    } catch {
      setMessage("コピーできませんでした。テキスト欄からコピーしてください。");
    }
  };

  const copyTestDiffCommand = async (repositoryId: string) => {
    const settings = testSourceSettings[repositoryId];
    if (!settings) return;
    const command = testDiffMode === "working"
      ? "git --no-pager diff | pbcopy"
      : `git --no-pager diff ${settings.base.trim() || "main"}...${settings.target.trim() || "HEAD"} | pbcopy`;
    try {
      await navigator.clipboard.writeText(command);
      setTestCommandCopiedId(repositoryId);
      if (commandCopiedTimer.current !== null) window.clearTimeout(commandCopiedTimer.current);
      commandCopiedTimer.current = window.setTimeout(() => setTestCommandCopiedId(""), 1800);
    } catch {
      setMessage("コマンドをコピーできませんでした。");
    }
  };

  const pasteTestDiff = async (repositoryId: string) => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) {
        setMessage("クリップボードに差分がありません。");
        return;
      }
      setTestSourceSettings((current) => ({ ...current, [repositoryId]: { ...current[repositoryId], diff: clipboardText } }));
      setMessage("クリップボードからGit Diffを貼り付けました。");
    } catch {
      setMessage("クリップボードを読み取れませんでした。入力欄へ直接貼り付けてください。");
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
          line: parsedItem.line || existing.line,
          functionName: parsedItem.functionName || existing.functionName,
          location: parsedItem.location || existing.location,
          reason: parsedItem.reason || existing.reason,
          suggestion: parsedItem.suggestion || existing.suggestion,
          suggestedCommitMessage: parsedItem.suggestedCommitMessage || existing.suggestedCommitMessage,
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
        noFindings,
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
    const targetRepositories = selectedTestSources.map(({ repository, base: sourceBase, target: sourceTarget }) => ({
      id: repository.id,
      name: repository.name,
      baseBranch: sourceBase.trim() || "main",
      targetBranch: sourceTarget.trim() || "HEAD",
    }));
    if (!targetRepositories.length) {
      setMessage("対象リポジトリを1つ以上選択してください。");
      return;
    }
    const repositoryNames = new Set(targetRepositories.map((repository) => repository.name));
    const scopedResult = {
      ...parsed,
      checks: parsed.checks.map((check) => {
        const matchedRepositories = check.repositories.filter((name) => repositoryNames.has(name));
        return { ...check, repositories: matchedRepositories.length ? matchedRepositories : targetRepositories.map((repository) => repository.name) };
      }),
    };
    const now = new Date().toISOString();
    const singleRepository = targetRepositories.length === 1 ? targetRepositories[0] : undefined;
    onUpdate({
      testRuns: [...(task.testRuns || []), {
        id: generateId(),
        repositoryId: singleRepository?.id || "",
        repositoryName: singleRepository?.name || "複数リポジトリ",
        baseBranch: singleRepository?.baseBranch || "複数",
        targetBranch: singleRepository?.targetBranch || "複数",
        repositories: targetRepositories,
        testPoints: [...selectedTestPoints],
        content: JSON.stringify(scopedResult, null, 2),
        ...scopedResult,
        status: "planned",
        createdAt: now,
        updatedAt: now,
      }],
      verificationTimeline: [...verificationTimeline, {
        id: generateId(),
        kind: "system",
        text: `${targetRepositories.map((repository) => repository.name).join("・")}の動作確認項目を取り込みました。`,
        createdAt: now,
      }],
    }, `${targetRepositories.map((repository) => repository.name).join("・")}の動作確認項目を記録しました。`);
    setTestResult("");
    setMessage("");
    selectView("tests");
  };

  const uploadTimelineFiles = async (files: File[]) => {
    if (!files.length) {
      setTimelineAttachmentError("添付するファイルを選択してください。");
      setTimelineDragging(false);
      return;
    }
    setTimelineAttachmentBusy(true);
    setTimelineAttachmentError("");
    try {
      const uploaded: Attachment[] = [];
      for (const file of files) uploaded.push(await addAttachment(taskId, file));
      setPendingTimelineAttachments((current) => [...current, ...uploaded]);
      setTimelineAttachments((current) => [...current, ...uploaded]);
      window.dispatchEvent(new CustomEvent("chattask-attachments-changed", { detail: { taskId } }));
    } catch (reason) {
      setTimelineAttachmentError(`画像を保存できませんでした: ${String(reason)}`);
    } finally {
      setTimelineAttachmentBusy(false);
      setTimelineDragging(false);
    }
  };

  const selectTimelineImages = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length) void uploadTimelineFiles(files);
  };

  const pasteTimelineImages = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData.items).filter((item) => item.kind === "file");
    if (!items.length) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const files = items.flatMap((item, index) => {
      const file = item.getAsFile();
      if (!file || !file.type.startsWith("image/")) return [];
      const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
      return [new File([file], `verification-${timestamp}-${index + 1}.${extension}`, { type: file.type })];
    });
    if (!files.length) return;
    event.preventDefault();
    void uploadTimelineFiles(files);
  };

  const dropTimelineImages = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    if (files.length) void uploadTimelineFiles(files);
    else setTimelineDragging(false);
  };

  const removePendingTimelineAttachment = async (attachment: Attachment) => {
    setTimelineAttachmentBusy(true);
    try {
      await removeAttachment(attachment.id);
      setPendingTimelineAttachments((current) => current.filter((item) => item.id !== attachment.id));
      setTimelineAttachments((current) => current.filter((item) => item.id !== attachment.id));
      window.dispatchEvent(new CustomEvent("chattask-attachments-changed", { detail: { taskId } }));
    } catch (reason) {
      setTimelineAttachmentError(`画像を取り消せませんでした: ${String(reason)}`);
    } finally {
      setTimelineAttachmentBusy(false);
    }
  };

  const uploadReplyFiles = async (files: File[]) => {
    if (!files.length) return;
    setReplyAttachmentBusy(true);
    setReplyAttachmentError("");
    try {
      const uploaded: Attachment[] = [];
      for (const file of files) uploaded.push(await addAttachment(taskId, file));
      setReplyAttachments((current) => [...current, ...uploaded]);
      setTimelineAttachments((current) => [...current, ...uploaded]);
      window.dispatchEvent(new CustomEvent("chattask-attachments-changed", { detail: { taskId } }));
    } catch (reason) {
      setReplyAttachmentError(`ファイルを保存できませんでした: ${String(reason)}`);
    } finally {
      setReplyAttachmentBusy(false);
      setReplyDragging(false);
    }
  };

  const selectReplyFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length) void uploadReplyFiles(files);
  };

  const pasteReplyImages = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const files = Array.from(event.clipboardData.items).flatMap((item, index) => {
      const file = item.kind === "file" ? item.getAsFile() : null;
      if (!file || !file.type.startsWith("image/")) return [];
      const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
      return [new File([file], `reply-${timestamp}-${index + 1}.${extension}`, { type: file.type })];
    });
    if (!files.length) return;
    event.preventDefault();
    void uploadReplyFiles(files);
  };

  const dropReplyFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    if (files.length) void uploadReplyFiles(files);
    else setReplyDragging(false);
  };

  const removeReplyAttachment = async (attachment: Attachment) => {
    setReplyAttachmentBusy(true);
    try {
      await removeAttachment(attachment.id);
      setReplyAttachments((current) => current.filter((item) => item.id !== attachment.id));
      setTimelineAttachments((current) => current.filter((item) => item.id !== attachment.id));
      window.dispatchEvent(new CustomEvent("chattask-attachments-changed", { detail: { taskId } }));
    } catch (reason) {
      setReplyAttachmentError(`ファイルを取り消せませんでした: ${String(reason)}`);
    } finally {
      setReplyAttachmentBusy(false);
    }
  };

  const addTimelineReply = () => {
    if (!timelineThreadEntry) return;
    const text = replyText.trim();
    if (!text && !replyAttachments.length) return;
    const checkIds = timelineEntryCheckIds(timelineThreadEntry);
    const checkTitles = timelineEntryCheckTitles(timelineThreadEntry);
    onUpdate({ verificationTimeline: [...verificationTimeline, {
      id: generateId(),
      kind: "reply",
      parentEntryId: timelineThreadEntry.id,
      text,
      checkId: checkIds[0],
      checkTitle: checkTitles[0],
      checkIds,
      checkTitles,
      attachmentIds: replyAttachments.map((attachment) => attachment.id),
      createdAt: new Date().toISOString(),
    }] }, "動作確認タイムラインに返信しました。");
    setReplyText("");
    setReplyAttachments([]);
    setReplyAttachmentError("");
  };

  const closeTimelineThread = async () => {
    const attachments = [...replyAttachments];
    setTimelineThreadEntryId("");
    setReplyText("");
    setReplyAttachments([]);
    setReplyAttachmentError("");
    setEditingTimelineEntryId("");
    setDeletingTimelineEntryId("");
    const removedIds = new Set<string>();
    for (const attachment of attachments) {
      try {
        await removeAttachment(attachment.id);
        removedIds.add(attachment.id);
      } catch {
        // 保存済みの一覧は維持し、次回の読み込みで同期する。
      }
    }
    if (removedIds.size) {
      setTimelineAttachments((current) => current.filter((attachment) => !removedIds.has(attachment.id)));
      window.dispatchEvent(new CustomEvent("chattask-attachments-changed", { detail: { taskId } }));
    }
  };

  const addTimelineEntry = () => {
    const text = timelineText.trim();
    if (!text && !pendingTimelineAttachments.length) return;
    const selectedChecks = verificationEntries.filter(({ check }) => timelineCheckIds.includes(check.id)).map(({ check }) => check);
    const checkIds = selectedChecks.map((check) => check.id);
    const checkTitles = selectedChecks.map((check) => check.title);
    const createdAt = new Date().toISOString();
    onUpdate({
      verificationTimeline: [...verificationTimeline, {
        id: generateId(),
        kind: timelineKind,
        text,
        checkId: checkIds[0],
        checkTitle: checkTitles[0],
        checkIds,
        checkTitles,
        attachmentIds: pendingTimelineAttachments.map((attachment) => attachment.id),
        createdAt,
      }],
    }, `動作確認タイムラインに${timelineKindLabels[timelineKind]}を追加しました。`);
    setTimelineText("");
    setTimelineCheckIds(timelineFilterCheckId ? [timelineFilterCheckId] : []);
    setPendingTimelineAttachments([]);
    setTimelineAttachmentError("");
    setTimelineComposerOpen(false);
  };

  const cancelTimelineComposer = async () => {
    const attachments = [...pendingTimelineAttachments];
    setTimelineComposerOpen(false);
    setTimelineText("");
    setTimelineKind("note");
    setTimelineCheckIds(timelineFilterCheckId ? [timelineFilterCheckId] : []);
    setPendingTimelineAttachments([]);
    setTimelineAttachmentError("");
    if (!attachments.length) return;
    const removedIds = new Set<string>();
    for (const attachment of attachments) {
      try {
        await removeAttachment(attachment.id);
        removedIds.add(attachment.id);
      } catch {
        // 添付一覧は維持し、次回の読み込みで保存状態と同期する。
      }
    }
    if (removedIds.size) {
      setTimelineAttachments((current) => current.filter((attachment) => !removedIds.has(attachment.id)));
      window.dispatchEvent(new CustomEvent("chattask-attachments-changed", { detail: { taskId } }));
    }
  };

  const deleteTimelineEntry = (entryId: string) => {
    onUpdate({ verificationTimeline: verificationTimeline.filter((entry) => entry.id !== entryId && entry.parentEntryId !== entryId) }, "動作確認タイムラインの記録を削除しました。");
    setDeletingTimelineEntryId("");
    if (editingTimelineEntryId === entryId) setEditingTimelineEntryId("");
    if (timelineThreadEntryId === entryId) setTimelineThreadEntryId("");
  };

  const startEditingTimelineEntry = (entry: NonNullable<Task["verificationTimeline"]>[number]) => {
    setEditingTimelineEntryId(entry.id);
    setEditingTimelineText(entry.text);
    setEditingTimelineKind(["note", "issue", "retest"].includes(entry.kind) ? entry.kind as "note" | "issue" | "retest" : "note");
    setEditingTimelineCheckIds(timelineEntryCheckIds(entry));
    setDeletingTimelineEntryId("");
  };

  const saveTimelineEntryEdit = () => {
    if (!editingTimelineEntryId) return;
    const currentEntry = verificationTimeline.find((entry) => entry.id === editingTimelineEntryId);
    if (!currentEntry) return;
    const selectedIds = timelineFilterEntry && !editingTimelineCheckIds.includes(timelineFilterEntry.check.id) ? [timelineFilterEntry.check.id, ...editingTimelineCheckIds] : editingTimelineCheckIds;
    const selectedChecks = verificationEntries.filter(({ check }) => selectedIds.includes(check.id)).map(({ check }) => check);
    const checkIds = selectedChecks.map((check) => check.id);
    const checkTitles = selectedChecks.map((check) => check.title);
    onUpdate({
      verificationTimeline: verificationTimeline.map((entry) => entry.id === editingTimelineEntryId ? {
        ...entry,
        kind: ["status", "system", "reply"].includes(entry.kind) ? entry.kind : editingTimelineKind,
        text: editingTimelineText.trim(),
        checkId: checkIds[0],
        checkTitle: checkTitles[0],
        checkIds,
        checkTitles,
      } : entry),
    }, "動作確認タイムラインの記録を編集しました。");
    setEditingTimelineEntryId("");
  };

  const updateVerificationStatus = (runId: string, checkIndex: number, status: NonNullable<NonNullable<Task["testRuns"]>[number]["checks"]>[number]["status"]) => {
    const now = new Date().toISOString();
    const changedCheck = (task.testRuns || []).find((run) => run.id === runId)?.checks?.[checkIndex];
    if (!changedCheck || changedCheck.status === status) return;
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
      verificationTimeline: [...verificationTimeline, {
        id: generateId(),
        kind: "status",
        text: `${verificationStatusLabels[changedCheck.status]}から${verificationStatusLabels[status]}へ変更`,
        checkId: changedCheck.id,
        checkTitle: changedCheck.title,
        checkIds: [changedCheck.id],
        checkTitles: [changedCheck.title],
        fromStatus: changedCheck.status,
        toStatus: status,
        createdAt: now,
      }],
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

  const verificationRepositoryNames = (run: NonNullable<Task["testRuns"]>[number], check?: NonNullable<NonNullable<Task["testRuns"]>[number]["checks"]>[number]) => {
    const runNames = run.repositories?.length ? run.repositories.map((repository) => repository.name) : [run.repositoryName || "リポジトリ未設定"];
    return check?.repositories?.length ? check.repositories : runNames;
  };

  const copyVerificationQuestion = async (run: NonNullable<Task["testRuns"]>[number], check: NonNullable<NonNullable<Task["testRuns"]>[number]["checks"]>[number], key: string) => {
    const statusLabel = { pending: "未実施", "in-progress": "確認中", passed: "確認済み", failed: "問題あり", ignored: "対象外" }[check.status];
    const text = [
      "次のアプリ動作確認について、確認の目的と具体的な実施方法を説明してください。",
      "ソースコードの変数名やデータベースのカラム名ではなく、実際の画面名・ボタン名・操作内容を使って説明してください。通常の画面操作だけでは準備できない場合は、その点も明記してください。",
      "",
      `対象タスク: ${task.title}`,
      `対象リポジトリ: ${verificationRepositoryNames(run, check).join("、")}`,
      check.screen && `対象画面: ${check.screen}`,
      check.file && `ファイル: ${check.file}`,
      check.line && `行: ${check.line}`,
      check.functionName && `関数・メソッド: ${check.functionName}`,
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
    const timelineCount = verificationTimeline.filter((entry) => timelineEntryCheckIds(entry).includes(check.id)).length;
    const sourceLocation = [check.file, check.line && `L${check.line.replace(/^L/i, "")}`, check.functionName].filter(Boolean).join(" › ");
    return <article className={`verification-${check.status}`} key={deleteKey}>
      <div className="review-checklist-item-main"><span><code>{check.screen || "対象画面未設定"}</code>{sourceLocation && <code>{sourceLocation}</code>}<strong>{check.title}</strong><small>{verificationRepositoryNames(run, check).map((name, repositoryIndex) => <em className="review-repository-badge" key={`${name}:${repositoryIndex}`}>{name}</em>)}<em>{check.category}</em>{run.environment?.map((environment) => <em className="verification-environment-badge" key={environment}>{environment}</em>)}</small></span></div>
      <select className={`review-checklist-status status-${check.status}`} aria-label={`${check.title}の確認状態`} value={check.status} onChange={(event) => updateVerificationStatus(run.id, index, event.target.value as typeof check.status)}><option value="pending">未実施</option><option value="in-progress">確認中</option><option value="passed">確認済み</option><option value="failed">問題あり</option><option value="ignored">対象外</option></select>
      <button type="button" className="danger-text" aria-label={`${check.title}を削除`} onClick={() => setDeletingTestRunId(deleteKey)}>×</button>
      <div className="review-checklist-item-actions"><button type="button" className="verification-timeline-open" onClick={() => openTimeline(check.id)}>タイムライン{timelineCount > 0 && <small>{timelineCount}</small>}</button><button type="button" className="ai-copy" onClick={() => void copyVerificationQuestion(run, check, deleteKey)}>{copiedVerificationKey === deleteKey ? "コピー済み" : copiedVerificationKey === `${deleteKey}:error` ? "コピー失敗" : "AI質問用にコピー"}</button></div>
      {deletingTestRunId === deleteKey && <div className="verification-item-delete"><span>削除しますか？</span><button type="button" onClick={() => setDeletingTestRunId("")}>戻る</button><button type="button" className="danger" onClick={() => deleteVerificationCheck(run.id, index)}>削除する</button></div>}
      <details><summary>事前条件・操作手順・期待結果</summary><div className="review-checklist-details verification-details">{check.preconditions.length > 0 && <section><strong>事前条件</strong><ul>{check.preconditions.map((condition) => <li key={condition}>{condition}</li>)}</ul></section>}<section><strong>操作手順</strong>{check.steps.length > 0 ? <ol>{check.steps.map((step) => <li key={step}>{step}</li>)}</ol> : <p>操作手順はありません。</p>}</section><section className="suggestion"><strong>期待結果</strong><p>{check.expectedResult || "期待結果は未設定です。"}</p></section></div></details>
    </article>;
  };

  const deleteTestRun = (id: string) => {
    onUpdate({ testRuns: (task.testRuns || []).filter((run) => run.id !== id) }, "動作確認記録を削除しました。");
    setDeletingTestRunId("");
  };

  return <main className={`code-review-window ${navigationCollapsed ? "navigation-collapsed" : ""}`}>
    <aside className="code-review-navigation">
      <nav className="code-review-activity-bar" aria-label="機能を選択">
        <button type="button" className={activeArea === "review" ? "active" : ""} aria-label="コードレビュー" aria-pressed={activeArea === "review"} data-tooltip="コードレビュー" onClick={() => selectArea("review")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9l-3 3 3 3M16 9l3 3-3 3M14 5l-4 14" /></svg></button>
        <button type="button" className={activeArea === "test" ? "active" : ""} aria-label="動作確認" aria-pressed={activeArea === "test"} data-tooltip="動作確認" onClick={() => selectArea("test")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v5l-5 9a2 2 0 001.8 3h10.4a2 2 0 001.8-3l-5-9V3M8 15h8M9 18h6" /></svg></button>
      </nav>
      <nav className="code-review-view-tabs" aria-label={`${activeArea === "review" ? "コードレビュー" : "動作確認"}のメニュー`}>
      <div className="code-review-sidebar-progress" aria-label="確認進捗">
        {activeArea === "review" && <div><small>レビュー進捗</small><strong>{completed}<span> / {actionableReviewCount}</span></strong></div>}
        {activeArea === "test" && <div className="verification"><small>動作確認進捗</small><strong>{completedVerificationTotal}<span> / {actionableVerificationCount}</span></strong></div>}
      </div>
      {activeArea === "review" && <div className="code-review-nav-group review-group" role="group" aria-label="コードレビュー">
        <p>コードレビュー</p>
        <button type="button" className={activeView === "review-prompt" ? "active" : ""} aria-pressed={activeView === "review-prompt"} onClick={() => selectView("review-prompt")}><span>⌘</span><div><strong>プロンプト生成</strong><small>リポジトリごとにレビュー</small></div></button>
        <button type="button" className={activeView === "checklist" ? "active" : ""} aria-pressed={activeView === "checklist"} onClick={() => selectView("checklist")}><span>✓</span><div><strong>チェックリスト</strong><small>{checklist.length ? `${inProgress ? `${inProgress}件対応中・` : ""}未対応${checklist.length - reviewed - inProgress}件` : "レビュー結果の対応を管理"}</small></div></button>
        <button type="button" className={activeView === "closed" ? "active" : ""} aria-pressed={activeView === "closed"} onClick={() => selectView("closed")}><span>○</span><div><strong>完了・対象外</strong><small>{reviewed ? `${reviewed}件` : "完了した指摘を確認"}</small></div></button>
        <button type="button" className={activeView === "history" ? "active" : ""} aria-pressed={activeView === "history"} onClick={() => selectView("history")}><span>↶</span><div><strong>過去のレビュー</strong><small>{task.codeReviewRuns?.length ? `${task.codeReviewRuns.length}回` : "レビュー履歴を確認"}</small></div></button>
      </div>}
      {activeArea === "test" && <div className="code-review-nav-group test-group" role="group" aria-label="動作確認">
        <p>動作確認</p>
        <button type="button" className={activeView === "test-prompt" ? "active" : ""} aria-pressed={activeView === "test-prompt"} onClick={() => selectView("test-prompt")}><span>⌘</span><div><strong>プロンプト生成</strong><small>対象リポジトリをまとめて作成</small></div></button>
        <button type="button" className={activeView === "tests" ? "active" : ""} aria-pressed={activeView === "tests"} onClick={() => selectView("tests")}><span>✓</span><div><strong>確認記録</strong><small>{activeVerificationTotal ? `未完了${activeVerificationTotal}件` : "操作手順と結果を記録"}</small></div></button>
        <button type="button" className={activeView === "timeline" ? "active" : ""} aria-pressed={activeView === "timeline"} onClick={() => openTimeline()}><span>◷</span><div><strong>タイムライン</strong><small>{task.verificationTimeline?.length ? `${task.verificationTimeline.length}件の記録` : "不具合や再確認を記録"}</small></div></button>
        <button type="button" className={activeView === "tests-closed" ? "active" : ""} aria-pressed={activeView === "tests-closed"} onClick={() => selectView("tests-closed")}><span>○</span><div><strong>完了・対象外</strong><small>{closedVerificationTotal ? `${closedVerificationTotal}件` : "確認済みの項目"}</small></div></button>
        <button type="button" className={activeView === "tests-history" ? "active" : ""} aria-pressed={activeView === "tests-history"} onClick={() => selectView("tests-history")}><span>↶</span><div><strong>過去の確認</strong><small>{task.testRuns?.length ? `${task.testRuns.length}回` : "取り込み履歴を確認"}</small></div></button>
      </div>}
      </nav>
    </aside>

    {activeView === "review-prompt" && <div className="code-review-workspace">
      <section className="code-review-input-panel">
        <header><strong>1. 差分を準備</strong><small>比較対象とGit Diffを入力</small></header>
        <label className="code-review-repository">対象リポジトリ<select value={selectedRepositoryId} onChange={(event) => selectRepository(event.target.value)} disabled={!repositories.length}>{!repositories.length && <option value="">リポジトリ未設定</option>}{selectedRepositoryId === "unassigned" && <option value="unassigned">以前の未分類項目</option>}{repositories.map((repository) => <option value={repository.id} key={repository.id}>{repository.name}</option>)}</select>{!repositories.length && <small>案件タグの設定からリポジトリを登録できます。</small>}</label>
        <div className="code-review-compare-settings">
          <label className="code-review-branch-field"><span>基準</span><input aria-label="基準ブランチ" list={`review-base-branches-${selectedRepositoryId || "unassigned"}`} value={base} onChange={(event) => setBase(event.target.value)} placeholder="ブランチを選択または入力" /><datalist id={`review-base-branches-${selectedRepositoryId || "unassigned"}`}>{baseBranchCandidates.map((branch) => <option value={branch} key={branch} />)}</datalist></label>
          <span className="code-review-compare-arrow" aria-hidden="true">→</span>
          <div className={`code-review-target-summary ${customTargetOpen ? "editing" : ""}`}><div><span>比較先</span>{customTargetOpen ? <input autoFocus aria-label="任意の比較先" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="feature/example" /> : <p><strong>HEAD</strong><small>現在のブランチ</small></p>}</div><button type="button" onClick={() => { if (customTargetOpen) setTarget(""); setCustomTargetOpen((current) => !current); }}>{customTargetOpen ? "HEADへ戻す" : "変更"}</button></div>
        </div>
        <div className="code-review-diff-mode" role="group" aria-label="差分の種類"><span>差分の種類</span><button type="button" className={diffMode === "branch" ? "active" : ""} aria-pressed={diffMode === "branch"} onClick={() => { setDiffMode("branch"); setCommandCopied(false); }}>ブランチ差分</button><button type="button" className={diffMode === "working" ? "active" : ""} aria-pressed={diffMode === "working"} onClick={() => { setDiffMode("working"); setCommandCopied(false); }}>未コミット差分</button></div>
        <div className="code-review-command"><code><span aria-hidden="true">$</span>{diffCommand}</code><button type="button" className={`primary ${commandCopied ? "copied" : ""}`} onClick={() => void copyDiffCommand()}>{commandCopied ? <><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4 4L19 7" /></svg>コピー済み</> : <><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" /></svg>コマンドをコピー</>}</button></div>
        <p className="code-review-command-help">{diffMode === "working" ? "コミット前の変更差分をクリップボードへ格納します。" : "選択したブランチ間の比較結果をクリップボードへ格納します。"}</p>
        <fieldset><legend>確認観点</legend><div>{reviewPoints.map(([id, label]) => <label key={id}><input type="checkbox" checked={selectedPoints.includes(id)} onChange={(event) => setSelectedPoints((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))} />{label}</label>)}</div></fieldset>
        <div className="code-review-textarea"><div className="code-review-diff-label"><strong>Git Diff</strong><button type="button" className="secondary" onClick={() => void pasteDiff()}>クリップボードから貼付</button></div><textarea aria-label="Git Diff" value={diff} onChange={(event) => setDiff(event.target.value)} placeholder="git diff の内容を貼り付けてください" spellCheck={false} /></div>
        <button type="button" className="primary code-review-main-action" disabled={!diff.trim()} onClick={generateReviewPrompt}>レビュープロンプトを作成</button>
      </section>

      <section className="code-review-output-panel">
        <header><strong>2. AIでレビュー</strong><small>プロンプトを送り、回答を取り込む</small></header>
        <label className="code-review-textarea compact">生成したプロンプト<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="左側でDiffを入力すると作成できます" spellCheck={false} /></label>
        <button type="button" disabled={!prompt.trim()} onClick={() => void copyPrompt("review")}>プロンプトをコピー</button>
        <label className="code-review-textarea compact">AIの回答<textarea value={result} onChange={(event) => setResult(event.target.value)} placeholder="AIが返したJSONを貼り付けてください" spellCheck={false} /></label><button type="button" className="primary" disabled={!result.trim()} onClick={importResult}>チェックリストを作成</button>
        {message && <p className="code-review-message" role="status">{message}</p>}
      </section>
    </div>}

    {activeView === "test-prompt" && <div className="code-review-workspace verification-prompt-workspace">
      <section className="code-review-input-panel">
        <header><strong>1. 動作確認の対象を準備</strong><small>対象リポジトリを選び、リポジトリごとのDiffを入力</small></header>
        {!repositories.length && <p className="code-review-test-note">案件タグの設定からリポジトリを登録してください。</p>}
        {!!repositories.length && <div className="verification-source-selector"><strong>対象リポジトリ</strong><div>{repositories.map((repository) => <label key={repository.id}><input type="checkbox" checked={testSourceSettings[repository.id]?.selected || false} onChange={(event) => setTestSourceSettings((current) => ({ ...current, [repository.id]: { ...(current[repository.id] || { base: "main", target: "", diff: "" }), selected: event.target.checked } }))} />{repository.name}</label>)}</div><small>{selectedTestSources.length}件を一つの動作確認にまとめます。</small></div>}
        {!!selectedTestCommandSource && <div className="verification-command-panel"><div className="verification-command-heading"><strong>Diff取得コマンド</strong>{selectedTestSources.length > 1 && <label>対象<select value={selectedTestCommandSource.repository.id} onChange={(event) => setTestCommandRepositoryId(event.target.value)}>{selectedTestSources.map(({ repository }) => <option value={repository.id} key={repository.id}>{repository.name}</option>)}</select></label>}</div><div className="code-review-diff-mode" role="group" aria-label="差分の種類"><span>差分の種類</span><button type="button" className={testDiffMode === "branch" ? "active" : ""} aria-pressed={testDiffMode === "branch"} onClick={() => { setTestDiffMode("branch"); setTestCommandCopiedId(""); }}>ブランチ差分</button><button type="button" className={testDiffMode === "working" ? "active" : ""} aria-pressed={testDiffMode === "working"} onClick={() => { setTestDiffMode("working"); setTestCommandCopiedId(""); }}>未コミット差分</button></div><div className="code-review-command"><code><span aria-hidden="true">$</span>{testDiffCommand}</code><button type="button" className={`primary ${testCommandCopiedId === selectedTestCommandSource.repository.id ? "copied" : ""}`} onClick={() => void copyTestDiffCommand(selectedTestCommandSource.repository.id)}>{testCommandCopiedId === selectedTestCommandSource.repository.id ? "コピー済み" : "コマンドをコピー"}</button></div><small>{testDiffMode === "working" ? "対象リポジトリのフォルダで実行し、コミット前の変更を取得します。" : "対象リポジトリのフォルダで実行し、ブランチ間の差分を取得します。"}</small></div>}
        <fieldset><legend>動作確認の観点</legend><div>{testPoints.map(([id, label]) => <label key={id}><input type="checkbox" checked={selectedTestPoints.includes(id)} onChange={(event) => setSelectedTestPoints((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))} />{label}</label>)}</div></fieldset>
        <div className="verification-source-list">{selectedTestSources.map(({ repository, base: sourceBase, target: sourceTarget, diff: sourceDiff }) => {
          const branchCandidates = reviewBaseBranchCandidates(task, repository);
          return <section className="verification-source-card" key={repository.id}><header><strong>{repository.name}</strong><small>このリポジトリの変更差分</small></header><div className="code-review-branches"><label>基準<input list={`verification-base-branches-${repository.id}`} value={sourceBase} onChange={(event) => setTestSourceSettings((current) => ({ ...current, [repository.id]: { ...current[repository.id], base: event.target.value } }))} placeholder="ブランチを選択または入力" /><datalist id={`verification-base-branches-${repository.id}`}>{branchCandidates.map((branch) => <option value={branch} key={branch} />)}</datalist></label><span>→</span><label>比較先<input value={sourceTarget} onChange={(event) => setTestSourceSettings((current) => ({ ...current, [repository.id]: { ...current[repository.id], target: event.target.value } }))} placeholder="HEAD" /></label></div><div className="code-review-textarea compact"><div className="code-review-diff-label"><strong>Git Diff</strong><button type="button" className="secondary" onClick={() => void pasteTestDiff(repository.id)}>クリップボードから貼付</button></div><textarea aria-label={`${repository.name}のGit Diff`} value={sourceDiff} onChange={(event) => setTestSourceSettings((current) => ({ ...current, [repository.id]: { ...current[repository.id], diff: event.target.value } }))} placeholder={`${repository.name} の git diffを貼り付けてください`} spellCheck={false} /></div></section>;
        })}</div>
        <button type="button" className="primary code-review-main-action" disabled={!selectedTestSources.length || selectedTestSources.some((source) => !source.diff.trim())} onClick={generateTestPrompt}>動作確認プロンプトを作成</button>
      </section>
      <section className="code-review-output-panel test-prompt-mode">
        <header><strong>2. AIで動作確認を作成</strong><small>複数リポジトリの変更をまとめて操作手順にする</small></header>
        <label className="code-review-textarea compact">生成したプロンプト<textarea value={testPrompt} onChange={(event) => setTestPrompt(event.target.value)} placeholder="左側で対象リポジトリとDiffを入力すると作成できます" spellCheck={false} /></label>
        <button type="button" disabled={!testPrompt.trim()} onClick={() => void copyPrompt("test")}>プロンプトをコピー</button>
        <label className="code-review-textarea compact">AIが作成した動作確認<textarea value={testResult} onChange={(event) => setTestResult(event.target.value)} placeholder="AIが返したJSONコードブロックを貼り付けてください" spellCheck={false} /></label><button type="button" className="primary" disabled={!testResult.trim()} onClick={saveTestRun}>確認記録として保存</button><p className="code-review-test-note">選択したリポジトリを対象範囲として、事前条件・操作手順・期待結果に分けて保存します。</p>
        {message && <p className="code-review-message" role="status">{message}</p>}
      </section>
    </div>}

    {activeView === "timeline" && <div className="code-review-checklist-view verification-timeline-view"><section className="verification-timeline">
      <header><div className="verification-timeline-title"><small>動作確認 › タイムライン</small><strong>{timelineFilterEntry?.check.title || "すべての記録"}</strong>{timelineFilterEntry && <p>{verificationRepositoryNames(timelineFilterEntry.run, timelineFilterEntry.check).join("・")}{timelineFilterEntry.check.screen ? `・${timelineFilterEntry.check.screen}` : ""}</p>}</div><div className="verification-timeline-header-actions"><span>{visibleVerificationTimeline.length}件</span>{timelineFilterEntry && <button type="button" className="verification-show-card" onClick={() => setPreviewVerificationCheckId(timelineFilterEntry.check.id)}>確認項目を表示</button>}<button type="button" className="primary verification-new-entry" onClick={() => { setTimelineCheckIds(timelineFilterCheckId ? [timelineFilterCheckId] : []); setTimelineComposerOpen(true); }}>＋ 新しい記録</button>{timelineFilterEntry && <button type="button" className="verification-show-all" onClick={() => openTimeline()}>すべて表示</button>}<button type="button" className="verification-back" onClick={() => { setTimelineFilterCheckId(""); setTimelineCheckIds([]); selectView("tests"); }}>← 確認記録</button></div></header>
      <div className="verification-timeline-list" ref={timelineListRef}>
        {!visibleVerificationTimeline.length && <div className="verification-timeline-empty"><strong>{timelineFilterEntry ? "この確認項目の記録はまだありません" : "記録はまだありません"}</strong><p>「新しい記録」から、確認内容や不具合の画面を残せます。</p></div>}
        {visibleVerificationTimeline.map((entry, entryIndex) => {
          const attachments = timelineAttachments.filter((attachment) => entry.attachmentIds?.includes(attachment.id));
          const editing = editingTimelineEntryId === entry.id;
          const deleting = deletingTimelineEntryId === entry.id;
          const relatedTitles = timelineEntryCheckTitles(entry);
          const relatedIds = timelineEntryCheckIds(entry);
          const replyCount = verificationTimeline.filter((candidate) => candidate.parentEntryId === entry.id).length;
          const showDate = entryIndex === 0 || timelineDateKey(visibleVerificationTimeline[entryIndex - 1].createdAt) !== timelineDateKey(entry.createdAt);
          return <Fragment key={entry.id}>{showDate && <><div className="verification-timeline-date-anchor" aria-hidden="true" /><div className="verification-timeline-date"><span>{timelineDateLabel(entry.createdAt)}</span></div></>}<article className={`timeline-kind-${entry.kind}`}><div className="verification-timeline-marker" aria-hidden="true" /><div className="verification-timeline-entry"><header><div className="verification-timeline-entry-title">{relatedTitles.length ? (relatedIds[0] && verificationEntries.some(({ check }) => check.id === relatedIds[0]) ? <button type="button" onClick={() => setPreviewVerificationCheckId(relatedIds[0])}>{relatedTitles[0]}<span aria-hidden="true">›</span></button> : <strong>{relatedTitles[0]}</strong>) : <strong>関連する確認項目なし</strong>}{relatedTitles.length > 1 && <small>ほか{relatedTitles.length - 1}件</small>}</div><div className="verification-timeline-entry-meta"><span>{timelineKindLabels[entry.kind]}</span><time>{new Date(entry.createdAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</time></div><div className="verification-timeline-entry-actions">{deleting ? <><small>削除しますか？</small><button type="button" onClick={() => setDeletingTimelineEntryId("")}>戻る</button><button type="button" className="danger-text" onClick={() => deleteTimelineEntry(entry.id)}>削除する</button></> : <><button type="button" className="reply" onClick={() => { setTimelineThreadEntryId(entry.id); setEditingTimelineEntryId(""); setDeletingTimelineEntryId(""); }}>返信{replyCount ? ` ${replyCount}` : ""}</button><button type="button" onClick={() => startEditingTimelineEntry(entry)}>編集</button><button type="button" className="danger-text" onClick={() => { setDeletingTimelineEntryId(entry.id); setEditingTimelineEntryId(""); }}>削除</button></>}</div></header>{editing ? <div className="verification-timeline-editor"><div>{!["status", "system"].includes(entry.kind) && <label>種類<select value={editingTimelineKind} onChange={(event) => setEditingTimelineKind(event.target.value as typeof editingTimelineKind)}><option value="note">メモ</option><option value="issue">不具合</option><option value="retest">再確認</option></select></label>}</div><section className="verification-timeline-edit-checks"><strong>関連する確認項目</strong><VerificationCheckPicker options={verificationCheckOptions} selectedIds={editingTimelineCheckIds} lockedIds={timelineFilterCheckId ? [timelineFilterCheckId] : []} onChange={setEditingTimelineCheckIds} /></section><textarea value={editingTimelineText} onChange={(event) => setEditingTimelineText(event.target.value)} /><footer><button type="button" onClick={() => setEditingTimelineEntryId("")}>キャンセル</button><button type="button" className="primary" onClick={saveTimelineEntryEdit}>変更を保存</button></footer></div> : <>{entry.kind === "status" && entry.fromStatus && entry.toStatus && <div className="verification-status-change"><small>状態変更</small><span>{verificationStatusLabels[entry.fromStatus]}</span><b>→</b><span>{verificationStatusLabels[entry.toStatus]}</span></div>}{entry.text && entry.kind !== "status" && <div className="verification-timeline-body"><p>{entry.text}</p></div>}<AttachmentCards attachments={attachments} /></>}</div></article></Fragment>;
        })}
      </div>
      {timelineThreadEntry && <div className="verification-thread-screen">
        <header><div><small>動作確認 › タイムライン › 返信</small><strong>記録への返信</strong><p>{timelineThreadReplies.length}件の返信</p></div><button type="button" onClick={() => void closeTimelineThread()}>タイムラインへ戻る</button></header>
        <div className="verification-thread-list">
          <article className="verification-thread-parent"><header><span>{timelineKindLabels[timelineThreadEntry.kind]}</span><time>{new Date(timelineThreadEntry.createdAt).toLocaleString("ja-JP")}</time><strong>親の記録</strong></header>{timelineThreadEntry.text && <p>{timelineThreadEntry.text}</p>}<AttachmentCards attachments={timelineAttachments.filter((attachment) => timelineThreadEntry.attachmentIds?.includes(attachment.id))} /></article>
          <section className="verification-thread-replies"><header><strong>返信</strong><span>{timelineThreadReplies.length}件</span></header>{timelineThreadReplies.length ? timelineThreadReplies.map((reply) => {
            const editingReply = editingTimelineEntryId === reply.id;
            const deletingReply = deletingTimelineEntryId === reply.id;
            return <article key={reply.id}><header><span>返信</span><time>{new Date(reply.createdAt).toLocaleString("ja-JP")}</time><div>{deletingReply ? <><small>削除しますか？</small><button type="button" onClick={() => setDeletingTimelineEntryId("")}>戻る</button><button type="button" className="danger-text" onClick={() => deleteTimelineEntry(reply.id)}>削除する</button></> : <><button type="button" onClick={() => startEditingTimelineEntry(reply)}>編集</button><button type="button" className="danger-text" onClick={() => { setDeletingTimelineEntryId(reply.id); setEditingTimelineEntryId(""); }}>削除</button></>}</div></header>{editingReply ? <div className="verification-thread-reply-editor"><textarea value={editingTimelineText} onChange={(event) => setEditingTimelineText(event.target.value)} /><footer><button type="button" onClick={() => setEditingTimelineEntryId("")}>キャンセル</button><button type="button" className="primary" onClick={saveTimelineEntryEdit}>変更を保存</button></footer></div> : <>{reply.text && <p>{reply.text}</p>}<AttachmentCards attachments={timelineAttachments.filter((attachment) => reply.attachmentIds?.includes(attachment.id))} /></>}</article>;
          }) : <p className="verification-thread-empty">返信はまだありません。</p>}</section>
        </div>
        <div className={`verification-reply-composer ${replyDragging ? "dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setReplyDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setReplyDragging(false); }} onDrop={dropReplyFiles}>
          <textarea value={replyText} onChange={(event) => setReplyText(event.target.value)} onPaste={pasteReplyImages} placeholder="返信を入力…（画像の貼り付け、ファイルのドロップ可）" />
          <AttachmentCards attachments={replyAttachments} onRemove={(attachment) => void removeReplyAttachment(attachment)} />
          {replyAttachmentError && <p className="attachment-error">{replyAttachmentError}</p>}
          <footer><small>親の添付ファイルは返信へ引き継がれません。</small><button type="button" onClick={() => replyFileInputRef.current?.click()} disabled={replyAttachmentBusy}>{replyAttachmentBusy ? "保存中…" : "ファイルを追加"}</button><input ref={replyFileInputRef} hidden type="file" multiple onChange={selectReplyFiles} /><button type="button" className="primary" disabled={replyAttachmentBusy || (!replyText.trim() && !replyAttachments.length)} onClick={addTimelineReply}>返信する</button></footer>
          {replyDragging && <div className="verification-timeline-drop">ここにファイルをドロップ</div>}
        </div>
      </div>}
      {timelineComposerOpen && <div className={`verification-timeline-composer ${timelineDragging ? "dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setTimelineDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTimelineDragging(false); }} onDrop={dropTimelineImages}>
        <header><div><small>動作確認 › タイムライン › 新しい記録</small><strong>新しい記録を追加</strong><p>確認結果や不具合の状況を、対象の確認項目へ記録します。</p></div><button type="button" aria-label="投稿画面を閉じる" onClick={() => void cancelTimelineComposer()}>×</button></header>
        <div className="verification-timeline-form">
          <label><span>種類</span><select value={timelineKind} onChange={(event) => setTimelineKind(event.target.value as typeof timelineKind)}><option value="note">メモ</option><option value="issue">不具合</option><option value="retest">再確認</option></select></label>
          <div className="verification-timeline-check-field"><span>関連する確認項目</span><div><VerificationCheckPicker options={verificationCheckOptions} selectedIds={timelineCheckIds} lockedIds={timelineFilterCheckId ? [timelineFilterCheckId] : []} onChange={setTimelineCheckIds} />{timelineFilterEntry && <small className="verification-auto-linked">現在開いている確認項目を自動で関連付けています。</small>}</div></div>
          <label className="verification-timeline-description"><span>内容</span><textarea autoFocus value={timelineText} onChange={(event) => setTimelineText(event.target.value)} onPaste={pasteTimelineImages} placeholder="確認した内容、不具合の再現手順、補足などを入力してください。画像は貼り付け・ドロップできます。" /></label>
          <div className="verification-timeline-attachment-row"><span>添付ファイル</span><div><button type="button" onClick={() => timelineFileInputRef.current?.click()} disabled={timelineAttachmentBusy}>{timelineAttachmentBusy ? "ファイルを保存中…" : "ファイルを選択"}</button><small>画像・PDF・テキスト・ログなどを添付できます。画像は貼り付けにも対応しています。</small><input ref={timelineFileInputRef} hidden type="file" multiple onChange={selectTimelineImages} /></div></div>
          <AttachmentCards attachments={pendingTimelineAttachments} onRemove={(attachment) => void removePendingTimelineAttachment(attachment)} />
          {timelineAttachmentError && <p className="attachment-error">{timelineAttachmentError}</p>}
        </div>
        <footer><button type="button" className="verification-composer-cancel" onClick={() => void cancelTimelineComposer()}>キャンセル</button><button type="button" className="primary" disabled={timelineAttachmentBusy || (!timelineText.trim() && !pendingTimelineAttachments.length)} onClick={addTimelineEntry}>記録を追加</button></footer>
        {timelineDragging && <div className="verification-timeline-drop">ここにファイルをドロップ</div>}
      </div>}
    </section></div>}

    {previewVerificationEntry && <Modal title="動作確認カード" wide onClose={() => setPreviewVerificationCheckId("")}><div className="code-review-checklist-view verification-checklist-view verification-card-preview"><div className="task-review-checklist-items current-review-items">{renderVerificationEntry(previewVerificationEntry)}</div></div></Modal>}

    {["checklist", "closed", "history"].includes(activeView) && <div className={`code-review-checklist-view section-${activeView}`}><TaskReviewChecklist taskId={task.id} items={checklist} runs={task.codeReviewRuns || []} repositories={repositories} selectedRepositoryId={selectedRepositoryId} onSelectRepository={selectRepository} onChange={updateChecklist} onChangeReviewData={updateReviewData} allowImport={false} section={activeView === "checklist" ? "active" : activeView === "closed" ? "closed" : "history"} /></div>}
    {["tests", "tests-closed", "tests-history"].includes(activeView) && <div className={`code-review-checklist-view verification-checklist-view section-${activeView}`}><section className="task-review-checklist">
      <header><div><strong>{activeView === "tests-closed" ? "完了・対象外" : activeView === "tests-history" ? "過去の動作確認" : "現在の動作確認"}</strong><small>{activeView === "tests-closed" ? `${closedVerificationEntries.length}件` : activeView === "tests-history" ? `${scopedVerificationRuns.length}回` : activeVerificationEntries.length ? `${inProgressVerificationCount ? `確認中${inProgressVerificationCount}件・` : ""}${failedVerificationCount ? `問題あり${failedVerificationCount}件・` : ""}未実施${pendingVerificationCount}件` : "確認が必要な項目はありません"}</small></div>{activeView !== "tests-history" && <div className="review-checklist-header-actions"><button type="button" onClick={() => setVerificationSortOpen(true)}>↕ 並び替え <small>{verificationSortRules.length}条件</small></button></div>}</header>
      {activeView === "tests" && !!activeVerificationEntries.length && <div className="task-review-checklist-items current-review-items">{sortedActiveVerificationEntries.map(renderVerificationEntry)}</div>}
      {activeView === "tests" && !activeVerificationEntries.length && <p>未完了の動作確認はありません。</p>}
      {activeView === "tests-closed" && !!closedVerificationEntries.length && <div className="task-review-checklist-items current-review-items">{sortedClosedVerificationEntries.map(renderVerificationEntry)}</div>}
      {activeView === "tests-closed" && !closedVerificationEntries.length && <p>完了・対象外の項目はありません。</p>}
      {activeView === "tests-history" && !!scopedVerificationRuns.length && <section className="review-history-section"><div>{[...scopedVerificationRuns].reverse().map((run) => { const runNumber = (task.testRuns || []).findIndex((candidate) => candidate.id === run.id) + 1; const repositoryScope = verificationRepositoryNames(run).join("・"); const comparison = run.repositories?.length ? run.repositories.map((repository) => `${repository.name}: ${repository.baseBranch} → ${repository.targetBranch}`).join(" / ") : `${run.baseBranch} → ${run.targetBranch}`; return <details className="review-run-card" key={run.id}><summary><span><strong>第{runNumber}回</strong><em>{repositoryScope}</em></span><span>{comparison}</span><small>{new Date(run.createdAt).toLocaleString("ja-JP")}・確認{run.checks?.length || 0}件</small></summary>{run.checks?.length ? <ul>{run.checks.map((check, index) => <li key={`${run.id}:${index}`}><span className={`review-history-status ${check.status}`}>{check.status === "in-progress" ? "確認中" : check.status === "passed" ? "確認済み" : check.status === "failed" ? "問題あり" : check.status === "ignored" ? "対象外" : "未実施"}</span><span>{check.title}</span></li>)}</ul> : <p>以前の形式で保存された記録です。</p>}<div className="review-run-actions">{deletingTestRunId === run.id ? <div className="review-run-delete-confirm"><span>この取り込みを削除しますか？</span><button type="button" onClick={() => setDeletingTestRunId("")}>やめる</button><button type="button" className="danger" onClick={() => deleteTestRun(run.id)}>削除する</button></div> : <button type="button" className="danger-text" onClick={() => setDeletingTestRunId(run.id)}>取り込み単位で削除</button>}</div></details>; })}</div></section>}
      {activeView === "tests-history" && !scopedVerificationRuns.length && <p>動作確認履歴はありません。</p>}
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
