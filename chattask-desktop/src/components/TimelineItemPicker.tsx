import { useState } from "react";
import { Modal } from "./Modal";

export type TimelineItemOption = { id: string; label: string; detail: string };

export function TimelineItemPicker({ options, selectedIds, lockedIds = [], onChange, itemLabel = "確認項目", searchPlaceholder = "タイトル・画面名・リポジトリ名で検索" }: {
  options: TimelineItemOption[];
  selectedIds: string[];
  lockedIds?: string[];
  onChange: (ids: string[]) => void;
  itemLabel?: string;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds);
  const normalizedQuery = query.trim().toLocaleLowerCase("ja");
  const visibleOptions = options.filter((option) => !normalizedQuery || `${option.label} ${option.detail}`.toLocaleLowerCase("ja").includes(normalizedQuery));
  const selectedOptions = selectedIds.flatMap((id) => {
    const option = options.find((candidate) => candidate.id === id);
    return option ? [option] : [{ id, label: `削除済みの${itemLabel}`, detail: "" }];
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
    <div className="verification-check-picker-selected">{selectedOptions.length ? selectedOptions.map((option) => <span key={option.id}>{option.label}<button type="button" aria-label={`${option.label}の選択を解除`} disabled={lockedIds.includes(option.id)} onClick={() => removeSelected(option.id)}>×</button></span>) : <small>{itemLabel}は選択されていません</small>}</div>
    <button type="button" className="verification-check-picker-open" onClick={() => { setDraftIds(selectedIds); setQuery(""); setOpen(true); }}>⌕ {itemLabel}を選択</button>
    {open && <Modal title={`関連する${itemLabel}を選択`} wide onClose={close}><div className="verification-check-picker-dialog">
      <div className="verification-check-picker-search"><span aria-hidden="true">⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} /><small>{draftIds.length}件選択</small></div>
      <div className="verification-check-picker-options">{visibleOptions.length ? visibleOptions.map((option) => <label key={option.id}><input type="checkbox" checked={draftIds.includes(option.id)} disabled={lockedIds.includes(option.id)} onChange={() => toggle(option.id)} /><span><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</span></label>) : <p>一致する{itemLabel}はありません。</p>}</div>
      <footer><span>{draftIds.length}件を関連付けます</span><button type="button" onClick={close}>キャンセル</button><button type="button" className="primary" onClick={() => { onChange(draftIds); close(); }}>選択を反映</button></footer>
    </div></Modal>}
  </div>;
}
