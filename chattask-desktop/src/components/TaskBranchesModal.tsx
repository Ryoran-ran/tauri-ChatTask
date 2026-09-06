import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { GithubRepository, ProjectTag, TaskRepositoryBranches } from "../types";
import { githubPullRequestUrl, normalizeGithubRepositoryUrl } from "../utils";
import { Modal } from "./Modal";
import { PullRequestTargetsModal } from "./PullRequestTargetsModal";

const normalizeNames = (names: string[]) => [...new Set(names.map((name) => name.trim()).filter(Boolean))];
const validRepositories = (tag?: ProjectTag): GithubRepository[] => (tag?.githubRepositories || []).map((repository) => ({ ...repository, url: normalizeGithubRepositoryUrl(repository.url) || "" })).filter((repository) => Boolean(repository.url));
const shellValue = (value: string) => /^[a-zA-Z0-9._/-]+$/.test(value) ? value : `'${value.replace(/'/g, `'"'"'`)}'`;
const repositoryExpansionStorageKey = (taskId: string) => `chatTaskRepositoryExpansion:${taskId}`;
const savedExpandedRepositories = (taskId: string) => {
  try {
    const stored = JSON.parse(localStorage.getItem(repositoryExpansionStorageKey(taskId)) || "null");
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : null;
  } catch {
    return null;
  }
};

