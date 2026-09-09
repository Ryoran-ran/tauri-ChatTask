import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { LocalTool } from "../types";
import { generateId } from "../utils";
import { Modal } from "./Modal";

const folderName = (path: string) => {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "新しいツール";
};
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
type DroppedEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (success: (file: File) => void, failure?: (error: DOMException) => void) => void;
  createReader?: () => { readEntries: (success: (entries: DroppedEntry[]) => void, failure?: (error: DOMException) => void) => void };
};
type DroppedToolFile = { relativePath: string; data: number[] };
const ignoredToolDirectories = new Set([".git", "node_modules", "target", ".next", ".cache", "coverage"]);

const entryFile = (entry: DroppedEntry) => new Promise<File>((resolve, reject) => entry.file?.(resolve, reject));
const directoryEntries = async (entry: DroppedEntry) => {
  const reader = entry.createReader?.();
  if (!reader) return [];
  const result: DroppedEntry[] = [];
  while (true) {
    const batch = await new Promise<DroppedEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return result;
    result.push(...batch);
  }
};
const readDroppedFiles = async (entry: DroppedEntry, parentPath: string, output: DroppedToolFile[]) => {
  if (entry.isDirectory) {
    if (ignoredToolDirectories.has(entry.name)) return;
    const directoryPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    for (const child of await directoryEntries(entry)) await readDroppedFiles(child, directoryPath, output);
    return;
  }
  if (!entry.isFile) return;
  const file = await entryFile(entry);
  const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  output.push({ relativePath, data: Array.from(new Uint8Array(await file.arrayBuffer())) });
};

