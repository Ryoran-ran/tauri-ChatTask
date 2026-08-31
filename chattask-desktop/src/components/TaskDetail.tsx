import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { PRIORITIES, STATUS_GROUPS, STATUS_LABELS, WAITING_STATUSES, isTerminalStatus } from "../data/constants";
import { taskProjectContexts } from "../projectContext";
import type { Goal, HistoryEntry, PlannedRange, ProjectTag, Task, TaskLink, UserProfile } from "../types";
import { formatDateTime, generateId, localDateValue, mergeRanges, normalizeUrl, rangeDates, recurrenceLabel, removeDateFromRanges, todayValue } from "../utils";
import { MarkdownText } from "./MarkdownText";
import { RecurrenceSettingsEditor } from "./RecurrenceSettingsEditor";
import { AttachmentsSection } from "./AttachmentsSection";
import { AttachmentCards } from "./AttachmentCards";
import { addAttachment, listAttachments, openAttachment, removeAttachment, type Attachment } from "../services/attachments";
import { UserAvatar } from "./UserAvatar";
import { Modal } from "./Modal";
import { RelatedTasksModal } from "./RelatedTasksModal";
import { WorkDatePicker } from "./WorkDatePicker";

interface Props {
  task: Task | null;
  allTasks: Task[];
  projects: Goal[];
  tags: ProjectTag[];
  profile: UserProfile;
  detailsHidden: boolean;
  onToggleDetails: () => void;
  onUpdate: (changes: Partial<Task>, historyText?: string) => void;
  onDelete: () => void;
  onCreateChild: () => void;
  onDocuments: () => void;
  onSharedDocuments: (projectId: string, documentId?: string) => void;
  onTagDocuments: () => void;
  onPromote: () => void;
  onSaveTemplate: () => void;
  onOpenProject: (id: string) => void;
  onOpenTask?: (id: string) => void;
  promoted: boolean;
  projectManaged: boolean;
  onDeleteDailyPlan: (date: string) => void;
  onDeleteMemo: (id: string) => void;
  onEditMemo: (id: string, text: string) => void;
}

