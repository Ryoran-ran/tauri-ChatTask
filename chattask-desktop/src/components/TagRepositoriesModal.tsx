import { useState } from "react";
import type { GithubRepository } from "../types";
import { generateId, normalizeGithubRepositoryUrl } from "../utils";
import { Modal } from "./Modal";

export function TagRepositoriesModal({ tagName, repositories, onSave, onClose }: {
  tagName: string;
  repositories: GithubRepository[];
  onSave: (repositories: GithubRepository[]) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState(() => repositories.map((repository) => ({ ...repository })));
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const add = () => {
    const normalized = normalizeGithubRepositoryUrl(url);
    if (!normalized) { setError("https://github.com/所有者/リポジトリ の形式で入力してください。"); return; }
    if (items.some((repository) => normalizeGithubRepositoryUrl(repository.url) === normalized)) { setError("同じリポジトリがすでに登録されています。"); return; }
    const defaultName = new URL(normalized).pathname.split("/").filter(Boolean).pop() || "GitHub";
    setItems((current) => [...current, { id: generateId(), name: name.trim() || defaultName, url: normalized }]);
    setName(""); setUrl(""); setError("");
  };
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
  };
  const save = () => {
    const invalid = items.find((repository) => !normalizeGithubRepositoryUrl(repository.url));
    if (invalid) { setError(`「${invalid.name || "名称未設定"}」のURLを確認してください。`); return; }
    const normalized = items.map((repository) => { const repositoryUrl = normalizeGithubRepositoryUrl(repository.url)!; return { ...repository, name: repository.name.trim() || new URL(repositoryUrl).pathname.split("/").filter(Boolean).pop() || "GitHub", url: repositoryUrl }; });
    onSave(normalized);
    onClose();
  };
  return <Modal title={`GitHubリポジトリ・${tagName}`} onClose={onClose} wide><div className="tag-repository-manager">
    <header><div><small>案件タグ</small><strong>{tagName}</strong><span>この案件タグのタスクで使用するリポジトリを管理します。</span></div><b>{items.length}件</b></header>
    <div className="tag-github-form"><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="表示名（例：フロントエンド）" /><input value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") add(); }} placeholder="https://github.com/owner/repository" spellCheck={false} /><button type="button" className="primary" disabled={!url.trim()} onClick={add}>追加</button></div>
    <div className="tag-github-list tag-repository-manager-list">{items.map((repository, index) => <div key={repository.id}><input aria-label="リポジトリの表示名" value={repository.name} onChange={(event) => setItems((current) => current.map((item) => item.id === repository.id ? { ...item, name: event.target.value } : item))} /><input aria-label={`${repository.name || "リポジトリ"}のURL`} value={repository.url} onChange={(event) => setItems((current) => current.map((item) => item.id === repository.id ? { ...item, url: event.target.value } : item))} spellCheck={false} /><a href={normalizeGithubRepositoryUrl(repository.url) || undefined} target="_blank" rel="noreferrer">開く ↗</a><span className="tag-github-repository-actions"><button type="button" disabled={index === 0} aria-label={`${repository.name}を上へ移動`} title="上へ" onClick={() => move(index, -1)}>↑</button><button type="button" disabled={index === items.length - 1} aria-label={`${repository.name}を下へ移動`} title="下へ" onClick={() => move(index, 1)}>↓</button><button type="button" className="danger-text" onClick={() => setItems((current) => current.filter((item) => item.id !== repository.id))}>削除</button></span></div>)}{!items.length && <p>GitHubリポジトリは登録されていません。</p>}</div>
    {error && <p className="attachment-error">{error}</p>}
    <div className="modal-actions"><button type="button" onClick={onClose}>キャンセル</button><button type="button" className="primary" onClick={save}>保存</button></div>
  </div></Modal>;
}
