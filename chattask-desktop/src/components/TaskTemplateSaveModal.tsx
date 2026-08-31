import { useState } from "react";
import type { Task } from "../types";
import { Modal } from "./Modal";

export function TaskTemplateSaveModal({ task, onSave, onClose }: {
  task: Task;
  onSave: (name: string, keywords: string[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(task.title);
  const [keywords, setKeywords] = useState(task.title);
  const submit = () => {
    const normalizedName = name.trim();
    if (!normalizedName) return;
    onSave(normalizedName, [...new Set(keywords.split(/[,\n、]/).map((value) => value.trim()).filter(Boolean))]);
  };

  return <Modal title="テンプレートとして保存" onClose={onClose}>
    <div className="task-template-save-form">
      <p>タスク名、説明、次のアクション、予定工数、リンク、手順書・資料を再利用できる形で保存します。</p>
      <label>テンプレート名<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>検索キーワード<textarea rows={3} value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="カンマ区切りで入力" /></label>
      <small>同じ名前のテンプレートがある場合は更新します。</small>
      <div className="modal-actions"><button type="button" onClick={onClose}>キャンセル</button><button type="button" className="primary" disabled={!name.trim()} onClick={submit}>テンプレートを保存</button></div>
    </div>
  </Modal>;
}
