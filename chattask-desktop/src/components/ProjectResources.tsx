import { useState } from "react";
import type { Goal, TaskLink } from "../types";
import { generateId } from "../utils";
import { AttachmentsSection } from "./AttachmentsSection";

export function ProjectResources({ project, onLinks }: { project: Goal; onLinks: (links: TaskLink[]) => void }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const addLink = () => {
    const entered = url.trim();
    if (!entered) return;
    const normalized = /^https?:\/\//i.test(entered) ? entered : `https://${entered}`;
    try {
      const parsed = new URL(normalized);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      onLinks([...(project.sharedLinks || []), { id: generateId(), label: label.trim() || parsed.hostname, url: parsed.toString() }]);
      setLabel("");
      setUrl("");
      setError("");
    } catch {
      setError("正しいサイトURLを入力してください。");
    }
  };
  return <section className="project-resources">
    <header><div><strong>共有サイト・ファイル</strong><small>このプロジェクトで共通利用する資料をまとめます。</small></div></header>
    <div className="project-shared-links">
      <div className="project-shared-link-list">{(project.sharedLinks || []).map((link) => <div key={link.id}><a href={link.url} target="_blank" rel="noreferrer"><span>↗</span><strong>{link.label || link.url}</strong><small>{link.url}</small></a><button type="button" className="danger-text" aria-label={`${link.label || link.url}を削除`} onClick={() => onLinks((project.sharedLinks || []).filter((item) => item.id !== link.id))}>×</button></div>)}{!project.sharedLinks?.length && <p>共有サイトは登録されていません。</p>}</div>
      <div className="project-shared-link-form"><label>表示名<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例：案件管理サイト" /></label><label>URL<input value={url} onChange={(event) => { setUrl(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addLink(); } }} placeholder="https://..." /></label><button type="button" onClick={addLink}>サイトを追加</button></div>
      {error && <p className="project-shared-link-error">{error}</p>}
    </div>
    <div className="project-shared-files"><AttachmentsSection taskId={`project:${project.id}`} title="共有ファイル" /></div>
  </section>;
}
