import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import plaintext from "highlight.js/lib/languages/plaintext";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import { marked } from "marked";
import { useMemo, type MouseEvent } from "react";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("json", json);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("text", plaintext);

const languageAliases: Record<string, string> = {
  ts: "typescript", typescript: "typescript",
  js: "javascript", javascript: "javascript",
  html: "html", xml: "html",
  css: "css", json: "json", sql: "sql",
  bash: "bash", sh: "bash", shell: "bash",
  text: "text", txt: "text", plaintext: "text",
};
const languageLabels: Record<string, string> = {
  typescript: "TypeScript", javascript: "JavaScript", html: "HTML", css: "CSS",
  json: "JSON", sql: "SQL", bash: "Bash", text: "Text",
};

const indentWidth = (value: string) => value.replace(/\t/g, "    ").length;
const removeIndent = (line: string, width: number) => {
  let offset = 0;
  let removed = 0;
  while (offset < line.length && removed < width) {
    if (line[offset] === " ") {
      removed += 1;
      offset += 1;
    } else if (line[offset] === "\t") {
      removed += 4;
      offset += 1;
    } else break;
  }
  return line.slice(offset);
};

const normalizeSeparatorsWithLineMap = (text: string) => {
  let inCodeFence = false;
  let codeFenceIndent = 0;
  let followsClosedFence = false;
  const lines: { text: string; sourceLine: number }[] = [];
  const sourceLines = text.replace(/\r\n?/g, "\n").split("\n");
  const fenceIndexes = sourceLines.flatMap((line, index) => /^\s*```/.test(line) ? [index] : []);
  const unmatchedFenceIndex = fenceIndexes.length % 2 ? fenceIndexes[fenceIndexes.length - 1] : -1;
  sourceLines.forEach((sourceLineText, index) => {
    const sourceLine = index + 1;
    const fence = sourceLineText.match(/^(\s*)(```.*)$/);
    const wasInCodeFence = inCodeFence;
    // Nested lists often indent fences by four or more spaces, which Markdown
    // interprets as ordinary indented code instead of a fence. Normalize only
    // for preview; keep the stored source untouched.
    let line = fence
      ? index === unmatchedFenceIndex ? `\\${fence[2]}` : fence[2]
      : inCodeFence && codeFenceIndent > 0 ? removeIndent(sourceLineText, codeFenceIndent) : sourceLineText;
    if (fence && index !== unmatchedFenceIndex) {
      if (!inCodeFence) codeFenceIndent = indentWidth(fence[1]);
      inCodeFence = !inCodeFence;
      if (!inCodeFence) codeFenceIndent = 0;
    }
    if (fence && wasInCodeFence && !inCodeFence) {
      followsClosedFence = true;
    } else if (!inCodeFence && followsClosedFence && line.trim()) {
      // A list marker indented after a fenced block is otherwise parsed as a
      // separate indented code block. Keep the source untouched and normalize
      // only that first following list item for the preview.
      if (/^\s{4,}(?:[-*+]|\d+\.)\s+/.test(line)) line = line.replace(/^\s{4}/, "");
      followsClosedFence = false;
    }
    if (!inCodeFence && /^\s*-{3,}\s*$/.test(line)) {
      if (lines.length && lines[lines.length - 1].text !== "") lines.push({ text: "", sourceLine });
      lines.push({ text: "---", sourceLine }, { text: "", sourceLine });
    } else {
      // marked treats an empty list marker immediately below text as a Setext
      // heading underline (for example, `- 懸念点` followed by an indented `-`).
      // Keep it unambiguously as an empty list item without changing the editor text.
      const emptyUnorderedListItem = line.match(/^(\s*)[-*+]\s*$/);
      lines.push({
        text: emptyUnorderedListItem
          ? `${emptyUnorderedListItem[1]}${line.trim()} <!-- empty-list-item -->`
          : line,
        sourceLine,
      });
    }
  });
  const listItem = /^\s*(?:[-*+]|\d+\.)\s+/;
  const filtered = lines.filter((line, index) => {
    if (line.text.trim()) return true;
    let previous = index - 1;
    let next = index + 1;
    while (previous >= 0 && !lines[previous].text.trim()) previous -= 1;
    while (next < lines.length && !lines[next].text.trim()) next += 1;
    return !(previous >= 0 && next < lines.length && listItem.test(lines[previous].text) && listItem.test(lines[next].text));
  });
  return {
    text: filtered.map((line) => line.text).join("\n"),
    lineMap: filtered.map((line) => line.sourceLine),
  };
};
export function MarkdownText({ text, preserveLineBreaks = true, sourceMapped = false, activeSourceLine = null, highlightQuery = "", currentHighlight = 0 }: { text: string; preserveLineBreaks?: boolean; sourceMapped?: boolean; activeSourceLine?: number | null; highlightQuery?: string; currentHighlight?: number }) {
  const html = useMemo(() => {
    const normalizedResult = normalizeSeparatorsWithLineMap(text);
    const normalized = normalizedResult.text;
    const options = {
      async: false,
      breaks: preserveLineBreaks,
      gfm: true,
    } as const;
    const tokens = marked.lexer(normalized, options);
    const originalLines = text.replace(/\r\n?/g, "\n").split("\n");
    const codeIndentColumns: number[] = [];
    let trackedLine = 1;
    tokens.forEach((token) => {
      const raw = token.raw || "";
      const sourceLine = normalizedResult.lineMap[trackedLine - 1] || trackedLine;
      if (token.type === "code") {
        const fenceIndent = originalLines[sourceLine - 1]?.match(/^([ \t]*)```/)?.[1] || "";
        codeIndentColumns.push(fenceIndent.replace(/\t/g, "    ").length);
      }
      trackedLine += (raw.match(/\n/g) || []).length;
    });
    let rendered: string;
    if (sourceMapped) {
      let line = 1;
      rendered = tokens.map((token) => {
        const normalizedStartLine = line;
        const raw = token.raw || "";
        const newlineCount = (raw.match(/\n/g) || []).length;
        const normalizedEndLine = Math.max(normalizedStartLine, normalizedStartLine + newlineCount - (raw.endsWith("\n") ? 1 : 0));
        const startLine = normalizedResult.lineMap[normalizedStartLine - 1] || normalizedStartLine;
        const endLine = normalizedResult.lineMap[normalizedEndLine - 1] || startLine;
        line += newlineCount;
        if (token.type === "space") return "";
        const tokenHtml = marked.parser([token], options);
        const tokenTemplate = document.createElement("template");
        tokenTemplate.innerHTML = tokenHtml;
        Array.from(tokenTemplate.content.children).forEach((element) => {
          element.setAttribute("data-source-start", String(startLine));
          element.setAttribute("data-source-end", String(endLine));
          if (activeSourceLine !== null && activeSourceLine >= startLine && activeSourceLine <= endLine) {
            element.classList.add("is-cursor-block");
          }
        });
        return tokenTemplate.innerHTML;
      }).join("");
    } else {
      rendered = marked.parser(tokens, options);
    }
    const clean = DOMPurify.sanitize(rendered);
    const template = document.createElement("template"); template.innerHTML = clean;
    template.content.querySelectorAll("a").forEach((link) => { link.target = "_blank"; link.rel = "noopener noreferrer"; });
    template.content.querySelectorAll("pre").forEach((pre, index) => {
      const code = pre.querySelector("code");
      const declared = Array.from(code?.classList || []).find((name) => name.startsWith("language-"))?.slice("language-".length).toLowerCase() || "";
      const language = languageAliases[declared];
      if (code && language && language !== "text") {
        code.innerHTML = hljs.highlight(code.textContent || "", { language }).value;
        code.classList.add("hljs");
      }
      pre.classList.add("markdown-code-block");
      const indentColumns = Math.min(codeIndentColumns[index] || 0, 24);
      if (indentColumns > 0) {
        pre.dataset.codeIndent = String(indentColumns);
        pre.style.marginLeft = `${indentColumns * .65}rem`;
      }
      const label = document.createElement("span");
      label.className = "markdown-code-language";
      label.textContent = languageLabels[language] || declared || "Code";
      pre.prepend(label);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "markdown-code-copy";
      button.dataset.copyCode = "true";
      button.setAttribute("aria-label", "コードをコピー");
      button.textContent = "コピー";
      pre.prepend(button);
    });
    const query = highlightQuery.trim();
    if (query) {
      const normalizedQuery = query.toLocaleLowerCase("ja");
      const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      let node = walker.nextNode();
      while (node) {
        const parent = node.parentElement;
        if (parent && !parent.closest("button") && node.textContent?.toLocaleLowerCase("ja").includes(normalizedQuery)) textNodes.push(node as Text);
        node = walker.nextNode();
      }
      let occurrence = 0;
      textNodes.forEach((textNode) => {
        const source = textNode.textContent || "";
        const normalized = source.toLocaleLowerCase("ja");
        const fragment = document.createDocumentFragment();
        let offset = 0;
        let match = normalized.indexOf(normalizedQuery);
        while (match >= 0) {
          if (match > offset) fragment.append(source.slice(offset, match));
          const mark = document.createElement("mark");
          mark.className = `markdown-search-highlight${occurrence === currentHighlight ? " markdown-search-current" : ""}`;
          mark.textContent = source.slice(match, match + query.length);
          fragment.append(mark);
          occurrence += 1;
          offset = match + query.length;
          match = normalized.indexOf(normalizedQuery, offset);
        }
        if (offset < source.length) fragment.append(source.slice(offset));
        textNode.replaceWith(fragment);
      });
    }
    return template.innerHTML;
  }, [activeSourceLine, currentHighlight, highlightQuery, text, preserveLineBreaks, sourceMapped]);
  const copyCode = async (event: MouseEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-copy-code]");
    if (!button) return;
    const code = button.closest("pre")?.querySelector("code")?.textContent || "";
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = code;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    button.textContent = "コピー済み";
    button.classList.add("is-copied");
    window.setTimeout(() => {
      if (!button.isConnected) return;
      button.textContent = "コピー";
      button.classList.remove("is-copied");
    }, 1600);
  };
  return <div className="markdown-text" onClick={(event) => void copyCode(event)} dangerouslySetInnerHTML={{ __html: html }} />;
}
