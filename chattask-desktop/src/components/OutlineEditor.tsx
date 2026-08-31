import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { generateId } from "../utils";

type OutlineNode = { id: string; text: string; children: OutlineNode[] };
const blank = (): OutlineNode[] => [{ id: generateId(), text: "新しい項目", children: [] }];
const parse = (value: string): OutlineNode[] => { try { const result = JSON.parse(value) as OutlineNode[]; return Array.isArray(result) && result.length ? result : blank(); } catch { return blank(); } };
const copy = (nodes: OutlineNode[]) => structuredClone(nodes);
const find = (nodes: OutlineNode[], id: string): OutlineNode | undefined => { for (const node of nodes) { if (node.id === id) return node; const hit = find(node.children, id); if (hit) return hit; } };
const contains = (node: OutlineNode, id: string): boolean => node.id === id || node.children.some((child) => contains(child, id));
const flatten = (nodes: OutlineNode[]): OutlineNode[] => nodes.flatMap((node) => [node, ...flatten(node.children)]);
const locate = (nodes: OutlineNode[], id: string): { list: OutlineNode[]; index: number; parent?: OutlineNode } | undefined => {
  const walk = (list: OutlineNode[], parent?: OutlineNode): ReturnType<typeof locate> => { const index = list.findIndex((node) => node.id === id); if (index >= 0) return { list, index, parent }; for (const node of list) { const hit = walk(node.children, node); if (hit) return hit; } };
  return walk(nodes);
};

export const outlineToMarkdown = (value: string): string => {
  let items: OutlineNode[];
  try {
    const parsed = JSON.parse(value) as OutlineNode[];
    items = Array.isArray(parsed) ? parsed : [];
  } catch {
    items = [];
  }
  const lines: string[] = [];
  const write = (nodes: OutlineNode[], depth = 0) => nodes.forEach((node) => {
    const indent = "  ".repeat(depth);
    const textLines = String(node.text || "（無題）").split(/\r?\n/);
    lines.push(`${indent}- ${textLines[0] || "（無題）"}`);
    textLines.slice(1).forEach((line) => lines.push(`${indent}  ${line}`));
    write(Array.isArray(node.children) ? node.children : [], depth + 1);
  });
  write(items);
  return `${lines.join("\n")}\n`;
};

