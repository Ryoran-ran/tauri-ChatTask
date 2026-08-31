import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MarkdownText } from "./MarkdownText";

type ViewMode = "edit" | "split" | "preview";
const MARKDOWN_INDENT = "    ";

interface Props {
  documentId: string;
  documentTitle: string;
  value: string;
  initialSearchQuery?: string;
  onChange: (value: string) => void;
}

export function BlockEditor({ documentId, documentTitle, value, initialSearchQuery = "", onChange }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fullscreenPreviewRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const previewScrollRatioRef = useRef(0);
  const activeScrollSourceRef = useRef<"source" | "preview" | null>(null);
  const scrollSourceTimerRef = useRef<number | null>(null);
  const cursorSyncFrameRef = useRef<number | null>(null);
  const viewModeStorageKey = `chatTaskMarkdownViewMode:${documentId}`;
  const scrollSyncStorageKey = `chatTaskMarkdownScrollSync:${documentId}`;
  const cursorOutlineStorageKey = `chatTaskMarkdownCursorOutline:${documentId}`;
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(viewModeStorageKey);
    return saved === "edit" || saved === "preview" ? saved : "split";
  });
  const [scrollSync, setScrollSyncState] = useState(() => localStorage.getItem(scrollSyncStorageKey) !== "false");
  const [cursorOutline, setCursorOutlineState] = useState(() => localStorage.getItem(cursorOutlineStorageKey) !== "false");
  const [activeSourceLine, setActiveSourceLine] = useState<number | null>(null);
  const [fullscreenPreview, setFullscreenPreview] = useState(false);
  const [searchOpen, setSearchOpen] = useState(Boolean(initialSearchQuery));
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [searchIndex, setSearchIndex] = useState(0);
  const [activeLine, setActiveLine] = useState({ top: 0, height: 22, visible: false });
  const searchMatches = useMemo(() => {
    const query = searchQuery.toLocaleLowerCase("ja");
    if (!query) return [];
    const source = value.toLocaleLowerCase("ja");
    const matches: number[] = [];
    let offset = 0;
    while (offset <= source.length - query.length) {
      const match = source.indexOf(query, offset);
      if (match < 0) break;
      matches.push(match);
      offset = match + Math.max(1, query.length);
    }
    return matches;
  }, [searchQuery, value]);
  useEffect(() => {
    if (!searchOpen) return;
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [searchOpen]);
  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    localStorage.setItem(viewModeStorageKey, mode);
  };
  const setScrollSync = (enabled: boolean) => {
    setScrollSyncState(enabled);
    localStorage.setItem(scrollSyncStorageKey, String(enabled));
  };
  const setCursorOutline = (enabled: boolean) => {
    setCursorOutlineState(enabled);
    localStorage.setItem(cursorOutlineStorageKey, String(enabled));
  };
  const claimScrollSource = (source: "source" | "preview") => {
    activeScrollSourceRef.current = source;
    if (scrollSourceTimerRef.current !== null) window.clearTimeout(scrollSourceTimerRef.current);
    scrollSourceTimerRef.current = window.setTimeout(() => {
      activeScrollSourceRef.current = null;
      scrollSourceTimerRef.current = null;
    }, 180);
  };
  const syncScroll = (sourceName: "source" | "preview", source: HTMLElement, target: HTMLElement) => {
    if (!scrollSync || viewMode !== "split") return;
    // 再描画やカーソル追従で発生したscrollイベントは同期しない。
    // wheel・pointer・移動キーで明示的に操作された側だけを同期元にする。
    if (activeScrollSourceRef.current !== sourceName) return;
    claimScrollSource(sourceName);
    const sourceRange = source.scrollHeight - source.clientHeight;
    const targetRange = target.scrollHeight - target.clientHeight;
    if (sourceRange <= 0 || targetRange <= 0) return;
    target.scrollTop = targetRange * (source.scrollTop / sourceRange);
  };
  const syncPreviewToCursor = (textarea: HTMLTextAreaElement) => {
    if (!scrollSync || viewMode !== "split") return;
    const preview = previewRef.current;
    if (!preview || !value.length) return;
    const caretLine = value.slice(0, textarea.selectionStart).split("\n").length;
    setActiveSourceLine(caretLine);
    if (cursorSyncFrameRef.current !== null) window.cancelAnimationFrame(cursorSyncFrameRef.current);
    cursorSyncFrameRef.current = window.requestAnimationFrame(() => {
      cursorSyncFrameRef.current = null;
      claimScrollSource("source");
      const blocks = Array.from(preview.querySelectorAll<HTMLElement>("[data-source-start][data-source-end]"));
      let targetBlock = blocks.find((block) => {
        const start = Number(block.dataset.sourceStart);
        const end = Number(block.dataset.sourceEnd);
        return caretLine >= start && caretLine <= end;
      });
      if (!targetBlock) {
        targetBlock = blocks.find((block) => Number(block.dataset.sourceStart) > caretLine) || blocks[blocks.length - 1];
      }
      if (!targetBlock) return;
      const startLine = Number(targetBlock.dataset.sourceStart);
      const endLine = Number(targetBlock.dataset.sourceEnd);
      const lineSpan = Math.max(1, endLine - startLine + 1);
      const positionInBlock = Math.max(0, Math.min(1, (caretLine - startLine) / lineSpan));
      const previewTargetY = targetBlock.offsetTop + targetBlock.offsetHeight * positionInBlock;
      blocks.forEach((block) => block.classList.toggle("is-cursor-block", cursorOutline && block === targetBlock));
      preview.scrollTo({
        top: Math.max(0, Math.min(preview.scrollHeight - preview.clientHeight, previewTargetY - preview.clientHeight / 2)),
        behavior: "auto",
      });
    });
  };
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || document.activeElement !== textarea) return;
    syncPreviewToCursor(textarea);
  }, [scrollSync, value, viewMode]);
  const scrollRatio = (element: HTMLElement | null) => {
    if (!element) return 0;
    const range = element.scrollHeight - element.clientHeight;
    return range > 0 ? element.scrollTop / range : 0;
  };
  const restoreScrollRatio = (element: HTMLElement | null, ratio: number) => {
    if (!element) return;
    element.scrollTop = (element.scrollHeight - element.clientHeight) * ratio;
  };
  const openFullscreenPreview = () => {
    previewScrollRatioRef.current = scrollRatio(previewRef.current);
    setFullscreenPreview(true);
    requestAnimationFrame(() => restoreScrollRatio(fullscreenPreviewRef.current, previewScrollRatioRef.current));
  };
  const closeFullscreenPreview = () => {
    previewScrollRatioRef.current = scrollRatio(fullscreenPreviewRef.current);
    setFullscreenPreview(false);
    requestAnimationFrame(() => restoreScrollRatio(previewRef.current, previewScrollRatioRef.current));
  };
  const openSearch = () => {
    if (fullscreenPreview) closeFullscreenPreview();
    if (viewMode === "preview") setViewMode("edit");
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  };
  const closeSearch = () => {
    setSearchOpen(false);
    textareaRef.current?.focus();
  };
  const moveSearch = (direction: 1 | -1) => {
    if (!searchMatches.length) return;
    setSearchIndex((current) => (current + direction + searchMatches.length) % searchMatches.length);
  };
  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        openSearch();
        return;
      }
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        closeSearch();
        return;
      }
      if (event.key === "Escape" && fullscreenPreview) {
        event.preventDefault();
        closeFullscreenPreview();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        if (fullscreenPreview) closeFullscreenPreview();
        else openFullscreenPreview();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
      if (scrollSourceTimerRef.current !== null) window.clearTimeout(scrollSourceTimerRef.current);
      if (cursorSyncFrameRef.current !== null) window.cancelAnimationFrame(cursorSyncFrameRef.current);
    };
  }, [fullscreenPreview, searchOpen, viewMode]);
  useEffect(() => {
    if (!searchOpen || !searchMatches.length) return;
    const index = Math.min(searchIndex, searchMatches.length - 1);
    if (index !== searchIndex) setSearchIndex(index);
    const start = searchMatches[index];
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.setSelectionRange(start, start + searchQuery.length);
      const line = value.slice(0, start).split("\n").length - 1;
      const computed = window.getComputedStyle(textarea);
      const lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.65;
      textarea.scrollTop = Math.max(0, line * lineHeight - textarea.clientHeight / 2);
      const preview = previewRef.current;
      const previewMatch = preview?.querySelector<HTMLElement>(".markdown-search-current");
      if (preview && previewMatch) preview.scrollTop = Math.max(0, previewMatch.offsetTop - preview.clientHeight / 2);
    });
  }, [searchIndex, searchMatches, searchOpen, searchQuery, value]);
  useEffect(() => setSearchIndex(0), [searchQuery]);

  const updateActiveLine = (textarea: HTMLTextAreaElement) => {
    const computed = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.65;
    const mirror = document.createElement("div");
    const marker = document.createElement("span");
    mirror.style.position = "fixed";
    mirror.style.left = "-10000px";
    mirror.style.top = "0";
    mirror.style.visibility = "hidden";
    mirror.style.boxSizing = computed.boxSizing;
    mirror.style.width = computed.width;
    mirror.style.padding = computed.padding;
    mirror.style.borderWidth = computed.borderWidth;
    mirror.style.font = computed.font;
    mirror.style.letterSpacing = computed.letterSpacing;
    mirror.style.lineHeight = computed.lineHeight;
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.overflowWrap = "break-word";
    mirror.style.tabSize = computed.tabSize;
    mirror.textContent = textarea.value.slice(0, textarea.selectionStart);
    marker.textContent = "\u200b";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const top = marker.offsetTop - textarea.scrollTop;
    mirror.remove();
    setActiveLine({
      top,
      height: lineHeight,
      visible: document.activeElement === textarea && top + lineHeight >= 0 && top <= textarea.clientHeight,
    });
  };

  const scrollCaretIntoView = (textarea: HTMLTextAreaElement, source: string, caret: number) => {
    const computed = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.65;
    const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
    const line = source.slice(0, caret).split("\n").length - 1;
    const caretTop = paddingTop + line * lineHeight;
    const margin = lineHeight * 2;
    if (caretTop > textarea.scrollTop + textarea.clientHeight - margin) {
      textarea.scrollTop = Math.max(0, caretTop - textarea.clientHeight + margin);
    } else if (caretTop < textarea.scrollTop + margin) {
      textarea.scrollTop = Math.max(0, caretTop - margin);
    }
  };

  const replaceRange = (start: number, end: number, replacement: string, selectionStart: number, selectionEnd = selectionStart) => {
    const next = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
      scrollCaretIntoView(textarea, next, selectionEnd);
      syncPreviewToCursor(textarea);
    });
  };

  const prefixLines = (prefix: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
    const nextBreak = value.indexOf("\n", selectionEnd);
    const lineEnd = nextBreak < 0 ? value.length : nextBreak;
    const selectedLines = value.slice(lineStart, lineEnd);
    const replacement = selectedLines.split("\n").map((line) => `${prefix}${line}`).join("\n");
    replaceRange(lineStart, lineEnd, replacement, selectionStart + prefix.length, lineStart + replacement.length);
  };

  const wrapSelection = (before: string, after = before, placeholder = "テキスト") => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end);
    const content = selected || placeholder;
    const replacement = `${before}${content}${after}`;
    const contentStart = start + before.length;
    replaceRange(start, end, replacement, contentStart, contentStart + content.length);
  };

  const insertText = (text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    replaceRange(start, end, text, start + text.length);
  };

  const handleTab = (shiftKey: boolean) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (!shiftKey && start === end) {
      replaceRange(start, end, MARKDOWN_INDENT, start + MARKDOWN_INDENT.length);
      return;
    }
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const nextBreak = value.indexOf("\n", end);
    const lineEnd = nextBreak < 0 ? value.length : nextBreak;
    const lines = value.slice(lineStart, lineEnd).split("\n");
    if (shiftKey) {
      const removed = lines.map((line) => Math.min(MARKDOWN_INDENT.length, line.match(/^ */)?.[0].length || 0));
      const replacement = lines.map((line, index) => line.slice(removed[index])).join("\n");
      const firstRemoved = removed[0] || 0;
      const totalRemoved = removed.reduce((total, amount) => total + amount, 0);
      replaceRange(
        lineStart,
        lineEnd,
        replacement,
        Math.max(lineStart, start - firstRemoved),
        Math.max(lineStart, end - totalRemoved),
      );
      return;
    }
    const replacement = lines.map((line) => `${MARKDOWN_INDENT}${line}`).join("\n");
    replaceRange(lineStart, lineEnd, replacement, start + MARKDOWN_INDENT.length, end + lines.length * MARKDOWN_INDENT.length);
  };

  const handleEnter = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const nextBreak = value.indexOf("\n", start);
    const lineEnd = nextBreak < 0 ? value.length : nextBreak;
    const currentLine = value.slice(lineStart, lineEnd);
    const list = currentLine.match(/^(\s*)(- \[[ xX]\]|[-*+]|\d+\.)\s+(.*)$/);
    if (list) {
      const [, indent, marker, content] = list;
      if (!content.trim() && start === end) {
        replaceRange(lineStart, lineEnd, "", lineStart);
        return;
      }
      const nextMarker = /^\d+\.$/.test(marker)
        ? `${Number.parseInt(marker, 10) + 1}.`
        : /^- \[[xX]\]$/.test(marker) ? "- [ ]" : marker;
      const continuation = `\n${indent}${nextMarker} `;
      replaceRange(start, end, continuation, start + continuation.length);
      return;
    }
    const indent = currentLine.match(/^\s*/)?.[0] || "";
    if (!currentLine.trim() && indent && start === end) {
      replaceRange(lineStart, lineEnd, "", lineStart);
      return;
    }
    const continuation = `\n${indent}`;
    replaceRange(start, end, continuation, start + continuation.length);
  };

  return <div className="markdown-editor-shell">
    {searchOpen && <div className="document-find-bar" role="search">
      <input ref={searchInputRef} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter") {
          event.preventDefault();
          moveSearch(event.shiftKey ? -1 : 1);
        } else if (event.key === "Escape") {
          event.preventDefault();
          closeSearch();
        }
      }} placeholder="文書内を検索" aria-label="文書内を検索" />
      <span>{searchQuery ? searchMatches.length ? `${Math.min(searchIndex + 1, searchMatches.length)} / ${searchMatches.length}` : "0件" : ""}</span>
      <button type="button" disabled={!searchMatches.length} onClick={() => moveSearch(-1)} aria-label="前の検索結果">↑</button>
      <button type="button" disabled={!searchMatches.length} onClick={() => moveSearch(1)} aria-label="次の検索結果">↓</button>
      <button type="button" onClick={closeSearch} aria-label="検索を閉じる">×</button>
    </div>}
    <div className="block-toolbar">
      <button type="button" onClick={() => insertText("\n")}>＋ テキスト</button>
      <button type="button" onClick={() => prefixLines("## ")}>見出し</button>
      <button type="button" onClick={() => prefixLines("- ")}>箇条書き</button>
      <button type="button" onClick={() => prefixLines("1. ")}>番号</button>
      <button type="button" onClick={() => prefixLines("- [ ] ")}>☐ チェック</button>
      <button type="button" onClick={() => insertText("| 見出し1 | 見出し2 | 見出し3 |\n| --- | --- | --- |\n| 内容1 | 内容2 | 内容3 |")}>表</button>
      <button type="button" onClick={() => wrapSelection("```\n", "\n```", "コード")}>{"</> コード"}</button>
      <span className="block-toolbar-divider" />
      <button type="button" title="太字" onClick={() => wrapSelection("**")}><b>B</b></button>
      <button type="button" title="イタリック" onClick={() => wrapSelection("*")}><i>I</i></button>
      <button type="button" title="下線" onClick={() => wrapSelection("<u>", "</u>")}><u>U</u></button>
      <div className="markdown-view-toggle" role="group" aria-label="エディタの表示方法">
        <button type="button" className={viewMode === "edit" ? "active" : ""} aria-pressed={viewMode === "edit"} onClick={() => setViewMode("edit")}>テキストのみ</button>
        <button type="button" className={viewMode === "preview" ? "active" : ""} aria-pressed={viewMode === "preview"} onClick={() => setViewMode("preview")}>プレビューのみ</button>
        <button type="button" className={viewMode === "split" ? "active" : ""} aria-pressed={viewMode === "split"} onClick={() => setViewMode("split")}>両方</button>
      </div>
      <button type="button" className={`markdown-scroll-sync ${scrollSync ? "active" : ""}`} aria-pressed={scrollSync} disabled={viewMode !== "split"} title="左右のスクロール同期" onClick={() => setScrollSync(!scrollSync)}>同期 {scrollSync ? "ON" : "OFF"}</button>
      <button type="button" className={`markdown-cursor-outline ${cursorOutline ? "active" : ""}`} aria-pressed={cursorOutline} title="カーソル位置に対応するプレビュー枠線" onClick={() => setCursorOutline(!cursorOutline)}>枠線 {cursorOutline ? "ON" : "OFF"}</button>
    </div>
    <div className={`markdown-editor-split mode-${viewMode}`}>
      <section className="markdown-source-pane">
        <header><strong>編集</strong><span>Markdown</span></header>
        <div className="markdown-source-wrap">
          <div
            className={`markdown-active-line ${activeLine.visible ? "is-visible" : ""}`}
            style={{ top: activeLine.top, height: activeLine.height }}
            aria-hidden="true"
          />
          <textarea
          ref={textareaRef}
          className="markdown-source"
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            onChange(next);
            requestAnimationFrame(() => {
              const textarea = textareaRef.current;
              if (textarea) {
                updateActiveLine(textarea);
              }
            });
          }}
          onSelect={(event) => {
            syncPreviewToCursor(event.currentTarget);
            updateActiveLine(event.currentTarget);
          }}
          onFocus={(event) => updateActiveLine(event.currentTarget)}
          onBlur={() => setActiveLine((current) => ({ ...current, visible: false }))}
          onWheel={() => claimScrollSource("source")}
          onPointerDown={() => claimScrollSource("source")}
          onScroll={(event) => {
            const preview = previewRef.current;
            if (preview) syncScroll("source", event.currentTarget, preview);
            updateActiveLine(event.currentTarget);
          }}
          onKeyDown={(event) => {
            if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) claimScrollSource("source");
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Tab") {
              event.preventDefault();
              handleTab(event.shiftKey);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleEnter();
            }
          }}
          spellCheck={false}
          placeholder="Markdownで入力してください…"
          />
        </div>
      </section>
      <section className="markdown-preview-pane">
        <header><strong>表示</strong><span className="markdown-preview-heading-actions"><span>プレビュー</span><button type="button" onClick={openFullscreenPreview}>全画面</button></span></header>
        <div ref={previewRef} className="markdown-preview" onWheel={() => claimScrollSource("preview")} onPointerDown={() => claimScrollSource("preview")} onKeyDown={(event) => {
          if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) claimScrollSource("preview");
        }} onScroll={(event) => {
          const textarea = textareaRef.current;
          if (textarea) syncScroll("preview", event.currentTarget, textarea);
        }} tabIndex={0}>
          {value.trim() ? <MarkdownText text={value} preserveLineBreaks={false} sourceMapped activeSourceLine={cursorOutline ? activeSourceLine : null} highlightQuery={searchOpen ? searchQuery : ""} currentHighlight={searchIndex} /> : <p className="muted">左側に入力すると、ここに表示されます。</p>}
        </div>
      </section>
    </div>
    {fullscreenPreview && createPortal(<div className="markdown-fullscreen-preview" role="dialog" aria-modal="true" aria-label={`${documentTitle || "無題の文書"}のプレビュー`}>
      <header><div><strong>{documentTitle || "無題の文書"}</strong><span>Esc または ⌘/Ctrl + Shift + P で閉じる</span></div><button type="button" onClick={closeFullscreenPreview} aria-label="プレビューを閉じる">×</button></header>
      <div ref={fullscreenPreviewRef} className="markdown-fullscreen-scroll">
        <article>{value.trim() ? <MarkdownText text={value} preserveLineBreaks={false} highlightQuery={searchOpen ? searchQuery : ""} currentHighlight={searchIndex} /> : <p className="muted">内容がありません。</p>}</article>
      </div>
    </div>, document.body)}
  </div>;
}