export function TaskBranchesModal({ taskId, taskTitle, repositoryBranches, tag, onSave, onSaveRepositories, onOpenTagSettings, onClose }: {
  taskId: string;
  taskTitle: string;
  repositoryBranches: TaskRepositoryBranches[];
  tag?: ProjectTag;
  onSave: (repositoryBranches: TaskRepositoryBranches[]) => void;
  onSaveRepositories?: (repositories: GithubRepository[]) => void;
  onOpenTagSettings: () => void;
  onClose: () => void;
}) {
  const repositories = useMemo(() => validRepositories(tag), [tag]);
  const initialGroups = useMemo(() => {
    const groups = Object.fromEntries(repositoryBranches.map((group) => [group.repositoryId, normalizeNames(group.branchNames)]));
    if (repositories.length === 1 && groups[""]?.length && !groups[repositories[0].id]?.length) { groups[repositories[0].id] = groups[""]; delete groups[""]; }
    return groups;
  }, [repositories, repositoryBranches]);
  const initialTaskTargets = useMemo(() => {
    const targets = Object.fromEntries(repositoryBranches.map((group) => [group.repositoryId, normalizeNames(group.pullRequestTargets || [])]));
    if (repositories.length === 1 && targets[""]?.length && !targets[repositories[0].id]?.length) { targets[repositories[0].id] = targets[""]; delete targets[""]; }
    return targets;
  }, [repositories, repositoryBranches]);
  const [groups, setGroups] = useState<Record<string, string[]>>(initialGroups);
  const [taskTargets, setTaskTargets] = useState<Record<string, string[]>>(initialTaskTargets);
  const [commonTargets, setCommonTargets] = useState<Record<string, string[]>>(() => Object.fromEntries(repositories.map((repository) => [repository.id, normalizeNames(repository.pullRequestTargets || [])])));
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [directTargets, setDirectTargets] = useState<Record<string, string>>({});
  const [targetEditorRepositoryId, setTargetEditorRepositoryId] = useState("");
  const [pullRequestTarget, setPullRequestTarget] = useState<{ repository: GithubRepository; branchName: string } | null>(null);
  const [renamingBranch, setRenamingBranch] = useState<{ repositoryId: string; originalName: string; name: string } | null>(null);
  const [deletingBranch, setDeletingBranch] = useState<{ repositoryId: string; repositoryName: string; name: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const saved = savedExpandedRepositories(taskId);
    return new Set(saved ?? (repositories.length <= 2 ? repositories.map((repository) => repository.id) : repositories.slice(0, 1).map((repository) => repository.id)));
  });
  const [copied, setCopied] = useState("");
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});
  const taskSaveHandler = useRef(onSave);
  const repositorySaveHandler = useRef(onSaveRepositories);
  const taskSaveInitialized = useRef(false);
  const repositorySaveInitialized = useRef(false);
  const orphanIds = [...new Set([...Object.keys(groups), ...Object.keys(taskTargets)])].filter((id) => !repositories.some((repository) => repository.id === id) && ((groups[id]?.length || 0) > 0 || (taskTargets[id]?.length || 0) > 0));
  const totalBranches = Object.values(groups).reduce((total, names) => total + names.length, 0);
  useEffect(() => { taskSaveHandler.current = onSave; }, [onSave]);
  useEffect(() => { repositorySaveHandler.current = onSaveRepositories; }, [onSaveRepositories]);
  useEffect(() => {
    if (!taskSaveInitialized.current) { taskSaveInitialized.current = true; return; }
    const repositoryIds = new Set([...Object.keys(groups), ...Object.keys(taskTargets)]);
    taskSaveHandler.current([...repositoryIds].map((repositoryId) => ({ repositoryId, branchNames: normalizeNames(groups[repositoryId] || []), pullRequestTargets: normalizeNames(taskTargets[repositoryId] || []) })).filter((group) => group.branchNames.length || group.pullRequestTargets.length));
  }, [groups, taskTargets]);
  useEffect(() => {
    if (!repositorySaveInitialized.current) { repositorySaveInitialized.current = true; return; }
    repositorySaveHandler.current?.(repositories.map((repository) => ({ ...repository, pullRequestTargets: normalizeNames(commonTargets[repository.id] || []) })));
  }, [commonTargets]);
  const copy = async (value: string, key: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied((current) => current === key ? "" : current), 1400);
  };
  const addBranch = (event: FormEvent, repositoryId: string) => {
    event.preventDefault();
    const name = (inputs[repositoryId] || "").trim();
    if (!name) return;
    setGroups((current) => ({ ...current, [repositoryId]: normalizeNames([...(current[repositoryId] || []), name]) }));
    setInputs((current) => ({ ...current, [repositoryId]: "" }));
  };
  const removeBranch = (repositoryId: string, name: string) => setGroups((current) => ({ ...current, [repositoryId]: (current[repositoryId] || []).filter((branch) => branch !== name) }));
  const renameBranch = (repositoryId: string, originalName: string, name: string) => {
    const nextName = name.trim();
    if (!nextName) return;
    setGroups((current) => ({
      ...current,
      [repositoryId]: normalizeNames((current[repositoryId] || []).map((branch) => branch === originalName ? nextName : branch)),
    }));
    setRenamingBranch(null);
  };
  const updateExpanded = (updater: (current: Set<string>) => Set<string>) => setExpanded((current) => {
    const next = updater(current);
    localStorage.setItem(repositoryExpansionStorageKey(taskId), JSON.stringify([...next]));
    return next;
  });
  const toggleRepository = (repositoryId: string) => updateExpanded((current) => { const next = new Set(current); next.has(repositoryId) ? next.delete(repositoryId) : next.add(repositoryId); return next; });
  const moveOrphan = (orphanId: string) => {
    const targetId = moveTargets[orphanId] || repositories[0]?.id;
    if (!targetId) return;
    setGroups((current) => { const next = { ...current, [targetId]: normalizeNames([...(current[targetId] || []), ...(current[orphanId] || [])]) }; delete next[orphanId]; return next; });
    setTaskTargets((current) => { const next = { ...current, [targetId]: normalizeNames([...(current[targetId] || []), ...(current[orphanId] || [])]) }; delete next[orphanId]; return next; });
    updateExpanded((current) => new Set(current).add(targetId));
  };
  const savePullRequestTargets = (repositoryId: string, common: string[], local: string[]) => {
    setCommonTargets((current) => ({ ...current, [repositoryId]: common }));
    setTaskTargets((current) => ({ ...current, [repositoryId]: local }));
  };
  const branchRows = (repository: GithubRepository, names: string[]) => names.length ? <div className="task-repository-branch-links">{names.map((name) => {
    const key = `${repository.id}:${name}`;
    const targets = normalizeNames([...(commonTargets[repository.id] || []), ...(taskTargets[repository.id] || [])]);
    const fallbackUrl = githubPullRequestUrl(repository.url, name);
    const onlyTargetUrl = targets.length === 1 ? githubPullRequestUrl(repository.url, name, targets[0]) : null;
    const isRenaming = renamingBranch?.repositoryId === repository.id && renamingBranch.originalName === name;
    return <div key={name}>{isRenaming
      ? <form className="task-branch-rename-form" onSubmit={(event) => { event.preventDefault(); renameBranch(repository.id, name, renamingBranch.name); }}><input autoFocus aria-label={`${name}の新しいブランチ名`} value={renamingBranch.name} onChange={(event) => setRenamingBranch({ ...renamingBranch, name: event.target.value })} spellCheck={false} /><button type="button" onClick={() => setRenamingBranch(null)}>取消</button><button type="submit" className="primary" disabled={!renamingBranch.name.trim()}>変更</button></form>
      : <button type="button" className="task-branch-name-copy" title="ブランチ名をコピー" onClick={() => void copy(name, `${key}:name`)}><code>{name}</code><span>{copied === `${key}:name` ? "コピー済み" : "名前をコピー"}</span></button>}
      <div className="task-branch-command-actions">
        <button type="button" className="task-branch-rename-button" disabled={isRenaming} onClick={() => setRenamingBranch({ repositoryId: repository.id, originalName: name, name })}>名前変更</button>
        <button type="button" className="task-branch-create-button" title="ブランチ作成コマンドをコピー" onClick={() => void copy(`git switch -c ${shellValue(name)}`, `${key}:create`)}>{copied === `${key}:create` ? "コピー済み" : "作成"}</button>
        <button type="button" onClick={() => void copy(`git switch ${shellValue(name)}`, `${key}:switch`)}>{copied === `${key}:switch` ? "コピー済み" : "切替"}</button>
        <button type="button" onClick={() => void copy(`git push -u origin ${shellValue(name)}`, `${key}:push`)}>{copied === `${key}:push` ? "コピー済み" : "Push"}</button>
        {targets.length > 1
          ? <button type="button" className="task-pr-create-button" onClick={() => setPullRequestTarget({ repository, branchName: name })}>PR作成 ▾</button>
          : <a href={onlyTargetUrl || fallbackUrl || undefined} target="_blank" rel="noreferrer" title={`${name}から${targets[0] ? ` ${targets[0]} へ` : ""}プルリクエストを作成`}>{targets[0] ? `PR → ${targets[0]}` : "PR作成"} ↗</a>}
        <button type="button" className="danger-text" aria-label={`${name}を削除`} title="削除" onClick={() => setDeletingBranch({ repositoryId: repository.id, repositoryName: repository.name || "GitHubリポジトリ", name })}>×</button>
      </div>
    </div>;
  })}</div> : <p className="task-repository-no-branches">ブランチは未設定です。</p>;
  const targetEditorRepository = repositories.find((repository) => repository.id === targetEditorRepositoryId);
  const pullRequestTargets = pullRequestTarget ? normalizeNames([...(commonTargets[pullRequestTarget.repository.id] || []), ...(taskTargets[pullRequestTarget.repository.id] || [])]) : [];
  const pullRequestKey = pullRequestTarget ? `${pullRequestTarget.repository.id}:${pullRequestTarget.branchName}` : "";
  const directTarget = directTargets[pullRequestKey] || "";
  return <><Modal title={`関連ブランチ・${taskTitle || "無題のタスク"}`} onClose={onClose} wide><div className="task-branches-modal">
    <header className="task-branches-summary"><div><small>案件タグ</small><strong>{tag?.name || "案件タグなし"}</strong><span>リポジトリごとにブランチ名を記録します。</span></div><b>{repositories.length}リポジトリ・{totalBranches}ブランチ</b><button type="button" onClick={() => { onClose(); onOpenTagSettings(); }}>案件タグ設定を開く</button></header>
    <div className="task-repository-branch-cards">{repositories.map((repository) => {
      const names = groups[repository.id] || [];
      const sharedTargets = commonTargets[repository.id] || [];
      const localTargets = (taskTargets[repository.id] || []).filter((target) => !sharedTargets.includes(target));
      const availableTargets = normalizeNames([...sharedTargets, ...localTargets]);
      const isExpanded = expanded.has(repository.id);
      return <section className={`task-repository-branch-card ${isExpanded ? "expanded" : "collapsed"}`} key={repository.id}><header><button type="button" className="task-repository-toggle" aria-expanded={isExpanded} onClick={() => toggleRepository(repository.id)}><span aria-hidden="true">{isExpanded ? "⌄" : "›"}</span><div><strong>{repository.name || "GitHubリポジトリ"}</strong><small>{repository.url}</small></div></button><span>{names.length}件</span><button type="button" className="task-pr-target-header-button" title={availableTargets.length ? `PR作成先: ${availableTargets.join("、")}` : "PR作成先は未設定です"} onClick={() => setTargetEditorRepositoryId(repository.id)}>PR作成先 <b>{availableTargets.length}件</b></button><a href={repository.url} target="_blank" rel="noreferrer">リポジトリを開く ↗</a></header>{isExpanded && <div className="task-repository-branch-body"><form className="task-branch-add-form" onSubmit={(event) => addBranch(event, repository.id)}><input autoFocus={repositories[0]?.id === repository.id} value={inputs[repository.id] || ""} onChange={(event) => setInputs((current) => ({ ...current, [repository.id]: event.target.value }))} placeholder="ブランチ名を入力" spellCheck={false} /><button type="submit" className="primary" disabled={!inputs[repository.id]?.trim()}>追加</button></form>{branchRows(repository, names)}</div>}</section>;
    })}{!repositories.length && <section className="task-repository-branch-empty"><strong>GitHubリポジトリが登録されていません</strong><span>案件タグ設定でリポジトリを登録すると、リポジトリごとの入力欄が表示されます。</span><button type="button" className="primary" onClick={() => { onClose(); onOpenTagSettings(); }}>案件タグ設定を開く</button></section>}</div>
    {orphanIds.map((orphanId) => <section className="task-branch-orphan" key={orphanId || "unassigned"}><div><strong>{orphanId ? "削除済みリポジトリの記録" : "リポジトリ未指定の記録"}</strong><span>{[...(groups[orphanId] || []), ...(taskTargets[orphanId] || []).map((target) => `PR→${target}`)].join("、")}</span></div>{repositories.length > 0 && <div><select aria-label="記録の移動先リポジトリ" value={moveTargets[orphanId] || repositories[0].id} onChange={(event) => setMoveTargets((current) => ({ ...current, [orphanId]: event.target.value }))}>{repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.name}</option>)}</select><button type="button" onClick={() => moveOrphan(orphanId)}>このリポジトリへ移す</button></div>}</section>)}
    <div className="task-branches-autosave"><span>追加・削除・移動は自動保存されます</span><button type="button" className="primary" onClick={onClose}>閉じる</button></div>
  </div></Modal>{targetEditorRepository && <PullRequestTargetsModal repositoryName={targetEditorRepository.name} commonTargets={commonTargets[targetEditorRepository.id] || []} taskTargets={taskTargets[targetEditorRepository.id] || []} allowTaskTargets onSave={(common, local) => savePullRequestTargets(targetEditorRepository.id, common, local)} onClose={() => setTargetEditorRepositoryId("")} />}{pullRequestTarget && <Modal title={`PR作成先・${pullRequestTarget.branchName}`} onClose={() => setPullRequestTarget(null)}><div className="task-pr-destination-dialog"><header><small>作成元ブランチ</small><code>{pullRequestTarget.branchName}</code><span>プルリクエストの作成先を選択してください。</span></header><div>{pullRequestTargets.map((target) => <a key={target} href={githubPullRequestUrl(pullRequestTarget.repository.url, pullRequestTarget.branchName, target) || undefined} target="_blank" rel="noreferrer" onClick={() => setPullRequestTarget(null)}><code>{target}</code><span>へPRを作成 ↗</span></a>)}</div><label><span>今回だけ別の作成先を使用</span><input value={directTarget} onChange={(event) => setDirectTargets((current) => ({ ...current, [pullRequestKey]: event.target.value }))} placeholder="例：release/2026-09" spellCheck={false} /></label><div className="modal-actions"><button type="button" onClick={() => setPullRequestTarget(null)}>キャンセル</button><a className={`button-link primary${directTarget.trim() ? "" : " disabled"}`} href={directTarget.trim() ? githubPullRequestUrl(pullRequestTarget.repository.url, pullRequestTarget.branchName, directTarget) || undefined : undefined} target="_blank" rel="noreferrer" onClick={() => directTarget.trim() && setPullRequestTarget(null)}>入力した作成先へ</a></div></div></Modal>}{deletingBranch && <Modal title="ブランチ記録を削除" onClose={() => setDeletingBranch(null)}><div className="task-branch-delete-dialog"><div className="task-branch-delete-warning"><span aria-hidden="true">!</span><div><strong>このブランチ記録を削除しますか？</strong><small>実際のGitブランチは削除されません。</small></div></div><dl><div><dt>リポジトリ</dt><dd>{deletingBranch.repositoryName}</dd></div><div><dt>ブランチ</dt><dd><code>{deletingBranch.name}</code></dd></div></dl><div className="modal-actions"><button type="button" onClick={() => setDeletingBranch(null)}>キャンセル</button><button type="button" className="danger" onClick={() => { removeBranch(deletingBranch.repositoryId, deletingBranch.name); setDeletingBranch(null); }}>削除する</button></div></div></Modal>}</>;
}
