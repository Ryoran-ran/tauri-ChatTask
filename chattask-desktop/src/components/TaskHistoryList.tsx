import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Task, UserProfile } from "../types";
import { formatDateTime, localDateValue, normalizeUrl, todayValue } from "../utils";
import type { Attachment } from "../services/attachments";
import { AttachmentCards } from "./AttachmentCards";
import { MarkdownText } from "./MarkdownText";
import { UserAvatar } from "./UserAvatar";
import { handleTextareaIndent, memoUrls } from "./taskDetailUtils";

interface Props {
  task: Task;
  profile: UserProfile;
  attachments: Attachment[];
  quickLinkedAttachmentIds: Set<string>;
  onQuickLink: (attachment: Attachment) => void;
  onRenamed: (attachment: Attachment, name: string) => void;
  onDeleteMemo: (id: string) => void;
  onEditMemo: (id: string, text: string) => void;
  onOpenMemoLinkImport: (text: string) => void;
}

const formatHoursValue = (value: number) => Number(value.toFixed(2)).toString();

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

const historyDateLabel = (date: string) => {
  if (date === todayValue()) return "今日";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const offset = yesterday.getTimezoneOffset();
  const yesterdayValue = new Date(yesterday.getTime() - offset * 60_000).toISOString().slice(0, 10);
  if (date === yesterdayValue) return "昨日";
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short" }).format(new Date(`${date}T00:00:00`));
};

export function TaskHistoryList({ task, profile, attachments, quickLinkedAttachmentIds, onQuickLink, onRenamed, onDeleteMemo, onEditMemo, onOpenMemoLinkImport }: Props) {
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const [historyDate, setHistoryDate] = useState("");
  const [historySearchVisible, setHistorySearchVisible] = useState(false);
  const [editingMemo, setEditingMemo] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const visibleHistory = task.history.filter((entry) => !(entry.type === "system" && entry.text.trim() === "プロジェクトから作業項目の予定を同期しました。"));
  const historyDates = [...new Set(visibleHistory.map((entry) => localDateValue(entry.timestamp)).filter(Boolean))].sort().reverse();
  const historyGroups = visibleHistory.reduce<{ date: string; entries: Task["history"] }[]>((groups, entry) => {
    const date = localDateValue(entry.timestamp);
    const current = groups[groups.length - 1];
    if (current?.date === date) current.entries.push(entry);
    else groups.push({ date, entries: [entry] });
    return groups;
  }, []);

  useEffect(() => {
    setHistoryDate("");
    setHistorySearchVisible(false);
    setEditingMemo(null);
  }, [task.id]);

  useLayoutEffect(() => {
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
  }, [task.id, task.history.length]);

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

  return <>
    {historySearchVisible ? <div className="history-jump"><span>メモ履歴 {visibleHistory.length}件</span><select aria-label="移動する履歴の日付" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)}><option value="">日付を選択</option>{historyDates.map((date) => <option key={date} value={date}>{date.replace(/-/g, "/")}</option>)}</select><button type="button" disabled={!historyDate} onClick={scrollToHistoryDate}>移動</button><button type="button" onClick={scrollToLatest}>最新へ</button><button type="button" onClick={() => setHistorySearchVisible(false)}>検索を閉じる</button></div> : <button type="button" className="history-search-trigger" onClick={() => setHistorySearchVisible(true)}>日付検索</button>}
    <div className="history-list" ref={historyScrollRef}>{historyGroups.map((group) => <section className="history-date-group" key={group.date}>
      <div className="history-date-label" data-history-date={group.date}><button type="button" onClick={() => { setHistoryDate(group.date); setHistorySearchVisible(true); }} title="この日付を検索">{historyDateLabel(group.date)}</button></div>
      {group.entries.map((entry) => <Fragment key={entry.id}>{entry.type === "system"
        ? <div className="system-entry">{entry.text}<time>{formatDateTime(entry.timestamp)}</time></div>
        : <div className="memo-entry"><UserAvatar profile={profile} /><div className="memo-content"><div className="memo-head"><strong>{profile.displayName}</strong><time>{formatDateTime(entry.timestamp)}</time><span className="memo-actions">{editingMemo !== entry.id && <>{memoUrls(entry.text).some((url) => !task.links.some((link) => normalizeUrl(link.url) === url)) && <button className="memo-link-register" title="メモ内のURLを選んで関連リンクへ追加" onClick={() => onOpenMemoLinkImport(entry.text)}>リンクを登録</button>}<button onClick={() => { setEditingMemo(entry.id); setEditingText(entry.text); }}>編集</button><button className="danger-text" onClick={() => onDeleteMemo(entry.id)}>削除</button></>}</span></div>{(entry.workTitle || entry.workPlannedHours !== undefined || entry.workActualHours !== undefined) && <div className="memo-work-title"><span>{entry.workTitle && <><small>対象作業</small><strong>{entry.workTitle}</strong></>}</span><span className="memo-work-effort">{entry.workPlannedHours !== undefined && <small>予定 <b>{formatHoursValue(entry.workPlannedHours)}h</b></small>}{entry.workActualHours !== undefined && <small>実績 <b>{formatHoursValue(entry.workActualHours)}h</b></small>}</span></div>}{editingMemo === entry.id ? <div><textarea rows={4} value={editingText} onChange={(event) => setEditingText(event.target.value)} onKeyDown={(event) => { if (handleTextareaIndent(event, editingText, setEditingText)) return; if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); onEditMemo(entry.id, editingText); setEditingMemo(null); } }} /><div className="editor-buttons"><button onClick={() => setEditingMemo(null)}>キャンセル</button><button className="primary" onClick={() => { onEditMemo(entry.id, editingText); setEditingMemo(null); }}>保存</button></div></div> : <>{entry.text && <CollapsibleMemo text={entry.text} />}<AttachmentCards attachments={attachments.filter((attachment) => entry.attachmentIds?.includes(attachment.id))} quickLinkedAttachmentIds={quickLinkedAttachmentIds} onQuickLink={onQuickLink} onRenamed={onRenamed} /></>}</div></div>}
      </Fragment>)}
    </section>)}</div>
  </>;
}
