import { useEffect, useState } from "react";
import { FILTERS, isTerminalStatus } from "../data/constants";
import { taskProjectContexts } from "../projectContext";
import type { Goal, NonWorkingPeriod, Priority, ProjectTag, SavedTaskView, Task, TaskFilter, TaskSortKey, TaskSortRule } from "../types";
import { TaskCard } from "./TaskCard";
import { TagIcon } from "./TagIcon";
import { Modal } from "./Modal";
import { hasIncompletePlanForDate, isRecurringDue, todayValue } from "../utils";

interface Props {
  tasks: Task[];
  tags: ProjectTag[];
  projects: Goal[];
  periods: NonWorkingPeriod[];
  selectedId: string | null;
  filter: TaskFilter;
  tagFilter: string;
  search: string;
  priorityFilter: "all" | Priority;
  savedViews: SavedTaskView[];
  sortRules: TaskSortRule[];
  filtersHidden: boolean;
  collapsedIds: Set<string>;
  onFilter: (filter: TaskFilter) => void;
  onTagFilter: (tag: string) => void;
  onSearch: (search: string) => void;
  onPriorityFilter: (priority: "all" | Priority) => void;
  onSaveView: (name: string) => void;
  onApplyView: (view: SavedTaskView) => void;
  onDeleteView: (id: string) => void;
  onSortRules: (rules: TaskSortRule[]) => void;
  onToggleFilters: () => void;
  onSelect: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onCreate: (projectTagId?: string) => void;
  onToday: () => void;
  narrow: boolean;
  density: "standard" | "compact" | "minimal";
  groupByTag: boolean;
  onToggleWidth: () => void;
  onToggleDensity: () => void;
  onToggleGroupByTag: () => void;
  onQuick: (id: string, action: "doing" | "waiting" | "done" | "today" | "tomorrow" | "log") => void;
  onOpenProject: (id: string) => void;
  onSaveTemplate: (task: Task) => void;
}

const depthFor = (task: Task, all: Task[]) => {
  let depth = 0;
  let parentId = task.parentTaskId;
  const visited = new Set<string>();
  while (parentId && depth < 4 && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = all.find((item) => item.id === parentId);
    if (!parent) break;
    depth += 1;
    parentId = parent.parentTaskId;
  }
  return depth;
};

