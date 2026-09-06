import type { KeyboardEvent } from "react";
import type { PlannedRange, Task } from "../types";
import { normalizeUrl } from "../utils";

export const memoUrls = (text: string) => {
  const matches = text.match(/https?:\/\/[^\s<>"'）)\]】]+/g) || [];
  const normalized = matches
    .map((url) => url.replace(/[.,。、!?！？;；:：]+$/g, ""))
    .map(normalizeUrl)
    .filter((url): url is string => Boolean(url));
  return [...new Set(normalized)];
};

export const handleTextareaIndent = (
  event: KeyboardEvent<HTMLTextAreaElement>,
  value: string,
  onChange: (value: string) => void,
) => {
  if (event.key !== "Tab") return false;
  event.preventDefault();
  const textarea = event.currentTarget;
  const indent = "    ";
  const selectionStart = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const nextBreak = value.indexOf("\n", selectionEnd);
  const lineEnd = nextBreak < 0 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  let replacement: string;
  let nextStart: number;
  let nextEnd: number;
  if (event.shiftKey) {
    const removed = lines.map((line) => Math.min(indent.length, line.match(/^ */)?.[0].length || 0));
    replacement = lines.map((line, index) => line.slice(removed[index])).join("\n");
    nextStart = Math.max(lineStart, selectionStart - (removed[0] || 0));
    nextEnd = Math.max(nextStart, selectionEnd - removed.reduce((total, amount) => total + amount, 0));
  } else {
    replacement = lines.map((line) => `${indent}${line}`).join("\n");
    nextStart = selectionStart + indent.length;
    nextEnd = selectionEnd + lines.length * indent.length;
  }
  onChange(`${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(nextStart, nextEnd);
  });
  return true;
};

export const scheduleEffort = (task: Task, range: PlannedRange) => {
  const entries = Object.entries(task.dailyActualHours || {});
  // 実績は日付だけではなく予定IDへ紐づける。同日の別予定へ流用しない。
  const applicableEntries = entries.filter(([key]) => key.includes("::") && key.split("::")[1] === range.id);
  const planned = Math.max(0, Number(range.plannedHours) || 0);
  const actual = applicableEntries.reduce((sum, [, value]) => sum + Math.max(0, Number(value) || 0), 0);
  const accuracy = planned > 0 ? Math.max(0, Math.round((1 - Math.abs(actual - planned) / planned) * 100)) : null;
  const format = (value: number) => Number(value.toFixed(2)).toString();
  return { planned: format(planned), actual: format(actual), accuracy };
};
