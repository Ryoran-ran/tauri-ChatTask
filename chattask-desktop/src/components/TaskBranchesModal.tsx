import { useMemo, useState, type FormEvent } from "react";
import type { GithubRepository, ProjectTag, TaskRepositoryBranches } from "../types";
import { githubPullRequestUrl, normalizeGithubRepositoryUrl } from "../utils";
import { Modal } from "./Modal";

const normalizeNames = (names: string[]) => [...new Set(names.map((name) => name.trim()).filter(Boolean))];
const validRepositories = (tag?: ProjectTag): GithubRepository[] => (tag?.githubRepositories || []).map((repository) => ({ ...repository, url: normalizeGithubRepositoryUrl(repository.url) || "" })).filter((repository) => Boolean(repository.url));
const shellValue = (value: string) => /^[a-zA-Z0-9._/-]+$/.test(value) ? value : `'${value.replace(/'/g, `'"'"'`)}'`;

export function TaskBranchesModal({ taskTitle, repositoryBranches, tag, onSave, onOpenTagSettings, onClose }: {
  taskTitle: string;
  repositoryBranches: TaskRepositoryBranches[];
  tag?: ProjectTag;
  onSave: (repositoryBranches: TaskRepositoryBranches[]) => void;
  onOpenTagSettings: () => void;
  onClose: () => void;
}) {
  const repositories = useMemo(() => validRepositories(tag), [tag]);
  const initialGroups = useMemo(() => {
    const groups = Object.fromEntries(repositoryBranches.map((group) => [group.repositoryId, normalizeNames(group.branchNames)]));
    if (repositories.length === 1 && groups[""]?.length && !groups[repositories[0].id]?.length) { groups[repositories[0].id] = groups[""]; delete groups[""]; }
    return groups;
  }, [repositories, repositoryBranches]);
  const [groups, setGroups] = useState<Record<string, string[]>>(initialGroups);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(repositories.length <= 2 ? repositories.map((repository) => repository.id) : repositories.slice(0, 1).map((repository) => repository.id)));
  const [copied, setCopied] = useState("");
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});
  const orphanIds = Object.keys(groups).filter((id) => !repositories.some((repository) => repository.id === id) && groups[id]?.length);
  const totalBranches = Object.values(groups).reduce((total, names) => total + names.length, 0);
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
  const toggleRepository = (repositoryId: string) => setExpanded((current) => { const next = new Set(current); next.has(repositoryId) ? next.delete(repositoryId) : next.add(repositoryId); return next; });
  const moveOrphan = (orphanId: string) => {
    const targetId = moveTargets[orphanId] || repositories[0]?.id;
    if (!targetId) return;
    setGroups((current) => { const next = { ...current, [targetId]: normalizeNames([...(current[targetId] || []), ...(current[orphanId] || [])]) }; delete next[orphanId]; return next; });
    setExpanded((current) => new Set(current).add(targetId));
  };
  const save = () => {
    onSave(Object.entries(groups).map(([repositoryId, branchNames]) => ({ repositoryId, branchNames: normalizeNames(branchNames) })).filter((group) => group.branchNames.length));
    onClose();
  };
  const branchRows = (repository: GithubRepository, names: string[]) => names.length ? <div className="task-repository-branch-links">{names.map((name) => {
    const url = githubPullRequestUrl(repository.url, name);
    const key = `${repository.id}:${name}`;
    return <div key={name}><button type="button" className="task-branch-name-copy" title="ブランチ名をコピー" onClick={() => void copy(name, `${key}:name`)}><code>{name}</code><span>{copied === `${key}:name` ? "コピー済み" : "名前をコピー"}</span></button><div className="task-branch-command-actions"><button type="button" onClick={() => void copy(`git switch ${shellValue(name)}`, `${key}:switch`)}>{copied === `${key}:switch` ? "コピー済み" : "切替"}</button><button type="button" onClick={() => void copy(`git push -u origin ${shellValue(name)}`, `${key}:push`)}>{copied === `${key}:push` ? "コピー済み" : "Push"}</button>{url && <a href={url} target="_blank" rel="noreferrer" title={`${name}からプルリクエストを作成`}>PR作成 ↗</a>}<button type="button" className="danger-text" aria-label={`${name}を削除`} title="削除" onClick={() => removeBranch(repository.id, name)}>×</button></div></div>;
  })}</div> : <p className="task-repository-no-branches">ブランチは未設定です。</p>;
  return <Modal title={`関連ブランチ・${taskTitle || "無題のタスク"}`} onClose={onClose} wide><div className="task-branches-modal">
    <header className="task-branches-summary"><div><small>案件タグ</small><strong>{tag?.name || "案件タグなし"}</strong><span>リポジトリごとにブランチ名を記録します。</span></div><b>{repositories.length}リポジトリ・{totalBranches}ブランチ</b><button type="button" onClick={() => { onClose(); onOpenTagSettings(); }}>案件タグ設定を開く</button></header>
    <div className="task-repository-branch-cards">{repositories.map((repository) => {
      const names = groups[repository.id] || [];
      const isExpanded = expanded.has(repository.id);
      return <section className={`task-repository-branch-card ${isExpanded ? "expanded" : "collapsed"}`} key={repository.id}><header><button type="button" className="task-repository-toggle" aria-expanded={isExpanded} onClick={() => toggleRepository(repository.id)}><span aria-hidden="true">{isExpanded ? "⌄" : "›"}</span><div><strong>{repository.name || "GitHubリポジトリ"}</strong><small>{repository.url}</small></div></button><span>{names.length}件</span><a href={repository.url} target="_blank" rel="noreferrer">リポジトリを開く ↗</a></header>{isExpanded && <div className="task-repository-branch-body"><form className="task-branch-add-form" onSubmit={(event) => addBranch(event, repository.id)}><input autoFocus={repositories[0]?.id === repository.id} value={inputs[repository.id] || ""} onChange={(event) => setInputs((current) => ({ ...current, [repository.id]: event.target.value }))} placeholder="ブランチ名を入力" spellCheck={false} /><button type="submit" className="primary" disabled={!inputs[repository.id]?.trim()}>追加</button></form>{branchRows(repository, names)}</div>}</section>;
    })}{!repositories.length && <section className="task-repository-branch-empty"><strong>GitHubリポジトリが登録されていません</strong><span>案件タグ設定でリポジトリを登録すると、リポジトリごとの入力欄が表示されます。</span><button type="button" className="primary" onClick={() => { onClose(); onOpenTagSettings(); }}>案件タグ設定を開く</button></section>}</div>
    {orphanIds.map((orphanId) => <section className="task-branch-orphan" key={orphanId || "unassigned"}><div><strong>{orphanId ? "削除済みリポジトリのブランチ" : "リポジトリ未指定のブランチ"}</strong><span>{groups[orphanId].join("、")}</span></div>{repositories.length > 0 && <div><select aria-label="ブランチの移動先リポジトリ" value={moveTargets[orphanId] || repositories[0].id} onChange={(event) => setMoveTargets((current) => ({ ...current, [orphanId]: event.target.value }))}>{repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.name}</option>)}</select><button type="button" onClick={() => moveOrphan(orphanId)}>このリポジトリへ移す</button></div>}</section>)}
    <div className="modal-actions"><button type="button" onClick={onClose}>キャンセル</button><button type="button" className="primary" onClick={save}>保存</button></div>
  </div></Modal>;
}