const memoUrls = (text: string) => {
  const matches = text.match(/https?:\/\/[^\s<>"'）)\]】]+/g) || [];
  const normalized = matches.map((url) => url.replace(/[.,。、!?！？;；:：]+$/g, "")).map(normalizeUrl).filter((url): url is string => Boolean(url));
  return [...new Set(normalized)];
};

const handleMemoIndent = (event: KeyboardEvent<HTMLTextAreaElement>, value: string, onChange: (value: string) => void) => {
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

const scheduleEffort = (task: Task, range: PlannedRange) => {
  const entries = Object.entries(task.dailyActualHours || {});
  // 実績は日付だけではなく予定IDへ紐づける。同日の別予定へ流用しない。
  const applicableEntries = entries.filter(([key]) => key.includes("::") && key.split("::")[1] === range.id);
  const planned = Math.max(0, Number(range.plannedHours) || 0);
  const actual = applicableEntries.reduce((sum, [, value]) => sum + Math.max(0, Number(value) || 0), 0);
  const accuracy = planned > 0 ? Math.max(0, Math.round((1 - Math.abs(actual - planned) / planned) * 100)) : null;
  const format = (value: number) => Number(value.toFixed(2)).toString();
  return { planned: format(planned), actual: format(actual), accuracy };
};

function CollapsibleMemo({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [collapsible, setCollapsible] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (expanded) return;
    const content = contentRef.current;
    if (!content) return;
    const measure = () => setCollapsible(content.scrollHeight > content.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [text, expanded]);
  return <div className={`memo-collapse ${collapsible ? "collapsible" : ""} ${expanded ? "expanded" : ""}`}>
    <div ref={contentRef} className="memo-collapse-content"><MarkdownText text={text} /></div>
    {(collapsible || expanded) && <button type="button" className="memo-collapse-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "折りたたむ" : "もっと見る"}</button>}
  </div>;
}

export function TaskDetail({ task, allTasks, projects, tags, profile, detailsHidden, onToggleDetails, onUpdate, onDelete, onCreateChild, onDocuments, onSharedDocuments, onTagDocuments, onPromote, onSaveTemplate, onOpenProject, onOpenTask = (id) => window.dispatchEvent(new CustomEvent("chattask-open-task", { detail: { id } })), promoted, projectManaged, onDeleteDailyPlan, onDeleteMemo, onEditMemo }: Props) {
  const [rangeStart, setRangeStart] = useState(todayValue());
  const [rangeEnd, setRangeEnd] = useState("");
  const [rangeTitle, setRangeTitle] = useState("");
  const [rangeDescription, setRangeDescription] = useState("");
  const [rangePlannedHours, setRangePlannedHours] = useState("");
  const [rangeStatus, setRangeStatus] = useState<NonNullable<Task["plannedRanges"][number]["status"]>>("not-started");
  const [editingRangeId, setEditingRangeId] = useState("");
  const [scheduleEditorOpen, setScheduleEditorOpen] = useState(false);
  const [deletingRange, setDeletingRange] = useState<Task["plannedRanges"][number] | null>(null);
  const [draggingRangeId, setDraggingRangeId] = useState("");
  const [dragOverRangeId, setDragOverRangeId] = useState("");
  useEffect(() => {
    if (detailsHidden) return;
    const closeDetailsOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") onToggleDetails(); };
    window.addEventListener("keydown", closeDetailsOnEscape);
    return () => window.removeEventListener("keydown", closeDetailsOnEscape);
  }, [detailsHidden, onToggleDetails]);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [editingLinkLabel, setEditingLinkLabel] = useState("");
  const [editingLinkUrl, setEditingLinkUrl] = useState("");
  const [memo, setMemo] = useState("");
  const memoInputRef = useRef<HTMLTextAreaElement>(null);
  const dragDepthRef = useRef(0);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const taskMenuRef = useRef<HTMLDetailsElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleFocusRef = useRef("");
  const [editingMemo, setEditingMemo] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [pendingWaitingStatus, setPendingWaitingStatus] = useState<Task["status"] | null>(null);
  const [pendingLeavingWaitingStatus, setPendingLeavingWaitingStatus] = useState<Task["status"] | null>(null);
  const [endingStatus, setEndingStatus] = useState<Task["status"] | null>(null);
  const [endingReason, setEndingReason] = useState("");
  const [attachmentRevision, setAttachmentRevision] = useState(0);
  const [allAttachments, setAllAttachments] = useState<Attachment[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [draggingFile, setDraggingFile] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const [historyDate, setHistoryDate] = useState("");
  const [historySearchVisible, setHistorySearchVisible] = useState(false);
  const [projectContextOpen, setProjectContextOpen] = useState(() => localStorage.getItem("chatTaskProjectContextOpen") !== "false");
  const [projectContextVisible, setProjectContextVisible] = useState(() => localStorage.getItem("chatTaskProjectContextVisible") !== "false");
  const [tagResourcesVisible, setTagResourcesVisible] = useState(() => localStorage.getItem("chatTaskTagResourcesVisible") !== "false");
  const [scheduleQuickOpen, setScheduleQuickOpen] = useState(false);
  const [relatedTasksOpen, setRelatedTasksOpen] = useState(false);
  const [quickScheduleAdding, setQuickScheduleAdding] = useState(false);
  const [linkImportItems, setLinkImportItems] = useState<{ url: string; label: string; selected: boolean }[] | null>(null);
  useEffect(() => {
    const input = memoInputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 66), 192)}px`;
    input.style.overflowY = input.scrollHeight > 192 ? "auto" : "hidden";
  }, [memo]);
  useEffect(() => { setDeleteConfirm(false); setPendingWaitingStatus(null); setPendingLeavingWaitingStatus(null); setEndingStatus(null); setEndingReason(""); }, [task?.id]);
  useEffect(() => {
    if (task?.title !== "新規タスク") return;
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }, [task?.id]);
  useEffect(() => { setPendingAttachments([]); setAttachmentError(""); setHistorySearchVisible(false); setEditingLinkId(null); }, [task?.id]);
  useLayoutEffect(() => {
    setHistoryDate("");
    let cancelled = false;
    let secondFrame = 0;
    const scrollToBottom = () => {
      if (cancelled) return;
      const container = historyScrollRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    };
    const firstFrame = requestAnimationFrame(() => {
      scrollToBottom();
      secondFrame = requestAnimationFrame(scrollToBottom);
    });
    const timers = [80, 240, 600].map((delay) => window.setTimeout(scrollToBottom, delay));
    return () => {
      cancelled = true;
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      timers.forEach(window.clearTimeout);
    };
  }, [task?.id, task?.history.length]);
  useEffect(() => {
    if (!task?.id) { setAllAttachments([]); return; }
    void listAttachments(task.id).then(setAllAttachments).catch((reason) => setAttachmentError(String(reason)));
  }, [task?.id, attachmentRevision]);
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId: string }>).detail;
      if (detail?.taskId === task?.id) setAttachmentRevision((value) => value + 1);
    };
    window.addEventListener("chattask-attachments-changed", refresh);
    return () => window.removeEventListener("chattask-attachments-changed", refresh);
  }, [task?.id]);
  useEffect(() => {
    const receiveFiles = async (event: Event) => {
      const detail = (event as CustomEvent<{ taskId: string; files: File[] }>).detail;
      if (!task?.id || detail?.taskId !== task.id || !detail.files?.length) return;
      setAttachmentBusy(true);
      setAttachmentError("");
      try {
        const uploaded: Attachment[] = [];
        for (const file of detail.files) uploaded.push(await addAttachment(task.id, file));
        setPendingAttachments((current) => [...current, ...uploaded]);
        setAttachmentRevision((value) => value + 1);
        requestAnimationFrame(() => memoInputRef.current?.focus());
        window.dispatchEvent(new CustomEvent("chattask-drop-notice", { detail: { text: `${uploaded.length}件のファイルをチャット入力欄へ追加しました。` } }));
      } catch (reason) {
        const message = String(reason);
        setAttachmentError(message);
        window.dispatchEvent(new CustomEvent("chattask-drop-notice", { detail: { text: `ファイルを追加できませんでした: ${message}`, error: true } }));
      } finally {
        setAttachmentBusy(false);
        setDraggingFile(false);
      }
    };
    window.addEventListener("chattask-global-files-dropped", receiveFiles);
    return () => window.removeEventListener("chattask-global-files-dropped", receiveFiles);
  }, [task?.id]);

  if (!task) return <section className="detail empty-detail"><div><span className="empty-icon">◇</span><p>左のリストからタスクを選択してください</p></div></section>;
  const parentTask = allTasks.find((candidate) => candidate.id === task.parentTaskId);
  const ownLinkUrls = new Set(task.links.map((link) => normalizeUrl(link.url)).filter((url): url is string => Boolean(url)));
  const ownLinkFiles = new Set(task.links.map((link) => link.attachmentId).filter((id): id is string => Boolean(id)));
  const inheritedParentLinks = (parentTask?.links || []).filter((link) => {
    if (link.kind === "file" || link.attachmentId) return Boolean(link.attachmentId && !ownLinkFiles.has(link.attachmentId));
    const normalized = normalizeUrl(link.url);
    return normalized && !ownLinkUrls.has(normalized);
  });
  const currentTag = tags.find((tag) => tag.id === task.projectTagId);
  const projectContexts = taskProjectContexts(projects, task.id);
  const sharedProjects = projectContexts.reduce<Goal[]>((items, context) => {
    const project = projects.find((candidate) => candidate.id === context.projectId);
    return project && !items.some((item) => item.id === project.id) ? [...items, project] : items;
  }, []);
  const sharedProject = sharedProjects[0];

  const update = <K extends keyof Task>(key: K, value: Task[K], history?: string) => onUpdate({ [key]: value }, history);
  const addAttachmentQuickLink = (attachment: Attachment) => {
    if (ownLinkFiles.has(attachment.id)) return;
    const link: TaskLink = { id: generateId(), label: attachment.name, url: "", kind: "file", attachmentId: attachment.id };
    update("links", [...task.links, link], `ファイル「${attachment.name}」をクイックリンクへ追加しました。`);
  };
  const requestStatusChange = (status: Task["status"]) => {
    if (status === task.status) return;
    if (task.waitingFollowUp && !WAITING_STATUSES.includes(status) && !isTerminalStatus(status)) {
      setPendingLeavingWaitingStatus(status);
      return;
    }
    if (WAITING_STATUSES.includes(status) && !task.waitingFollowUp) {
      setPendingWaitingStatus(status);
      return;
    }
    if (status === "done") {
      update("status", status, "ステータスを「完了」へ変更しました。");
      return;
    }
    if (isTerminalStatus(status)) {
      setEndingStatus(status);
      setEndingReason("");
      return;
    }
    update("status", status, `ステータスを「${STATUS_LABELS[status]}」へ変更しました。`);
  };
  const confirmEndingStatus = () => {
    if (!endingStatus) return;
    const reason = endingReason.trim();
    const history = reason ? [...task.history, {
      id: generateId(),
      type: "comment" as const,
      text: `${STATUS_LABELS[endingStatus]}理由：${reason}`,
      timestamp: new Date().toISOString(),
    }] : task.history;
    onUpdate({ status: endingStatus, history }, `ステータスを「${STATUS_LABELS[endingStatus]}」へ変更しました。`);
    setEndingStatus(null);
    setEndingReason("");
  };
  const resetRangeDraft = () => {
    setEditingRangeId("");
    setRangeTitle("");
    setRangeDescription("");
    setRangePlannedHours("");
    setRangeStatus("not-started");
    setRangeStart(todayValue());
    setRangeEnd("");
  };
  const unscheduleRange = (range: Task["plannedRanges"][number]) => {
    const plannedRanges = task.plannedRanges.filter((item) => item.id !== range.id);
    onUpdate({
      plannedRanges,
      unscheduledPlans: [...(task.unscheduledPlans || []).filter((item) => item.id !== range.id), { ...range, startDate: "", endDate: "" }],
      plannedHours: plannedRanges.reduce((sum, item) => sum + (Number(item.plannedHours) || 0), 0),
    }, `予定「${scheduleTitle(range)}」の日程を外しました。`);
    setQuickScheduleAdding(false);
    resetRangeDraft();
  };
  const addRange = () => {
    if (!rangeStart) {
      const previousRange = [...task.plannedRanges, ...(task.unscheduledPlans || [])].find((range) => range.id === editingRangeId);
      if (previousRange) unscheduleRange(previousRange);
      return false;
    }
    const end = rangeEnd || rangeStart;
    if (end < rangeStart) { alert("終了日は開始日以降にしてください。"); return false; }
    const previousRange = [...task.plannedRanges, ...(task.unscheduledPlans || [])].find((range) => range.id === editingRangeId);
    const movedToAnotherDate = Boolean(previousRange && previousRange.startDate !== rangeStart);
    const lastOrderOnDate = task.plannedRanges.reduce((max, range) => range.id !== editingRangeId && range.startDate === rangeStart ? Math.max(max, range.sortOrder ?? 0) : max, -1);
    const nextRange = { ...previousRange, id: editingRangeId || generateId(), startDate: rangeStart, endDate: end, sortOrder: !previousRange || movedToAnotherDate ? lastOrderOnDate + 1 : previousRange.sortOrder, title: rangeTitle.trim(), description: rangeDescription.trim(), note: rangeDescription.trim(), plannedHours: Math.max(0, Number(rangePlannedHours) || 0), status: rangeStatus, completedAt: rangeStatus === "completed" ? previousRange?.completedAt || new Date().toISOString() : undefined };
    const nextRanges = editingRangeId ? [...task.plannedRanges.filter((range) => range.id !== editingRangeId), nextRange] : [...task.plannedRanges, nextRange];
    const mergedRanges = mergeRanges(nextRanges);
    onUpdate({ plannedRanges: mergedRanges, unscheduledPlans: (task.unscheduledPlans || []).filter((range) => range.id !== editingRangeId), plannedHours: mergedRanges.reduce((sum, range) => sum + (Number(range.plannedHours) || 0), 0) }, editingRangeId ? "予定を更新しました。" : "予定を追加しました。");
    setRangeEnd("");
    setRangeTitle("");
    setRangeDescription("");
    setRangePlannedHours("");
    setRangeStatus("not-started");
    setEditingRangeId("");
    setScheduleEditorOpen(false);
    return true;
  };
  const addLink = () => {
    const url = normalizeUrl(linkUrl);
    if (!url) return alert("正しいURLを入力してください。");
    const link: TaskLink = { id: generateId(), label: linkLabel.trim(), url };
    update("links", [...task.links, link], "関連リンクを追加しました。");
    setLinkLabel(""); setLinkUrl("");
  };
  const addFileLink = async (file: File) => {
    setAttachmentBusy(true);
    try {
      const attachment = await addAttachment(task.id, file);
      const link: TaskLink = { id: generateId(), label: file.name, url: "", kind: "file", attachmentId: attachment.id };
      update("links", [...task.links, link], `ファイル「${file.name}」をクイックリンクへ追加しました。`);
      setAttachmentRevision((value) => value + 1);
      window.dispatchEvent(new CustomEvent("chattask-drop-notice", { detail: { text: `「${file.name}」をクイックリンクへ追加しました。` } }));
    } catch (reason) {
      window.dispatchEvent(new CustomEvent("chattask-drop-notice", { detail: { text: `ファイルを追加できませんでした: ${String(reason)}`, error: true } }));
    } finally {
      setAttachmentBusy(false);
    }
  };
  const startEditingLink = (link: TaskLink) => {
    setEditingLinkId(link.id);
    setEditingLinkLabel(link.label);
    setEditingLinkUrl(link.url);
  };
  const saveEditingLink = () => {
    if (!editingLinkId) return;
    const editing = task.links.find((item) => item.id === editingLinkId);
    if (editing?.kind === "file" || editing?.attachmentId) {
      update("links", task.links.map((item) => item.id === editingLinkId ? { ...item, label: editingLinkLabel.trim() || item.label } : item), "ファイルリンクの表示名を編集しました。");
      setEditingLinkId(null);
      return;
    }
    const url = normalizeUrl(editingLinkUrl);
    if (!url) return alert("正しいURLを入力してください。");
    update("links", task.links.map((item) => item.id === editingLinkId ? { ...item, label: editingLinkLabel.trim(), url } : item), "関連リンクを編集しました。");
    setEditingLinkId(null);
  };
  const openMemoLinkImport = (text: string) => {
    const registered = new Set(task.links.map((link) => normalizeUrl(link.url)).filter((url): url is string => Boolean(url)));
    const urls = memoUrls(text).filter((url) => !registered.has(url));
    if (!urls.length) return;
    setLinkImportItems(urls.map((url) => {
      let label = url;
      try { label = new URL(url).hostname; } catch { /* URLはnormalizeUrlで検証済み */ }
      return { url, label, selected: true };
    }));
  };
  const addSelectedMemoLinks = () => {
    if (!linkImportItems) return;
    const selected = linkImportItems.filter((item) => item.selected);
    if (!selected.length) return;
    const links: TaskLink[] = selected.map((item) => ({ id: generateId(), label: item.label.trim() || item.url, url: item.url }));
    update("links", [...task.links, ...links], `メモから関連リンクを${links.length}件追加しました。`);
    setLinkImportItems(null);
  };
  const addMemo = () => {
    const text = memo.trim();
    if (!text && !pendingAttachments.length) return;
    const entry: HistoryEntry = { id: generateId(), type: "comment", text, timestamp: new Date().toISOString(), attachmentIds: pendingAttachments.map((item) => item.id) };
    update("history", [...task.history, entry]);
    setMemo(""); setPendingAttachments([]);
  };
  const uploadToMemo = async (files: File[]) => {
    if (!files.length) return;
    const startedAt = Date.now();
    setAttachmentBusy(true); setAttachmentError("");
    try {
      const uploaded: Attachment[] = [];
      for (const file of files) uploaded.push(await addAttachment(task.id, file));
      setPendingAttachments((current) => [...current, ...uploaded]);
      setAttachmentRevision((value) => value + 1);
    } catch (reason) { setAttachmentError(String(reason)); }
    finally {
      const remaining = Math.max(0, 700 - (Date.now() - startedAt));
      if (remaining) await new Promise((resolve) => window.setTimeout(resolve, remaining));
      setAttachmentBusy(false); setDraggingFile(false);
    }
  };
  const enterDropZone = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current += 1;
    setDraggingFile(true);
  };
  const leaveDropZone = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDraggingFile(false);
  };
  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) {
      setDraggingFile(false);
      setAttachmentError("ドロップされたファイルを読み取れませんでした。");
      return;
    }
    void uploadToMemo(files);
  };
  const pasteFiles = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardFiles = Array.from(event.clipboardData.items).filter((item) => item.kind === "file");
    const directFiles = Array.from(event.clipboardData.files);
    if (!clipboardFiles.length && !directFiles.length) return;
    event.preventDefault();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const files = directFiles.length ? directFiles : clipboardFiles.flatMap((item, index) => {
      const file = item.getAsFile();
      if (!file) return [];
      if (file.name && !/^image\.(png|jpe?g|gif|webp)$/i.test(file.name)) return [file];
      const mimeExtension = file.type.split("/")[1]?.replace("jpeg", "jpg").replace("plain", "txt");
      const extension = mimeExtension ? `.${mimeExtension}` : "";
      return [new File([file], `clipboard-${timestamp}-${index + 1}${extension}`, { type: file.type || "application/octet-stream" })];
    });
    void uploadToMemo(files);
  };
  const scheduleDates = rangeDates(task.plannedRanges);
  const changeDailyPlanDate = (currentDate: string, nextDate: string) => {
    if (!nextDate || nextDate === currentDate) return;
    if (scheduleDates.includes(nextDate)) {
      alert("変更先の日付には、すでにその日のメモがあります。");
      return;
    }
    const sourceRange = task.plannedRanges.find((range) => currentDate >= range.startDate && currentDate <= range.endDate);
    const replacementRange = {
      ...(sourceRange || {}),
      id: generateId(),
      startDate: nextDate,
      endDate: nextDate,
    };
    const dailyPlans = { ...task.dailyPlans };
    const dailyPlanCompleted = { ...task.dailyPlanCompleted };
    const dailyActualHours = { ...task.dailyActualHours };
    const currentPlanKey = sourceRange ? `${currentDate}::${sourceRange.id}` : currentDate;
    const nextPlanKey = `${nextDate}::${replacementRange.id}`;
    if (Object.prototype.hasOwnProperty.call(dailyPlans, currentPlanKey)) {
      dailyPlans[nextPlanKey] = dailyPlans[currentPlanKey];
      delete dailyPlans[currentPlanKey];
    }
    if (Object.prototype.hasOwnProperty.call(dailyPlanCompleted, currentPlanKey)) {
      dailyPlanCompleted[nextPlanKey] = dailyPlanCompleted[currentPlanKey];
      delete dailyPlanCompleted[currentPlanKey];
    }
    if (Object.prototype.hasOwnProperty.call(dailyActualHours, currentPlanKey)) {
      dailyActualHours[nextPlanKey] = dailyActualHours[currentPlanKey];
      delete dailyActualHours[currentPlanKey];
    }
    onUpdate({
      plannedRanges: mergeRanges([...removeDateFromRanges(task.plannedRanges, currentDate), replacementRange]),
      dailyPlans,
      dailyPlanCompleted,
      dailyActualHours,
    }, `その日のメモを${currentDate}から${nextDate}へ移動しました。`);
  };
  const projectSchedules = projects.flatMap((project) => [
    ...project.milestones.filter((milestone) => milestone.linkedTaskId === task.id || milestone.taskIds.includes(task.id)).map((milestone) => ({
      id: `milestone-${project.id}-${milestone.id}`,
      projectId: project.id,
      projectTitle: project.title,
      type: "マイルストーン",
      title: milestone.title,
      description: milestone.description || "",
      ranges: milestone.plannedRanges?.length ? milestone.plannedRanges : task.plannedRanges,
    })),
    ...(project.workItems || []).filter((work) => work.linkedTaskId === task.id).map((work) => ({
      id: `work-${project.id}-${work.id}`,
      projectId: project.id,
      projectTitle: project.title,
      type: "作業項目",
      title: work.title,
      description: work.description,
      ranges: work.plannedRanges?.length ? work.plannedRanges : task.plannedRanges,
    })),
  ]);
  const scheduleTitle = (range: Task["plannedRanges"][number]) => {
    const enteredTitle = range.title?.trim();
    if (enteredTitle) return enteredTitle;
    if (range.sourceId) {
      for (const project of projects) {
        if (range.sourceType === "project-work") {
          const work = (project.workItems || []).find((item) => item.id === range.sourceId);
          if (work?.title.trim()) return work.title.trim();
        }
        if (range.sourceType === "project-milestone") {
          const milestone = project.milestones.find((item) => item.id === range.sourceId);
          if (milestone?.title.trim()) return milestone.title.trim();
        }
      }
    }
    const description = (range.description || range.note || "").trim().split("\n")[0];
    return description || `予定 ${range.startDate}`;
  };
  const scheduleProjectContext = (range: Task["plannedRanges"][number]) => {
    if (range.sourceId) {
      for (const project of projects) {
        if (range.sourceType === "project-work") {
          const work = (project.workItems || []).find((item) => item.id === range.sourceId);
          if (work) return { projectId: project.id, status: work.status === "done" ? "completed" : work.status, label: work.status === "done" ? "達成" : work.status === "in-progress" ? "進行中" : "未着手" };
        }
        if (range.sourceType === "project-milestone") {
          const milestone = project.milestones.find((item) => item.id === range.sourceId);
          if (milestone) {
            const status = milestone.status || (milestone.completed ? "achieved" : "not-started");
            return { projectId: project.id, status: status === "achieved" ? "completed" : status, label: status === "achieved" ? "達成" : status === "in-progress" ? "進行中" : "未着手" };
          }
        }
      }
    }
    for (const project of projects) {
      const work = (project.workItems || []).find((item) => item.linkedTaskId === task.id && (item.plannedRanges || []).some((planned) => planned.id === range.id));
      if (work) return { projectId: project.id, status: work.status === "done" ? "completed" : work.status, label: work.status === "done" ? "達成" : work.status === "in-progress" ? "進行中" : "未着手" };
      const milestone = project.milestones.find((item) => (item.linkedTaskId === task.id || item.taskIds.includes(task.id)) && (item.plannedRanges || []).some((planned) => planned.id === range.id));
      if (milestone) {
        const status = milestone.status || (milestone.completed ? "achieved" : "not-started");
        return { projectId: project.id, status: status === "achieved" ? "completed" : status, label: status === "achieved" ? "達成" : status === "in-progress" ? "進行中" : "未着手" };
      }
    }
    return { projectId: projectContexts.length === 1 ? projectContexts[0].projectId : "", status: "", label: "状態未確認" };
  };
  const incompleteScheduleCount = task.plannedRanges.filter((range) => {
    if (range.status === "completed") return false;
    return scheduleProjectContext(range).status !== "completed";
  }).length;
  const currentRanges = [...task.plannedRanges.filter((range) => range.endDate >= todayValue() || range.status !== "completed"), ...(task.unscheduledPlans || [])];
  const pastRanges = task.plannedRanges.filter((range) => range.endDate < todayValue() && range.status === "completed");
  const loadRangeDraft = (range: Task["plannedRanges"][number]) => {
    setEditingRangeId(range.id);
    setRangeStart(range.startDate);
    setRangeEnd(range.endDate === range.startDate ? "" : range.endDate);
    setRangeTitle(range.title || "");
    setRangeDescription(range.description || range.note || "");
    setRangePlannedHours(Number(range.plannedHours) > 0 ? String(range.plannedHours) : "");
    setRangeStatus(range.status || "not-started");
  };
  const editRange = (range: Task["plannedRanges"][number]) => {
    loadRangeDraft(range);
    setScheduleEditorOpen(true);
  };
  const updateRangeStatus = (range: Task["plannedRanges"][number], nextStatus: NonNullable<Task["plannedRanges"][number]["status"]>) => onUpdate({
    plannedRanges: task.plannedRanges.map((item) => item.id === range.id ? { ...item, status: nextStatus, completedAt: nextStatus === "completed" ? item.completedAt || new Date().toISOString() : undefined } : item),
  }, `予定「${scheduleTitle(range)}」を${nextStatus === "completed" ? "完了" : nextStatus === "in-progress" ? "進行中" : "未着手"}へ変更しました。`);
  const sortedPlannedRanges = [...task.plannedRanges].sort((a, b) => a.startDate.localeCompare(b.startDate)
    || (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER)
    || a.endDate.localeCompare(b.endDate));
  const reorderRange = (targetRange: Task["plannedRanges"][number]) => {
    const sourceRange = task.plannedRanges.find((range) => range.id === draggingRangeId);
    setDragOverRangeId("");
    setDraggingRangeId("");
    if (!sourceRange || sourceRange.id === targetRange.id || sourceRange.startDate !== targetRange.startDate) return;
    const sameDateRanges = sortedPlannedRanges.filter((range) => range.startDate === sourceRange.startDate);
    const sourceIndex = sameDateRanges.findIndex((range) => range.id === sourceRange.id);
    const targetIndex = sameDateRanges.findIndex((range) => range.id === targetRange.id);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const reordered = [...sameDateRanges];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    const orderById = new Map(reordered.map((range, index) => [range.id, index]));
    onUpdate({
      plannedRanges: task.plannedRanges.map((range) => range.startDate === sourceRange.startDate
        ? { ...range, sortOrder: orderById.get(range.id) ?? range.sortOrder }
        : range),
    }, `${sourceRange.startDate}の予定順を変更しました。`);
  };
  const deleteRange = (range: Task["plannedRanges"][number]) => {
    setDeletingRange(range);
  };
  const confirmDeleteRange = () => {
    const range = deletingRange;
    if (!range) return;
    const title = scheduleTitle(range);
    const rangeKeySuffix = `::${range.id}`;
    const removeRangeEntries = <T,>(record: Record<string, T> | undefined): Record<string, T> => Object.fromEntries(
      Object.entries(record || {}).filter(([key]) => !key.endsWith(rangeKeySuffix)),
    );
    const plannedRanges = task.plannedRanges.filter((item) => item.id !== range.id);
    const dailyActualHours = removeRangeEntries(task.dailyActualHours);
    onUpdate({
      plannedRanges,
      unscheduledPlans: (task.unscheduledPlans || []).filter((item) => item.id !== range.id),
      plannedHours: plannedRanges.reduce((sum, item) => sum + (Number(item.plannedHours) || 0), 0),
      dailyPlans: removeRangeEntries(task.dailyPlans),
      dailyPlanCompleted: removeRangeEntries(task.dailyPlanCompleted),
      dailyPlanStatuses: removeRangeEntries(task.dailyPlanStatuses),
      dailyActualHours,
      actualHours: Object.values(dailyActualHours).reduce((sum, hours) => sum + (Number(hours) || 0), 0),
    }, `予定「${title}」を削除しました。`);
    if (editingRangeId === range.id) {
      setQuickScheduleAdding(false);
      resetRangeDraft();
    }
    setDeletingRange(null);
  };
  const rangeChip = (range: Task["plannedRanges"][number]) => {
    const status = range.status || "not-started";
    const overdue = status !== "completed" && (range.originalEndDate ? range.endDate > range.originalEndDate : range.endDate < todayValue());
    const effort = scheduleEffort(task, range);
    return <span key={range.id} className={`date-chip task-schedule-chip schedule-status-${overdue ? "overdue" : status}`}><span><strong>{scheduleTitle(range)}</strong><b>{range.startDate === range.endDate ? range.startDate : `${range.startDate}〜${range.endDate}`}</b>{(range.description || range.note) && <small>{range.description || range.note}</small>}<span className="task-schedule-chip-effort"><small>予定 <b>{effort.planned}h</b></small><small>実績 <b>{effort.actual}h</b></small><small className={effort.accuracy !== null && effort.accuracy < 70 ? "low" : ""}>精度 <b>{effort.accuracy === null ? "—" : `${effort.accuracy}%`}</b></small></span></span><select className={`task-schedule-status ${overdue ? "is-overdue" : ""}`} aria-label={`${scheduleTitle(range)}の状態`} value={status} onChange={(event) => updateRangeStatus(range, event.target.value as NonNullable<typeof range.status>)}><option value="not-started">{overdue ? "遅延・未着手" : "未着手"}</option><option value="in-progress">{overdue ? "遅延・進行中" : "進行中"}</option><option value="completed">完了</option></select><button type="button" onClick={() => editRange(range)}>編集</button><button type="button" aria-label={`予定「${scheduleTitle(range)}」を削除`} onClick={() => deleteRange(range)}>×</button></span>;
  };
  const descendantIds = new Set<string>();
  const collectDescendants = (parentId: string) => allTasks.filter((item) => item.parentTaskId === parentId).forEach((item) => { if (!descendantIds.has(item.id)) { descendantIds.add(item.id); collectDescendants(item.id); } });
  collectDescendants(task.id);
  const visibleHistory = task.history.filter((entry) => !(entry.type === "system" && entry.text.trim() === "プロジェクトから作業項目の予定を同期しました。"));
  const historyDates = [...new Set(visibleHistory.map((entry) => localDateValue(entry.timestamp)).filter(Boolean))].sort().reverse();
  const scrollToLatest = () => historyScrollRef.current?.scrollTo({ top: historyScrollRef.current.scrollHeight, behavior: "smooth" });
  const scrollToHistoryDate = () => {
    if (!historyDate) return;
    const container = historyScrollRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-history-date="${historyDate}"]`);
    if (!container || !target) return;
    const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top: Math.max(0, top - 12), behavior: "smooth" });
    target.classList.add("history-highlight");
    window.setTimeout(() => target.classList.remove("history-highlight"), 1400);
  };
  const historyDateLabel = (date: string) => {
    if (date === todayValue()) return "今日";
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const offset = yesterday.getTimezoneOffset();
    const yesterdayValue = new Date(yesterday.getTime() - offset * 60_000).toISOString().slice(0, 10);
    if (date === yesterdayValue) return "昨日";
    return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short" }).format(new Date(`${date}T00:00:00`));
  };
  const historyGroups = visibleHistory.reduce<{ date: string; entries: HistoryEntry[] }[]>((groups, entry) => {
    const date = localDateValue(entry.timestamp);
    const current = groups[groups.length - 1];
    if (current?.date === date) current.entries.push(entry);
    else groups.push({ date, entries: [entry] });
    return groups;
  }, []);
  const historyEntries = historyGroups.map((group) => <section className="history-date-group" key={group.date}>
    <div className="history-date-label" data-history-date={group.date}><button type="button" onClick={() => { setHistoryDate(group.date); setHistorySearchVisible(true); }} title="この日付を検索">{historyDateLabel(group.date)}</button></div>
    {group.entries.map((entry) => <Fragment key={entry.id}>{entry.type === "system"
      ? <div className="system-entry">{entry.text}<time>{formatDateTime(entry.timestamp)}</time></div>
        : <div className="memo-entry"><UserAvatar profile={profile} /><div className="memo-content"><div className="memo-head"><strong>{profile.displayName}</strong><time>{formatDateTime(entry.timestamp)}</time><span className="memo-actions">{editingMemo !== entry.id && <>{memoUrls(entry.text).some((url) => !task.links.some((link) => normalizeUrl(link.url) === url)) && <button className="memo-link-register" title="メモ内のURLを選んで関連リンクへ追加" onClick={() => openMemoLinkImport(entry.text)}>リンクを登録</button>}<button onClick={() => { setEditingMemo(entry.id); setEditingText(entry.text); }}>編集</button><button className="danger-text" onClick={() => onDeleteMemo(entry.id)}>削除</button></>}</span></div>{editingMemo === entry.id ? <div><textarea rows={4} value={editingText} onChange={(event) => setEditingText(event.target.value)} onKeyDown={(event) => { if (handleMemoIndent(event, editingText, setEditingText)) return; if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); onEditMemo(entry.id, editingText); setEditingMemo(null); } }} /><div className="editor-buttons"><button onClick={() => setEditingMemo(null)}>キャンセル</button><button className="primary" onClick={() => { onEditMemo(entry.id, editingText); setEditingMemo(null); }}>保存</button></div></div> : <>{entry.text && <CollapsibleMemo text={entry.text} />}<AttachmentCards attachments={allAttachments.filter((attachment) => entry.attachmentIds?.includes(attachment.id))} quickLinkedAttachmentIds={ownLinkFiles} onQuickLink={addAttachmentQuickLink} onRenamed={(attachment, name) => setAllAttachments((current) => current.map((item) => item.id === attachment.id ? { ...item, name } : item))} /></>}</div></div>}</Fragment>)}
  </section>);
  const closeTaskMenu = () => {
    if (taskMenuRef.current) taskMenuRef.current.open = false;
  };

  return <section className="detail">
    <div className="detail-header">
      <div className="detail-header-title">
        {[...projectContexts].sort((a, b) => Number(a.kind === "origin") - Number(b.kind === "origin")).map((context) => <button key={`${context.projectId}-${context.kind}`} type="button" className={`task-project-mark detail-header-project-mark ${context.kind}`} title={`${context.projectTitle}\n${context.location}\nクリックしてプロジェクトを開く`} aria-label={`${context.projectTitle}を開く`} onClick={() => onOpenProject(context.projectId)}>{context.kind === "origin" ? "P" : "↗"}</button>)}
        <input ref={titleInputRef} className="title-input" value={task.title} onFocus={() => { titleFocusRef.current = task.title; }} onChange={(event) => update("title", event.target.value)} onBlur={() => { if (titleFocusRef.current !== task.title) onUpdate({}, "タスク名を更新しました。"); }} />
      </div>
      <select className="detail-status-select" aria-label="ステータス" value={task.status} onChange={(event) => requestStatusChange(event.target.value as Task["status"])}>{STATUS_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.values.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</optgroup>)}</select>
      <details className="task-detail-menu" ref={taskMenuRef}>
        <summary aria-label="タスク操作" title="タスク操作">…</summary>
        <div className="task-detail-menu-panel">
          <span className="task-menu-group-label">タスク操作</span>
          <button onClick={() => { closeTaskMenu(); onCreateChild(); }}>子タスク追加</button>
          <button onClick={() => { closeTaskMenu(); window.dispatchEvent(new CustomEvent("chattask-open-waiting", { detail: { taskId: task.id } })); }}>{task.waitingFollowUp ? "待ち情報を編集" : "待ち箱へ入れる"}</button>
          {!task.waitingFollowUp && task.lastReleasedWaitingFollowUp && <button onClick={() => { closeTaskMenu(); onUpdate({ waitingFollowUp: task.lastReleasedWaitingFollowUp, status: task.lastReleasedWaitingStatus || "waiting-general", lastReleasedWaitingFollowUp: undefined, lastReleasedWaitingStatus: undefined }, "直前に解除した待ち状態を復元しました。"); }}>直前の待ち解除を取り消す</button>}
          <button onClick={() => { closeTaskMenu(); onDocuments(); }}>ドキュメント</button>
          <button onClick={() => { closeTaskMenu(); onSaveTemplate(); }}>テンプレートとして保存</button>
          <button onClick={() => { closeTaskMenu(); onPromote(); }}>{promoted ? "起点プロジェクトを開く" : "プロジェクトへ昇華"}</button>
          {!!projectContexts.length && <><span className="task-menu-group-label">表示設定</span><button onClick={() => { const visible = !projectContextVisible; setProjectContextVisible(visible); localStorage.setItem("chatTaskProjectContextVisible", String(visible)); closeTaskMenu(); }}>{projectContextVisible ? "プロジェクト情報を非表示" : "プロジェクト情報を表示"}</button></>}
          <span className="task-menu-group-label danger-group">管理</span>
          <button className="danger-text" onClick={() => { closeTaskMenu(); setDeleteConfirm(true); }}>削除</button>
        </div>
      </details>
    </div>
    {pendingWaitingStatus && <div className="task-waiting-choice" role="alertdialog" aria-label="待ち箱への登録を選択">
      <div><strong>「{STATUS_LABELS[pendingWaitingStatus]}」へ変更します</strong><span>このタスクを待ち箱にも入れますか？</span></div>
      <div><button type="button" onClick={() => setPendingWaitingStatus(null)}>変更をやめる</button><button type="button" onClick={() => { const status = pendingWaitingStatus; setPendingWaitingStatus(null); onUpdate({ status, waitingFollowUp: undefined }, `ステータスを「${STATUS_LABELS[status]}」へ変更しました。`); }}>ステータスだけ変更</button><button type="button" className="primary" onClick={() => { const status = pendingWaitingStatus; setPendingWaitingStatus(null); onUpdate({ status, waitingFollowUp: undefined }, `ステータスを「${STATUS_LABELS[status]}」へ変更しました。`); window.setTimeout(() => window.dispatchEvent(new CustomEvent("chattask-open-waiting", { detail: { taskId: task.id } })), 0); }}>待ち箱にも入れる</button></div>
    </div>}
    {pendingLeavingWaitingStatus && task.waitingFollowUp && <div className="task-waiting-choice" role="alertdialog" aria-label="待ち箱の解除を選択">
      <div><strong>「{STATUS_LABELS[pendingLeavingWaitingStatus]}」へ変更します</strong><span>現在の待ち情報をどうしますか？</span></div>
      <div><button type="button" onClick={() => setPendingLeavingWaitingStatus(null)}>変更をやめる</button><button type="button" onClick={() => { const status = pendingLeavingWaitingStatus; setPendingLeavingWaitingStatus(null); onUpdate({ status, waitingFollowUp: task.waitingFollowUp }, `ステータスを「${STATUS_LABELS[status]}」へ変更し、待ち箱には残しました。`); }}>待ち箱には残す</button><button type="button" className="primary" onClick={() => { const status = pendingLeavingWaitingStatus; const info = task.waitingFollowUp!; const releasedAt = new Date().toISOString(); setPendingLeavingWaitingStatus(null); onUpdate({ status, waitingFollowUp: undefined, lastReleasedWaitingFollowUp: info, lastReleasedWaitingStatus: task.status, waitingHistory: [...(task.waitingHistory || []), { id: generateId(), followUp: info, status: task.status, releasedAt, reason: "status-change" }] }, `ステータスを「${STATUS_LABELS[status]}」へ変更し、待ち箱を解除しました。`); window.dispatchEvent(new CustomEvent("chattask-drop-notice", { detail: { text: `「${task.title}」の待ちを解除しました。待ち箱から取り消せます。` } })); }}>待ち箱を解除する</button></div>
    </div>}
    {deleteConfirm && <div className="task-delete-confirm" role="alert"><span>「{task.title || "無題のタスク"}」を削除しますか？{allTasks.some((item) => item.parentTaskId === task.id) && " 子タスクは親なしに移動します。"}</span><div><button onClick={() => setDeleteConfirm(false)}>キャンセル</button><button className="danger" onClick={onDelete}>削除する</button></div></div>}
    <div className="quick-links task-quick-links">
      <span>クイックリンク</span>
      <div className="quick-link-scroll">{task.links.map((link) => link.kind === "file" || link.attachmentId ? <button type="button" className="quick-file-link" key={link.id} title={`${link.label || "ファイル"}を開く`} onClick={() => link.attachmentId && void openAttachment(link.attachmentId)}><i aria-hidden="true">▧</i>{link.label || "ファイル"}</button> : <a key={link.id} href={link.url} target="_blank" rel="noreferrer">{link.label || new URL(link.url).hostname}</a>)}{inheritedParentLinks.map((link) => link.kind === "file" || link.attachmentId ? <button type="button" className="quick-file-link inherited-parent-link" key={`parent:${parentTask?.id}:${link.id}`} title={`${parentTask?.title || "親タスク"}から継承・${link.label || "ファイル"}を開く`} onClick={() => link.attachmentId && void openAttachment(link.attachmentId)}><i aria-hidden="true">↳</i><b aria-hidden="true">▧</b>{link.label || "ファイル"}</button> : <a className="inherited-parent-link" key={`parent:${parentTask?.id}:${link.id}`} href={link.url} target="_blank" rel="noreferrer" title={`${parentTask?.title || "親タスク"}から継承`} aria-label={`${link.label || new URL(link.url).hostname}（${parentTask?.title || "親タスク"}から継承）`}><i aria-hidden="true">↳</i>{link.label || new URL(link.url).hostname}</a>)}</div>
      <div className="quick-toggle-actions">
        <button type="button" className="quick-details-toggle quick-document-button" aria-label="ドキュメントを開く" title={`タスク専用ドキュメントを開く（${task.documents.length}件）`} onClick={onDocuments}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8l4 4V20H6z" /><path d="M14 3.5V8h4M9 12h6M9 15h6" /></svg></button>
        <button type="button" className="quick-details-toggle quick-schedule-button" aria-label="予定を開く" title={`未完了の予定を開く（${incompleteScheduleCount}件／全${task.plannedRanges.length}件）`} onClick={() => { setScheduleQuickOpen(true); setQuickScheduleAdding(false); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5h14V20H5zM8 3.5v5M16 3.5v5M5 10h14" /></svg>{incompleteScheduleCount > 0 && <small>{incompleteScheduleCount}</small>}</button>
        <button type="button" className="quick-details-toggle quick-related-task-button" aria-label="関連タスクを開く" title={`関連タスクを開く（${task.relatedTasks.length}件）`} onClick={() => setRelatedTasksOpen(true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 14.5l5-5M7.5 17.5l-1 1a3.5 3.5 0 01-5-5l3-3a3.5 3.5 0 015 0M16.5 6.5l1-1a3.5 3.5 0 015 5l-3 3a3.5 3.5 0 01-5 0" /></svg>{task.relatedTasks.length > 0 && <small>{task.relatedTasks.length}</small>}</button>
        {(parentTask || currentTag || sharedProject) && <button type="button" className={`quick-details-toggle quick-resources-toggle ${tagResourcesVisible ? "active" : ""}`} aria-label={tagResourcesVisible ? "共有・継承資料を非表示" : "共有・継承資料を表示"} title={tagResourcesVisible ? "共有・継承資料を非表示" : "共有・継承資料を表示"} aria-pressed={tagResourcesVisible} onClick={() => { const visible = !tagResourcesVisible; setTagResourcesVisible(visible); localStorage.setItem("chatTaskTagResourcesVisible", String(visible)); }}>▤</button>}
        <button type="button" className={`quick-details-toggle ${detailsHidden ? "" : "active"}`} aria-label={detailsHidden ? "詳細情報を表示" : "詳細情報を閉じる"} title={detailsHidden ? "詳細情報を表示" : "詳細情報を閉じる"} aria-pressed={!detailsHidden} onClick={onToggleDetails}>ⓘ</button>
      </div>
    </div>
    {projectContextVisible && !!projectContexts.length && <details className="task-project-contexts" open={projectContextOpen} onToggle={(event) => { const open = event.currentTarget.open; setProjectContextOpen(open); localStorage.setItem("chatTaskProjectContextOpen", String(open)); }}><summary>プロジェクト管理中 <small>{projectContexts.length}件</small></summary><div>{projectContexts.map((context) => <button type="button" key={`${context.projectId}-${context.location}`} onClick={() => onOpenProject(context.projectId)}><b>{context.kind === "origin" ? "P" : "↗"}</b><span><strong>{context.projectTitle}</strong><small>{context.location}</small></span></button>)}</div></details>}
    {tagResourcesVisible && (parentTask || currentTag || sharedProjects.length > 0) && <section className="tag-common-resources">
      <header><div><strong>共有・継承資料</strong><small>親タスク、プロジェク、案件タグの資料を参照します。</small></div><button type="button" onClick={() => { setTagResourcesVisible(false); localStorage.setItem("chatTaskTagResourcesVisible", "false"); }}>閉じる</button></header>
      <div className="task-shared-resource-grid">
        {parentTask && <article className="task-shared-resource-card parent" key={parentTask.id}>
          <header><span>親</span><div><strong>{parentTask.title || "無題のタスク"}</strong><small>親タスクから継承・閲覧専用</small></div><button type="button" onClick={() => onOpenTask(parentTask.id)}>親タスクを開く</button></header>
          {!!parentTask.links.length && <div className="task-shared-links inherited-parent-links"><strong>継承URL</strong>{parentTask.links.map((link) => { const copied = ownLinkUrls.has(normalizeUrl(link.url) || ""); return <span key={link.id}><a href={link.url} target="_blank" rel="noreferrer">↗ {link.label || link.url}</a><button type="button" disabled={copied} onClick={() => update("links", [...task.links, { ...link, id: generateId() }], `親タスクのURL「${link.label || link.url}」を固定コピーしました。`)}>{copied ? "コピー済み" : "固定コピー"}</button></span>; })}</div>}
          <AttachmentsSection taskId={parentTask.id} title="親タスクのファイル" readOnly copyToTaskId={task.id} />
        </article>}
        {sharedProjects.map((project) => <article className="task-shared-resource-card project" key={project.id}>
          <header><span>P</span><div><strong>{project.title}</strong><small>プロジェクト共有</small></div><button type="button" onClick={() => onOpenProject(project.id)}>プロジェクトを開く</button></header>
          <button type="button" className="tag-common-document-link" onClick={() => onSharedDocuments(project.id)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8l4 4V20H6z" /><path d="M14 3.5V8h4M9 12h6M9 15h6" /></svg><span>共有ドキュメントを開く</span><small>{project.sharedDocuments?.filter((document) => document.kind !== "folder").length || 0}件</small></button>
          {!!project.sharedDocuments?.some((document) => document.kind !== "folder") && <div className="task-project-shared-document-list">{project.sharedDocuments.filter((document) => document.kind !== "folder").map((document) => <button type="button" key={document.id} title={`${document.title || "無題の文書"}を閲覧`} onClick={() => onSharedDocuments(project.id, document.id)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8l4 4V20H6z" /><path d="M14 3.5V8h4M9 12h6M9 15h6" /></svg><span>{document.title || "無題の文書"}</span><small>閲覧 ›</small></button>)}</div>}
          <AttachmentsSection taskId={`project:${project.id}`} title="プロジェクト共通ファイル" readOnly />
        </article>)}
        {currentTag && <article className="task-shared-resource-card tag">
          <header><span>#</span><div><strong>{currentTag.name}</strong><small>案件タグ共有</small></div></header>
          <button type="button" className="tag-common-document-link" onClick={onTagDocuments}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8l4 4V20H6z" /><path d="M14 3.5V8h4M9 12h6M9 15h6" /></svg><span>共有ドキュメントを開く</span><small>{currentTag.sharedDocuments?.filter((document) => document.kind !== "folder").length || 0}件</small></button>
          {!!currentTag.sharedLinks?.length && <div className="task-shared-links"><strong>共通URL</strong>{currentTag.sharedLinks.map((link) => <a key={link.id} href={link.url} target="_blank" rel="noreferrer">↗ {link.label || link.url}</a>)}</div>}
          <AttachmentsSection taskId={`project-tag:${currentTag.id}`} title="案件タグ共通ファイル" readOnly />
        </article>}
      </div>
    </section>}
    {!detailsHidden && <div className={`attributes ${scheduleEditorOpen ? "schedule-editor-active" : ""}`}>
      <div className="attributes-header"><div className="attributes-header-title"><strong>詳細情報</strong><span title={task.title}>{task.title || "無題のタスク"}</span></div><button type="button" onClick={onToggleDetails}>閉じる</button></div>
      <details open><summary>基本情報</summary><div className="field-grid">
        <label>ステータス<select value={task.status} onChange={(event) => requestStatusChange(event.target.value as Task["status"])}>{STATUS_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.values.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</optgroup>)}</select></label>
        <label>優先度<select value={task.priority} onChange={(event) => update("priority", event.target.value as Task["priority"], `優先度を${event.target.value}へ変更しました。`)}>{PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}</select></label>
        <label>案件タグ<select value={task.projectTagId} onChange={(event) => update("projectTagId", event.target.value, "案件タグを変更しました。")}><option value="">タグなし</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}{tag.visible ? "" : "（非表示）"}</option>)}</select></label>
        <ParentTaskSelector task={task} candidates={allTasks.filter((item) => item.id !== task.id && !descendantIds.has(item.id))} onChange={(parentTaskId) => update("parentTaskId", parentTaskId, parentTaskId ? "親タスクを変更しました。" : "親タスクとの関連を解除しました。")} />
        {task.status === "recurring" && <div className="project-effort-notice"><small>予定工数</small><strong>1回あたり {Number(task.plannedHours) || 0}h</strong></div>}
        {task.status !== "recurring" && !projectManaged && <div className="project-effort-notice"><small>予定工数</small><strong>各予定の合計 {task.plannedRanges.reduce((sum, range) => sum + (Number(range.plannedHours) || 0), 0)}h</strong></div>}
        {task.status !== "recurring" && projectManaged && <div className="project-effort-notice"><small>予定工数</small><strong>プロジェクト側で管理</strong></div>}
        <div className="actual-effort-readonly"><small>実績工数</small><strong>{Number(task.actualHours || 0).toFixed(2).replace(/\.?0+$/, "")}h</strong><span>タイマー・今日のページから記録</span></div>
      </div></details>
      <details open><summary>スケジュール</summary><div className="field-grid schedule-meta-grid">
        <label>期限・通知日<WorkDatePicker ariaLabel="期限・通知日" value={task.dueDate || task.reminderDate || ""} onChange={(date) => onUpdate({ dueDate: date, reminderDate: date }, "期限・通知日を変更しました。") } /></label>
      </div>
      <RecurrenceSettingsEditor task={task} onUpdate={onUpdate} />
      {task.status !== "recurring" && !projectManaged && <>
      {!scheduleEditorOpen && <button type="button" className="schedule-editor-open" onClick={() => { setEditingRangeId(""); setRangeTitle(""); setRangeDescription(""); setRangePlannedHours(""); setRangeStatus("not-started"); setRangeStart(todayValue()); setRangeEnd(""); setScheduleEditorOpen(true); }}>＋ 予定を追加</button>}
      <div className="schedule-editor task-schedule-editor">{scheduleEditorOpen && <button type="button" className="schedule-editor-modal-close" aria-label="予定編集を閉じる" onClick={() => { setScheduleEditorOpen(false); setEditingRangeId(""); }}>×</button>}<div className="task-schedule-copy"><label>予定の題名<input value={rangeTitle} onChange={(event) => setRangeTitle(event.target.value)} placeholder="例：資料作成" /></label><label className="task-schedule-hours">予定工数（時間）<input type="number" min="0" step="0.25" value={rangePlannedHours} onChange={(event) => setRangePlannedHours(event.target.value)} placeholder="例：2" /></label><label>予定の状態<select value={rangeStatus} onChange={(event) => setRangeStatus(event.target.value as typeof rangeStatus)}><option value="not-started">未着手</option><option value="in-progress">進行中</option><option value="completed">完了</option></select></label><label>予定の説明<textarea rows={2} value={rangeDescription} onChange={(event) => setRangeDescription(event.target.value)} placeholder="実施内容や完了条件など" /></label></div><div className="inline-form"><WorkDatePicker ariaLabel="開始日" value={rangeStart} onChange={setRangeStart} /><span>〜</span><WorkDatePicker ariaLabel="終了日" value={rangeEnd} min={rangeStart} onChange={setRangeEnd} /><button className="primary" disabled={!rangeStart} onClick={addRange}>{editingRangeId ? "更新" : "追加"}</button>{editingRangeId ? <button onClick={() => { setEditingRangeId(""); setRangeTitle(""); setRangeDescription(""); setRangePlannedHours(""); setRangeStatus("not-started"); setRangeStart(todayValue()); setRangeEnd(""); }}>キャンセル</button> : <button onClick={() => { setRangeStart(todayValue()); setRangeEnd(todayValue()); }}>今日</button>}</div>
        <div className="chips">{currentRanges.map(rangeChip)}{pastRanges.length > 0 && <details className="past-ranges"><summary>過去の予定 {pastRanges.length}件</summary><div className="chips">{pastRanges.map(rangeChip)}</div></details>}</div>
      </div></>}
      {task.status !== "recurring" && projectManaged && <div className="project-effort-notice project-schedule-notice"><small>スケジュール</small><strong>プロジェクト側で管理</strong><span>予定変更は関連するマイルストーンまたは作業項目から行ってください。</span></div>}
      {projectSchedules.length > 0 && <details className="linked-project-schedules"><summary>プロジェクトから連携された予定内容 <small>{projectSchedules.length}件</small></summary><div>{projectSchedules.map((item) => <article key={item.id}><div><small><button type="button" className="linked-schedule-project-link" title="該当プロジェクトを開く" onClick={() => onOpenProject(item.projectId)}>{item.projectTitle}<span aria-hidden="true">↗</span></button>・{item.type}</small><b>{item.title || "名称未設定"}</b></div>{item.description && <p>{item.description}</p>}<div className="linked-project-schedule-ranges">{item.ranges.map((range) => <div key={range.id}><span className="date-chip">{range.startDate === range.endDate ? range.startDate : `${range.startDate}〜${range.endDate}`}{Number(range.plannedHours) > 0 ? `・予定 ${range.plannedHours}h` : ""}</span>{range.note && <p>{range.note}</p>}</div>)}</div></article>)}</div></details>}
      </details>
      {task.status !== "recurring" && <details><summary>その日のメモ</summary><div className="daily-plans">{scheduleDates.length ? scheduleDates.map((date) => <div className="daily-plan" key={date}><WorkDatePicker className="daily-plan-date" ariaLabel="メモの日付" value={date} onChange={(nextDate) => changeDailyPlanDate(date, nextDate)} allowClear={false} /><textarea className={task.dailyPlanCompleted[date] ? "plan-completed" : ""} value={task.dailyPlans[date] || ""} placeholder="その日の対応メモ・確認事項・申し送りなど" onChange={(event) => update("dailyPlans", { ...task.dailyPlans, [date]: event.target.value })} /><div><label className="check-label"><input type="checkbox" checked={Boolean(task.dailyPlanCompleted[date])} onChange={(event) => update("dailyPlanCompleted", { ...task.dailyPlanCompleted, [date]: event.target.checked })} />達成</label><button type="button" className="danger-text" onClick={() => onDeleteDailyPlan(date)}>削除</button></div></div>) : <p className="muted">予定日を追加すると、その日ごとのメモを入力できます。</p>}</div></details>}
      <details open><summary>内容</summary><div className="stack-fields"><label>説明<textarea rows={5} value={task.description} onChange={(event) => update("description", event.target.value)} onBlur={() => onUpdate({}, "説明を更新しました。")} placeholder="背景や完了条件など" /></label></div></details>
      <details><summary>関連リンク</summary><div className="links-editor">
        <div className="inline-form"><input value={linkLabel} onChange={(event) => setLinkLabel(event.target.value)} placeholder="表示名（Redmineなど）" /><input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="URL" /><button className="primary" onClick={addLink}>追加</button><label className="quick-file-picker">ファイルを追加<input type="file" disabled={attachmentBusy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void addFileLink(file); event.target.value = ""; }} /></label></div>
        {task.links.map((link) => editingLinkId === link.id
          ? <div className="link-row link-row-editing" key={link.id}><input value={editingLinkLabel} onChange={(event) => setEditingLinkLabel(event.target.value)} placeholder="表示名" />{!(link.kind === "file" || link.attachmentId) && <input value={editingLinkUrl} onChange={(event) => setEditingLinkUrl(event.target.value)} placeholder="URL" />}<button onClick={() => setEditingLinkId(null)}>キャンセル</button><button className="primary" onClick={saveEditingLink}>保存</button></div>
          : <div className="link-row" key={link.id}>{link.kind === "file" || link.attachmentId ? <button type="button" className="link-file-open" onClick={() => link.attachmentId && void openAttachment(link.attachmentId)}>▧ {link.label || "ファイル"}</button> : <a href={link.url} target="_blank" rel="noreferrer">{link.label || link.url}</a>}<button onClick={() => startEditingLink(link)}>編集</button><button className="danger-text" onClick={() => update("links", task.links.filter((item) => item.id !== link.id))}>削除</button></div>)}
      </div></details>
      <AttachmentsSection taskId={task.id} refreshKey={attachmentRevision} quickLinkedAttachmentIds={ownLinkFiles} onQuickLink={addAttachmentQuickLink} onChanged={() => setAttachmentRevision((value) => value + 1)} onHistory={(text) => onUpdate({}, text)} />
    </div>}
      <div className="history-panel">{historySearchVisible ? <div className="history-jump"><span>メモ履歴 {visibleHistory.length}件</span><select aria-label="移動する履歴の日付" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)}><option value="">日付を選択</option>{historyDates.map((date) => <option key={date} value={date}>{date.replace(/-/g, "/")}</option>)}</select><button type="button" disabled={!historyDate} onClick={scrollToHistoryDate}>移動</button><button type="button" onClick={scrollToLatest}>最新へ</button><button type="button" onClick={() => setHistorySearchVisible(false)}>検索を閉じる</button></div> : <button type="button" className="history-search-trigger" onClick={() => setHistorySearchVisible(true)}>日付検索</button>}<div className="history-list" ref={historyScrollRef}>{historyEntries}</div>
      <div className={`memo-composer ${draggingFile ? "dragging-file" : ""}`} onDragEnter={enterDropZone} onDragOver={(event) => event.preventDefault()} onDragLeave={leaveDropZone} onDrop={dropFiles}><textarea ref={memoInputRef} value={memo} onChange={(event) => setMemo(event.target.value)} onPaste={pasteFiles} onKeyDown={(event) => { if (handleMemoIndent(event, memo, setMemo)) return; if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); addMemo(); } }} placeholder="作業内容やメモを入力...（Tabで字下げ、Shift+Tabで解除、⌘/Ctrl + Enterで記録）" /><button className="primary" onClick={addMemo}>記録</button>{(attachmentBusy || draggingFile) && <div className="memo-drop-overlay">{attachmentBusy ? "ファイルを保存中..." : "ここにドロップして添付"}</div>}</div>
      <AttachmentCards attachments={pendingAttachments} quickLinkedAttachmentIds={ownLinkFiles} onQuickLink={addAttachmentQuickLink} onRenamed={(attachment, name) => { setPendingAttachments((current) => current.map((item) => item.id === attachment.id ? { ...item, name } : item)); setAllAttachments((current) => current.map((item) => item.id === attachment.id ? { ...item, name } : item)); }} onRemove={(attachment) => { void removeAttachment(attachment.id).then(() => { setPendingAttachments((current) => current.filter((item) => item.id !== attachment.id)); setAttachmentRevision((value) => value + 1); }).catch((reason) => setAttachmentError(String(reason))); }} />
      {attachmentError && <div className="memo-attachment-error">{attachmentError}</div>}
    </div>
    {relatedTasksOpen && <RelatedTasksModal task={task} allTasks={allTasks} onUpdate={(relatedTasks) => onUpdate({ relatedTasks }, "関連タスクを更新しました。")} onOpen={onOpenTask} onClose={() => setRelatedTasksOpen(false)} />}
    {deletingRange && <Modal title="予定を削除" onClose={() => setDeletingRange(null)}>
      <div className="task-ending-dialog">
        <p>予定「{scheduleTitle(deletingRange)}」を削除しますか？</p>
        <p>この予定に紐づく実績・メモ・達成記録も削除されます。</p>
        {deletingRange.sourceId && <p>プロジェクトから連携された予定のため、管理元の予定からも削除されます。</p>}
        <div className="modal-actions"><button type="button" onClick={() => setDeletingRange(null)}>キャンセル</button><button type="button" className="danger" onClick={confirmDeleteRange}>削除する</button></div>
      </div>
    </Modal>}
    {scheduleQuickOpen && <Modal title={`予定・${task.title || "無題のタスク"}`} onClose={() => { setScheduleQuickOpen(false); setQuickScheduleAdding(false); }} wide>
      <div className="task-schedule-quick">
        {projectManaged && <div className="task-schedule-quick-notice"><strong>プロジェクト側で管理・閲覧専用</strong><span>予定カードをクリックすると、管理元のプロジェクトを開きます。期間・工数・状態はプロジェクト側で変更してください。</span></div>}
        <div className={`task-schedule-quick-content ${quickScheduleAdding ? "is-adding" : ""} ${editingRangeId ? "is-editing" : ""}`}>
        <section className="task-schedule-quick-list-pane">
          <header className="task-schedule-quick-head"><div><strong>タスクスケジュール</strong><small>{task.status === "recurring" ? `${recurrenceLabel(task)}・1回あたり ${Number(task.plannedHours) || 0}h` : `${task.plannedRanges.length + (task.unscheduledPlans?.length || 0)}件・予定工数 ${task.plannedRanges.reduce((sum, range) => sum + (Number(range.plannedHours) || 0), 0)}h`}</small></div>{!projectManaged && task.status !== "recurring" && <button type="button" className="primary" onClick={() => { resetRangeDraft(); setQuickScheduleAdding(true); }}>＋ 予定を追加</button>}</header>
          <div className="task-schedule-quick-list">{[...sortedPlannedRanges, ...(task.unscheduledPlans || [])].map((range) => {
          const status = range.status || "not-started";
          const unscheduled = !range.startDate;
          const overdue = !unscheduled && status !== "completed" && (range.originalEndDate ? range.endDate > range.originalEndDate : range.endDate < todayValue());
          const projectContext = projectManaged ? scheduleProjectContext(range) : null;
          const effort = scheduleEffort(task, range);
          const effortView = <div className="task-schedule-effort" aria-label={`予定 ${effort.planned}時間、実績 ${effort.actual}時間、精度 ${effort.accuracy === null ? "算出対象外" : `${effort.accuracy}%`}`}><span><small>予定</small><b>{effort.planned}h</b></span><span><small>実績</small><b>{effort.actual}h</b></span><span className={effort.accuracy !== null && effort.accuracy < 70 ? "low" : ""}><small>精度</small><b>{effort.accuracy === null ? "—" : `${effort.accuracy}%`}</b></span></div>;
          if (projectContext) {
            const projectOverdue = projectContext.status !== "completed" && (range.originalEndDate ? range.endDate > range.originalEndDate : range.endDate < todayValue());
            return <article className={`task-schedule-quick-item task-schedule-project-link schedule-status-${projectOverdue ? "overdue" : projectContext.status || "not-started"} ${projectContext.projectId ? "" : "is-unlinked"}`} key={range.id} role={projectContext.projectId ? "button" : undefined} tabIndex={projectContext.projectId ? 0 : undefined} onClick={() => { if (!projectContext.projectId) return; setScheduleQuickOpen(false); onOpenProject(projectContext.projectId); }} onKeyDown={(event) => { if (projectContext.projectId && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setScheduleQuickOpen(false); onOpenProject(projectContext.projectId); } }}><div><strong>{scheduleTitle(range)}</strong><span>{range.startDate === range.endDate ? range.startDate : `${range.startDate}〜${range.endDate}`}</span>{(range.description || range.note) && <small>{range.description || range.note}</small>}{effortView}</div><div className="task-schedule-project-meta"><span className={`task-schedule-project-status status-${projectContext.status || "unknown"}`}>{projectOverdue ? `遅延・${projectContext.label}` : projectContext.label}</span><span className="task-schedule-project-action">{projectContext.projectId ? "プロジェクトを開く ›" : "管理元を確認できません"}</span></div></article>;
          }
          return <article className={`task-schedule-quick-item is-editable ${unscheduled ? "is-unscheduled" : `schedule-status-${overdue ? "overdue" : status}`} ${draggingRangeId === range.id ? "is-dragging" : ""} ${dragOverRangeId === range.id ? "is-drag-over" : ""}`} key={range.id} onDragOver={(event) => { const source = task.plannedRanges.find((item) => item.id === draggingRangeId); if (!source || source.startDate !== range.startDate) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragOverRangeId(range.id); }} onDragLeave={() => setDragOverRangeId((current) => current === range.id ? "" : current)} onDrop={(event) => { event.preventDefault(); reorderRange(range); }}><span className="task-schedule-drag-handle" draggable={!projectManaged && !unscheduled} role="button" tabIndex={0} aria-label={`${scheduleTitle(range)}を並べ替え`} title={unscheduled ? "予定日を設定すると並べ替えできます" : "同じ開始日の予定内でドラッグして並べ替え"} onDragStart={(event) => { setDraggingRangeId(range.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", range.id); }} onDragEnd={() => { setDraggingRangeId(""); setDragOverRangeId(""); }}>⠿</span><div><strong>{scheduleTitle(range)}</strong><span>{unscheduled ? "予定なし" : range.startDate === range.endDate ? range.startDate : `${range.startDate}〜${range.endDate}`}</span>{(range.description || range.note) && <small>{range.description || range.note}</small>}{effortView}</div><div className="task-schedule-quick-item-actions"><select className={overdue ? "is-overdue" : ""} aria-label={`${scheduleTitle(range)}の状態`} value={status} onChange={(event) => updateRangeStatus(range, event.target.value as NonNullable<typeof range.status>)}><option value="not-started">{overdue ? "遅延・未着手" : "未着手"}</option><option value="in-progress">{overdue ? "遅延・進行中" : "進行中"}</option><option value="completed">完了</option></select>{!projectManaged && <><button type="button" onClick={() => { loadRangeDraft(range); setQuickScheduleAdding(true); }}>詳細編集</button><button type="button" className="task-schedule-delete" onClick={() => deleteRange(range)}>削除</button></>}</div></article>;
        })}{!task.plannedRanges.length && !(task.unscheduledPlans || []).length && <div className="task-schedule-quick-empty"><strong>予定はまだありません</strong><span>右上の「予定を追加」から、このタスクの作業予定を登録できます。</span></div>}</div>
        </section>
        {quickScheduleAdding ? <section className="task-schedule-quick-form">
          <div className="task-schedule-quick-form-main"><label>予定の題名<input autoFocus value={rangeTitle} onChange={(event) => setRangeTitle(event.target.value)} placeholder="例：資料作成" /></label><label>予定工数（時間）<input type="number" min="0" step="0.25" value={rangePlannedHours} onChange={(event) => setRangePlannedHours(event.target.value)} placeholder="例：2" /></label><label>状態<select value={rangeStatus} onChange={(event) => setRangeStatus(event.target.value as typeof rangeStatus)}><option value="not-started">未着手</option><option value="in-progress">進行中</option><option value="completed">完了</option></select></label></div>
          <div className="task-schedule-quick-dates"><label>開始日<WorkDatePicker ariaLabel="開始日" value={rangeStart} onChange={setRangeStart} /></label><span>〜</span><label>終了日<WorkDatePicker ariaLabel="終了日" value={rangeEnd} min={rangeStart} onChange={setRangeEnd} /></label></div>
          <label>予定の説明<textarea rows={3} value={rangeDescription} onChange={(event) => setRangeDescription(event.target.value)} placeholder="実施内容や完了条件など" /></label>
          <div className="task-schedule-quick-form-actions">{editingRangeId && rangeStart && <button type="button" onClick={() => { const range = [...task.plannedRanges, ...(task.unscheduledPlans || [])].find((item) => item.id === editingRangeId); if (range) unscheduleRange(range); }}>日程だけ外す</button>}<button type="button" onClick={() => { setQuickScheduleAdding(false); resetRangeDraft(); }}>キャンセル</button><button type="button" className="primary" disabled={!rangeStart} onClick={() => { if (addRange()) setQuickScheduleAdding(false); }}>{editingRangeId ? "予定を更新" : "予定を追加"}</button></div>
        </section> : <section className="task-schedule-quick-editor-empty"><strong>スケジュール編集</strong><span>左の予定から「詳細編集」を選ぶか、「予定を追加」を押してください。</span></section>}
        </div>
      </div>
    </Modal>}
    {endingStatus && <Modal title={`「${STATUS_LABELS[endingStatus]}」に変更`} onClose={() => { setEndingStatus(null); setEndingReason(""); }}>
      <div className="task-ending-dialog">
        <p>終了理由や申し送りを入力できます。入力内容はタスクのメモにも保存されます。</p>
        <label>{endingStatus === "handed-over" ? "引き継ぎ内容" : `${STATUS_LABELS[endingStatus]}理由`}<textarea autoFocus rows={5} value={endingReason} onChange={(event) => setEndingReason(event.target.value)} placeholder={endingStatus === "handed-over" ? "引き継ぎ先、残っている対応、注意点など" : "終了した理由や補足（任意）"} /></label>
        <div className="modal-actions"><button type="button" onClick={() => { setEndingStatus(null); setEndingReason(""); }}>キャンセル</button><button type="button" className="primary" onClick={confirmEndingStatus}>「{STATUS_LABELS[endingStatus]}」にする</button></div>
      </div>
    </Modal>}
    {linkImportItems && <Modal title="メモのリンクを関連リンクへ登録" onClose={() => setLinkImportItems(null)}>
      <div className="memo-link-import">
        <p>登録するURLを選択し、クイックリンクに表示する名前を設定してください。</p>
        <div className="memo-link-import-tools"><button type="button" onClick={() => setLinkImportItems(linkImportItems.map((item) => ({ ...item, selected: true })))}>すべて選択</button><button type="button" onClick={() => setLinkImportItems(linkImportItems.map((item) => ({ ...item, selected: false })))}>すべて解除</button></div>
        <div className="memo-link-import-list">{linkImportItems.map((item, index) => <label className={item.selected ? "selected" : ""} key={item.url}><input type="checkbox" checked={item.selected} onChange={(event) => setLinkImportItems(linkImportItems.map((current, currentIndex) => currentIndex === index ? { ...current, selected: event.target.checked } : current))} /><span><input value={item.label} disabled={!item.selected} aria-label={`${item.url}の表示名`} onChange={(event) => setLinkImportItems(linkImportItems.map((current, currentIndex) => currentIndex === index ? { ...current, label: event.target.value } : current))} placeholder="表示名" /><small>{item.url}</small></span></label>)}</div>
        <div className="modal-actions"><button type="button" onClick={() => setLinkImportItems(null)}>キャンセル</button><button type="button" className="primary" disabled={!linkImportItems.some((item) => item.selected)} onClick={addSelectedMemoLinks}>選択したリンクを登録（{linkImportItems.filter((item) => item.selected).length}件）</button></div>
      </div>
    </Modal>}
  </section>;
}

function ParentTaskSelector({ task, candidates, onChange }: { task: Task; candidates: Task[]; onChange: (parentTaskId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const parent = candidates.find((item) => item.id === task.parentTaskId);
  const normalizedQuery = query.trim().toLowerCase();
  const matches = candidates.filter((item) => !normalizedQuery || `${item.title} ${item.description}`.toLowerCase().includes(normalizedQuery));
  const choose = (parentTaskId: string) => {
    onChange(parentTaskId);
    setOpen(false);
    setQuery("");
  };
  return <div className="parent-task-field">
    <small>親タスク</small>
    <button type="button" className="parent-task-trigger" onClick={() => setOpen(true)}><span>{parent?.title || "親タスクなし"}</span><b>{parent ? "変更" : "検索"}</b></button>
    {open && createPortal(<div className="linked-task-picker-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="linked-task-picker parent-task-picker" role="dialog" aria-modal="true" aria-label="親タスクを検索">
        <header><div><strong>親タスクを選択</strong><small>タスク名・説明で検索できます</small></div><button type="button" onClick={() => setOpen(false)}>×</button></header>
        <div className="linked-task-picker-search"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="親タスクを検索..." /></div>
        <div className="linked-task-picker-results"><section><h4>{normalizedQuery ? "検索結果" : "すべてのタスク"}</h4>
          {matches.map((item) => <button type="button" className={`linked-task-choice ${item.id === task.parentTaskId ? "selected" : ""}`} key={item.id} onClick={() => choose(item.id)}><span><strong>{item.title || "無題のタスク"}</strong><small>{item.description || "説明なし"}</small></span><span><b>{item.id === task.parentTaskId ? "選択中" : "選択"}</b></span></button>)}
          {!matches.length && <p>該当するタスクはありません。</p>}
        </section></div>
        <footer><button type="button" className="danger-text" disabled={!task.parentTaskId} onClick={() => choose("")}>親タスクとの関連を解除</button><button type="button" onClick={() => setOpen(false)}>キャンセル</button></footer>
      </section>
    </div>, document.body)}
  </div>;
}