export function ToolsModal({ tools, storagePath, onSave, onStoragePath, onClose }: { tools: LocalTool[]; storagePath: string; onSave: (tools: LocalTool[]) => void; onStoragePath: (path: string) => void; onClose: () => void }) {
  const [htmlFiles, setHtmlFiles] = useState<Record<string, string[]>>(() => Object.fromEntries(tools.map((tool) => [tool.id, tool.entryFile ? [tool.entryFile] : []])));
  const [loadingIds, setLoadingIds] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [deleteId, setDeleteId] = useState("");
  const [sourcePath, setSourcePath] = useState(() => localStorage.getItem("chatTaskLastToolSourcePath") || "");
  const [entryFileDraft, setEntryFileDraft] = useState("index.html");
  const [dropActive, setDropActive] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState("");
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [editingId, setEditingId] = useState("");
  const [folderNameDraft, setFolderNameDraft] = useState("");

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (!(event.target as Element | null)?.closest(".tool-menu-area, .tool-action-menu")) setOpenMenuId("");
    };
    const closeMenuOnMove = () => setOpenMenuId("");
    document.addEventListener("mousedown", closeMenu);
    window.addEventListener("resize", closeMenuOnMove);
    window.addEventListener("scroll", closeMenuOnMove, true);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("resize", closeMenuOnMove);
      window.removeEventListener("scroll", closeMenuOnMove, true);
    };
  }, []);

  const toggleToolMenu = (toolId: string, button: HTMLButtonElement) => {
    if (openMenuId === toolId) {
      setOpenMenuId("");
      return;
    }
    const rect = button.getBoundingClientRect();
    const menuWidth = 184;
    const menuHeight = 150;
    const gap = 6;
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
    const top = window.innerHeight - rect.bottom >= menuHeight + gap
      ? rect.bottom + gap
      : Math.max(8, rect.top - menuHeight - gap);
    setMenuPosition({ top, left });
    setOpenMenuId(toolId);
  };

  const loadFiles = async (tool: LocalTool) => {
    setLoadingIds((current) => new Set(current).add(tool.id));
    try {
      const files = await invoke<string[]>("list_tool_html_files", { folderPath: tool.folderPath });
      setHtmlFiles((current) => ({ ...current, [tool.id]: files }));
      return files;
    } catch (error) {
      setHtmlFiles((current) => ({ ...current, [tool.id]: [] }));
      setNotice({ text: errorText(error), error: true });
      return [];
    } finally {
      setLoadingIds((current) => { const next = new Set(current); next.delete(tool.id); return next; });
    }
  };

  const updateTool = (id: string, changes: Partial<LocalTool>) => {
    const updatedAt = new Date().toISOString();
    onSave(tools.map((tool) => tool.id === id ? { ...tool, ...changes, updatedAt } : tool));
  };

  const renameToolFolder = async (tool: LocalTool) => {
    const nextName = folderNameDraft.trim();
    if (!nextName) {
      setNotice({ text: "保存フォルダ名を入力してください。", error: true });
      return;
    }
    setLoadingIds((current) => new Set(current).add(tool.id));
    setNotice(null);
    try {
      const folderPath = await invoke<string>("rename_managed_tool_folder", { folderPath: tool.folderPath, toolId: tool.id, folderName: nextName });
      updateTool(tool.id, { folderPath });
      setFolderNameDraft(folderName(folderPath));
      setNotice({ text: `保存フォルダ名を「${folderName(folderPath)}」へ変更しました。` });
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    } finally {
      setLoadingIds((current) => { const next = new Set(current); next.delete(tool.id); return next; });
    }
  };

  const chooseStoragePath = async () => {
    setNotice(null);
    try {
      const path = await invoke<string | null>("select_tool_folder", { initialPath: storagePath || undefined });
      if (!path) return;
      onStoragePath(path);
      setNotice({ text: tools.length ? "保存先を変更しました。登録済みのツールは元の場所に残り、新しく追加するツールから使用されます。" : "ツールの保存先を設定しました。" });
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    }
  };

  const importFolder = async (path: string, requestedEntryFile: string) => {
    if (!storagePath) {
      setNotice({ text: "先にツールの保存先を設定してください。", error: true });
      return;
    }
    const trimmedPath = path.trim();
    const trimmedEntry = requestedEntryFile.trim();
    if (!trimmedPath || !trimmedEntry) {
      setNotice({ text: "取り込むフォルダと起動HTMLを入力してください。", error: true });
      return;
    }
    setAdding(true);
    setNotice(null);
    try {
      const entryFile = await invoke<string>("validate_tool_html_entry", { folderPath: trimmedPath, entryFile: trimmedEntry });
      const id = generateId();
      const copiedPath = await invoke<string>("copy_tool_folder", { sourceFolder: trimmedPath, storagePath, toolId: id });
      const timestamp = new Date().toISOString();
      const tool: LocalTool = { id, name: folderName(trimmedPath), folderPath: copiedPath, entryFile, createdAt: timestamp, updatedAt: timestamp, managedCopy: true };
      setHtmlFiles((current) => ({ ...current, [tool.id]: [entryFile] }));
      onSave([...tools, tool]);
      localStorage.setItem("chatTaskLastToolSourcePath", trimmedPath);
      setSourcePath(trimmedPath);
      setEntryFileDraft(entryFile);
      setImportOpen(false);
      setNotice({ text: `「${tool.name}」を保存先へコピーして追加しました。` });
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    } finally {
      setAdding(false);
    }
  };

  const chooseFolder = async () => {
    if (!storagePath) {
      setNotice({ text: "先にツールの保存先を設定してください。", error: true });
      return;
    }
    setNotice(null);
    try {
      const path = await invoke<string | null>("select_tool_folder", { initialPath: sourcePath || undefined });
      if (!path) return;
      setSourcePath(path);
      localStorage.setItem("chatTaskLastToolSourcePath", path);
      const entryFile = await invoke<string | null>("select_tool_html_file", { folderPath: path });
      if (!entryFile) return;
      setEntryFileDraft(entryFile);
      await importFolder(path, entryFile);
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    }
  };

  const droppedPath = (dataTransfer: DataTransfer) => {
    const filePath = (dataTransfer.files[0] as (File & { path?: string }) | undefined)?.path;
    if (filePath) return filePath;
    const uri = dataTransfer.getData("text/uri-list").split(/\r?\n/).find((line) => line.startsWith("file://"));
    if (uri) {
      try { return decodeURIComponent(new URL(uri).pathname); } catch { /* try plain text */ }
    }
    const text = dataTransfer.getData("text/plain").trim();
    if (text.startsWith("file://")) {
      try { return decodeURIComponent(new URL(text).pathname); } catch { return ""; }
    }
    return text;
  };

  const receiveDrop = (dataTransfer: DataTransfer) => {
    const path = droppedPath(dataTransfer);
    setDropActive(false);
    if (!path) {
      setNotice({ text: "フォルダのパスを取得できませんでした。パスを貼り付けてください。", error: true });
      return;
    }
    const normalized = path.replace(/\/$/, "");
    if (/\.html?$/i.test(normalized)) {
      const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
      setSourcePath(normalized.slice(0, separator));
      setEntryFileDraft(normalized.slice(separator + 1));
    } else {
      setSourcePath(normalized);
    }
    setNotice({ text: "パスを入力欄へ反映しました。起動HTMLを確認して取り込んでください。" });
  };

  const importDroppedFolder = async (dataTransfer: DataTransfer) => {
    if (!storagePath) {
      setDropActive(false);
      setNotice({ text: "先にツールの保存先を設定してください。", error: true });
      return;
    }
    const entries = Array.from(dataTransfer.items).flatMap((item) => {
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => DroppedEntry | null }).webkitGetAsEntry?.();
      return entry ? [entry] : [];
    });
    if (!entries.length) {
      receiveDrop(dataTransfer);
      return;
    }
    setDropActive(false);
    setAdding(true);
    setNotice({ text: "ドロップしたツールを読み込んでいます。" });
    try {
      const files: DroppedToolFile[] = [];
      for (const entry of entries) {
        if (entries.length === 1 && entry.isDirectory) {
          if (ignoredToolDirectories.has(entry.name)) continue;
          for (const child of await directoryEntries(entry)) await readDroppedFiles(child, "", files);
        } else {
          await readDroppedFiles(entry, "", files);
        }
      }
      if (files.length > 10_000) throw new Error("ツール内のファイル数が上限（10,000件）を超えています。");
      if (files.reduce((total, file) => total + file.data.length, 0) > 1024 * 1024 * 1024) throw new Error("ツールの容量が上限（1GB）を超えています。");
      const htmlFiles = files.map((file) => file.relativePath).filter((path) => /\.html?$/i.test(path)).sort((left, right) => {
        const leftIndex = left.toLowerCase() === "index.html";
        const rightIndex = right.toLowerCase() === "index.html";
        return Number(rightIndex) - Number(leftIndex) || left.localeCompare(right);
      });
      if (!htmlFiles.length) throw new Error("ドロップしたフォルダ内にHTMLファイルがありません。");
      const id = generateId();
      const name = entries.length === 1 ? entries[0].name.replace(/\.html?$/i, "") : "HTMLツール";
      const copiedPath = await invoke<string>("import_dropped_tool_files", { storagePath, toolId: id, folderName: name, files });
      const timestamp = new Date().toISOString();
      const tool: LocalTool = { id, name, folderPath: copiedPath, entryFile: htmlFiles[0], createdAt: timestamp, updatedAt: timestamp, managedCopy: true };
      setHtmlFiles((current) => ({ ...current, [id]: htmlFiles }));
      onSave([...tools, tool]);
      setImportOpen(false);
      setNotice({ text: `「${name}」をドロップから追加しました。` });
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    } finally {
      setAdding(false);
    }
  };

  const launch = async (tool: LocalTool) => {
    setNotice(null);
    try {
      await invoke("open_tool_in_chrome", { folderPath: tool.folderPath, entryFile: tool.entryFile });
    } catch (error) {
      setNotice({ text: `${tool.name}を起動できませんでした。${errorText(error)}`, error: true });
    }
  };

  const openFolder = async (tool: LocalTool) => {
    setNotice(null);
    try { await invoke("open_tool_folder", { folderPath: tool.folderPath }); }
    catch (error) { setNotice({ text: errorText(error), error: true }); }
  };

  const deleteTool = async (tool: LocalTool, removeFiles: boolean) => {
    setNotice(null);
    try {
      if (removeFiles) await invoke("delete_managed_tool_folder", { folderPath: tool.folderPath, toolId: tool.id });
      onSave(tools.filter((item) => item.id !== tool.id));
      setDeleteId("");
      setNotice({ text: removeFiles ? `「${tool.name}」の登録とコピーしたファイルを削除しました。` : `「${tool.name}」を一覧から削除しました。` });
    } catch (error) {
      setNotice({ text: errorText(error), error: true });
    }
  };

  return <>
    <Modal title="ツール" onClose={onClose} wide>
      {notice && !importOpen && <p className={`tools-notice ${notice.error ? "error" : ""}`} role="status">{notice.text}</p>}
      <div className="tools-list-heading"><div><strong>登録済みツール</strong><span>{tools.length}件</span></div><button type="button" className="primary" onClick={() => { setNotice(null); setImportOpen(true); }}>＋ ツールを追加</button></div>
      <div className="tools-list">
      {tools.map((tool) => {
        const files = htmlFiles[tool.id];
        const loading = loadingIds.has(tool.id);
        const entryMissing = Boolean(files && !files.includes(tool.entryFile));
        return <article className={`tool-launcher-row ${editingId === tool.id || deleteId === tool.id ? "is-expanded" : ""}`} key={tool.id}>
          <div className="tool-launcher-summary">
            <button type="button" className="tool-launch-button" disabled={loading || entryMissing || !tool.entryFile} onClick={() => void launch(tool)}><span className="tool-launch-icon" aria-hidden="true">&lt;/&gt;</span><span><strong>{tool.name || "名称未設定のツール"}</strong><small>{tool.entryFile}</small></span><b>Chromeで開く ↗</b></button>
            <div className="tool-menu-area"><button type="button" className="tool-menu-trigger" aria-label={`${tool.name}の設定`} aria-expanded={openMenuId === tool.id} onClick={(event) => toggleToolMenu(tool.id, event.currentTarget)}>…</button></div>
          </div>
          {openMenuId === tool.id && createPortal(<div className="tool-action-menu" style={menuPosition}><button type="button" onClick={() => { setEditingId(tool.id); setFolderNameDraft(folderName(tool.folderPath)); setDeleteId(""); setOpenMenuId(""); }}>設定を編集</button><button type="button" onClick={() => { setOpenMenuId(""); void openFolder(tool); }}>フォルダを開く</button><button type="button" onClick={() => { setEditingId(tool.id); setFolderNameDraft(folderName(tool.folderPath)); setOpenMenuId(""); void loadFiles(tool); }}>HTML一覧を更新</button><button type="button" className="danger-text" onClick={() => { setDeleteId(tool.id); setEditingId(""); setOpenMenuId(""); }}>削除</button></div>, document.body)}
          {editingId === tool.id && <div className="tool-inline-settings"><label>ツール名<input value={tool.name} onChange={(event) => updateTool(tool.id, { name: event.target.value })} /></label><label>起動HTML<select value={entryMissing ? "" : tool.entryFile} disabled={loading || !files?.length} onChange={(event) => updateTool(tool.id, { entryFile: event.target.value })}>{entryMissing && <option value="">ファイルが見つかりません</option>}{loading && <option value="">確認中…</option>}{!loading && !files?.length && <option value="">HTMLがありません</option>}{files?.map((file) => <option value={file} key={file}>{file}</option>)}</select></label><label className="tool-folder-name-setting">保存フォルダ名<span><input value={folderNameDraft} disabled={loading || !tool.managedCopy} onChange={(event) => setFolderNameDraft(event.target.value)} /><button type="button" disabled={loading || !tool.managedCopy || !folderNameDraft.trim() || folderNameDraft.trim() === folderName(tool.folderPath)} onClick={() => void renameToolFolder(tool)}>変更</button></span></label><button type="button" onClick={() => setEditingId("")}>閉じる</button><code title={tool.folderPath}>{tool.folderPath}</code>{!tool.managedCopy && <small>ChatTaskがコピーしたフォルダだけ名前を変更できます。</small>}</div>}
          {deleteId === tool.id && <div className="tool-delete-confirm"><span>削除方法を選択してください</span><button type="button" onClick={() => setDeleteId("")}>戻る</button><button type="button" onClick={() => void deleteTool(tool, false)}>登録だけ削除</button>{tool.managedCopy && <button type="button" className="danger" onClick={() => void deleteTool(tool, true)}>ファイルも削除</button>}</div>}
        </article>;
      })}
      {!tools.length && <div className="tools-empty"><strong>登録されたツールはありません</strong><span>{storagePath ? "HTMLファイルを含むツールフォルダを追加してください。" : "最初にツールの保存先を設定してください。"}</span></div>}
      </div>
      <div className="modal-actions"><span className="tools-autosave">変更は自動保存されます</span><button type="button" className="primary" onClick={onClose}>閉じる</button></div>
    </Modal>
    {importOpen && <Modal title="ツールを追加" onClose={() => { if (!adding) setImportOpen(false); }} wide>
      <div className="tools-import-body tools-import-dialog-body">
        <div className="tools-storage-setting"><span>保存先</span><code title={storagePath}>{storagePath || "未設定"}</code><button type="button" onClick={() => void chooseStoragePath()}>{storagePath ? "変更" : "設定"}</button>{storagePath && <button type="button" onClick={() => void invoke("open_tool_folder", { folderPath: storagePath }).catch((error) => setNotice({ text: errorText(error), error: true }))}>開く</button>}</div>
        <div className={`tools-direct-import ${dropActive ? "is-dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); event.stopPropagation(); setDropActive(true); }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }} onDragLeave={(event) => { event.stopPropagation(); if (event.currentTarget === event.target) setDropActive(false); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void importDroppedFolder(event.dataTransfer); }}>
          <div><strong>{adding ? "取り込み中…" : "ここにフォルダをドロップ"}</strong><span>またはパスを入力して取り込みます</span></div>
          <label>フォルダパス<input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="/Users/.../MyTool" /></label>
          <label>起動HTML<input value={entryFileDraft} onChange={(event) => setEntryFileDraft(event.target.value)} placeholder="index.html" /></label>
          <button type="button" disabled={adding || !storagePath || !sourcePath.trim() || !entryFileDraft.trim()} onClick={() => void importFolder(sourcePath, entryFileDraft)}>コピーして追加</button>
        </div>
        <button type="button" className="tools-finder-import" disabled={adding || !storagePath} onClick={() => void chooseFolder()}>Finderから選択</button>
      </div>
      {notice && <p className={`tools-notice ${notice.error ? "error" : ""}`} role="status">{notice.text}</p>}
      <div className="modal-actions"><button type="button" disabled={adding} onClick={() => setImportOpen(false)}>キャンセル</button></div>
    </Modal>}
  </>;
}