export function Sidebar(props: Props) {
  const [viewName, setViewName] = useState("");
  const [sortEditorOpen, setSortEditorOpen] = useState(false);
  const [collapsedTagGroups, setCollapsedTagGroups] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("chatTaskCollapsedTagGroups") || "[]")); }
    catch { return new Set(); }
  });
  useEffect(() => {
    localStorage.setItem("chatTaskCollapsedTagGroups", JSON.stringify([...collapsedTagGroups]));
  }, [collapsedTagGroups]);
  const toggleTagGroup = (id: string) => setCollapsedTagGroups((current) => {
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const hiddenByParent = (task: Task) => {
    let parentId = task.parentTaskId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (props.collapsedIds.has(parentId)) return true;
      visited.add(parentId);
      parentId = props.tasks.find((item) => item.id === parentId)?.parentTaskId || "";
    }
    return false;
  };
  const visibleTasks = props.tasks.filter((task) => !hiddenByParent(task));
  const completedProjectWorkIds = new Set(props.projects.flatMap((project) =>
    (project.workItems || []).filter((work) => work.status === "done").map((work) => work.id)));
  const today = todayValue();
  const childrenByParent = new Map<string, Task[]>();
  props.tasks.forEach((task) => {
    if (task.parentTaskId) childrenByParent.set(task.parentTaskId, [...(childrenByParent.get(task.parentTaskId) || []), task]);
  });
  const descendantTodayMemo = new Map<string, boolean>();
  const hasTodayDescendant = (taskId: string, visiting = new Set<string>()): boolean => {
    const cached = descendantTodayMemo.get(taskId);
    if (cached !== undefined) return cached;
    if (visiting.has(taskId)) return false;
    const nextVisiting = new Set(visiting).add(taskId);
    const result = (childrenByParent.get(taskId) || []).some((child) =>
      (!isTerminalStatus(child.status) && (hasIncompletePlanForDate(child, today, completedProjectWorkIds) || isRecurringDue(child, today, props.periods)))
      || hasTodayDescendant(child.id, nextVisiting));
    descendantTodayMemo.set(taskId, result);
    return result;
  };
  const sortLabels: Record<TaskSortKey, string> = { today: "今日すること", priority: "優先度", dueDate: "期限", updatedAt: "更新日時", createdAt: "作成日時", title: "タスク名" };
  const moveSortRule = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= props.sortRules.length) return;
    const next = [...props.sortRules];
    [next[index], next[target]] = [next[target], next[index]];
    props.onSortRules(next);
  };
  const prioritizeToday = () => {
    const existing = props.sortRules.find((rule) => rule.key === "today");
    props.onSortRules([
      { ...(existing || { id: `sort-today-${Date.now()}`, key: "today" as const }), direction: "desc" },
      ...props.sortRules.filter((rule) => rule.key !== "today"),
    ]);
  };
  const renderTask = (task: Task, grouped = false, flat = false) => {
    const children = flat ? [] : props.tasks.filter((child) => child.parentTaskId === task.id);
    const parent = props.tasks.find((item) => item.id === task.parentTaskId);
    const depth = flat ? 0 : grouped && parent?.projectTagId !== task.projectTagId ? 0 : depthFor(task, props.tasks);
    const visibleSiblings = depth > 0 ? visibleTasks.filter((item) => item.parentTaskId === task.parentTaskId) : [];
    const isLastChild = depth > 0 && visibleSiblings[visibleSiblings.length - 1]?.id === task.id;
    const projectContexts = taskProjectContexts(props.projects, task.id);
    return <TaskCard key={task.id} task={task} tag={props.tags.find((tag) => tag.id === task.projectTagId)} projectContexts={projectContexts} completedProjectWorkIds={completedProjectWorkIds} periods={props.periods} hasTodayDescendant={!flat && hasTodayDescendant(task.id)} selected={task.id === props.selectedId} childCount={children.length} completedChildren={children.filter((child) => isTerminalStatus(child.status)).length} depth={depth} isLastChild={isLastChild} collapsed={!flat && props.collapsedIds.has(task.id)} onSelect={() => props.onSelect(task.id)} onToggle={() => props.onToggleCollapse(task.id)} onQuick={(action) => props.onQuick(task.id, action)} onOpenProject={props.onOpenProject} onSaveTemplate={() => props.onSaveTemplate(task)} />;
  };
  const groups = props.groupByTag ? [
    ...props.tags.filter((tag) => tag.visible).map((tag) => ({ id: tag.id, name: tag.name, color: tag.color || "#3b82f6", tasks: visibleTasks.filter((task) => task.projectTagId === tag.id) })),
    ...Array.from(new Set(visibleTasks.filter((task) => task.projectTagId && !props.tags.some((tag) => tag.id === task.projectTagId)).map((task) => task.projectTagId))).map((id) => ({ id, name: "削除済みの案件タグ", color: "#64748b", tasks: visibleTasks.filter((task) => task.projectTagId === id) })),
    { id: "", name: "タグなし", color: "#94a3b8", tasks: visibleTasks.filter((task) => !task.projectTagId) },
  ] : [];
  const todayShortcutKey = "today-shortcut";
  // The today shortcut is a task-level view. It must not inherit the regular
  // tree's indentation or disappear when an ancestor is collapsed.
  const todayShortcutTasks = props.tasks.filter((task) =>
    !isTerminalStatus(task.status)
    && (hasIncompletePlanForDate(task, today, completedProjectWorkIds)
      || isRecurringDue(task, today, props.periods)
      || Boolean(task.waitingFollowUp?.reviewDate && task.waitingFollowUp.reviewDate <= today)));
  const todayShortcutCollapsed = collapsedTagGroups.has(todayShortcutKey);
  return (
    <aside className={`sidebar ${props.narrow ? "sidebar-narrow" : ""} density-${props.density}`}>
      <div className="sidebar-tools">
        <div className="sidebar-display-tools">
          <button className="filter-toggle" onClick={props.onToggleFilters}>{props.filtersHidden ? "検索・絞り込みを表示" : "検索・絞り込みを隠す"}<span>{props.filtersHidden ? "▼" : "▲"}</span></button>
          <details className="sidebar-display-menu">
            <summary aria-label="表示設定" title="表示設定">…</summary>
            <div>
              <strong>表示設定</strong>
              <button className={props.groupByTag ? "active" : ""} onClick={props.onToggleGroupByTag}><span>カテゴリー</span><small>{props.groupByTag ? "案件タグ別" : "分類なし"}</small></button>
              <button onClick={props.onToggleDensity}><span>タスクの縦幅</span><small>{props.density === "standard" ? "標準" : props.density === "compact" ? "コンパクト" : "最小"}</small></button>
              <button onClick={props.onToggleWidth}><span>サイドバーの横幅</span><small>{props.narrow ? "細い" : "標準"}</small></button>
            </div>
          </details>
        </div>
        {!props.filtersHidden && <div className="filters-panel">
          <input value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="タスク名やメモを検索..." />
          <div className="filter-buttons">{FILTERS.map((item) => <button key={item.id} className={props.filter === item.id ? "active" : ""} onClick={() => props.onFilter(item.id)}>{item.label}</button>)}</div>
          <select value={props.tagFilter} onChange={(event) => props.onTagFilter(event.target.value)}>
            <option value="all">すべての案件タグ</option><option value="none">タグなし</option>
            {props.tags.filter((tag) => tag.visible).map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
          </select>
          <select value={props.priorityFilter} onChange={(event) => props.onPriorityFilter(event.target.value as "all" | Priority)}>
            <option value="all">すべての優先度</option>
            {(["A", "B", "C", "D"] as Priority[]).map((priority) => <option value={priority} key={priority}>優先度 {priority}</option>)}
          </select>
          <button type="button" className="advanced-filter-open" onClick={() => window.dispatchEvent(new Event("chattask-open-advanced-filter"))}>＋ 条件検索（AND・OR）</button>
          <button type="button" className="sort-editor-open" onClick={() => setSortEditorOpen(true)}><span>↕ 並び替え</span><small>{props.sortRules.length}条件・上から優先</small></button>
          {sortEditorOpen && <Modal title="タスクの並び替え" onClose={() => setSortEditorOpen(false)} wide><div className="sort-editor-dialog">
            <header><div><strong>並び替え条件</strong><p>上にある条件から順番に適用します。</p></div></header>
              <button type="button" className={props.sortRules[0]?.key === "today" && props.sortRules[0]?.direction === "desc" ? "active" : ""} onClick={prioritizeToday}>今日することを最優先</button>
              <div className="task-sort-rules">{props.sortRules.map((rule, index) => <div key={rule.id}>
                <b>{index + 1}</b>
                <select value={rule.key} onChange={(event) => props.onSortRules(props.sortRules.map((item) => item.id === rule.id ? { ...item, key: event.target.value as TaskSortKey } : item))}>{Object.entries(sortLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>
                <select aria-label={`${sortLabels[rule.key]}の方向`} value={rule.direction} onChange={(event) => props.onSortRules(props.sortRules.map((item) => item.id === rule.id ? { ...item, direction: event.target.value as "asc" | "desc" } : item))}><option value="asc">昇順</option><option value="desc">降順</option></select>
                <button type="button" disabled={index === 0} onClick={() => moveSortRule(index, -1)}>↑</button><button type="button" disabled={index === props.sortRules.length - 1} onClick={() => moveSortRule(index, 1)}>↓</button><button type="button" aria-label={`${sortLabels[rule.key]}を削除`} onClick={() => props.onSortRules(props.sortRules.filter((item) => item.id !== rule.id))}>×</button>
              </div>)}</div>
              {props.sortRules.length < Object.keys(sortLabels).length && <button type="button" onClick={() => { const key = (Object.keys(sortLabels) as TaskSortKey[]).find((candidate) => !props.sortRules.some((rule) => rule.key === candidate)); if (key) props.onSortRules([...props.sortRules, { id: `sort-${Date.now()}`, key, direction: key === "dueDate" || key === "title" || key === "priority" ? "asc" : "desc" }]); }}>＋ 並び替え条件を追加</button>}
            <footer><button type="button" className="primary" onClick={() => setSortEditorOpen(false)}>設定を反映</button></footer>
          </div></Modal>}
          <details className="saved-views">
          <summary><span>保存済みビュー</span><small>{props.savedViews.length}件</small></summary>
          <div className="saved-views-panel">
            <form onSubmit={(event) => { event.preventDefault(); const name = viewName.trim(); if (!name) return; props.onSaveView(name); setViewName(""); }}>
              <input value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="現在の表示に名前を付ける" />
              <button type="submit" disabled={!viewName.trim()}>保存</button>
            </form>
            <div className="saved-view-list">
              {props.savedViews.map((view) => <div key={view.id}><button type="button" className="saved-view-apply" onClick={() => props.onApplyView(view)}><strong>{view.name}</strong><small>{[view.tagFilter === "all" ? "" : view.tagFilter === "none" ? "タグなし" : props.tags.find((tag) => tag.id === view.tagFilter)?.name || "削除済みタグ", view.priorityFilter === "all" ? "" : `優先度${view.priorityFilter}`, view.search ? `「${view.search}」` : "", view.sortRules?.length ? `並び替え${view.sortRules.length}条件` : ""].filter(Boolean).join("・") || "表示条件"}</small></button><button type="button" className="saved-view-delete" title={`${view.name}を削除`} aria-label={`${view.name}を削除`} onClick={() => props.onDeleteView(view.id)}>×</button></div>)}
              {!props.savedViews.length && <p>保存されたビューはありません。</p>}
            </div>
          </div>
          </details>
        </div>}
        <button className="secondary full" onClick={props.onToday}>今日のページ</button>
      </div>
      <div className="task-list">
        {props.groupByTag && <section className={`task-tag-group task-today-shortcut ${todayShortcutCollapsed ? "collapsed" : ""}`}>
          <div className="task-tag-group-top">
            <button type="button" className="task-tag-group-header" aria-expanded={!todayShortcutCollapsed} onClick={() => toggleTagGroup(todayShortcutKey)}>
              <span className="task-tag-group-arrow" aria-hidden="true">{todayShortcutCollapsed ? "▶" : "▼"}</span>
              <span className="task-today-shortcut-icon" aria-hidden="true">✓</span>
              <strong>今日すること</strong>
              <small>{todayShortcutTasks.length}件</small>
            </button>
          </div>
          {!todayShortcutCollapsed && <div className="task-tag-group-items">
            {todayShortcutTasks.map((task) => renderTask(task, false, true))}
            {!todayShortcutTasks.length && <p className="task-today-shortcut-empty">今日することはありません</p>}
          </div>}
        </section>}
        {props.groupByTag ? groups.map((group) => {
          const groupKey = group.id || "untagged";
          const collapsed = collapsedTagGroups.has(groupKey);
          return <section className={`task-tag-group ${collapsed ? "collapsed" : ""}`} key={groupKey}>
            <div className="task-tag-group-top">
              <button type="button" className="task-tag-group-header" aria-expanded={!collapsed} onClick={() => toggleTagGroup(groupKey)}>
                <span className="task-tag-group-arrow" aria-hidden="true">{collapsed ? "▶" : "▼"}</span>
                {group.id && props.tags.some((tag) => tag.id === group.id)
                  ? <TagIcon tag={props.tags.find((tag) => tag.id === group.id)!} className="task-tag-group-icon" />
                  : <span className="task-tag-group-mark" style={{ backgroundColor: group.color }} aria-hidden="true" />}
                <strong>{group.name}</strong>
                <small>{group.tasks.length}件</small>
              </button>
              {(!group.id || props.tags.some((tag) => tag.id === group.id)) && <button type="button" className="task-tag-group-add" aria-label={`${group.name}にタスクを追加`} title={`${group.name}にタスクを追加`} onClick={() => props.onCreate(group.id)}>＋<span>追加</span></button>}
            </div>
            {!collapsed && <div className="task-tag-group-items">{group.tasks.map((task) => renderTask(task, true))}</div>}
          </section>;
        }) : visibleTasks.map((task) => renderTask(task))}
        {!props.tasks.length && <div className="empty-list">該当するタスクはありません</div>}
      </div>
      <button
        type="button"
        className="sidebar-new-task-fab"
        aria-label="新規タスクを追加"
        title="新規タスクを追加"
        onClick={() => props.onCreate()}
      >
        ＋
      </button>
    </aside>
  );
}