const collapsedStorageKey = (documentId: string) => `chatTaskOutlineCollapsed:${documentId}`;
const loadCollapsed = (documentId: string): Set<string> => {
  if (!documentId) return new Set();
  try {
    const stored = JSON.parse(localStorage.getItem(collapsedStorageKey(documentId)) || "[]") as unknown;
    return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
};

export function OutlineEditor({ documentId, value, onChange }: { documentId: string; value: string; onChange: (value: string) => void }) {
  const [nodes, setNodes] = useState(() => parse(value));
  const [mode, setMode] = useState<"edit" | "view">("edit");
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(documentId));
  const [selectedId, setSelectedId] = useState(nodes[0]?.id || "");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(nodes[0]?.id ? [nodes[0].id] : []));
  const selectionAnchor = useRef(nodes[0]?.id || "");
  const [editingId, setEditingId] = useState("");
  const [menuId, setMenuId] = useState("");
  const [undoStack, setUndoStack] = useState<OutlineNode[][]>([]);
  const [redoStack, setRedoStack] = useState<OutlineNode[][]>([]);
  const inputs = useRef(new Map<string, HTMLTextAreaElement>());
  const editorRoot = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const compositionJustEnded = useRef(false);
  const pointerDrag = useRef<{ id: string; ids: string[]; pointerId: number; startX: number; startY: number; started: boolean } | null>(null);
  const pointerDrop = useRef<{ id: string; position: "before" | "inside" | "after" } | null>(null);
  const [draggingIds, setDraggingIds] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<{ id: string; position: "before" | "inside" | "after" } | null>(null);
  const resizeEditor = (element: HTMLTextAreaElement) => {
    element.style.height = "0";
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
  };
  const updateCollapsed = (updater: (current: Set<string>) => Set<string>) => {
    setCollapsed((current) => {
      const next = updater(current);
      localStorage.setItem(collapsedStorageKey(documentId), JSON.stringify([...next]));
      return next;
    });
  };
  const focusSelectionMode = () => requestAnimationFrame(() => editorRoot.current?.focus());
  const visibleNodes = () => {
    const visible: OutlineNode[] = [];
    const walk = (items: OutlineNode[]) => items.forEach((node) => { visible.push(node); if (!collapsed.has(node.id)) walk(node.children); });
    walk(nodes);
    return visible;
  };
  const selectOnly = (id: string) => {
    setSelectedId(id);
    setSelectedIds(new Set([id]));
    selectionAnchor.current = id;
  };
  const selectWithPointer = (id: string, shiftKey: boolean, toggleKey: boolean) => {
    if (shiftKey) {
      const visible = visibleNodes();
      const anchorIndex = visible.findIndex((node) => node.id === selectionAnchor.current);
      const targetIndex = visible.findIndex((node) => node.id === id);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        setSelectedIds(new Set(visible.slice(start, end + 1).map((node) => node.id)));
        setSelectedId(id);
        setEditingId("");
        focusSelectionMode();
        return;
      }
    }
    if (toggleKey) {
      setSelectedIds((current) => {
        const next = new Set(current);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
      setSelectedId(id);
      selectionAnchor.current = id;
      setEditingId("");
      focusSelectionMode();
      return;
    }
    selectOnly(id);
    startEditing(id);
  };
  useEffect(() => {
    const timer = window.setTimeout(focusSelectionMode, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const showEditMode = () => {
    setMode("edit");
    setMenuId("");
    focusSelectionMode();
  };
  const applySnapshot = (next: OutlineNode[], focus = "") => {
    setNodes(next);
    onChange(JSON.stringify(next));
    if (focus) requestAnimationFrame(() => {
      const input = inputs.current.get(focus);
      if (!input) return;
      input.focus();
      resizeEditor(input);
    });
  };
  const commit = (next: OutlineNode[], focus = "") => {
    if (JSON.stringify(next) === JSON.stringify(nodes)) return;
    setUndoStack((current) => [...current.slice(-99), copy(nodes)]);
    setRedoStack([]);
    applySnapshot(next, focus);
  };
  const undo = () => {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [...current.slice(-99), copy(nodes)]);
    const restored = copy(previous);
    const restoredIds = flatten(restored);
    const nextSelectedId = restoredIds.some((node) => node.id === selectedId) ? selectedId : restoredIds[restoredIds.length - 1]?.id || "";
    if (nextSelectedId) selectOnly(nextSelectedId);
    applySnapshot(restored, editingId && nextSelectedId === selectedId ? nextSelectedId : "");
  };
  const redo = () => {
    const following = redoStack[redoStack.length - 1];
    if (!following) return;
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => [...current.slice(-99), copy(nodes)]);
    const restored = copy(following);
    const restoredIds = flatten(restored);
    const nextSelectedId = restoredIds.some((node) => node.id === selectedId) ? selectedId : restoredIds[restoredIds.length - 1]?.id || "";
    if (nextSelectedId) selectOnly(nextSelectedId);
    applySnapshot(restored, editingId && nextSelectedId === selectedId ? nextSelectedId : "");
  };
  const updateText = (id: string, text: string) => { const next = copy(nodes); const node = find(next, id); if (node) { node.text = text; commit(next); } };
  const addImmediatelyBelow = (id: string) => {
    const next = copy(nodes);
    const hit = locate(next, id);
    if (!hit) return;
    const current = hit.list[hit.index];
    const node = { id: generateId(), text: "", children: [] };

    // An expanded child is the next visible row. Insert before it so Enter
    // always creates the new block immediately below the current row.
    if (current.children.length > 0 && !collapsed.has(id)) current.children.unshift(node);
    else hit.list.splice(hit.index + 1, 0, node);

    selectOnly(node.id);
    commit(next, node.id);
  };
  const addChild = (id: string) => { const next = copy(nodes); const parent = find(next, id); if (!parent) return; const node = { id: generateId(), text: "", children: [] }; parent.children.push(node); updateCollapsed((current) => { const expanded = new Set(current); expanded.delete(id); return expanded; }); selectOnly(node.id); commit(next, node.id); };
  const indent = (id: string) => { const next = copy(nodes); const hit = locate(next, id); if (!hit || hit.index === 0) return; const [node] = hit.list.splice(hit.index, 1); hit.list[hit.index - 1].children.push(node); commit(next, id); };
  const outdent = (id: string) => { const next = copy(nodes); const hit = locate(next, id); if (!hit?.parent) return; const parentHit = locate(next, hit.parent.id); if (!parentHit) return; const [node] = hit.list.splice(hit.index, 1); parentHit.list.splice(parentHit.index + 1, 0, node); commit(next, id); };
  const move = (id: string, direction: -1 | 1) => { const next = copy(nodes); const hit = locate(next, id); if (!hit) return; const target = hit.index + direction; if (target < 0 || target >= hit.list.length) return; [hit.list[hit.index], hit.list[target]] = [hit.list[target], hit.list[hit.index]]; commit(next, id); };
  const remove = (id: string) => {
    const before = flatten(nodes);
    const removedIndex = before.findIndex((node) => node.id === id);
    const next = copy(nodes);
    const hit = locate(next, id);
    if (!hit) return;
    hit.list.splice(hit.index, 1);
    if (!next.length) next.push(...blank());
    const remaining = flatten(next);
    const previousId = [...before.slice(0, Math.max(0, removedIndex))].reverse().find((node) => remaining.some((item) => item.id === node.id))?.id;
    const nextSelectedId = previousId || remaining[Math.min(Math.max(removedIndex, 0), remaining.length - 1)]?.id || next[0].id;
    setSelectedId(nextSelectedId);
    setSelectedIds(new Set([nextSelectedId]));
    selectionAnchor.current = nextSelectedId;
    commit(next);
    requestAnimationFrame(() => editorRoot.current?.focus());
  };
  const topLevelSelection = (ids: Iterable<string>) => {
    const chosen = new Set(ids);
    return flatten(nodes).filter((node) => chosen.has(node.id) && !flatten(nodes).some((parent) => parent.id !== node.id && chosen.has(parent.id) && contains(parent, node.id))).map((node) => node.id);
  };
  const removeSelected = () => {
    const ids = topLevelSelection(selectedIds);
    if (!ids.length) return;
    const before = flatten(nodes);
    const firstIndex = Math.min(...ids.map((id) => before.findIndex((node) => node.id === id)).filter((index) => index >= 0));
    const removeSet = new Set(ids);
    const next = copy(nodes);
    const prune = (items: OutlineNode[]) => {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (removeSet.has(items[index].id)) items.splice(index, 1);
        else prune(items[index].children);
      }
    };
    prune(next);
    if (!next.length) next.push(...blank());
    const remaining = flatten(next);
    const nextId = remaining[Math.max(0, Math.min(firstIndex - 1, remaining.length - 1))]?.id || next[0].id;
    selectOnly(nextId);
    setMenuId("");
    commit(next);
    focusSelectionMode();
  };
  const copySelected = (event: ClipboardEvent<HTMLDivElement>) => {
    if (mode !== "edit" || (event.target as HTMLElement).matches("textarea,input,[contenteditable='true']")) return;
    const ids = topLevelSelection(selectedIds);
    if (!ids.length) return;
    const selected = ids.map((id) => find(nodes, id)).filter((node): node is OutlineNode => Boolean(node));
    if (!selected.length) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", outlineToMarkdown(JSON.stringify(selected)).trimEnd());
    event.clipboardData.setData("application/x-chattask-outline+json", JSON.stringify(selected));
  };
  const moveTo = (ids: string[], targetId: string, position: "before" | "inside" | "after") => {
    const rootIds = topLevelSelection(ids);
    if (!rootIds.length || rootIds.includes(targetId)) return;
    const next = copy(nodes);
    const moving = rootIds.map((id) => find(next, id)).filter((node): node is OutlineNode => Boolean(node));
    if (moving.some((node) => contains(node, targetId))) return;
    const rootSet = new Set(rootIds);
    const extract = (items: OutlineNode[]) => {
      for (let index = items.length - 1; index >= 0; index -= 1) {
        if (rootSet.has(items[index].id)) items.splice(index, 1);
        else extract(items[index].children);
      }
    };
    extract(next);
    const target = locate(next, targetId);
    if (!target) return;
    if (position === "inside") target.list[target.index].children.push(...moving);
    else target.list.splice(target.index + (position === "after" ? 1 : 0), 0, ...moving);
    setSelectedIds(new Set(rootIds));
    setSelectedId(rootIds[0]);
    selectionAnchor.current = rootIds[0];
    commit(next);
    focusSelectionMode();
  };
  const clearDrag = () => { pointerDrag.current = null; pointerDrop.current = null; setDraggingIds(new Set()); setDropTarget(null); };
  const startDrag = (event: ReactPointerEvent<HTMLSpanElement>, id: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const ids = selectedIds.has(id) ? topLevelSelection(selectedIds) : [id];
    if (!selectedIds.has(id)) selectOnly(id);
    pointerDrag.current = { id, ids, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, started: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const drag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const current = pointerDrag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.started && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 4) return;
    if (!current.started) { current.started = true; setDraggingIds(new Set(current.ids)); }
    event.preventDefault();
    const row = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-outline-node-id]");
    if (!row || current.ids.includes(row.dataset.outlineNodeId || "")) { pointerDrop.current = null; setDropTarget(null); return; }
    const rect = row.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
    const position = ratio < .28 ? "before" : ratio > .72 ? "after" : "inside";
    const target = { id: row.dataset.outlineNodeId || "", position } as const;
    pointerDrop.current = target;
    setDropTarget(target);
  };
  const endDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const current = pointerDrag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.started && pointerDrop.current) moveTo(current.ids, pointerDrop.current.id, pointerDrop.current.position);
    else if (!current.started) { selectOnly(current.id); setMenuId((openId) => openId === current.id ? "" : current.id); }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    clearDrag();
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>, id: string) => {
    const nativeEvent = event.nativeEvent as globalThis.KeyboardEvent;
    const isImeConversion = composing.current || compositionJustEnded.current || nativeEvent.isComposing || nativeEvent.keyCode === 229;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.blur();
      editorRoot.current?.focus();
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && isImeConversion) {
      compositionJustEnded.current = false;
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      // IMEの未確定文字を消して空になった操作と、空のブロックに対する
      // 削除操作を分ける。DOMの値だけを見ると、変換中の最後の1文字を
      // 消したキー入力でブロックまで削除されることがある。
      if (isImeConversion) return;
      const currentNode = find(nodes, id);
      if (currentNode?.text === "" && event.currentTarget.value === "") {
        event.preventDefault();
        remove(id);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); addImmediatelyBelow(id); }
    else if (event.key === "Tab") { event.preventDefault(); event.shiftKey ? outdent(id) : indent(id); }
    else if (event.key === "ArrowUp" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); move(id, -1); }
    else if (event.key === "ArrowDown" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); move(id, 1); }
  };
  const navigateSelection = (direction: -1 | 1) => {
    const visible: OutlineNode[] = [];
    const walk = (items: OutlineNode[]) => items.forEach((node) => { visible.push(node); if (!collapsed.has(node.id)) walk(node.children); });
    walk(nodes);
    if (!visible.length) return;
    const currentIndex = visible.findIndex((node) => node.id === selectedId);
    const nextIndex = Math.min(visible.length - 1, Math.max(0, (currentIndex < 0 ? 0 : currentIndex) + direction));
    const nextId = visible[nextIndex].id;
    selectOnly(nextId);
    requestAnimationFrame(() => {
      const row = Array.from(editorRoot.current?.querySelectorAll<HTMLElement>("[data-outline-node-id]") || [])
        .find((element) => element.dataset.outlineNodeId === nextId);
      row?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };
  const startEditing = (id: string) => {
    const input = inputs.current.get(id);
    if (!input) return;
    setEditingId(id);
    input.readOnly = false;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
    resizeEditor(input);
  };
  const rows = (items: OutlineNode[], depth = 0): ReactNode => items.map((node) => <div key={node.id}>
    <div data-outline-node-id={node.id} className={`outline-row ${selectedId === node.id ? "active" : ""} ${selectedIds.has(node.id) ? "is-selected" : ""} ${editingId === node.id ? "is-editing" : ""} ${draggingIds.has(node.id) ? "is-dragging" : ""} ${dropTarget?.id === node.id ? `is-drop-target is-drop-${dropTarget.position}` : ""}`} style={{ "--outline-depth": depth, marginLeft: `${Math.min(depth, 6) * 14}px`, width: `calc(100% - ${Math.min(depth, 6) * 14}px)` } as CSSProperties} onMouseDown={(event) => { if (!(event.target as HTMLElement).closest(".outline-row-menu,.outline-toggle,textarea")) event.preventDefault(); }} onClick={(event) => { if ((event.target as HTMLElement).closest(".outline-row-menu,.outline-toggle,textarea")) return; selectWithPointer(node.id, event.shiftKey, multiSelectMode || event.metaKey || event.ctrlKey); }}>
      {multiSelectMode && <span className={`outline-select-box ${selectedIds.has(node.id) ? "checked" : ""}`} aria-hidden="true">{selectedIds.has(node.id) ? "✓" : ""}</span>}
      <div className="outline-handle-menu outline-row-menu" onClick={(event) => event.stopPropagation()}>
        <span className="outline-drag-handle" role="button" aria-label={`${node.text || "無題"}の操作。ドラッグして移動`} aria-expanded={menuId === node.id} title="ドラッグで移動・クリックでメニュー" onPointerDown={(event) => startDrag(event, node.id)} onPointerMove={drag} onPointerUp={endDrag} onPointerCancel={clearDrag} onClick={(event) => event.stopPropagation()}><i /><i /><i /><i /><i /><i /></span>
        {menuId === node.id && <div className="outline-action-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { move(node.id, -1); setMenuId(""); }}>↑ 上へ移動</button><button type="button" role="menuitem" onClick={() => { move(node.id, 1); setMenuId(""); }}>↓ 下へ移動</button><button type="button" role="menuitem" onClick={() => { indent(node.id); setMenuId(""); }}>→ 子階層へ</button><button type="button" role="menuitem" onClick={() => { outdent(node.id); setMenuId(""); }}>← 親階層へ</button><button type="button" role="menuitem" className="danger" onClick={() => { remove(node.id); setMenuId(""); }}>× 削除</button>
        </div>}
      </div>
      <button type="button" className="outline-toggle" disabled={!node.children.length} onClick={() => updateCollapsed((current) => { const next = new Set(current); next.has(node.id) ? next.delete(node.id) : next.add(node.id); return next; })}>{node.children.length ? (collapsed.has(node.id) ? "▶" : "▼") : "•"}</button>
      <textarea rows={1} ref={(element) => { if (element) { inputs.current.set(node.id, element); requestAnimationFrame(() => resizeEditor(element)); } else inputs.current.delete(node.id); }} value={node.text} placeholder="項目を入力" aria-label="アウトライン項目" readOnly={multiSelectMode} onMouseDown={(event) => { if (multiSelectMode || event.shiftKey || event.metaKey || event.ctrlKey) { event.preventDefault(); event.stopPropagation(); selectWithPointer(node.id, event.shiftKey, multiSelectMode || event.metaKey || event.ctrlKey); } }} onFocus={(event) => { if (multiSelectMode) { event.currentTarget.blur(); return; } setEditingId(node.id); selectOnly(node.id); requestAnimationFrame(() => resizeEditor(event.currentTarget)); }} onBlur={() => setEditingId((current) => current === node.id ? "" : current)} onChange={(event) => { resizeEditor(event.currentTarget); updateText(node.id, event.target.value); }} onCompositionStart={() => { composing.current = true; compositionJustEnded.current = false; }} onCompositionEnd={() => { composing.current = false; compositionJustEnded.current = true; window.setTimeout(() => { compositionJustEnded.current = false; }, 0); }} onKeyDown={(event) => keyDown(event, node.id)} />
    </div>{!collapsed.has(node.id) && rows(node.children, depth + 1)}
  </div>);
  const preview = useMemo(() => { const render = (items: OutlineNode[]): ReactNode => <ul>{items.map((node) => <li key={node.id}><span className="outline-preview-text">{node.text || "（無題）"}</span>{node.children.length > 0 && render(node.children)}</li>)}</ul>; return render(nodes); }, [nodes]);
  return <div ref={editorRoot} className={`outline-editor is-${mode}`} tabIndex={0} onCopy={copySelected} onKeyDown={(event) => { if (mode !== "edit" || (event.target as HTMLElement).matches("textarea,input,button,[contenteditable='true']")) return; if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return; } if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); navigateSelection(event.key === "ArrowUp" ? -1 : 1); return; } if ((event.key === "Backspace" || event.key === "Delete") && selectedIds.size) { event.preventDefault(); removeSelected(); return; } if (event.key === "F2" && selectedId) { event.preventDefault(); startEditing(selectedId); return; } if (event.key === "Enter" && selectedId) { event.preventDefault(); event.shiftKey ? addChild(selectedId) : addImmediatelyBelow(selectedId); return; } if (selectedId && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); const node = find(nodes, selectedId); if (node) { const nextText = `${node.text}${event.key}`; updateText(selectedId, nextText); requestAnimationFrame(() => { startEditing(selectedId); const input = inputs.current.get(selectedId); input?.setSelectionRange(nextText.length, nextText.length); }); } } }} onPointerDownCapture={(event) => { if (!(event.target as HTMLElement).closest(".outline-row-menu")) setMenuId(""); }}>
    <section>
      <header className="outline-mode-header">
        <strong>{mode === "edit" ? "アウトライン編集" : "アウトライン閲覧"}</strong>
        <div className="outline-mode-actions" role="group" aria-label="アウトラインの表示モード">
          {mode === "edit" && <><button type="button" disabled={!undoStack.length} onClick={undo} title="元に戻す（⌘Z）"><span aria-hidden="true">↶</span>戻す</button><button type="button" disabled={!redoStack.length} onClick={redo} title="やり直す（⇧⌘Z）"><span aria-hidden="true">↷</span>やり直す</button></>}
          {mode === "edit" && <button type="button" className={multiSelectMode ? "active outline-multi-toggle" : "outline-multi-toggle"} aria-pressed={multiSelectMode} onClick={() => { setMultiSelectMode((current) => { const next = !current; if (next) { setSelectedIds(new Set()); setEditingId(""); focusSelectionMode(); } else if (selectedId) setSelectedIds(new Set([selectedId])); return next; }); }}><span aria-hidden="true">☑</span>{multiSelectMode ? "選択終了" : "複数選択"}</button>}
          <button type="button" className={mode === "edit" ? "active" : ""} aria-pressed={mode === "edit"} onClick={showEditMode}><span aria-hidden="true">✎</span>編集</button>
          <button type="button" className={mode === "view" ? "active" : ""} aria-pressed={mode === "view"} onClick={() => setMode("view")}><span aria-hidden="true">◉</span>閲覧</button>
        </div>
      </header>
      {mode === "edit" ? <>
        <div className="outline-tree">{rows(nodes)}</div>
        <button type="button" className="outline-add-root" onClick={() => { const next = copy(nodes); const node = { id: generateId(), text: "", children: [] }; next.push(node); selectOnly(node.id); commit(next, node.id); }}>＋ 最上位の項目を追加</button>
      </> : <div className="outline-preview outline-read-view">{preview}</div>}
    </section>
  </div>;
}
