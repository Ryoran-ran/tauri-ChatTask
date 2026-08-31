import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Task, TaskDocument } from "../types";
import { exportMarkdown } from "../services/documents";
import { generateId } from "../utils";
import { Modal } from "./Modal";
import { BlockEditor } from "./BlockEditor";
import { OutlineEditor, outlineToMarkdown } from "./OutlineEditor";

type SaveStatus = "saved" | "unsaved" | "saving" | "error";
type FolderSortMode = NonNullable<TaskDocument["folderSortMode"]>;
const FOLDER_SORT_OPTIONS: { value: FolderSortMode; label: string }[] = [
  { value: "manual", label: "手動の並び順" },
  { value: "name-asc", label: "名前順（昇順）" },
  { value: "name-desc", label: "名前順（降順）" },
  { value: "updated-desc", label: "更新日（新しい順）" },
  { value: "updated-asc", label: "更新日（古い順）" },
  { value: "created-desc", label: "作成日（新しい順）" },
  { value: "created-asc", label: "作成日（古い順）" },
];

const normalizeDocuments = (items: TaskDocument[]) => items.map((item, index) => ({
  ...item,
  kind: item.kind === "folder" ? "folder" as const : item.kind === "outline" ? "outline" as const : "document" as const,
  parentId: item.parentId || "",
  sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : index,
}));
type ImportKind = "document" | "outline";
type ImportedOutlineNode = { id: string; text: string; children: ImportedOutlineNode[] };

const markdownToOutline = (source: string): string => {
  const roots: ImportedOutlineNode[] = [];
  const stack: { depth: number; node: ImportedOutlineNode }[] = [];
  let previous: ImportedOutlineNode | undefined;
  source.split(/\r?\n/).forEach((rawLine) => {
    if (!rawLine.trim()) return;
    const heading = rawLine.match(/^\s*(#{1,6})\s+(.+)$/);
    const list = rawLine.match(/^(\s*)(?:[-+*]|\d+[.)])\s+(.+)$/);
    const indent = list ? list[1].replace(/\t/g, "  ").length : rawLine.match(/^\s*/)?.[0].replace(/\t/g, "  ").length || 0;
    const depth = heading ? heading[1].length - 1 : list ? Math.floor(indent / 2) : 0;
    const text = (heading?.[2] || list?.[2] || rawLine.trim()).trim();
    if (!text) return;
    const node: ImportedOutlineNode = { id: generateId(), text, children: [] };
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    if (depth > 0 && stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ depth, node });
    previous = node;
  });
  return JSON.stringify(roots.length ? roots : [{ id: generateId(), text: previous?.text || "新しい項目", children: [] }]);
};
const DocumentIcon = ({ kind }: { kind: "document" | "folder" | "outline" | "import" }) => kind === "folder"
  ? <svg className="document-type-icon folder" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><path d="M3.5 9h17" /></svg>
  : kind === "outline"
    ? <svg className="document-type-icon outline" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h2M10 6h9M7 6v6h3M10 12h9M10 18h9M5 18h2" /></svg>
    : kind === "import"
    ? <svg className="document-type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 19h14" /></svg>
    : <svg className="document-type-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8l4 4V20H6z" /><path d="M14 3.5V8h4M9 12h6M9 15h6" /></svg>;

