import { useEffect, useRef, useState, type FormEvent } from "react";
import { Modal } from "./Modal";

const normalizeTargets = (targets: string[]) => [...new Set(targets.map((target) => target.trim()).filter(Boolean))];

export function PullRequestTargetsModal({ repositoryName, commonTargets, taskTargets = [], allowTaskTargets = false, onSave, onClose }: {
  repositoryName: string;
  commonTargets: string[];
  taskTargets?: string[];
  allowTaskTargets?: boolean;
  onSave: (commonTargets: string[], taskTargets: string[]) => void;
  onClose: () => void;
}) {
  const [common, setCommon] = useState(() => normalizeTargets(commonTargets));
  const [local, setLocal] = useState(() => normalizeTargets(taskTargets).filter((target) => !commonTargets.includes(target)));
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<"task" | "common">(allowTaskTargets ? "task" : "common");
  const initialized = useRef(false);
  const saveHandler = useRef(onSave);
  useEffect(() => { saveHandler.current = onSave; }, [onSave]);
  useEffect(() => {
    if (!initialized.current) { initialized.current = true; return; }
    saveHandler.current(normalizeTargets(common), normalizeTargets(local));
  }, [common, local]);
  const add = (event: FormEvent) => {
    event.preventDefault();
    const target = input.trim();
    if (!target) return;
    if (scope === "common") {
      setCommon((current) => normalizeTargets([...current, target]));
      setLocal((current) => current.filter((item) => item !== target));
    } else if (!common.includes(target)) {
      setLocal((current) => normalizeTargets([...current, target]));
    }
    setInput("");
  };
  const move = (targetScope: "common" | "task", index: number, delta: -1 | 1) => {
    const update = targetScope === "common" ? setCommon : setLocal;
    update((current) => {
      const destination = index + delta;
      if (destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  };
  const targetList = (targets: string[], targetScope: "common" | "task") => <div className="pr-target-editor-list">{targets.map((target, index) => <div key={target}><code>{target}</code><span><button type="button" disabled={index === 0} aria-label={`${target}を上へ移動`} onClick={() => move(targetScope, index, -1)}>↑</button><button type="button" disabled={index === targets.length - 1} aria-label={`${target}を下へ移動`} onClick={() => move(targetScope, index, 1)}>↓</button><button type="button" className="danger-text" aria-label={`${target}を削除`} onClick={() => (targetScope === "common" ? setCommon : setLocal)((current) => current.filter((item) => item !== target))}>削除</button></span></div>)}{!targets.length && <p>{targetScope === "common" ? "共通候補はありません。" : "このタスクだけの候補はありません。"}</p>}</div>;

  return <Modal title={`PR作成先・${repositoryName || "GitHubリポジトリ"}`} onClose={onClose} wide><div className="pr-target-editor">
    <header><div><small>GitHubリポジトリ</small><strong>{repositoryName || "GitHubリポジトリ"}</strong><span>PR作成時に選択する作成先ブランチを登録します。</span></div><b>{normalizeTargets([...common, ...local]).length}件</b></header>
    <form onSubmit={add}><input autoFocus value={input} onChange={(event) => setInput(event.target.value)} placeholder="作成先ブランチ（例：staging、main）" spellCheck={false} />{allowTaskTargets && <select aria-label="PR作成先の保存範囲" value={scope} onChange={(event) => setScope(event.target.value as "task" | "common")}><option value="task">このタスクだけ</option><option value="common">共通候補にも追加</option></select>}<button type="submit" className="primary" disabled={!input.trim()}>追加</button></form>
    <section><header><div><strong>共通候補</strong><small>このリポジトリを使用するすべてのタスクに表示</small></div><b>{common.length}件</b></header>{targetList(common, "common")}</section>
    {allowTaskTargets && <section className="task-only"><header><div><strong>このタスクだけ</strong><small>現在のタスクでのみ使用</small></div><b>{local.length}件</b></header>{targetList(local, "task")}</section>}
    <div className="pr-target-autosave"><span>変更内容は自動保存されます</span><button type="button" className="primary" onClick={onClose}>閉じる</button></div>
  </div></Modal>;
}
