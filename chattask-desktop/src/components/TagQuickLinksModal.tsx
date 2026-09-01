import { useState } from "react";
import type { QuickLinkRule } from "../types";
import { generateId, normalizeQuickLinkPrefix } from "../utils";
import { Modal } from "./Modal";

export function TagQuickLinksModal({ tagName, rules, onSave, onClose }: { tagName: string; rules: QuickLinkRule[]; onSave: (rules: QuickLinkRule[]) => void; onClose: () => void }) {
  const [items, setItems] = useState(() => rules.map((rule) => ({ ...rule })));
  const [name, setName] = useState("");
  const [urlPrefix, setUrlPrefix] = useState("");
  const [error, setError] = useState("");
  const add = () => {
    const prefix = normalizeQuickLinkPrefix(urlPrefix);
    if (!name.trim() || !prefix) { setError("表示名と正しい判定用URLを入力してください。"); return; }
    setItems((current) => [...current, { id: generateId(), name: name.trim(), urlPrefix: prefix }]);
    setName(""); setUrlPrefix(""); setError("");
  };
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; setItems(next);
  };
  const save = () => {
    const invalid = items.find((rule) => !rule.name.trim() || !normalizeQuickLinkPrefix(rule.urlPrefix));
    if (invalid) { setError("表示名または判定用URLに入力不足があります。"); return; }
    onSave(items.map((rule) => ({ ...rule, name: rule.name.trim(), urlPrefix: normalizeQuickLinkPrefix(rule.urlPrefix)! })));
    onClose();
  };
  return <Modal title={`クイックリンク設定・${tagName}`} onClose={onClose} wide><div className="tag-repository-manager tag-quick-link-manager">
    <header><div><small>案件タグ</small><strong>{tagName}</strong><span>URLの前方一致から、関連リンクの表示名を自動入力します。</span></div><b>{items.length}件</b></header>
    <div className="tag-quick-link-form"><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="表示名（例：Redmine）" /><input value={urlPrefix} onChange={(event) => setUrlPrefix(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") add(); }} placeholder="判定用URL（例：https://redmine.example.com/issues/）" spellCheck={false} /><button type="button" className="primary" disabled={!name.trim() || !urlPrefix.trim()} onClick={add}>追加</button></div>
    <p className="tag-quick-link-note">クエリ文字列と # は無視されます。複数一致した場合は、URLが最も長く具体的なルールを優先します。</p>
    <div className="tag-quick-link-rules">{items.map((rule, index) => <div key={rule.id}><input aria-label="クイックリンクの表示名" value={rule.name} onChange={(event) => setItems((current) => current.map((item) => item.id === rule.id ? { ...item, name: event.target.value } : item))} /><input aria-label={`${rule.name || "クイックリンク"}の判定用URL`} value={rule.urlPrefix} onChange={(event) => setItems((current) => current.map((item) => item.id === rule.id ? { ...item, urlPrefix: event.target.value } : item))} spellCheck={false} /><span className="tag-github-repository-actions"><button type="button" disabled={index === 0} aria-label={`${rule.name}を上へ移動`} onClick={() => move(index, -1)}>↑</button><button type="button" disabled={index === items.length - 1} aria-label={`${rule.name}を下へ移動`} onClick={() => move(index, 1)}>↓</button><button type="button" className="danger-text" onClick={() => setItems((current) => current.filter((item) => item.id !== rule.id))}>削除</button></span></div>)}{!items.length && <p>クイックリンクの判定ルールは登録されていません。</p>}</div>
    {error && <p className="attachment-error">{error}</p>}
    <div className="modal-actions"><button type="button" onClick={onClose}>キャンセル</button><button type="button" className="primary" onClick={save}>保存</button></div>
  </div></Modal>;
}