export function DocumentsModal({ task, documents: initialDocuments, title, scopeLabel = "タスク専用", scopeOptions = [], persistenceKey, initialDocumentId = "", initialSearchQuery = "", onSave, onClose }: { task?: Task; documents?: TaskDocument[]; title?: string; scopeLabel?: string; scopeOptions?: { id: string; icon: string; label: string; count: number; active: boolean; onOpen: () => void }[]; persistenceKey?: string; initialDocumentId?: string; initialSearchQuery?: string; onSave: (documents: TaskDocument[]) => void; onClose: () => void }) {
  const sourceDocuments = normalizeDocuments(task?.documents || initialDocuments || []);
  const resourceId = task?.id || title || "shared-documents";
  const lastDocumentStorageKey = `chatTaskLastDocument:${persistenceKey || resourceId}`;
  const resourceTitle = task?.title || title || "ドキュメント";
  const [documents, setDocuments] = useState<TaskDocument[]>(sourceDocuments);
  const [selectedId, setSelectedId] = useState(() => {
    const rememberedId = localStorage.getItem(lastDocumentStorageKey) || "";
    return initialDocumentId || (sourceDocuments.some((document) => document.id === rememberedId && document.kind !== "folder") ? rememberedId : "") || sourceDocuments.find((document) => document.kind !== "folder")?.id || sourceDocuments[0]?.id || "";
  });
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const [movingId, setMovingId] = useState("");
  const [moveTarget, setMoveTarget] = useState<{ id: string; position: "before" | "inside" | "after" } | null>(null);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("chatTaskCollapsedDocumentFolders") || "[]"));
    } catch {
      return new Set();
    }
  });
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [importChoiceOpen, setImportChoiceOpen] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [fileSearchTarget, setFileSearchTarget] = useState<{ documentId: string; query: string; nonce: number } | null>(initialDocumentId && initialSearchQuery ? { documentId: initialDocumentId, query: initialSearchQuery, nonce: 0 } : null);
  const latestDocuments = useRef(documents);
  const saveHandler = useRef(onSave);
  const dirty = useRef(false);
  const initialized = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importKindRef = useRef<ImportKind>("document");
  const dragDepth = useRef(0);
  const filePointerDrag = useRef<{ id: string; pointerId: number; x: number; y: number; started: boolean } | null>(null);
  const filePointerDrop = useRef<{ parentId: string; targetId: string; position: "before" | "inside" | "after" } | null>(null);
  const suppressFileClick = useRef(false);
  const selected = documents.find((document) => document.id === selectedId);
  const selectedParentId = selected?.kind === "folder" ? selected.id : selected?.parentId || "";
  const fileSearchResults = useMemo(() => {
    const query = fileSearchQuery.trim().toLocaleLowerCase("ja");
    if (!query) return [];
    return documents.filter((document) => document.kind !== "folder").flatMap((document) => {
      const source = `${document.title}\n${document.content}`;
      const normalized = source.toLocaleLowerCase("ja");
      let index = normalized.indexOf(query);
      if (index < 0) return [];
      let count = 0;
      let offset = 0;
      while (offset <= normalized.length - query.length) {
        const match = normalized.indexOf(query, offset);
        if (match < 0) break;
        count += 1;
        offset = match + Math.max(1, query.length);
      }
      const start = Math.max(0, index - 32);
      const end = Math.min(source.length, index + query.length + 60);
      return [{ document, count, excerpt: `${start ? "…" : ""}${source.slice(start, end).replace(/\s+/g, " ").trim()}${end < source.length ? "…" : ""}` }];
    });
  }, [documents, fileSearchQuery]);

  useEffect(() => { saveHandler.current = onSave; }, [onSave]);
  const persist = useCallback((items = latestDocuments.current) => {
    if (!dirty.current) return;
    setSaveStatus("saving");
    try {
      saveHandler.current(items);
      dirty.current = false;
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }, []);

  useEffect(() => {
    setDocuments(sourceDocuments);
    latestDocuments.current = sourceDocuments;
    const rememberedId = localStorage.getItem(lastDocumentStorageKey) || "";
    setSelectedId(initialDocumentId || (sourceDocuments.some((document) => document.id === rememberedId && document.kind !== "folder") ? rememberedId : "") || sourceDocuments.find((document) => document.kind !== "folder")?.id || sourceDocuments[0]?.id || "");
    setSaveStatus("saved");
    dirty.current = false;
  }, [resourceId, lastDocumentStorageKey]);
  useEffect(() => {
    const current = documents.find((document) => document.id === selectedId);
    if (current && current.kind !== "folder") localStorage.setItem(lastDocumentStorageKey, current.id);
  }, [documents, lastDocumentStorageKey, selectedId]);
  useEffect(() => setDeleteConfirm(false), [selectedId]);
  useEffect(() => {
    if (!message || message === "出力中...") return;
    const timer = window.setTimeout(() => setMessage(""), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    latestDocuments.current = documents;
    if (!initialized.current) { initialized.current = true; return; }
    dirty.current = true;
    setSaveStatus("unsaved");
    const timer = window.setTimeout(() => persist(documents), 1200);
    return () => window.clearTimeout(timer);
  }, [documents, persist]);
  useEffect(() => {
    const saveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setFileSearchOpen(true);
        return;
      }
      if (event.key.toLowerCase() === "s" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        persist();
      }
    };
    window.addEventListener("keydown", saveShortcut, true);
    return () => window.removeEventListener("keydown", saveShortcut, true);
  }, [persist]);

  const update = (changes: Partial<TaskDocument>) => setDocuments((items) => items.map((item) => item.id === selectedId ? { ...item, ...changes, updatedAt: new Date().toISOString() } : item));
  const create = (kind: "document" | "folder" | "outline") => {
    const now = new Date().toISOString();
    const item: TaskDocument = {
      id: generateId(),
      title: kind === "folder" ? "新しいフォルダ" : kind === "outline" ? "新しいアウトライン" : "新しいドキュメント",
      content: "",
      kind,
      parentId: selectedParentId,
      sortOrder: Math.max(-1, ...documents.filter((document) => (document.parentId || "") === selectedParentId).map((document) => document.sortOrder ?? 0)) + 1,
      createdAt: now,
      updatedAt: now,
    };
    setDocuments((items) => [...items, item]);
    setSelectedId(item.id);
  };
  const descendants = (id: string): Set<string> => {
    const result = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      documents.forEach((item) => {
        if (item.parentId && result.has(item.parentId) && !result.has(item.id)) {
          result.add(item.id);
          changed = true;
        }
      });
    }
    return result;
  };
  const moveDocument = (id: string, parentId: string, targetId = "", position: "before" | "inside" | "after" = "inside") => {
    if (id === targetId || (parentId && descendants(id).has(parentId))) return;
    setDocuments((items) => {
      const moving = items.find((item) => item.id === id);
      if (!moving) return items;
      const siblings = items.filter((item) => item.id !== id && (item.parentId || "") === parentId).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      let index = siblings.length;
      if (targetId && position !== "inside") { const found = siblings.findIndex((item) => item.id === targetId); if (found >= 0) index = found + (position === "after" ? 1 : 0); }
      siblings.splice(index, 0, { ...moving, parentId });
      const order = new Map(siblings.map((item, itemIndex) => [item.id, itemIndex]));
      return items.map((item) => order.has(item.id) ? { ...item, parentId: item.id === id ? parentId : item.parentId, sortOrder: order.get(item.id), updatedAt: item.id === id ? new Date().toISOString() : item.updatedAt } : item);
    });
  };
  const clearFileDrag = () => { filePointerDrag.current = null; filePointerDrop.current = null; setMovingId(""); setMoveTarget(null); };
  const startFileDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".document-tree-toggle")) return;
    filePointerDrag.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, started: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const dragFile = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = filePointerDrag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.started && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5) return;
    if (!current.started) { current.started = true; setMovingId(current.id); }
    event.preventDefault();
    const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const row = element?.closest<HTMLButtonElement>("[data-document-tree-id]");
    if (row && row.dataset.documentTreeId !== current.id) {
      const rect = row.getBoundingClientRect(); const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
      const position = row.dataset.documentKind === "folder" && ratio > .3 && ratio < .7 ? "inside" : ratio < .5 ? "before" : "after";
      const targetId = row.dataset.documentTreeId || ""; const parentId = position === "inside" ? targetId : row.dataset.documentParentId || "";
      filePointerDrop.current = { parentId, targetId, position }; setMoveTarget({ id: targetId, position }); return;
    }
    if (element?.closest("[data-document-root-drop]")) { filePointerDrop.current = { parentId: "", targetId: "", position: "inside" }; setMoveTarget({ id: "", position: "inside" }); return; }
    filePointerDrop.current = null; setMoveTarget(null);
  };
  const endFileDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = filePointerDrag.current; if (!current || current.pointerId !== event.pointerId) return;
    if (current.started) { event.preventDefault(); suppressFileClick.current = true; const target = filePointerDrop.current; if (target) moveDocument(current.id, target.parentId, target.targetId, target.position); }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    clearFileDrag();
  };
  const remove = () => {
    if (!selected) return;
    const removedIds = descendants(selected.id);
    const next = documents.filter((item) => !removedIds.has(item.id));
    setDocuments(next);
    setSelectedId(next.find((item) => item.parentId === selected.parentId)?.id || next[0]?.id || "");
    setDeleteConfirm(false);
    latestDocuments.current = next;
    dirty.current = true;
    persist(next);
  };
  const duplicateSelected = () => {
    if (!selected) return;
    const copiedIds = descendants(selected.id);
    const originals = documents.filter((item) => copiedIds.has(item.id));
    const idMap = new Map(originals.map((item) => [item.id, generateId()]));
    const siblingTitles = new Set(documents.filter((item) => item.parentId === selected.parentId).map((item) => item.title));
    const copyBase = `${selected.title || (selected.kind === "folder" ? "無題のフォルダ" : "無題の文書")} のコピー`;
    let copyTitle = copyBase;
    let copyNumber = 2;
    while (siblingTitles.has(copyTitle)) {
      copyTitle = `${copyBase} (${copyNumber})`;
      copyNumber += 1;
    }
    const now = new Date().toISOString();
    const copies = originals.map((item): TaskDocument => ({
      ...item,
      id: idMap.get(item.id)!,
      title: item.id === selected.id ? copyTitle : item.title,
        parentId: item.id === selected.id ? selected.parentId : item.parentId ? idMap.get(item.parentId) || item.parentId : "",
      sortOrder: item.id === selected.id ? (selected.sortOrder ?? documents.length) + .5 : item.sortOrder,
      createdAt: now,
      updatedAt: now,
    }));
    setDocuments((items) => [...items, ...copies]);
    setSelectedId(idMap.get(selected.id)!);
    setMessage(selected.kind === "folder" ? `「${selected.title}」と配下の項目を複写しました。` : `「${selected.title}」を複写しました。`);
  };
  const close = () => {
    if (dirty.current) persist();
    onClose();
  };
  const exportSelected = async () => {
    if (!selected || selected.kind === "folder") return;
    if (dirty.current) persist();
    setMessage("出力中...");
    try {
      const content = selected.kind === "outline" ? outlineToMarkdown(selected.content) : selected.content;
      const path = await exportMarkdown(selected.title || "document", content);
      setMessage(`出力しました: ${path}`);
    } catch (reason) {
      setMessage(`出力できませんでした: ${String(reason)}`);
    }
  };
  const importFiles = async (files: File[], importKind: ImportKind = importKindRef.current) => {
    const markdownFiles = files.filter((file) => /\.(?:md|markdown|txt)$/i.test(file.name));
    if (!markdownFiles.length) {
      setMessage("インポートできませんでした: .md、.markdown、.txt ファイルを選択してください。");
      return;
    }
    const now = new Date().toISOString();
    try {
      const imported = await Promise.all(markdownFiles.map(async (file, index): Promise<TaskDocument> => {
        const source = await file.text();
        return {
          id: generateId(),
          title: file.name.replace(/\.(?:md|markdown|txt)$/i, "") || (importKind === "outline" ? "インポートしたアウトライン" : "インポートしたドキュメント"),
          content: importKind === "outline" ? markdownToOutline(source) : source,
          kind: importKind,
          parentId: selectedParentId,
          sortOrder: documents.filter((document) => (document.parentId || "") === selectedParentId).length + index,
          createdAt: now,
          updatedAt: now,
        };
      }));
      setDocuments((items) => [...items, ...imported]);
      setSelectedId(imported[0].id);
      setMessage(`${imported.length}件を${importKind === "outline" ? "アウトライン" : "文書"}としてインポートしました。`);
    } catch (reason) {
      setMessage(`インポートできませんでした: ${String(reason)}`);
    }
  };
  const importFromInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    void importFiles(files);
  };
  const chooseImportKind = (kind: ImportKind) => {
    importKindRef.current = kind;
    setImportChoiceOpen(false);
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";
    fileInputRef.current.click();
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = 0;
    setDragging(false);
    void importFiles(Array.from(event.dataTransfer.files));
  };
  const enter = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current += 1;
    setDragging(true);
  };
  const leave = (event: DragEvent<HTMLDivElement>) => {
    event.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragging(false);
  };
  const statusLabel = saveStatus === "saving" ? "保存中…" : saveStatus === "unsaved" ? "まもなく保存" : saveStatus === "error" ? "保存できませんでした" : "保存済み";
  const highlightFileSearchMatch = (text: string) => {
    const query = fileSearchQuery.trim();
    if (!query) return text;
    const normalizedText = text.toLocaleLowerCase("ja");
    const normalizedQuery = query.toLocaleLowerCase("ja");
    const parts: React.ReactNode[] = [];
    let offset = 0;
    let match = normalizedText.indexOf(normalizedQuery);
    while (match >= 0) {
      if (match > offset) parts.push(text.slice(offset, match));
      parts.push(<mark key={`${match}-${parts.length}`}>{text.slice(match, match + query.length)}</mark>);
      offset = match + query.length;
      match = normalizedText.indexOf(normalizedQuery, offset);
    }
    if (offset < text.length) parts.push(text.slice(offset));
    return parts.length ? parts : text;
  };
  const openFileSearchResult = (documentId: string) => {
    const query = fileSearchQuery.trim();
    setSelectedId(documentId);
    setFileSearchTarget({ documentId, query, nonce: Date.now() });
  };
  const toggleFolder = (id: string) => setCollapsedFolderIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    localStorage.setItem("chatTaskCollapsedDocumentFolders", JSON.stringify([...next]));
    return next;
  });
  const compareDocuments = (left: TaskDocument, right: TaskDocument, parentId: string) => {
    if (!parentId) {
      const kindOrder = Number(right.kind === "folder") - Number(left.kind === "folder");
      return kindOrder || left.title.localeCompare(right.title, "ja", { numeric: true, sensitivity: "base" });
    }
    const mode = documents.find((item) => item.id === parentId)?.folderSortMode || "manual";
    if (mode === "manual") return (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
    if (mode === "name-asc" || mode === "name-desc") {
      const result = left.title.localeCompare(right.title, "ja", { numeric: true, sensitivity: "base" });
      return mode === "name-desc" ? -result : result;
    }
    const field: "updatedAt" | "createdAt" = mode.startsWith("updated") ? "updatedAt" : "createdAt";
    const result = (left[field] || "").localeCompare(right[field] || "");
    return mode.endsWith("desc") ? -result : result;
  };
  const renderTree = (parentId = "", depth = 0): React.ReactNode => {
    const siblings = documents
      .filter((item) => (item.parentId || "") === parentId)
      .sort((left, right) => compareDocuments(left, right, parentId));
    return siblings.map((item, index) => <div className="document-tree-branch" key={item.id}>
      <button type="button" data-document-tree-id={item.id} data-document-parent-id={parentId} data-document-kind={item.kind} className={`${depth > 0 ? "document-tree-child" : ""} ${depth > 0 && index === siblings.length - 1 ? "document-tree-last-child" : ""} ${item.id === selectedId ? "active" : ""} ${movingId === item.id ? "is-moving" : ""} ${moveTarget?.id === item.id ? `is-move-target is-drop-${moveTarget.position}` : ""}`} style={{ paddingLeft: `${.55 + depth * .85}rem`, "--document-connector-left": `${.55 + depth * .85 - .42}rem` } as CSSProperties} onPointerDown={(event) => startFileDrag(event, item.id)} onPointerMove={dragFile} onPointerUp={endFileDrag} onPointerCancel={clearFileDrag} onClick={() => { if (suppressFileClick.current) { suppressFileClick.current = false; return; } setSelectedId(item.id); }}>
        {item.kind === "folder" ? <span role="button" className="document-tree-toggle" aria-label={collapsedFolderIds.has(item.id) ? `${item.title}を展開` : `${item.title}を折りたたむ`} aria-expanded={!collapsedFolderIds.has(item.id)} onClick={(event) => { event.stopPropagation(); toggleFolder(item.id); }}>{collapsedFolderIds.has(item.id) ? "▶" : "▼"}</span> : <span className="document-tree-leaf" />}<DocumentIcon kind={item.kind === "folder" ? "folder" : item.kind === "outline" ? "outline" : "document"} /><span>{item.title}</span>
      </button>
      {item.kind === "folder" && !collapsedFolderIds.has(item.id) && renderTree(item.id, depth + 1)}
    </div>);
  };

  return <Modal title={`${resourceTitle} — ドキュメント`} onClose={close} wide>
    <div className={`documents-layout ${dragging ? "is-import-dragging" : ""}`} onDragEnter={enter} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); } }} onDragLeave={leave} onDrop={drop}>
      <aside>
        <nav className="document-command-rail" aria-label="ドキュメント操作">
          {!!scopeOptions.length && <div className="document-command-rail-group" role="group" aria-label="ドキュメントの保存先">{scopeOptions.map((option) => <button type="button" key={option.id} className={option.active ? "active" : ""} title={`${option.label}（${option.count}件）`} aria-label={`${option.label}（${option.count}件）`} aria-pressed={option.active} onClick={() => { if (option.active) return; persist(); option.onOpen(); }}><b>{option.icon}</b><small>{option.count}</small></button>)}</div>}
          <div className="document-command-rail-group" role="group" aria-label="新規作成">
            <button type="button" className="primary" title="文書を作成" aria-label="文書を作成" onClick={() => create("document")}><DocumentIcon kind="document" /></button>
            <button type="button" title="アウトラインを作成" aria-label="アウトラインを作成" onClick={() => create("outline")}><DocumentIcon kind="outline" /></button>
            <button type="button" title="フォルダを作成" aria-label="フォルダを作成" onClick={() => create("folder")}><DocumentIcon kind="folder" /></button>
          </div>
          <div className="document-command-rail-group" role="group" aria-label="ツール">
            <button type="button" className={importChoiceOpen ? "active" : ""} title="ファイルをインポート" aria-label="ファイルをインポート" aria-expanded={importChoiceOpen} onClick={() => setImportChoiceOpen((open) => !open)}><DocumentIcon kind="import" /></button>
            <button type="button" className={fileSearchOpen ? "active" : ""} title="文書内を横断検索（⌘⇧F）" aria-label="文書内を横断検索" aria-pressed={fileSearchOpen} onClick={() => setFileSearchOpen((open) => !open)}>⌕</button>
          </div>
        </nav>
        <div className="document-file-pane">
          <div className="document-scope-label"><span>保存先</span><strong>{scopeLabel}</strong></div>
          {fileSearchOpen && <section className="document-file-search" role="search">
          <div><input autoFocus type="search" value={fileSearchQuery} onChange={(event) => setFileSearchQuery(event.target.value)} placeholder="この保存先を検索" /><button type="button" aria-label="検索を閉じる" onClick={() => setFileSearchOpen(false)}>×</button></div>
          <small>{fileSearchQuery.trim() ? `${fileSearchResults.length}文書で一致` : "文書名と本文を検索します"}</small>
          <div className="document-file-search-results">{fileSearchResults.map(({ document, count, excerpt }) => <button type="button" key={document.id} className={document.id === selectedId ? "active" : ""} onClick={() => openFileSearchResult(document.id)}><strong><span>{highlightFileSearchMatch(document.title || "無題の文書")}</span><b>{count}</b></strong><span>{highlightFileSearchMatch(excerpt)}</span></button>)}{fileSearchQuery.trim() && !fileSearchResults.length && <p>一致する文書はありません。</p>}</div>
          </section>}
          <input ref={fileInputRef} hidden type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple onChange={importFromInput} />
          <div data-document-root-drop title="最上位はVS Code風の「フォルダを先、同種内は名前順」で固定されます" className={`document-root-drop ${moveTarget?.id === "" ? "is-move-target" : ""}`}>最上位へ移動</div>
          <div className="document-tree">{renderTree()}</div>
        </div>
      </aside>
      {importChoiceOpen && <div className="document-import-choice" role="dialog" aria-modal="true" aria-label="インポート方法を選択" onClick={() => setImportChoiceOpen(false)}>
        <section onClick={(event) => event.stopPropagation()}>
          <header><strong>インポート方法</strong><button type="button" aria-label="閉じる" onClick={() => setImportChoiceOpen(false)}>×</button></header>
          <p>Markdownまたはテキストファイルの読み込み先を選択してください。</p>
          <button type="button" onClick={() => chooseImportKind("document")}><DocumentIcon kind="document" /><span><strong>文書として読み込む</strong><small>Markdownの内容をそのまま編集します</small></span></button>
          <button type="button" onClick={() => chooseImportKind("outline")}><DocumentIcon kind="outline" /><span><strong>アウトラインとして読み込む</strong><small>見出し・箇条書きを階層へ変換します</small></span></button>
        </section>
      </div>}
      <main>
        {selected ? <>
          <input className="document-title" value={selected.title} onChange={(event) => update({ title: event.target.value })} />
          {selected.kind === "folder"
            ? <section className="document-folder-browser"><header><div><DocumentIcon kind="folder" /><strong>フォルダ内のツリー</strong></div><div className="document-folder-sort"><label>並び順<select value={selected.folderSortMode || "manual"} onChange={(event) => update({ folderSortMode: event.target.value as FolderSortMode })}>{FOLDER_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><small>{documents.filter((item) => item.parentId === selected.id).length}項目</small></div></header><div className="document-folder-tree">{documents.some((item) => item.parentId === selected.id) ? renderTree(selected.id) : <div className="document-folder-empty"><DocumentIcon kind="folder" /><strong>{selected.title}</strong><p>「文書」またはMarkdownのインポートで、このフォルダ内に追加できます。</p></div>}</div></section>
            : selected.kind === "outline"
              ? <OutlineEditor key={selected.id} documentId={selected.id} value={selected.content} onChange={(content) => update({ content })} />
              : <BlockEditor key={`${selected.id}:${fileSearchTarget?.documentId === selected.id ? fileSearchTarget.nonce : initialSearchQuery}`} documentId={selected.id} documentTitle={selected.title} value={selected.content} initialSearchQuery={fileSearchTarget?.documentId === selected.id ? fileSearchTarget.query : selected.id === initialDocumentId ? initialSearchQuery : ""} onChange={(content) => update({ content })} />}
          {message && <div className={`document-export-toast${message.includes("できませんでした") ? " error" : ""}`} role="status">{message}</div>}
          <div className="document-footer">
            <div className="document-delete-actions">{deleteConfirm ? <><span>{selected.kind === "folder" ? "配下の文書も含めて削除しますか？" : "このドキュメントを削除しますか？"}</span><button onClick={() => setDeleteConfirm(false)}>キャンセル</button><button className="danger" onClick={remove}>削除する</button></> : <button className="danger-text" onClick={() => setDeleteConfirm(true)}>削除</button>}</div>
            <div className="document-save-actions"><span className={`save-status save-status-${saveStatus}`}>{statusLabel}</span><button onClick={duplicateSelected}>複写</button>{selected.kind !== "folder" && <button onClick={exportSelected}>MD出力</button>}<button className="primary" onClick={() => persist()}>今すぐ保存</button></div>
          </div>
        </> : <div className="empty-list">ドキュメントまたはフォルダを作成してください</div>}
      </main>
      {dragging && <div className="document-import-overlay">Markdownファイルをドロップしてインポート</div>}
    </div>
  </Modal>;
}
