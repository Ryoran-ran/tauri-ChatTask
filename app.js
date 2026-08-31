// --- 定数定義 ---
const STATUSES = {
    'todo': { label: '未対応', color: 'bg-gray-200 text-gray-700' },
    'doing': { label: '進行中', color: 'bg-blue-100 text-blue-700' },
    'waiting-general': { label: '待ち', color: 'bg-amber-100 text-amber-700' },
    'waiting-client': { label: '先方確認待ち', color: 'bg-orange-100 text-orange-700' },
    'waiting-team': { label: 'チーム確認待ち', color: 'bg-yellow-100 text-yellow-700' },
    'waiting-pr': { label: 'PR確認待ち', color: 'bg-purple-100 text-purple-700' },
    'waiting-staging': { label: '検証環境確認待ち', color: 'bg-pink-100 text-pink-700' },
    'waiting-prod': { label: '本番反映待ち', color: 'bg-red-100 text-red-700' },
    'recurring': { label: '定期タスク', color: 'bg-cyan-100 text-cyan-700' },
    'done': { label: '完了', color: 'bg-green-100 text-green-700' },
    'pending': { label: '保留', color: 'bg-slate-200 text-slate-700' },
};

const STATUS_CATEGORIES = [
    { label: '未着手', statuses: ['todo'] },
    { label: '進行中', statuses: ['doing', 'recurring'] },
    { label: '待機', statuses: ['waiting-general', 'waiting-client', 'waiting-team', 'waiting-pr', 'waiting-staging', 'waiting-prod', 'pending'] },
    { label: '完了', statuses: ['done'] }
];

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

const PRIORITIES = {
    'A': { label: 'A', value: 4, color: 'text-red-600 font-bold' },
    'B': { label: 'B', value: 3, color: 'text-green-600 font-bold' },
    'C': { label: 'C', value: 2, color: 'text-blue-600 font-bold' },
    'D': { label: 'D', value: 1, color: 'text-purple-600 font-bold' }
};

const FILTERS = [
    { id: 'all', label: '未完了' },
    { id: 'all-with-done', label: 'すべて' },
    { id: 'today', label: '今日やる' },
    { id: 'my-turn', label: '進行中' },
    { id: 'waiting', label: '待ち' },
    { id: 'deadline', label: '期限/リマインドあり' },
    { id: 'done', label: '完了' }
];

const DEFAULT_PROJECT_TAGS = [
    { id: 'project', name: '案件', visible: true },
    { id: 'admin', name: '事務作業', visible: true }
];

// --- 状態管理 ---
let tasks = [];
let projectTags = [];
let activityLog = [];
let dailyNotes = {};
let nonWorkingPeriods = [];
let ganttAnchorDate = toDateInputValue(new Date());
let currentTaskId = null;
let currentTaskDocumentId = null;
let currentFilter = FILTERS.some(filter => filter.id === localStorage.getItem('chatTaskCurrentFilter')) ? localStorage.getItem('chatTaskCurrentFilter') : 'all';
let currentTagFilter = localStorage.getItem('chatTaskCurrentTagFilter') || 'all';
let searchQuery = '';
let isDetailsHidden = localStorage.getItem('chatTaskDetailsHidden') === 'true';
let isRecurringTasksHidden = localStorage.getItem('chatTaskRecurringTasksHidden') === 'true';
let openTodayOnStartup = localStorage.getItem('chatTaskOpenTodayOnStartup') === 'true';
let isNarrowTaskList = localStorage.getItem('chatTaskListNarrow') === 'true';
const savedTaskCardDensity = localStorage.getItem('chatTaskCardsCompact');
let taskCardDensity = ['standard', 'compact', 'minimal'].includes(savedTaskCardDensity) ? savedTaskCardDensity :
    savedTaskCardDensity === 'false' ? 'standard' : 'compact';
let collapsedTaskIds = new Set();
try {
    const savedCollapsedIds = JSON.parse(localStorage.getItem('chatTaskCollapsedIds') || '[]');
    if (Array.isArray(savedCollapsedIds)) collapsedTaskIds = new Set(savedCollapsedIds);
} catch (error) {
    console.error('Collapsed task data parse error', error);
}

// --- ユーティリティ関数 ---
const escapeHTML = (str) => {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag])
    );
};

const formatDate = (isoString, includeTime = true) => {
    if (!isoString) return '';
    const d = new Date(isoString);
    const dateStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
    if (!includeTime) return dateStr;
    return `${dateStr} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

const generateId = () => Math.random().toString(36).substr(2, 9);

const renderMarkdown = (text) => {
    const rawHtml = marked.parse(text);
    const cleanHtml = DOMPurify.sanitize(rawHtml);
    const template = document.createElement('template');
    template.innerHTML = cleanHtml;

    template.content.querySelectorAll('a').forEach(link => {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
    });

    return template.innerHTML;
};

function init() {
    applyTaskListWidth();
    applyTaskCardDensity();
    document.getElementById('hideRecurringTasksCheck').checked = isRecurringTasksHidden;
    document.getElementById('openTodayOnStartupCheck').checked = openTodayOnStartup;
    // marked.jsの設定 (GitHub風の改行を有効にする)
    if (typeof marked !== 'undefined') {
        marked.setOptions({
            breaks: true,
            gfm: true
        });
    }

    // ステータスセレクトの初期化
    const statusSelect = document.getElementById('statusSelect');
    statusSelect.innerHTML = STATUS_CATEGORIES.map(category =>
        `<optgroup label="${category.label}">${category.statuses.map(statusId =>
            `<option value="${statusId}">${STATUSES[statusId].label}</option>`
        ).join('')}</optgroup>`
    ).join('');

    // フィルターボタンの初期化
    const filterContainer = document.getElementById('filterContainer');
    filterContainer.innerHTML = FILTERS.map(f => `
        <button onclick="setFilter('${f.id}')" id="filterBtn_${f.id}" class="px-2 py-1 text-xs rounded-full border transition-colors ${currentFilter === f.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'}">
            ${f.label}
        </button>
    `).join('');

    // イベントリスナーの登録
    document.getElementById('searchInput').addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderTaskList();
    });

    // Enterは改行、Command/Ctrl+Enterで記録
    const chatInput = document.getElementById('chatInput');
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) {
            e.preventDefault();
            submitChat(e);
        }
    });
    chatInput.addEventListener('input', resizeChatInput);
    ['taskDocumentTitleInput', 'taskDocumentContentInput'].forEach(id => {
        document.getElementById(id).addEventListener('keydown', event => {
            if (event.key.toLowerCase() === 's' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                saveCurrentTaskDocument();
            }
        });
    });
    document.addEventListener('click', event => {
        const menu = document.getElementById('headerSettingsMenu');
        if (menu && !menu.contains(event.target)) closeHeaderMenu();
    });

    // 属性変更時の自動保存リスナー
    const bindSave = (id, field, isCheckbox = false) => {
        document.getElementById(id).addEventListener('change', (e) => {
            if (!currentTaskId) return;
            const task = tasks.find(t => t.id === currentTaskId);
            const oldVal = task[field];
            const newVal = isCheckbox ? e.target.checked : e.target.value;
            
            if (oldVal !== newVal) {
                if (field === 'status' && oldVal === 'recurring' && newVal === 'done') {
                    alert('定期タスク本体は完了にできません。「今日のページ」から今回分を実施済みにしてください。');
                    e.target.value = oldVal;
                    return;
                }
                task[field] = newVal;
                task.updatedAt = new Date().toISOString();
                recordActivity(task, 'field-change', `${getFieldLabel(field)}を変更`, {
                    field,
                    oldValue: getFieldDisplayValue(field, oldVal),
                    newValue: getFieldDisplayValue(field, newVal)
                }, task.updatedAt);
                
                // ステータスが完了になったら完了日をセット
                if (field === 'status') {
                    if (newVal === 'done') {
                        task.completedAt = new Date().toISOString();
                    } else {
                        task.completedAt = null;
                    }
                    if (newVal === 'recurring') ensureRecurrenceSettings(task);
                }

                // 変更履歴を追加（履歴に残す項目のみ）
                if (field === 'status') {
                    addHistoryEvent(task, 'system', `ステータスを「${STATUSES[oldVal]?.label}」から「${STATUSES[newVal].label}」に変更しました。`);
                } else if (field === 'priority') {
                    addHistoryEvent(task, 'system', `優先度を「${PRIORITIES[oldVal]?.label}」から「${PRIORITIES[newVal].label}」に変更しました。`);
                } else if (field === 'reminderDate') {
                    addHistoryEvent(task, 'system', `リマインド日を「${newVal || 'なし'}」に変更しました。`);
                }

                saveData();
                renderTaskList();
                if (field === 'status' || field === 'priority' || field === 'reminderDate') {
                    renderChatHistory();
                }
                if (field === 'status') renderRecurringSettings(task);
            }
        });
    };

    bindSave('taskTitleInput', 'title');
    bindSave('statusSelect', 'status');
    bindSave('prioritySelect', 'priority');
    bindSave('reminderDateInput', 'reminderDate');
    bindSave('projectTagSelect', 'projectTagId');
    bindSave('parentTaskSelect', 'parentTaskId');
    bindSave('taskDescriptionInput', 'description');
    bindSave('nextActionInput', 'nextAction');

    ['recurrenceFrequencySelect', 'recurrenceWeekdaySelect', 'recurrenceMonthDayInput', 'recurrenceStartDateInput', 'recurrenceEndDateInput', 'recurrencePausedCheck'].forEach(id => {
        document.getElementById(id).addEventListener('change', updateRecurrenceSettings);
    });

    if (localStorage.getItem('chatTaskSearchFiltersHidden') === 'true') {
        toggleSearchFilters();
    }
    loadData();
    if (openTodayOnStartup) setTimeout(openTodayPage, 0);
}

function closeHeaderMenu() {
    document.getElementById('headerSettingsPanel')?.classList.add('hidden');
    document.getElementById('headerSettingsButton')?.setAttribute('aria-expanded', 'false');
}

function toggleHeaderMenu() {
    const panel = document.getElementById('headerSettingsPanel');
    const button = document.getElementById('headerSettingsButton');
    if (!panel || !button) return;
    const willOpen = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !willOpen);
    button.setAttribute('aria-expanded', String(willOpen));
}

function setRecurringTasksHidden(hidden) {
    isRecurringTasksHidden = hidden;
    localStorage.setItem('chatTaskRecurringTasksHidden', String(hidden));
    renderTaskList();
}

function setOpenTodayOnStartup(enabled) {
    openTodayOnStartup = enabled;
    localStorage.setItem('chatTaskOpenTodayOnStartup', String(enabled));
}

function toggleAttributeGroup(groupName) {
    const fields = [...document.querySelectorAll(`[data-attribute-group="${groupName}"]`)];
    if (!fields.length) return;
    const willHide = !fields[0].classList.contains('attribute-group-collapsed');
    fields.forEach(field => field.classList.toggle('attribute-group-collapsed', willHide));
    const icon = document.querySelector(`[data-attribute-icon="${groupName}"]`);
    if (icon) {
        icon.textContent = willHide ? '▶' : '▼';
        icon.closest('button')?.setAttribute('aria-expanded', String(!willHide));
    }
}

function loadData() {
    const saved = localStorage.getItem('chatTasksData');
    if (saved) {
        try {
            tasks = JSON.parse(saved);
            normalizeTaskStatuses();
            normalizeTaskPriorities();
            normalizeTaskRelationships();
            saveData();
        } catch (e) {
            console.error('Data parse error', e);
            tasks = [];
        }
    }
    const savedTags = localStorage.getItem('chatTaskProjectTags');
    if (savedTags) {
        try {
            projectTags = JSON.parse(savedTags);
        } catch (e) {
            console.error('Tag data parse error', e);
            projectTags = DEFAULT_PROJECT_TAGS.map(tag => ({ ...tag }));
        }
    } else {
        projectTags = DEFAULT_PROJECT_TAGS.map(tag => ({ ...tag }));
        saveProjectTags();
    }
    const savedActivityLog = localStorage.getItem('chatTaskActivityLog');
    if (savedActivityLog) {
        try {
            activityLog = JSON.parse(savedActivityLog);
            if (!Array.isArray(activityLog)) activityLog = [];
        } catch (e) {
            console.error('Activity log parse error', e);
            activityLog = [];
        }
    }
    const savedDailyNotes = localStorage.getItem('chatTaskDailyNotes');
    if (savedDailyNotes) {
        try {
            dailyNotes = JSON.parse(savedDailyNotes) || {};
        } catch (e) {
            console.error('Daily notes parse error', e);
            dailyNotes = {};
        }
    }
    const savedNonWorkingPeriods = localStorage.getItem('chatTaskNonWorkingPeriods');
    if (savedNonWorkingPeriods) {
        try {
            const parsedPeriods = JSON.parse(savedNonWorkingPeriods);
            nonWorkingPeriods = Array.isArray(parsedPeriods) ? parsedPeriods.filter(period => period?.startDate && period?.endDate && period.startDate <= period.endDate) : [];
        } catch (e) {
            console.error('Non-working period parse error', e);
            nonWorkingPeriods = [];
        }
    }
    migrateExistingHistoryToActivityLog();
    renderTagControls();
    renderTaskList();
}

function saveData() {
    localStorage.setItem('chatTasksData', JSON.stringify(tasks));
}

function saveActivityLog() {
    localStorage.setItem('chatTaskActivityLog', JSON.stringify(activityLog));
}

function getFieldLabel(field) {
    return ({
        title: 'タスク名', status: 'ステータス', priority: '優先度', reminderDate: 'リマインド日',
        isToday: '今日やる', plannedDate: '予定日', plannedDates: '予定日', plannedRanges: '予定期間', projectTagId: '案件タグ', parentTaskId: '親タスク',
        description: '説明', nextAction: '次に動く条件'
    })[field] || field;
}

function getFieldDisplayValue(field, value) {
    if (field === 'status') return STATUSES[value]?.label || value || 'なし';
    if (field === 'priority') return PRIORITIES[value]?.label || value || 'なし';
    if (field === 'projectTagId') return projectTags.find(tag => tag.id === value)?.name || 'タグなし';
    if (field === 'parentTaskId') return tasks.find(task => task.id === value)?.title || '親タスクなし';
    if (field === 'isToday') return value ? '有効' : '無効';
    return value || 'なし';
}

function recordActivity(task, type, summary, details = {}, timestamp = new Date().toISOString(), sourceHistoryId = null) {
    activityLog.push({
        id: generateId(),
        taskId: task?.id || null,
        taskTitle: task?.title || '無題のタスク',
        projectTagId: task?.projectTagId || '',
        type,
        summary,
        details,
        timestamp,
        sourceHistoryId
    });
    saveActivityLog();
}

function migrateExistingHistoryToActivityLog(force = false) {
    if (!force && localStorage.getItem('chatTaskActivityMigrationV1') === 'done') return;
    const importedHistoryIds = new Set(activityLog.map(event => event.sourceHistoryId).filter(Boolean));
    let migrated = false;
    tasks.forEach(task => {
        (task.history || []).forEach(history => {
            if (!history.id || importedHistoryIds.has(history.id)) return;
            activityLog.push({
                id: generateId(), taskId: task.id, taskTitle: task.title || '無題のタスク',
                projectTagId: task.projectTagId || '', type: history.type === 'comment' ? 'memo' : 'history',
                summary: history.type === 'comment' ? 'メモを追加' : history.text,
                details: history.type === 'comment' ? { text: history.text } : {},
                timestamp: history.timestamp || task.updatedAt || new Date().toISOString(), sourceHistoryId: history.id
            });
            importedHistoryIds.add(history.id);
            migrated = true;
        });
    });
    if (migrated) saveActivityLog();
    localStorage.setItem('chatTaskActivityMigrationV1', 'done');
}

function normalizeTaskPriorities() {
    const legacyPriorities = { high: 'A', medium: 'B', low: 'C' };
    tasks.forEach(task => {
        if (legacyPriorities[task.priority]) task.priority = legacyPriorities[task.priority];
        if (!PRIORITIES[task.priority]) task.priority = 'B';
    });
}

function normalizeTaskStatuses() {
    tasks.forEach(task => {
        if (task.status === 'doing-me') task.status = 'doing';
    });
}

function addDaysToDateValue(dateValue, days) {
    const date = new Date(`${dateValue}T00:00:00`);
    date.setDate(date.getDate() + days);
    return toDateInputValue(date);
}

function groupDatesIntoRanges(dates) {
    const sortedDates = [...new Set(dates.filter(Boolean))].sort();
    const ranges = [];
    sortedDates.forEach(date => {
        const lastRange = ranges[ranges.length - 1];
        if (lastRange && addDaysToDateValue(lastRange.endDate, 1) === date) lastRange.endDate = date;
        else ranges.push({ id: generateId(), startDate: date, endDate: date });
    });
    return ranges;
}

function mergePlannedRanges(ranges) {
    const merged = [];
    [...ranges].sort((a, b) => a.startDate.localeCompare(b.startDate)).forEach(range => {
        const lastRange = merged[merged.length - 1];
        if (lastRange && range.startDate <= addDaysToDateValue(lastRange.endDate, 1)) {
            if (range.endDate > lastRange.endDate) lastRange.endDate = range.endDate;
        } else merged.push({ id: range.id || generateId(), startDate: range.startDate, endDate: range.endDate });
    });
    return merged;
}

function isTaskPlannedForDate(task, dateValue) {
    return (task.plannedRanges || []).some(range => range.startDate <= dateValue && range.endDate >= dateValue);
}

function isTaskPendingForDate(task, dateValue) {
    return isTaskPlannedForDate(task, dateValue) && !task.dailyPlanCompleted?.[dateValue];
}

function getTaskPlannedRangeLabel(task) {
    return (task.plannedRanges || []).map(range => range.startDate === range.endDate ? range.startDate : `${range.startDate}〜${range.endDate}`).join(', ');
}

function getTaskScheduleDates(task, limit = 730) {
    const dates = [];
    let truncated = false;
    for (const range of task.plannedRanges || []) {
        let date = range.startDate;
        while (date <= range.endDate) {
            if (dates.length >= limit) {
                truncated = true;
                return { dates, truncated };
            }
            dates.push(date);
            date = addDaysToDateValue(date, 1);
        }
    }
    return { dates, truncated };
}

function renderTaskDailyPlans(task) {
    const panel = document.getElementById('dailyPlansPanel');
    const list = document.getElementById('dailyPlansList');
    panel.classList.toggle('hidden', task.status === 'recurring');
    if (task.status === 'recurring') return;
    const { dates, truncated } = getTaskScheduleDates(task);
    if (dates.length === 0) {
        list.innerHTML = '<p class="text-xs text-gray-400 py-2">予定日または予定期間を追加すると、日付別の計画を入力できます。</p>';
        return;
    }
    list.innerHTML = dates.map(date => `
        <div class="grid grid-cols-[7rem_1fr_auto] gap-2 items-start ${task.dailyPlanCompleted?.[date] ? 'opacity-70' : ''}">
            <label class="text-xs font-medium text-gray-600 pt-2" for="dailyPlan_${date}">${date}</label>
            <textarea id="dailyPlan_${date}" data-task-daily-plan-date="${date}" rows="2" class="w-full border border-gray-300 bg-white rounded p-2 text-xs resize-y focus:ring-blue-500 focus:border-blue-500 ${task.dailyPlanCompleted?.[date] ? 'line-through text-gray-500' : ''}" placeholder="この日に対応する内容...">${escapeHTML(task.dailyPlans?.[date] || '')}</textarea>
            <div class="flex flex-col items-start gap-1 pt-2">
                <label class="inline-flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                    <input type="checkbox" data-task-daily-plan-completed="${date}" ${task.dailyPlanCompleted?.[date] ? 'checked' : ''} class="rounded border-gray-300 text-green-600 focus:ring-green-500">
                    達成
                </label>
                <button type="button" data-delete-daily-plan-date="${date}" class="text-[11px] text-red-600 hover:text-red-800">削除</button>
            </div>
        </div>
    `).join('') + (truncated ? '<p class="text-xs text-orange-600">長期間のため先頭730日分を表示しています。それ以降は「今日のページ」から入力できます。</p>' : '');
    list.querySelectorAll('[data-task-daily-plan-date]').forEach(input => {
        input.addEventListener('change', () => setTaskDailyPlan(task.id, input.dataset.taskDailyPlanDate, input.value));
    });
    list.querySelectorAll('[data-task-daily-plan-completed]').forEach(input => {
        input.addEventListener('change', () => setTaskDailyPlanCompleted(task.id, input.dataset.taskDailyPlanCompleted, input.checked, true));
    });
    list.querySelectorAll('[data-delete-daily-plan-date]').forEach(button => {
        button.addEventListener('click', () => deleteTaskDailyPlanDate(task.id, button.dataset.deleteDailyPlanDate));
    });
}

function deleteTaskDailyPlanDate(taskId, dateValue) {
    const task = tasks.find(item => item.id === taskId);
    if (!task || !isTaskPlannedForDate(task, dateValue)) return;
    if (!confirm(`${dateValue}の日別計画を削除しますか？\nこの日を予定から外し、対応内容と達成チェックも削除します。`)) return;

    const nextRanges = [];
    (task.plannedRanges || []).forEach(range => {
        if (dateValue < range.startDate || dateValue > range.endDate) {
            nextRanges.push(range);
        } else if (range.startDate === dateValue && range.endDate === dateValue) {
            return;
        } else if (range.startDate === dateValue) {
            nextRanges.push({ ...range, startDate: addDaysToDateValue(dateValue, 1) });
        } else if (range.endDate === dateValue) {
            nextRanges.push({ ...range, endDate: addDaysToDateValue(dateValue, -1) });
        } else {
            nextRanges.push({ id: range.id, startDate: range.startDate, endDate: addDaysToDateValue(dateValue, -1) });
            nextRanges.push({ id: generateId(), startDate: addDaysToDateValue(dateValue, 1), endDate: range.endDate });
        }
    });
    task.plannedRanges = nextRanges;
    if (task.dailyPlans) delete task.dailyPlans[dateValue];
    if (task.dailyPlanCompleted) delete task.dailyPlanCompleted[dateValue];
    task.isToday = isTaskPlannedForDate(task, toDateInputValue(new Date()));
    task.updatedAt = new Date().toISOString();
    recordActivity(task, 'daily-plan-date-deleted', '日別計画の日付を削除', { date: dateValue }, task.updatedAt);
    saveData();
    renderPlannedDates(task);
    renderTaskDailyPlans(task);
    renderTaskList();
}

function setTaskDailyPlan(taskId, dateValue, value) {
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;
    task.dailyPlans = task.dailyPlans || {};
    const oldValue = task.dailyPlans[dateValue] || '';
    const newValue = value.trim();
    if (oldValue === newValue) return;
    if (newValue) task.dailyPlans[dateValue] = newValue;
    else delete task.dailyPlans[dateValue];
    task.updatedAt = new Date().toISOString();
    recordActivity(task, 'daily-plan-updated', newValue ? '日別計画を更新' : '日別計画を削除', {
        date: dateValue, text: newValue || oldValue
    }, task.updatedAt);
    saveData();
    renderTaskList();
}

function setTaskDailyPlanCompleted(taskId, dateValue, completed, rerenderDetails = false) {
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;
    task.dailyPlanCompleted = task.dailyPlanCompleted || {};
    if (completed) task.dailyPlanCompleted[dateValue] = true;
    else delete task.dailyPlanCompleted[dateValue];
    task.updatedAt = new Date().toISOString();
    recordActivity(task, completed ? 'daily-plan-completed' : 'daily-plan-reopened', completed ? '日別計画を達成' : '日別計画を未達成に戻す', {
        date: dateValue, text: task.dailyPlans?.[dateValue] || ''
    }, task.updatedAt);
    saveData();
    renderTaskList();
    if (rerenderDetails && currentTaskId === taskId) renderTaskDailyPlans(task);
}

function normalizeTaskRelationships() {
    const taskIds = new Set(tasks.map(task => task.id));
    const today = toDateInputValue(new Date());
    tasks.forEach(task => {
        task.links = Array.isArray(task.links) ? task.links.map(link => {
            const url = link?.url ? normalizeLinkUrl(link.url) : null;
            return url ? { id: link.id || generateId(), label: link.label || '', url } : null;
        }).filter(Boolean) : [];
        const legacyDate = task.plannedDate || (task.isToday ? today : '');
        if (Array.isArray(task.plannedRanges)) {
            task.plannedRanges = mergePlannedRanges(task.plannedRanges.filter(range => range?.startDate && range?.endDate && range.startDate <= range.endDate).map(range => ({
                id: range.id || generateId(), startDate: range.startDate, endDate: range.endDate
            })));
        } else {
            const legacyDates = Array.isArray(task.plannedDates) ? task.plannedDates : legacyDate ? [legacyDate] : [];
            task.plannedRanges = groupDatesIntoRanges(legacyDates);
        }
        delete task.plannedDate;
        delete task.plannedDates;
        task.isToday = isTaskPlannedForDate(task, today);
        task.recurrenceRecords = Array.isArray(task.recurrenceRecords) ? task.recurrenceRecords : [];
        task.dailyPlans = task.dailyPlans && typeof task.dailyPlans === 'object' && !Array.isArray(task.dailyPlans) ? task.dailyPlans : {};
        task.dailyPlanCompleted = task.dailyPlanCompleted && typeof task.dailyPlanCompleted === 'object' && !Array.isArray(task.dailyPlanCompleted) ? task.dailyPlanCompleted : {};
        task.documents = Array.isArray(task.documents) ? task.documents.filter(document => document && document.id).map(document => ({
            id: document.id,
            title: String(document.title || '無題のドキュメント'),
            content: String(document.content || ''),
            createdAt: document.createdAt || task.createdAt || new Date().toISOString(),
            updatedAt: document.updatedAt || task.updatedAt || new Date().toISOString()
        })) : [];
        if (task.status === 'recurring') ensureRecurrenceSettings(task);
        if (!task.parentTaskId || task.parentTaskId === task.id || !taskIds.has(task.parentTaskId)) {
            task.parentTaskId = '';
        }
    });
}

function saveProjectTags() {
    localStorage.setItem('chatTaskProjectTags', JSON.stringify(projectTags));
}

function saveNonWorkingPeriods() {
    localStorage.setItem('chatTaskNonWorkingPeriods', JSON.stringify(nonWorkingPeriods));
}

function renderTagControls() {
    const visibleTags = projectTags.filter(tag => tag.visible);
    const currentTask = tasks.find(task => task.id === currentTaskId);
    const hiddenAssignedTag = projectTags.find(tag => tag.id === currentTask?.projectTagId && !tag.visible);
    const tagSelect = document.getElementById('projectTagSelect');
    const tagFilter = document.getElementById('tagFilterSelect');

    tagSelect.innerHTML = '<option value="">タグなし</option>' + visibleTags.map(tag =>
        `<option value="${tag.id}">${escapeHTML(tag.name)}</option>`
    ).join('') + (hiddenAssignedTag ? `<option value="${hiddenAssignedTag.id}">${escapeHTML(hiddenAssignedTag.name)}（非表示）</option>` : '');
    tagSelect.value = currentTask?.projectTagId || '';

    tagFilter.innerHTML = '<option value="all">すべての案件タグ</option><option value="none">タグなし</option>' + visibleTags.map(tag =>
        `<option value="${tag.id}">${escapeHTML(tag.name)}</option>`
    ).join('');

    if (currentTagFilter !== 'all' && !tagFilter.querySelector(`option[value="${currentTagFilter}"]`)) {
        currentTagFilter = 'all';
    }
    tagFilter.value = currentTagFilter;
}

function setTagFilter(tagId) {
    currentTagFilter = tagId;
    localStorage.setItem('chatTaskCurrentTagFilter', tagId);
    renderTaskList();
}

function toDateInputValue(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getNonWorkingPeriodForDate(dateValue) {
    const configuredPeriod = nonWorkingPeriods.find(period => period.startDate <= dateValue && period.endDate >= dateValue);
    if (configuredPeriod) return configuredPeriod;
    const date = new Date(`${dateValue}T00:00:00`);
    if ([0, 6].includes(date.getDay())) {
        return { id: `weekend-${dateValue}`, startDate: dateValue, endDate: dateValue, type: 'weekend', note: '', automatic: true };
    }
    return null;
}

function isNonWorkingDate(dateValue) {
    return Boolean(getNonWorkingPeriodForDate(dateValue));
}

function getNonWorkingTypeLabel(type) {
    return ({ vacation: '休暇', holiday: '祝日', other: '非稼働日', weekend: '土日休暇' })[type] || '非稼働日';
}

function openNonWorkingSettings() {
    renderNonWorkingPeriods();
    resetNonWorkingForm();
    document.getElementById('holidayImportYear').value = new Date().getFullYear();
    document.getElementById('holidayImportStatus').textContent = '';
    const modal = document.getElementById('nonWorkingSettingsModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeNonWorkingSettings(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('nonWorkingSettingsModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function renderNonWorkingPeriods() {
    const list = document.getElementById('nonWorkingPeriodsList');
    if (nonWorkingPeriods.length === 0) {
        list.innerHTML = '<p class="text-sm text-gray-400 text-center py-5">休暇・非稼働日はまだありません。</p>';
        return;
    }
    const today = toDateInputValue(new Date());
    const sorted = [...nonWorkingPeriods].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const currentPeriods = sorted.filter(period => period.endDate >= today);
    const pastPeriods = sorted.filter(period => period.endDate < today).reverse();
    const renderPeriod = period => {
        const dateLabel = period.startDate === period.endDate ? period.startDate : `${period.startDate}〜${period.endDate}`;
        return `
            <div class="flex flex-wrap items-center gap-3 p-3 border border-gray-200 rounded-lg">
                <span class="px-2 py-1 text-xs rounded-full bg-purple-100 text-purple-700 shrink-0">${getNonWorkingTypeLabel(period.type)}</span>
                <span class="text-sm font-medium text-gray-700 shrink-0">${dateLabel}</span>
                <span class="text-sm text-gray-500 flex-1 min-w-0 truncate">${escapeHTML(period.note || '')}</span>
                <button type="button" data-edit-non-working="${period.id}" class="text-xs text-blue-600 hover:text-blue-800">編集</button>
                <button type="button" data-delete-non-working="${period.id}" class="text-xs text-red-600 hover:text-red-800">削除</button>
            </div>
        `;
    };
    list.innerHTML = (currentPeriods.length ? currentPeriods.map(renderPeriod).join('') : '<p class="text-sm text-gray-400 text-center py-3">今後の休暇・非稼働日はありません。</p>') +
        (pastPeriods.length ? `<details class="mt-3"><summary class="cursor-pointer text-sm text-gray-500 hover:text-gray-700">過去の休暇・非稼働日 ${pastPeriods.length}件</summary><div class="space-y-2 mt-2">${pastPeriods.map(renderPeriod).join('')}</div></details>` : '');
    list.querySelectorAll('[data-edit-non-working]').forEach(button => {
        button.addEventListener('click', () => editNonWorkingPeriod(button.dataset.editNonWorking));
    });
    list.querySelectorAll('[data-delete-non-working]').forEach(button => {
        button.addEventListener('click', () => deleteNonWorkingPeriod(button.dataset.deleteNonWorking));
    });
}

function addNonWorkingPeriod(event) {
    event.preventDefault();
    const startDate = document.getElementById('nonWorkingStartDate').value;
    const endDate = document.getElementById('nonWorkingEndDate').value || startDate;
    if (!startDate || endDate < startDate) {
        alert('期間を正しく指定してください。');
        return;
    }
    const editId = document.getElementById('nonWorkingEditId').value;
    if (nonWorkingPeriods.some(period => period.id !== editId && period.startDate <= endDate && period.endDate >= startDate)) {
        alert('指定した期間は既存の休暇・非稼働日と重複しています。');
        return;
    }
    const savedPeriod = {
        id: editId || generateId(), startDate, endDate,
        type: document.getElementById('nonWorkingType').value,
        note: document.getElementById('nonWorkingNote').value.trim()
    };
    if (editId) {
        nonWorkingPeriods = nonWorkingPeriods.map(period => period.id === editId ? savedPeriod : period);
    } else {
        nonWorkingPeriods.push(savedPeriod);
    }
    saveNonWorkingPeriods();
    renderNonWorkingPeriods();
    resetNonWorkingForm();
}

function editNonWorkingPeriod(periodId) {
    const period = nonWorkingPeriods.find(item => item.id === periodId);
    if (!period) return;
    document.getElementById('nonWorkingEditId').value = period.id;
    document.getElementById('nonWorkingStartDate').value = period.startDate;
    document.getElementById('nonWorkingEndDate').value = period.endDate === period.startDate ? '' : period.endDate;
    document.getElementById('nonWorkingType').value = period.type;
    document.getElementById('nonWorkingNote').value = period.note || '';
    document.getElementById('nonWorkingSubmitButton').textContent = '更新';
    document.getElementById('nonWorkingCancelEditButton').classList.remove('hidden');
    document.getElementById('nonWorkingStartDate').focus();
}

function resetNonWorkingForm() {
    document.getElementById('nonWorkingEditId').value = '';
    document.getElementById('nonWorkingStartDate').value = toDateInputValue(new Date());
    document.getElementById('nonWorkingEndDate').value = '';
    document.getElementById('nonWorkingType').value = 'vacation';
    document.getElementById('nonWorkingNote').value = '';
    document.getElementById('nonWorkingSubmitButton').textContent = '追加';
    document.getElementById('nonWorkingCancelEditButton').classList.add('hidden');
}

async function importJapaneseHolidays() {
    const yearInput = document.getElementById('holidayImportYear');
    const button = document.getElementById('holidayImportButton');
    const status = document.getElementById('holidayImportStatus');
    const year = Number(yearInput.value);
    if (!Number.isInteger(year) || year < 1955 || year > 2100) {
        alert('1955〜2100年の範囲で年を指定してください。');
        return;
    }

    button.disabled = true;
    button.textContent = '取得中...';
    status.textContent = '';
    try {
        const response = await fetch(`https://holidays-jp.github.io/api/v1/${year}/date.json`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const holidayData = await response.json();
        const holidays = Object.entries(holidayData).filter(([date]) => date.startsWith(`${year}-`));
        if (holidays.length === 0) throw new Error(`${year}年の祝日データがありません`);

        let addedCount = 0;
        let skippedCount = 0;
        holidays.forEach(([date, name]) => {
            const overlapsExisting = nonWorkingPeriods.some(period => period.startDate <= date && period.endDate >= date);
            if (overlapsExisting) {
                skippedCount += 1;
                return;
            }
            nonWorkingPeriods.push({ id: generateId(), startDate: date, endDate: date, type: 'holiday', note: String(name), imported: true });
            addedCount += 1;
        });
        saveNonWorkingPeriods();
        renderNonWorkingPeriods();
        status.textContent = `${addedCount}件追加${skippedCount ? `・${skippedCount}件重複` : ''}`;
    } catch (error) {
        console.error('Holiday import error', error);
        status.textContent = '取得できませんでした';
        alert('祝日データを取得できませんでした。インターネット接続を確認して、もう一度お試しください。');
    } finally {
        button.disabled = false;
        button.textContent = '日本の祝日を取り込む';
    }
}

function deleteNonWorkingPeriod(periodId) {
    const period = nonWorkingPeriods.find(item => item.id === periodId);
    if (!period || !confirm(`${getNonWorkingTypeLabel(period.type)}「${period.startDate}${period.startDate === period.endDate ? '' : `〜${period.endDate}`}」を削除しますか？`)) return;
    nonWorkingPeriods = nonWorkingPeriods.filter(item => item.id !== periodId);
    saveNonWorkingPeriods();
    renderNonWorkingPeriods();
}

function taskHasPastWorkingSchedule(task, beforeDate) {
    for (const range of task.plannedRanges || []) {
        let date = range.startDate;
        const endDate = range.endDate < beforeDate ? range.endDate : addDaysToDateValue(beforeDate, -1);
        while (date <= endDate) {
            if (!isNonWorkingDate(date)) return true;
            date = addDaysToDateValue(date, 1);
        }
    }
    return false;
}

function ensureRecurrenceSettings(task) {
    const today = new Date();
    const existing = task.recurrence || {};
    task.recurrence = {
        frequency: ['daily', 'weekly', 'monthly'].includes(existing.frequency) ? existing.frequency : 'weekly',
        weekday: Number.isInteger(Number(existing.weekday)) ? Number(existing.weekday) : today.getDay(),
        monthDay: Math.min(31, Math.max(1, Number(existing.monthDay) || today.getDate())),
        startDate: existing.startDate || toDateInputValue(today),
        endDate: existing.endDate || '',
        paused: Boolean(existing.paused)
    };
    task.recurrenceRecords = Array.isArray(task.recurrenceRecords) ? task.recurrenceRecords : [];
}

function updateStatusDoneOption(task) {
    const doneOption = document.querySelector('#statusSelect option[value="done"]');
    if (doneOption) doneOption.disabled = task?.status === 'recurring';
}

function renderRecurringSettings(task) {
    const panel = document.getElementById('recurringSettingsPanel');
    const isRecurring = task.status === 'recurring';
    panel.classList.toggle('hidden', !isRecurring);
    document.getElementById('plannedDatesField').classList.toggle('hidden', isRecurring);
    document.getElementById('dailyPlansPanel').classList.toggle('hidden', isRecurring);
    updateStatusDoneOption(task);
    if (!isRecurring) return;

    ensureRecurrenceSettings(task);
    const settings = task.recurrence;
    document.getElementById('recurrenceFrequencySelect').value = settings.frequency;
    document.getElementById('recurrenceWeekdaySelect').value = String(settings.weekday);
    document.getElementById('recurrenceMonthDayInput').value = settings.monthDay;
    document.getElementById('recurrenceStartDateInput').value = settings.startDate;
    document.getElementById('recurrenceEndDateInput').value = settings.endDate;
    document.getElementById('recurrencePausedCheck').checked = settings.paused;
    document.getElementById('recurrenceWeekdayField').classList.toggle('hidden', settings.frequency !== 'weekly');
    document.getElementById('recurrenceMonthDayField').classList.toggle('hidden', settings.frequency !== 'monthly');

    const doneCount = task.recurrenceRecords.filter(record => record.status === 'done').length;
    const skippedCount = task.recurrenceRecords.filter(record => record.status === 'skipped').length;
    const movedCount = task.recurrenceRecords.filter(record => record.status === 'moved').length;
    document.getElementById('recurrenceRecordSummary').textContent = `実施済み ${doneCount}回 / スキップ ${skippedCount}回 / 移動中 ${movedCount}回`;
}

function updateRecurrenceSettings() {
    const task = tasks.find(item => item.id === currentTaskId);
    if (!task || task.status !== 'recurring') return;
    ensureRecurrenceSettings(task);
    const oldSettings = { ...task.recurrence };
    task.recurrence = {
        frequency: document.getElementById('recurrenceFrequencySelect').value,
        weekday: Number(document.getElementById('recurrenceWeekdaySelect').value),
        monthDay: Math.min(31, Math.max(1, Number(document.getElementById('recurrenceMonthDayInput').value) || 1)),
        startDate: document.getElementById('recurrenceStartDateInput').value || toDateInputValue(new Date()),
        endDate: document.getElementById('recurrenceEndDateInput').value,
        paused: document.getElementById('recurrencePausedCheck').checked
    };
    if (task.recurrence.endDate && task.recurrence.endDate < task.recurrence.startDate) {
        alert('終了日は開始日以降にしてください。');
        task.recurrence = oldSettings;
        renderRecurringSettings(task);
        return;
    }
    task.updatedAt = new Date().toISOString();
    recordActivity(task, 'recurrence-updated', '定期設定を変更', { settings: { ...task.recurrence } }, task.updatedAt);
    saveData();
    renderRecurringSettings(task);
    renderTaskList();
}

function isRecurringTaskDue(task, dateValue) {
    if (task.status !== 'recurring') return false;
    ensureRecurrenceSettings(task);
    const settings = task.recurrence;
    if (settings.paused || dateValue < settings.startDate || (settings.endDate && dateValue > settings.endDate)) return false;
    const date = new Date(`${dateValue}T00:00:00`);
    if (settings.frequency === 'daily') return true;
    if (settings.frequency === 'weekly') return date.getDay() === settings.weekday;
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return date.getDate() === Math.min(settings.monthDay, lastDay);
}

function getRecurrenceLabel(task) {
    if (task.status !== 'recurring') return '';
    ensureRecurrenceSettings(task);
    const settings = task.recurrence;
    if (settings.frequency === 'daily') return '毎日';
    if (settings.frequency === 'weekly') return `毎週${WEEKDAY_LABELS[settings.weekday]}曜日`;
    return `毎月${settings.monthDay}日`;
}

function recordRecurringOccurrence(taskId, occurrenceDate, status, actualDate = occurrenceDate) {
    const task = tasks.find(item => item.id === taskId && item.status === 'recurring');
    if (!task) return;
    ensureRecurrenceSettings(task);
    task.recurrenceRecords = task.recurrenceRecords.filter(record => record.date !== occurrenceDate);
    if (status !== 'pending') {
        task.recurrenceRecords.push({ date: occurrenceDate, status, actualDate, timestamp: new Date().toISOString() });
    }
    task.recurrenceRecords.sort((a, b) => a.date.localeCompare(b.date));
    task.updatedAt = new Date().toISOString();
    const summary = status === 'done' ? '定期タスクを実施' : status === 'skipped' ? '定期タスクをスキップ' : '定期タスクの実施記録を取り消し';
    recordActivity(task, `recurrence-${status}`, summary, { date: actualDate, scheduledDate: occurrenceDate }, task.updatedAt);
    saveData();
    renderTaskList();
    renderTodayPage();
    if (currentTaskId === taskId) renderRecurringSettings(task);
}

function moveRecurringOccurrence(taskId, occurrenceDate, currentDate) {
    const task = tasks.find(item => item.id === taskId && item.status === 'recurring');
    if (!task) return;
    document.getElementById('recurrenceMoveTaskId').value = taskId;
    document.getElementById('recurrenceMoveOccurrenceDate').value = occurrenceDate;
    document.getElementById('recurrenceMoveDate').value = addDaysToDateValue(currentDate, 1);
    document.getElementById('recurrenceMoveReason').value = '';
    document.getElementById('recurrenceMoveDescription').textContent = `「${task.title || '無題のタスク'}」の${occurrenceDate}分`;
    updateRecurrenceMoveDateInfo();
    const modal = document.getElementById('recurrenceMoveModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('recurrenceMoveDate').focus();
}

function closeRecurrenceMoveCalendar(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('recurrenceMoveModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function updateRecurrenceMoveDateInfo() {
    const movedTo = document.getElementById('recurrenceMoveDate').value;
    const info = document.getElementById('recurrenceMoveDateInfo');
    if (!movedTo) {
        info.textContent = '';
        return;
    }
    const date = new Date(`${movedTo}T00:00:00`);
    const weekday = date.toLocaleDateString('ja-JP', { weekday: 'long' });
    const nonWorkingPeriod = getNonWorkingPeriodForDate(movedTo);
    info.textContent = `${weekday}${nonWorkingPeriod ? `・${getNonWorkingTypeLabel(nonWorkingPeriod.type)}` : ''}`;
    info.className = `text-xs ${nonWorkingPeriod ? 'text-purple-700 font-medium' : 'text-gray-500'}`;
}

function submitRecurringOccurrenceMove(event) {
    event.preventDefault();
    const taskId = document.getElementById('recurrenceMoveTaskId').value;
    const occurrenceDate = document.getElementById('recurrenceMoveOccurrenceDate').value;
    const movedTo = document.getElementById('recurrenceMoveDate').value;
    const moveReason = document.getElementById('recurrenceMoveReason').value.trim();
    const task = tasks.find(item => item.id === taskId && item.status === 'recurring');
    if (!task || !movedTo) return;
    if (movedTo === occurrenceDate) {
        alert('元の予定日とは異なる日付を指定してください。');
        return;
    }
    ensureRecurrenceSettings(task);
    task.recurrenceRecords = task.recurrenceRecords.filter(record => record.date !== occurrenceDate);
    task.recurrenceRecords.push({ date: occurrenceDate, status: 'moved', movedTo, moveReason, timestamp: new Date().toISOString() });
    task.recurrenceRecords.sort((a, b) => a.date.localeCompare(b.date));
    task.updatedAt = new Date().toISOString();
    recordActivity(task, 'recurrence-moved', '定期タスクを別日に移動', { date: movedTo, scheduledDate: occurrenceDate, reason: moveReason }, task.updatedAt);
    saveData();
    closeRecurrenceMoveCalendar();
    renderTaskList();
    renderTodayPage();
    if (currentTaskId === taskId) renderRecurringSettings(task);
}

function openTodayPage() {
    const modal = document.getElementById('todayPageModal');
    document.getElementById('todayPageDate').value = toDateInputValue(new Date());
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    renderTodayPage();
}

function closeTodayPage(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('todayPageModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function moveTodayPageDate(days) {
    const input = document.getElementById('todayPageDate');
    const date = new Date(`${input.value}T00:00:00`);
    date.setDate(date.getDate() + days);
    input.value = toDateInputValue(date);
    renderTodayPage();
}

function setTodayPageToToday() {
    document.getElementById('todayPageDate').value = toDateInputValue(new Date());
    renderTodayPage();
}

function isWaitingStatus(status) {
    return status?.startsWith('waiting') || status === 'pending';
}

function renderTodayTaskCard(task, dateValue) {
    const tag = projectTags.find(item => item.id === task.projectTagId);
    const status = STATUSES[task.status] || STATUSES.todo;
    const priority = PRIORITIES[task.priority] || PRIORITIES.B;
    return `
        <div class="bg-white border border-gray-200 rounded-md px-3 py-2">
            <button type="button" data-today-task-id="${escapeHTML(task.id)}" class="w-full text-left hover:text-blue-700 transition-colors">
                <div class="flex items-start gap-2">
                    <span class="font-medium text-sm text-gray-800 flex-1">${escapeHTML(task.title || '無題のタスク')}</span>
                    <span class="text-xs ${priority.color}">${priority.label}</span>
                </div>
                <div class="flex flex-wrap items-center gap-1 mt-1">
                    ${tag ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700">${escapeHTML(tag.name)}</span>` : ''}
                    <span class="text-[10px] px-1.5 py-0.5 rounded-full ${status.color}">${status.label}</span>
                    ${task.nextAction ? `<span class="text-[10px] text-gray-500 truncate">次: ${escapeHTML(task.nextAction)}</span>` : ''}
                </div>
            </button>
            ${isTaskPlannedForDate(task, dateValue) ? `
                <div class="mt-2 pt-2 border-t border-gray-100">
                    <div class="flex items-center justify-between mb-1">
                        <label class="text-[10px] font-semibold text-gray-500">この日にやる内容</label>
                        <label class="inline-flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                            <input type="checkbox" data-today-daily-plan-completed data-task-id="${escapeHTML(task.id)}" ${task.dailyPlanCompleted?.[dateValue] ? 'checked' : ''} class="rounded border-gray-300 text-green-600 focus:ring-green-500">
                            達成
                        </label>
                    </div>
                    <textarea data-today-daily-plan data-task-id="${escapeHTML(task.id)}" rows="2" class="w-full border border-gray-200 bg-gray-50 rounded p-2 text-xs resize-y focus:ring-blue-500 focus:border-blue-500 ${task.dailyPlanCompleted?.[dateValue] ? 'line-through text-gray-500' : ''}" placeholder="この日の対応内容を入力...">${escapeHTML(task.dailyPlans?.[dateValue] || '')}</textarea>
                </div>
            ` : ''}
        </div>
    `;
}

function renderTodaySection(title, tasksForSection, emptyText, colorClass = 'text-gray-700', dateValue = '') {
    return `
        <section class="bg-white border border-gray-200 rounded-lg p-4">
            <h3 class="font-bold text-sm ${colorClass} mb-3">${title} <span class="text-xs font-normal text-gray-400">${tasksForSection.length}件</span></h3>
            <div class="space-y-2">
                ${tasksForSection.length ? tasksForSection.map(task => renderTodayTaskCard(task, dateValue)).join('') : `<p class="text-xs text-gray-400 py-2">${emptyText}</p>`}
            </div>
        </section>
    `;
}

function renderRecurringTodaySection(occurrences, dateValue) {
    const rows = occurrences.map(({ task, occurrenceDate }) => {
        const record = task.recurrenceRecords?.find(item => item.date === occurrenceDate);
        const isMovedOccurrence = occurrenceDate !== dateValue;
        let stateLabel = '未実施';
        let stateColor = 'bg-cyan-100 text-cyan-700';
        if (record?.status === 'moved') {
            stateLabel = isMovedOccurrence ? '移動分・未実施' : `${record.movedTo}へ移動`;
            stateColor = 'bg-orange-100 text-orange-700';
        } else if (record?.status === 'done') {
            stateLabel = record.actualDate && record.actualDate !== occurrenceDate && !isMovedOccurrence ? `${record.actualDate}に実施済み` : '実施済み';
            stateColor = 'bg-green-100 text-green-700';
        } else if (record?.status === 'skipped') {
            stateLabel = record.actualDate && record.actualDate !== occurrenceDate && !isMovedOccurrence ? `${record.actualDate}にスキップ` : 'スキップ';
            stateColor = 'bg-gray-100 text-gray-600';
        }
        const isFinalRecord = ['done', 'skipped'].includes(record?.status);
        const isMovedAtOriginalDate = record?.status === 'moved' && !isMovedOccurrence;
        return `
            <div class="bg-white border border-cyan-200 rounded-md px-3 py-2">
                <div class="flex items-start gap-2">
                    <button type="button" data-today-task-id="${escapeHTML(task.id)}" class="flex-1 text-left font-medium text-sm text-gray-800 hover:text-blue-700">${escapeHTML(task.title || '無題のタスク')}</button>
                    <span class="text-[10px] px-1.5 py-0.5 rounded-full ${stateColor}">${stateLabel}</span>
                </div>
                ${record?.status === 'moved' && record.moveReason ? `<p class="mt-1.5 text-xs text-gray-600 whitespace-pre-wrap"><span class="font-medium">移動理由:</span> ${escapeHTML(record.moveReason)}</p>` : ''}
                <div class="flex items-center justify-between gap-2 mt-2">
                    <span class="text-[10px] text-gray-500">${isMovedOccurrence ? `${occurrenceDate}分 / ` : ''}${getRecurrenceLabel(task)}</span>
                    <div class="flex gap-1.5">
                        ${isFinalRecord || isMovedAtOriginalDate ? `<button type="button" data-recurrence-action="pending" data-task-id="${escapeHTML(task.id)}" data-occurrence-date="${occurrenceDate}" class="px-2 py-1 text-[10px] text-gray-600 bg-gray-100 hover:bg-gray-200 rounded">取り消し</button>` : `
                            <button type="button" data-recurrence-move data-task-id="${escapeHTML(task.id)}" data-occurrence-date="${occurrenceDate}" class="px-2 py-1 text-[10px] text-orange-700 bg-orange-50 hover:bg-orange-100 rounded">別日に移動</button>
                            <button type="button" data-recurrence-action="skipped" data-task-id="${escapeHTML(task.id)}" data-occurrence-date="${occurrenceDate}" class="px-2 py-1 text-[10px] text-gray-600 bg-gray-100 hover:bg-gray-200 rounded">スキップ</button>
                            <button type="button" data-recurrence-action="done" data-task-id="${escapeHTML(task.id)}" data-occurrence-date="${occurrenceDate}" class="px-2 py-1 text-[10px] text-white bg-green-600 hover:bg-green-700 rounded">実施済み</button>
                        `}
                    </div>
                </div>
            </div>
        `;
    }).join('');
    return `
        <section class="bg-cyan-50/50 border border-cyan-200 rounded-lg p-4 lg:col-span-2">
            <h3 class="font-bold text-sm text-cyan-800 mb-3">定期タスク <span class="text-xs font-normal text-gray-400">${occurrences.length}件</span></h3>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-2">
                ${rows || '<p class="text-xs text-gray-400 py-2">この日の定期タスクはありません。</p>'}
            </div>
        </section>
    `;
}

function renderTodayPage() {
    const dateValue = document.getElementById('todayPageDate').value;
    if (!dateValue) return;
    const selectedDate = new Date(`${dateValue}T00:00:00`);
    document.getElementById('todayPageDateLabel').textContent = selectedDate.toLocaleDateString('ja-JP', {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
    });
    const nonWorkingPeriod = getNonWorkingPeriodForDate(dateValue);
    const nonWorkingBanner = document.getElementById('todayNonWorkingBanner');
    nonWorkingBanner.classList.toggle('hidden', !nonWorkingPeriod);
    nonWorkingBanner.innerHTML = nonWorkingPeriod ? `<strong>${getNonWorkingTypeLabel(nonWorkingPeriod.type)}</strong>${nonWorkingPeriod.note ? ` — ${escapeHTML(nonWorkingPeriod.note)}` : ''}<div class="text-xs mt-1">この日の未達成予定は持ち越し対象に含まれません。定期タスクは移動またはスキップできます。</div>` : '';

    const incomplete = task => task.status !== 'done' && task.status !== 'recurring';
    const isPlannedForDate = task => isTaskPlannedForDate(task, dateValue);
    const plannedTasks = tasks.filter(task => isPlannedForDate(task) && incomplete(task) && !isWaitingStatus(task.status));
    const waitingTasks = tasks.filter(task => isPlannedForDate(task) && incomplete(task) && isWaitingStatus(task.status));
    const overdueTasks = tasks.filter(task => taskHasPastWorkingSchedule(task, dateValue) && !isPlannedForDate(task) && incomplete(task));
    const reminderTasks = tasks.filter(task => task.reminderDate && task.reminderDate <= dateValue && incomplete(task) && !isPlannedForDate(task));
    const completedTasks = tasks.filter(task => task.completedAt && toDateInputValue(new Date(task.completedAt)) === dateValue);
    const recurringOccurrences = [];
    tasks.forEach(task => {
        if (task.status !== 'recurring') return;
        if (isRecurringTaskDue(task, dateValue)) recurringOccurrences.push({ task, occurrenceDate: dateValue });
        (task.recurrenceRecords || []).forEach(record => {
            const displayDate = record.status === 'moved' ? record.movedTo : record.actualDate;
            if (displayDate === dateValue && record.date !== dateValue && !recurringOccurrences.some(item => item.task.id === task.id && item.occurrenceDate === record.date)) {
                recurringOccurrences.push({ task, occurrenceDate: record.date });
            }
        });
    });

    const sections = document.getElementById('todayPageSections');
    sections.innerHTML = [
        renderTodaySection(nonWorkingPeriod ? `${getNonWorkingTypeLabel(nonWorkingPeriod.type)}日の予定` : 'この日にやること', plannedTasks, '予定されたタスクはありません。', nonWorkingPeriod ? 'text-purple-700' : 'text-blue-700', dateValue),
        renderTodaySection('待ち・確認', waitingTasks, '確認対象はありません。', 'text-amber-700', dateValue),
        renderTodaySection('持ち越し', overdueTasks, '持ち越しタスクはありません。', 'text-orange-700', dateValue),
        renderTodaySection('期限・リマインド', reminderTasks, '該当するタスクはありません。', 'text-red-700', dateValue),
        renderRecurringTodaySection(recurringOccurrences, dateValue),
        renderTodaySection('この日に完了', completedTasks, '完了したタスクはありません。', 'text-green-700', dateValue)
    ].join('');
    sections.onclick = event => {
        const recurrenceMove = event.target.closest('[data-recurrence-move]');
        if (recurrenceMove) {
            moveRecurringOccurrence(recurrenceMove.dataset.taskId, recurrenceMove.dataset.occurrenceDate, dateValue);
            return;
        }
        const recurrenceAction = event.target.closest('[data-recurrence-action]');
        if (recurrenceAction) {
            recordRecurringOccurrence(recurrenceAction.dataset.taskId, recurrenceAction.dataset.occurrenceDate, recurrenceAction.dataset.recurrenceAction, dateValue);
            return;
        }
        const button = event.target.closest('[data-today-task-id]');
        if (!button) return;
        closeTodayPage();
        selectTask(button.dataset.todayTaskId);
    };
    sections.querySelectorAll('[data-today-daily-plan]').forEach(input => {
        input.addEventListener('change', () => setTaskDailyPlan(input.dataset.taskId, dateValue, input.value));
    });
    sections.querySelectorAll('[data-today-daily-plan-completed]').forEach(input => {
        input.addEventListener('change', () => {
            setTaskDailyPlanCompleted(input.dataset.taskId, dateValue, input.checked);
            renderTodayPage();
        });
    });
    document.getElementById('dailyNoteInput').value = dailyNotes[dateValue] || '';
    const carryButton = document.getElementById('carryOverTasksBtn');
    carryButton.classList.toggle('hidden', Boolean(nonWorkingPeriod));
    const carryDestination = addDaysToDateValue(dateValue, 1);
    carryButton.textContent = `未完了タスクを${carryDestination}へ持ち越す`;
}

function saveDailyNote() {
    const dateValue = document.getElementById('todayPageDate').value;
    if (!dateValue) return;
    const text = document.getElementById('dailyNoteInput').value;
    if (text) dailyNotes[dateValue] = text;
    else delete dailyNotes[dateValue];
    localStorage.setItem('chatTaskDailyNotes', JSON.stringify(dailyNotes));
}

function carryOverTasks() {
    const sourceDate = document.getElementById('todayPageDate').value;
    const destinationDate = addDaysToDateValue(sourceDate, 1);
    const targets = tasks.filter(task => isTaskPlannedForDate(task, sourceDate) && !isTaskPlannedForDate(task, destinationDate) && !['done', 'recurring'].includes(task.status));
    if (targets.length === 0) {
        alert(`${sourceDate}に予定された未完了タスクはありません。`);
        return;
    }
    if (!confirm(`${sourceDate}の未完了タスク${targets.length}件を${destinationDate}へ持ち越しますか？`)) return;
    const now = new Date().toISOString();
    targets.forEach(task => {
        task.plannedRanges = mergePlannedRanges([...(task.plannedRanges || []), { id: generateId(), startDate: destinationDate, endDate: destinationDate }]);
        task.isToday = isTaskPlannedForDate(task, toDateInputValue(new Date()));
        task.updatedAt = now;
        recordActivity(task, 'planned-date-added', '持ち越し日を追加', {
            fromDate: sourceDate,
            date: destinationDate
        }, now);
    });
    saveData();
    renderTaskList();
    renderTodayPage();
}

function getGanttSettings() {
    const scale = document.getElementById('ganttScale')?.value || 'day';
    const settings = {
        day: { days: 35, offset: 7, cellWidth: 36, moveDays: 28 },
        week: { days: 112, offset: 14, cellWidth: 12, moveDays: 84 },
        month: { days: 365, offset: 30, cellWidth: 4, moveDays: 365 }
    }[scale];
    return { scale, ...settings };
}

function getCurrentDocumentTask() {
    return tasks.find(task => task.id === currentTaskId) || null;
}

function openTaskDocuments() {
    const task = getCurrentDocumentTask();
    if (!task) return;
    task.documents = Array.isArray(task.documents) ? task.documents : [];
    currentTaskDocumentId = null;
    document.getElementById('taskDocumentsTaskName').textContent = task.title || '無題のタスク';
    const modal = document.getElementById('taskDocumentsModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    renderTaskDocumentsList();
    if (task.documents.length) selectTaskDocument(task.documents[0].id);
    else createTaskDocument();
}

function closeTaskDocuments(event) {
    if (event && event.target !== event.currentTarget) return;
    saveCurrentTaskDocument(true);
    const modal = document.getElementById('taskDocumentsModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    currentTaskDocumentId = null;
}

function renderTaskDocumentsList() {
    const task = getCurrentDocumentTask();
    const list = document.getElementById('taskDocumentsList');
    if (!task?.documents?.length) {
        list.innerHTML = '<p class="p-3 text-xs text-gray-400">ドキュメントはまだありません。</p>';
        return;
    }
    list.innerHTML = [...task.documents].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map(docEntry => `
        <button type="button" data-task-document-id="${escapeHTML(docEntry.id)}" class="block w-full rounded-md px-3 py-2 text-left ${docEntry.id === currentTaskDocumentId ? 'bg-violet-100 text-violet-800' : 'text-gray-700 hover:bg-white'}">
            <span class="block text-sm font-medium truncate">${escapeHTML(docEntry.title || '無題のドキュメント')}</span>
            <span class="block text-[10px] text-gray-400 mt-0.5">${formatDate(docEntry.updatedAt, false)} 更新</span>
        </button>
    `).join('');
    list.querySelectorAll('[data-task-document-id]').forEach(button => {
        button.addEventListener('click', () => selectTaskDocument(button.dataset.taskDocumentId));
    });
}

function createTaskDocument() {
    const task = getCurrentDocumentTask();
    if (!task) return;
    saveCurrentTaskDocument(true);
    const now = new Date().toISOString();
    const docEntry = { id: generateId(), title: '無題のドキュメント', content: '', createdAt: now, updatedAt: now };
    task.documents = Array.isArray(task.documents) ? task.documents : [];
    task.documents.push(docEntry);
    task.updatedAt = now;
    recordActivity(task, 'document-created', 'ドキュメントを作成', { documentId: docEntry.id, title: docEntry.title }, now);
    saveData();
    currentTaskDocumentId = docEntry.id;
    renderTaskDocumentsList();
    selectTaskDocument(docEntry.id, false);
    document.getElementById('taskDocumentTitleInput').select();
}

function selectTaskDocument(documentId, saveBeforeSelect = true) {
    const task = getCurrentDocumentTask();
    if (!task) return;
    if (saveBeforeSelect && currentTaskDocumentId && currentTaskDocumentId !== documentId) saveCurrentTaskDocument(true);
    const docEntry = task.documents?.find(item => item.id === documentId);
    if (!docEntry) return;
    currentTaskDocumentId = documentId;
    document.getElementById('taskDocumentEmpty').classList.add('hidden');
    document.getElementById('taskDocumentEditor').classList.remove('hidden');
    document.getElementById('taskDocumentEditor').classList.add('flex');
    document.getElementById('taskDocumentTitleInput').value = docEntry.title || '';
    renderTaskDocumentBlocks(docEntry.content || '');
    renderTaskDocumentsList();
}

function saveCurrentTaskDocument(silent = false) {
    const task = getCurrentDocumentTask();
    const docEntry = task?.documents?.find(item => item.id === currentTaskDocumentId);
    if (!docEntry) return false;
    const titleValue = document.getElementById('taskDocumentTitleInput').value.trim() || '無題のドキュメント';
    const contentValue = serializeTaskDocumentBlocks();
    if (docEntry.title === titleValue && docEntry.content === contentValue) return false;
    docEntry.title = titleValue;
    docEntry.content = contentValue;
    docEntry.updatedAt = new Date().toISOString();
    task.updatedAt = docEntry.updatedAt;
    recordActivity(task, 'document-updated', 'ドキュメントを更新', { documentId: docEntry.id, title: docEntry.title }, docEntry.updatedAt);
    saveData();
    renderTaskDocumentsList();
    renderTaskList();
    return true;
}

function deleteCurrentTaskDocument() {
    const task = getCurrentDocumentTask();
    const docEntry = task?.documents?.find(item => item.id === currentTaskDocumentId);
    if (!docEntry || !confirm(`ドキュメント「${docEntry.title}」を削除しますか？`)) return;
    task.documents = task.documents.filter(item => item.id !== docEntry.id);
    task.updatedAt = new Date().toISOString();
    recordActivity(task, 'document-deleted', 'ドキュメントを削除', { documentId: docEntry.id, title: docEntry.title }, task.updatedAt);
    saveData();
    currentTaskDocumentId = null;
    document.getElementById('taskDocumentEditor').classList.add('hidden');
    document.getElementById('taskDocumentEditor').classList.remove('flex');
    document.getElementById('taskDocumentEmpty').classList.remove('hidden');
    document.getElementById('taskDocumentBlockEditor').innerHTML = '';
    renderTaskDocumentsList();
    if (task.documents.length) selectTaskDocument(task.documents[0].id);
}

function createTaskDocumentBlock(type = 'paragraph', text = '', checked = false, indent = 0) {
    const block = document.createElement('div');
    block.className = 'task-document-block';
    block.dataset.type = type;
    block.dataset.indent = String(Math.max(0, Math.min(4, indent)));
    if (type === 'checklist') {
        block.dataset.checked = String(checked);
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = checked;
        checkbox.className = 'mt-2 rounded border-gray-300 text-violet-600 focus:ring-violet-500';
        checkbox.addEventListener('change', () => { block.dataset.checked = String(checkbox.checked); });
        block.appendChild(checkbox);
    }
    const content = document.createElement('div');
    content.className = 'task-document-block-content';
    content.contentEditable = 'true';
    content.spellcheck = true;
    content.dataset.placeholder = type === 'paragraph' ? '入力するか、Markdownコマンドを入力...' : '';
    content.textContent = text;
    content.addEventListener('compositionstart', () => { block.dataset.composing = 'true'; });
    content.addEventListener('compositionend', () => {
        block.dataset.composing = 'false';
        applyTaskDocumentInputRule(block, true);
    });
    content.addEventListener('input', () => {
        if (block.dataset.composing !== 'true') applyTaskDocumentInputRule(block);
    });
    content.addEventListener('keydown', event => handleTaskDocumentBlockKeydown(event, block));
    block.appendChild(content);
    return block;
}

function renderTaskDocumentBlocks(markdown) {
    const editor = document.getElementById('taskDocumentBlockEditor');
    editor.innerHTML = '';
    const lines = String(markdown || '').split('\n');
    lines.forEach(line => {
        let type = 'paragraph';
        const leadingSpaces = line.match(/^ */)?.[0].length || 0;
        const indent = Math.min(4, Math.floor(leadingSpaces / 2));
        const sourceLine = line.slice(leadingSpaces);
        let text = sourceLine;
        let checked = false;
        if (/^###\s+/.test(sourceLine)) { type = 'heading3'; text = sourceLine.replace(/^###\s+/, ''); }
        else if (/^##\s+/.test(sourceLine)) { type = 'heading2'; text = sourceLine.replace(/^##\s+/, ''); }
        else if (/^#\s+/.test(sourceLine)) { type = 'heading1'; text = sourceLine.replace(/^#\s+/, ''); }
        else if (/^- \[[xX]\]\s*/.test(sourceLine)) { type = 'checklist'; checked = true; text = sourceLine.replace(/^- \[[xX]\]\s*/, ''); }
        else if (/^- \[ \]\s*/.test(sourceLine)) { type = 'checklist'; text = sourceLine.replace(/^- \[ \]\s*/, ''); }
        else if (/^-\s+/.test(sourceLine)) { type = 'bullet'; text = sourceLine.replace(/^-\s+/, ''); }
        else if (/^\d+\.\s+/.test(sourceLine)) { type = 'ordered'; text = sourceLine.replace(/^\d+\.\s+/, ''); }
        else if (/^>\s+/.test(sourceLine)) { type = 'quote'; text = sourceLine.replace(/^>\s+/, ''); }
        editor.appendChild(createTaskDocumentBlock(type, text, checked, indent));
    });
    if (!editor.children.length) editor.appendChild(createTaskDocumentBlock());
    renumberTaskDocumentBlocks();
}

function serializeTaskDocumentBlocks() {
    return [...document.querySelectorAll('#taskDocumentBlockEditor .task-document-block')].map(block => {
        const text = block.querySelector('.task-document-block-content')?.textContent || '';
        const prefix = '  '.repeat(Number(block.dataset.indent) || 0);
        switch (block.dataset.type) {
            case 'heading1': return `${prefix}# ${text}`;
            case 'heading2': return `${prefix}## ${text}`;
            case 'heading3': return `${prefix}### ${text}`;
            case 'bullet': return `${prefix}- ${text}`;
            case 'ordered': return `${prefix}1. ${text}`;
            case 'quote': return `${prefix}> ${text}`;
            case 'checklist': return `${prefix}- [${block.dataset.checked === 'true' ? 'x' : ' '}] ${text}`;
            default: return `${prefix}${text}`;
        }
    }).join('\n');
}

function setTaskDocumentBlockType(block, type) {
    const content = block.querySelector('.task-document-block-content');
    const replacement = createTaskDocumentBlock(type, content?.textContent || '', false, Number(block.dataset.indent) || 0);
    block.replaceWith(replacement);
    renumberTaskDocumentBlocks();
    focusTaskDocumentBlock(replacement);
    return replacement;
}

function applyTaskDocumentInputRule(block, allowUnspacedFullWidth = false) {
    const content = block.querySelector('.task-document-block-content');
    const value = content?.textContent || '';
    const normalizedValue = normalizeMarkdownCommand(value);
    const rules = [
        [/^- ?\[ \] $/, 'checklist'], [/^### $/, 'heading3'], [/^## $/, 'heading2'], [/^# $/, 'heading1'],
        [/^(?:-|・) $/, 'bullet'], [/^\d+\. $/, 'ordered'], [/^> $/, 'quote']
    ];
    let matched = rules.find(([pattern]) => pattern.test(normalizedValue));
    if (!matched && allowUnspacedFullWidth && /[＃－＞［］．０-９　・]/.test(value)) {
        const unspacedRules = [
            [/^- ?\[ ?\]$/, 'checklist'], [/^###$/, 'heading3'], [/^##$/, 'heading2'], [/^#$/, 'heading1'],
            [/^(?:-|・)$/, 'bullet'], [/^\d+\.$/, 'ordered'], [/^>$/, 'quote']
        ];
        matched = unspacedRules.find(([pattern]) => pattern.test(normalizedValue));
    }
    if (!matched) return;
    content.textContent = '';
    setTaskDocumentBlockType(block, matched[1]);
}

function normalizeMarkdownCommand(value) {
    return String(value)
        .replace(/＃/g, '#').replace(/－/g, '-').replace(/＞/g, '>')
        .replace(/［/g, '[').replace(/］/g, ']').replace(/．/g, '.')
        .replace(/　/g, ' ')
        .replace(/[０-９]/g, digit => String('０１２３４５６７８９'.indexOf(digit)));
}

function getContentCaretOffset(content) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return 0;
    const range = selection.getRangeAt(0).cloneRange();
    range.selectNodeContents(content);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    return range.toString().length;
}

function focusTaskDocumentBlock(block, offset = null) {
    const content = block.querySelector('.task-document-block-content');
    if (!content) return;
    content.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    const textNode = content.firstChild || content.appendChild(document.createTextNode(''));
    const position = offset === null ? textNode.textContent.length : Math.min(offset, textNode.textContent.length);
    range.setStart(textNode, position);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
}

function handleTaskDocumentBlockKeydown(event, block) {
    const content = block.querySelector('.task-document-block-content');
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key.toLowerCase() === 'a' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        selectAllTaskDocumentBlocks();
    } else if ((event.key === 'Backspace' || event.key === 'Delete') && !window.getSelection()?.isCollapsed) {
        if (deleteSelectedTaskDocumentBlocks()) event.preventDefault();
    } else if (event.key === 'Tab') {
        event.preventDefault();
        const currentIndent = Number(block.dataset.indent) || 0;
        block.dataset.indent = String(Math.max(0, Math.min(4, currentIndent + (event.shiftKey ? -1 : 1))));
        renumberTaskDocumentBlocks();
    } else if (event.key.toLowerCase() === 's' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        saveCurrentTaskDocument();
    } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const offset = getContentCaretOffset(content);
        const text = content.textContent || '';
        const indent = Number(block.dataset.indent) || 0;
        if (!text && indent > 0) {
            block.dataset.indent = String(indent - 1);
            renumberTaskDocumentBlocks();
            focusTaskDocumentBlock(block, 0);
            return;
        }
        if (!text && block.dataset.type !== 'paragraph') {
            setTaskDocumentBlockType(block, 'paragraph');
            return;
        }
        content.textContent = text.slice(0, offset);
        const nextType = block.dataset.type === 'checklist' || block.dataset.type === 'bullet' || block.dataset.type === 'ordered' ? block.dataset.type : 'paragraph';
        const nextBlock = createTaskDocumentBlock(nextType, text.slice(offset), false, Number(block.dataset.indent) || 0);
        block.after(nextBlock);
        renumberTaskDocumentBlocks();
        focusTaskDocumentBlock(nextBlock, 0);
    } else if (event.key === 'Backspace' && getContentCaretOffset(content) === 0) {
        if (block.dataset.type !== 'paragraph') {
            event.preventDefault();
            setTaskDocumentBlockType(block, 'paragraph');
            return;
        }
        const previous = block.previousElementSibling;
        if (!previous) return;
        event.preventDefault();
        const previousContent = previous.querySelector('.task-document-block-content');
        const previousLength = previousContent.textContent.length;
        previousContent.textContent += content.textContent || '';
        block.remove();
        renumberTaskDocumentBlocks();
        focusTaskDocumentBlock(previous, previousLength);
    } else if (event.key === 'Delete' && getContentCaretOffset(content) === (content.textContent || '').length) {
        const next = block.nextElementSibling;
        if (!next) return;
        event.preventDefault();
        const currentLength = content.textContent.length;
        const nextContent = next.querySelector('.task-document-block-content');
        content.textContent += nextContent?.textContent || '';
        next.remove();
        renumberTaskDocumentBlocks();
        focusTaskDocumentBlock(block, currentLength);
    }
}

function selectAllTaskDocumentBlocks() {
    const contents = [...document.querySelectorAll('#taskDocumentBlockEditor .task-document-block-content')];
    if (!contents.length) return;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(contents[0], 0);
    range.setEnd(contents.at(-1), contents.at(-1).childNodes.length);
    selection.removeAllRanges();
    selection.addRange(range);
}

function deleteSelectedTaskDocumentBlocks() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    const startContent = getTaskDocumentContentFromNode(range.startContainer);
    const endContent = getTaskDocumentContentFromNode(range.endContainer);
    if (!startContent || !endContent || startContent === endContent) return false;
    const blocks = [...document.querySelectorAll('#taskDocumentBlockEditor .task-document-block')];
    const startBlock = startContent.closest('.task-document-block');
    const endBlock = endContent.closest('.task-document-block');
    const startIndex = blocks.indexOf(startBlock);
    const endIndex = blocks.indexOf(endBlock);
    if (startIndex < 0 || endIndex <= startIndex) return false;
    const startOffset = getRangeOffsetWithinContent(startContent, range.startContainer, range.startOffset);
    const endOffset = getRangeOffsetWithinContent(endContent, range.endContainer, range.endOffset);
    const prefix = (startContent.textContent || '').slice(0, startOffset);
    const suffix = (endContent.textContent || '').slice(endOffset);
    startContent.textContent = prefix + suffix;
    blocks.slice(startIndex + 1, endIndex + 1).forEach(item => item.remove());
    renumberTaskDocumentBlocks();
    focusTaskDocumentBlock(startBlock, prefix.length);
    return true;
}

function getTaskDocumentContentFromNode(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return element?.closest?.('.task-document-block-content') || null;
}

function getRangeOffsetWithinContent(content, node, offset) {
    const range = document.createRange();
    range.selectNodeContents(content);
    range.setEnd(node, offset);
    return range.toString().length;
}

function renumberTaskDocumentBlocks() {
    const counters = [0, 0, 0, 0, 0];
    document.querySelectorAll('#taskDocumentBlockEditor .task-document-block').forEach(block => {
        if (block.dataset.type !== 'ordered') {
            counters.fill(0);
            return;
        }
        const indent = Math.max(0, Math.min(4, Number(block.dataset.indent) || 0));
        counters[indent] += 1;
        counters.fill(0, indent + 1);
        const number = counters[indent];
        if (indent === 0) block.dataset.marker = `${number}.`;
        else if (indent % 2 === 1) block.dataset.marker = `${toAlphabeticMarker(number)}.`;
        else block.dataset.marker = `${toRomanMarker(number)}.`;
    });
}

function toAlphabeticMarker(number) {
    let value = Math.max(1, number);
    let marker = '';
    while (value > 0) {
        value -= 1;
        marker = String.fromCharCode(97 + (value % 26)) + marker;
        value = Math.floor(value / 26);
    }
    return marker;
}

function toRomanMarker(number) {
    const numerals = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let value = Math.max(1, number);
    let marker = '';
    numerals.forEach(([amount, numeral]) => {
        while (value >= amount) {
            marker += numeral;
            value -= amount;
        }
    });
    return marker;
}

function appendTaskDocumentBlock(type) {
    const editor = document.getElementById('taskDocumentBlockEditor');
    const block = createTaskDocumentBlock(type);
    editor.appendChild(block);
    renumberTaskDocumentBlocks();
    focusTaskDocumentBlock(block);
}

function openHelp() {
    const modal = document.getElementById('helpModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeHelp(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('helpModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function openGanttChart() {
    ganttAnchorDate = toDateInputValue(new Date());
    const tagFilter = document.getElementById('ganttTagFilter');
    tagFilter.innerHTML = '<option value="all">すべての案件タグ</option><option value="none">タグなし</option>' +
        projectTags.map(tag => `<option value="${tag.id}">${escapeHTML(tag.name)}${tag.visible ? '' : '（非表示）'}</option>`).join('');
    const savedScale = localStorage.getItem('chatTaskGanttScale');
    document.getElementById('ganttScale').value = ['day', 'week', 'month'].includes(savedScale) ? savedScale : 'day';
    document.getElementById('ganttShowCompleted').checked = false;
    const modal = document.getElementById('ganttChartModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    renderGanttChart();
}

function closeGanttChart(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('ganttChartModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function changeGanttScale() {
    localStorage.setItem('chatTaskGanttScale', document.getElementById('ganttScale').value);
    renderGanttChart();
}

function moveGanttPeriod(direction) {
    ganttAnchorDate = addDaysToDateValue(ganttAnchorDate, getGanttSettings().moveDays * direction);
    renderGanttChart();
}

function resetGanttPeriod() {
    ganttAnchorDate = toDateInputValue(new Date());
    renderGanttChart();
}

function dateValueDifference(fromDate, toDate) {
    return Math.round((new Date(`${toDate}T00:00:00`) - new Date(`${fromDate}T00:00:00`)) / 86400000);
}

function renderGanttChart() {
    const content = document.getElementById('ganttChartContent');
    if (!content) return;
    const { scale, days, offset, cellWidth } = getGanttSettings();
    const startDate = addDaysToDateValue(ganttAnchorDate, -offset);
    const endDate = addDaysToDateValue(startDate, days - 1);
    const chartWidth = days * cellWidth;
    const selectedTag = document.getElementById('ganttTagFilter').value;
    const showCompleted = document.getElementById('ganttShowCompleted').checked;
    let filtered = tasks.filter(task => {
        if (!showCompleted && task.status === 'done') return false;
        if (selectedTag === 'none' && task.projectTagId) return false;
        if (selectedTag !== 'all' && selectedTag !== 'none' && task.projectTagId !== selectedTag) return false;
        return task.status !== 'recurring';
    });

    const filteredIds = new Set(filtered.map(task => task.id));
    const ordered = [];
    const added = new Set();
    const appendTree = task => {
        if (added.has(task.id)) return;
        added.add(task.id);
        ordered.push(task);
        filtered.filter(child => child.parentTaskId === task.id).forEach(appendTree);
    };
    filtered.filter(task => !task.parentTaskId || !filteredIds.has(task.parentTaskId)).forEach(appendTree);
    filtered.forEach(appendTree);
    filtered = ordered;

    const dates = Array.from({ length: days }, (_, index) => addDaysToDateValue(startDate, index));
    const shouldLabelDate = (date, index) => {
        if (scale === 'day') return true;
        const parsed = new Date(`${date}T00:00:00`);
        if (scale === 'week') return parsed.getDay() === 1 || index === 0;
        return date.endsWith('-01') || index === 0;
    };
    const dateLabel = date => {
        const parsed = new Date(`${date}T00:00:00`);
        if (scale === 'day') return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
        if (scale === 'week') return `${parsed.getMonth() + 1}/${parsed.getDate()}週`;
        return `${parsed.getFullYear()}/${parsed.getMonth() + 1}`;
    };
    const vacationBands = dates.map((date, index) => isNonWorkingDate(date) ?
        `<span class="absolute top-0 bottom-0 bg-purple-100/70 border-x border-purple-200/50 pointer-events-none" style="left:${index * cellWidth}px;width:${cellWidth}px" title="${escapeHTML(getNonWorkingTypeLabel(getNonWorkingPeriodForDate(date).type))}: ${date}"></span>` : '').join('');
    const priorityColors = { A: 'bg-red-400', B: 'bg-green-500', C: 'bg-blue-500', D: 'bg-purple-500' };
    const today = toDateInputValue(new Date());
    const todayOffset = dateValueDifference(startDate, today);
    const todayLine = todayOffset >= 0 && todayOffset < days ? `<span class="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none" style="left:${todayOffset * cellWidth + cellWidth / 2}px" title="今日"></span>` : '';
    const header = dates.map((date, index) => `<span class="absolute top-0 h-full border-l border-gray-200 text-[10px] text-gray-500 pt-2 pl-1 whitespace-nowrap ${isNonWorkingDate(date) ? 'bg-purple-100/70' : ''}" style="left:${index * cellWidth}px;width:${cellWidth}px">${shouldLabelDate(date, index) ? dateLabel(date) : ''}</span>`).join('');
    const rows = filtered.map(task => {
        const segments = (task.plannedRanges || []).map(range => {
            const clippedStart = range.startDate < startDate ? startDate : range.startDate;
            const clippedEnd = range.endDate > endDate ? endDate : range.endDate;
            if (clippedStart > clippedEnd) return '';
            const left = dateValueDifference(startDate, clippedStart) * cellWidth + 2;
            const width = (dateValueDifference(clippedStart, clippedEnd) + 1) * cellWidth - 4;
            return `<span class="absolute top-2 h-6 rounded ${priorityColors[task.priority] || priorityColors.B} ${task.status === 'done' ? 'opacity-40' : 'opacity-90'} shadow-sm z-10" style="left:${left}px;width:${Math.max(width, 4)}px" title="${escapeHTML(task.title)}: ${range.startDate}〜${range.endDate}"></span>`;
        }).join('');
        const tag = projectTags.find(item => item.id === task.projectTagId);
        return `<div class="flex h-10 border-b border-gray-100">
            <button type="button" data-gantt-task="${escapeHTML(task.id)}" class="sticky left-0 z-30 w-60 shrink-0 px-3 text-left bg-white hover:bg-blue-50 border-r border-gray-200 text-xs truncate ${task.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-700'}" style="padding-left:${12 + getTaskDepth(task) * 14}px" title="${escapeHTML(task.title)}">${getTaskDepth(task) ? '↳ ' : ''}${escapeHTML(task.title || '無題')}${tag ? ` · ${escapeHTML(tag.name)}` : ''}</button>
            <div class="relative gantt-grid-background shrink-0" style="width:${chartWidth}px;--gantt-cell-width:${cellWidth}px">${vacationBands}${segments}${todayLine}</div>
        </div>`;
    }).join('');
    content.innerHTML = `<div style="min-width:${240 + chartWidth}px">
        <div class="sticky top-0 z-40 flex h-10 border-b border-gray-200 bg-gray-50">
            <div class="sticky left-0 z-50 w-60 shrink-0 px-3 flex items-center bg-gray-50 border-r border-gray-200 text-xs font-bold text-gray-600">タスク (${filtered.length})</div>
            <div class="relative shrink-0" style="width:${chartWidth}px">${header}${todayLine}</div>
        </div>
        ${rows || '<p class="sticky left-0 w-60 p-5 text-sm text-gray-400">表示するタスクがありません。</p>'}
    </div>`;
    content.querySelectorAll('[data-gantt-task]').forEach(button => button.addEventListener('click', () => {
        closeGanttChart();
        selectTask(button.dataset.ganttTask);
    }));
}

function openReportExport() {
    const tagFilter = document.getElementById('reportTagFilter');
    tagFilter.innerHTML = '<option value="all">すべての案件タグ</option><option value="none">タグなし</option>' +
        projectTags.map(tag => `<option value="${tag.id}">${escapeHTML(tag.name)}${tag.visible ? '' : '（非表示）'}</option>`).join('');
    document.getElementById('reportPeriodType').value = 'daily';
    updateReportPeriod();
    const modal = document.getElementById('reportExportModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeReportExport(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('reportExportModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function updateReportPeriod() {
    const type = document.getElementById('reportPeriodType').value;
    if (type === 'custom') return;
    const start = new Date();
    const end = new Date();
    if (type === 'weekly') {
        const dayFromMonday = (start.getDay() + 6) % 7;
        start.setDate(start.getDate() - dayFromMonday);
        end.setTime(start.getTime());
        end.setDate(end.getDate() + 6);
    } else if (type === 'monthly') {
        start.setDate(1);
        end.setMonth(end.getMonth() + 1, 0);
    }
    document.getElementById('reportStartDate').value = toDateInputValue(start);
    document.getElementById('reportEndDate').value = toDateInputValue(end);
}

function matchesReportTag(projectTagId, selectedTagId) {
    if (selectedTagId === 'all') return true;
    if (selectedTagId === 'none') return !projectTagId;
    return projectTagId === selectedTagId;
}

function markdownText(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/([*_`#[\]])/g, '\\$1');
}

function formatReportEvent(event) {
    const time = formatDate(event.timestamp).split(' ')[1] || '';
    const tagName = projectTags.find(tag => tag.id === event.projectTagId)?.name;
    let line = `- ${time} ${tagName ? `[${markdownText(tagName)}] ` : ''}**${markdownText(event.taskTitle)}**: ${markdownText(event.summary)}`;
    if (event.details?.field) {
        line += `（${markdownText(event.details.oldValue)} → ${markdownText(event.details.newValue)}）`;
    }
    if (event.details?.text) {
        const quotedText = markdownText(event.details.text).split('\n').map(text => `  > ${text}`).join('\n');
        line += `\n${quotedText}`;
    }
    if (event.details?.startDate && event.details?.endDate && event.details.startDate !== event.details.endDate) {
        line += `（${event.details.startDate}〜${event.details.endDate}）`;
    } else if (event.details?.scheduledDate && event.details.scheduledDate !== event.details.date) {
        line += `（本来の予定日: ${event.details.scheduledDate} / 対応日: ${event.details.date}）`;
    } else if (event.details?.date) {
        line += `（${event.details.date}）`;
    }
    if (event.details?.reason) {
        line += ` — 理由: ${markdownText(event.details.reason)}`;
    }
    if (event.details?.url) {
        line += ` — [${markdownText(event.details.label || event.details.url)}](${event.details.url})`;
    }
    return line;
}

function formatTaskForReport(task) {
    const tagName = projectTags.find(tag => tag.id === task.projectTagId)?.name;
    const lines = [`- **${markdownText(task.title || '無題のタスク')}**${tagName ? ` [${markdownText(tagName)}]` : ''}`];
    lines.push(`  - ステータス: ${markdownText(STATUSES[task.status]?.label || task.status)}`);
    lines.push(`  - 優先度: ${markdownText(PRIORITIES[task.priority]?.label || task.priority)}`);
    if (task.plannedRanges?.length) lines.push(`  - 予定: ${getTaskPlannedRangeLabel(task)}`);
    if (task.status === 'recurring') lines.push(`  - 繰り返し: ${getRecurrenceLabel(task)}${task.recurrence?.paused ? '（一時停止）' : ''}`);
    if (task.nextAction) lines.push(`  - 次に動く条件: ${markdownText(task.nextAction)}`);
    if (task.reminderDate) lines.push(`  - リマインド日: ${task.reminderDate}`);
    (task.links || []).forEach(link => lines.push(`  - [${markdownText(link.label || link.url)}](${link.url})`));
    return lines.join('\n');
}

function exportActivityReport(event) {
    event.preventDefault();
    const type = document.getElementById('reportPeriodType').value;
    const startValue = document.getElementById('reportStartDate').value;
    const endValue = document.getElementById('reportEndDate').value;
    const selectedTagId = document.getElementById('reportTagFilter').value;
    if (!startValue || !endValue || startValue > endValue) {
        alert('集計期間を正しく指定してください。');
        return;
    }

    const startTime = new Date(`${startValue}T00:00:00`).getTime();
    const endTime = new Date(`${endValue}T23:59:59.999`).getTime();
    const periodEvents = activityLog.filter(item => {
        const time = item.type?.startsWith('recurrence-') && item.details?.date
            ? new Date(`${item.details.date}T12:00:00`).getTime()
            : new Date(item.timestamp).getTime();
        return time >= startTime && time <= endTime && matchesReportTag(item.projectTagId, selectedTagId);
    }).sort((a, b) => {
        const aDate = a.type?.startsWith('recurrence-') && a.details?.date ? `${a.details.date}T12:00:00` : a.timestamp;
        const bDate = b.type?.startsWith('recurrence-') && b.details?.date ? `${b.details.date}T12:00:00` : b.timestamp;
        return new Date(aDate) - new Date(bDate);
    });
    const completedTasks = tasks.filter(task => {
        const time = task.completedAt ? new Date(task.completedAt).getTime() : NaN;
        return time >= startTime && time <= endTime && matchesReportTag(task.projectTagId, selectedTagId);
    });
    const activeStatuses = new Set(['doing', 'waiting-general', 'waiting-client', 'waiting-team', 'waiting-pr', 'waiting-staging', 'waiting-prod', 'pending', 'recurring']);
    const activeTasks = tasks.filter(task => activeStatuses.has(task.status) && matchesReportTag(task.projectTagId, selectedTagId));
    const performedEvents = periodEvents.filter(event => ['memo', 'daily-plan-completed', 'recurrence-done'].includes(event.type));
    const decisionEvents = periodEvents.filter(event => event.type === 'recurrence-moved' || event.type === 'recurrence-updated' || (event.type === 'field-change' && event.details?.field !== 'status'));
    const carryOverEvents = periodEvents.filter(event => event.details?.fromDate || event.summary?.includes('持ち越し'));
    const waitingTasks = tasks.filter(task => (isWaitingStatus(task.status) || task.status === 'pending') && matchesReportTag(task.projectTagId, selectedTagId));
    const periodDailyNotes = Object.entries(dailyNotes).filter(([date, text]) => date >= startValue && date <= endValue && text.trim());
    const periodNonWorking = nonWorkingPeriods.filter(period => period.startDate <= endValue && period.endDate >= startValue);
    const periodTaskPlans = tasks.flatMap(task => [...new Set([
        ...Object.keys(task.dailyPlans || {}), ...Object.keys(task.dailyPlanCompleted || {})
    ])].filter(date => date >= startValue && date <= endValue && matchesReportTag(task.projectTagId, selectedTagId))
        .map(date => ({ task, date, text: task.dailyPlans?.[date] || '', completed: Boolean(task.dailyPlanCompleted?.[date]) })))
        .sort((a, b) => a.date.localeCompare(b.date));
    const reportNames = { daily: '日次まとめ', weekly: '週次まとめ', monthly: '月次まとめ', custom: '期間まとめ' };
    const selectedTagName = selectedTagId === 'all' ? 'すべて' : selectedTagId === 'none' ? 'タグなし' : projectTags.find(tag => tag.id === selectedTagId)?.name || '不明';

    const sections = [
        `# ${reportNames[type] || '期間まとめ'}`,
        `期間: ${startValue}〜${endValue}`,
        `案件タグ: ${markdownText(selectedTagName)}`,
        '',
        '## 実施したこと',
        performedEvents.length ? performedEvents.map(formatReportEvent).join('\n') : '- 該当する記録はありません。',
        '',
        '## 完了したこと',
        completedTasks.length ? completedTasks.map(formatTaskForReport).join('\n') : '- 該当するタスクはありません。',
        '',
        '## 判断・決定',
        decisionEvents.length ? decisionEvents.map(formatReportEvent).join('\n') : '- 該当する記録はありません。',
        '',
        '## 待ち・懸念',
        waitingTasks.length ? waitingTasks.map(formatTaskForReport).join('\n') : '- 該当するタスクはありません。',
        '',
        '## 翌日・別日への持ち越し',
        carryOverEvents.length ? carryOverEvents.map(formatReportEvent).join('\n') : '- 該当する記録はありません。',
        '',
        '## 期間中の対応履歴',
        periodEvents.length ? periodEvents.map(formatReportEvent).join('\n') : '- 該当する履歴はありません。',
        '',
        '## 日次メモ',
        periodDailyNotes.length ? periodDailyNotes.map(([date, text]) => `### ${date}\n${markdownText(text)}`).join('\n\n') : '- 日次メモはありません。',
        '',
        '## 休暇・非稼働日',
        '- 土曜日・日曜日（自動設定）',
        periodNonWorking.length ? periodNonWorking.map(period => `- ${period.startDate === period.endDate ? period.startDate : `${period.startDate}〜${period.endDate}`} ${getNonWorkingTypeLabel(period.type)}${period.note ? `: ${markdownText(period.note)}` : ''}`).join('\n') : '- 手動設定された休暇はありません。',
        '',
        '## 日別の対応予定',
        periodTaskPlans.length ? periodTaskPlans.map(item => `- ${isNonWorkingDate(item.date) ? '[休暇日]' : item.completed ? '[x]' : '[ ]'} ${item.date} **${markdownText(item.task.title)}**: ${markdownText(item.text || '内容未入力')}`).join('\n') : '- 日別の対応予定はありません。',
        '',
        '## 現在対応中・確認待ち・保留中のタスク',
        activeTasks.length ? activeTasks.map(formatTaskForReport).join('\n') : '- 該当するタスクはありません。',
        '',
        '## AIへの依頼',
        '上記の記録をもとに、成果、対応内容、課題・確認待ち、次に行うことに分けて、簡潔で読みやすい業務報告を作成してください。',
        ''
    ];
    const blob = new Blob([sections.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `chattask_${type}_${startValue}_${endValue}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    closeReportExport();
}

function toggleSearchFilters() {
    const panel = document.getElementById('searchFiltersPanel');
    const button = document.getElementById('toggleSearchFiltersBtn');
    const label = button.querySelector('span');
    const icon = button.querySelector('[data-toggle-icon]');
    const isHidden = panel.classList.toggle('hidden');

    button.setAttribute('aria-expanded', String(!isHidden));
    label.textContent = isHidden ? '検索・絞り込みを表示' : '検索・絞り込みを隠す';
    icon.classList.toggle('-rotate-90', isHidden);
    localStorage.setItem('chatTaskSearchFiltersHidden', String(isHidden));
}

function applyTaskListWidth() {
    const aside = document.getElementById('taskListAside');
    const button = document.getElementById('taskListWidthBtn');
    aside.classList.toggle('lg:w-96', !isNarrowTaskList);
    aside.classList.toggle('lg:w-80', isNarrowTaskList);
    button.textContent = isNarrowTaskList ? '横幅: 細め' : '横幅: 標準';
}

function toggleTaskListWidth() {
    isNarrowTaskList = !isNarrowTaskList;
    localStorage.setItem('chatTaskListNarrow', String(isNarrowTaskList));
    applyTaskListWidth();
}

function applyTaskCardDensity() {
    const list = document.getElementById('taskList');
    const button = document.getElementById('taskCardDensityBtn');
    const isStandard = taskCardDensity === 'standard';
    const isMinimal = taskCardDensity === 'minimal';
    list.classList.toggle('p-2', isStandard);
    list.classList.toggle('space-y-2', isStandard);
    list.classList.toggle('p-1', !isStandard);
    list.classList.toggle('space-y-1', !isStandard);
    button.textContent = `縦幅: ${{ standard: '標準', compact: 'コンパクト', minimal: '最小' }[taskCardDensity]}`;
    button.title = isMinimal ? 'タイトルと主要情報のみ表示' : '';
}

function toggleTaskCardDensity() {
    const nextDensity = { standard: 'compact', compact: 'minimal', minimal: 'standard' };
    taskCardDensity = nextDensity[taskCardDensity];
    localStorage.setItem('chatTaskCardsCompact', taskCardDensity);
    applyTaskCardDensity();
    renderTaskList();
}

function openTagSettings() {
    renderTagSettings();
    const modal = document.getElementById('tagSettingsModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('newTagNameInput').focus();
}

function closeTagSettings(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('tagSettingsModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function renderTagSettings() {
    const list = document.getElementById('tagSettingsList');
    if (projectTags.length === 0) {
        list.innerHTML = '<p class="text-sm text-gray-500 text-center py-4">タグがありません。</p>';
        return;
    }

    list.innerHTML = projectTags.map((tag, index) => `
        <div class="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
            <div class="flex flex-col shrink-0" aria-label="${escapeHTML(tag.name)}の並び順">
                <button type="button" onclick="moveProjectTag('${tag.id}', -1)" ${index === 0 ? 'disabled' : ''} class="w-7 h-6 leading-none rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-25 disabled:cursor-not-allowed" aria-label="${escapeHTML(tag.name)}を上へ移動">▲</button>
                <button type="button" onclick="moveProjectTag('${tag.id}', 1)" ${index === projectTags.length - 1 ? 'disabled' : ''} class="w-7 h-6 leading-none rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-25 disabled:cursor-not-allowed" aria-label="${escapeHTML(tag.name)}を下へ移動">▼</button>
            </div>
            <input id="tagName_${tag.id}" type="text" maxlength="40" value="${escapeHTML(tag.name)}" onchange="renameProjectTag('${tag.id}', this.value)" class="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <label class="inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer shrink-0">
                <input type="checkbox" ${tag.visible ? 'checked' : ''} onchange="setProjectTagVisibility('${tag.id}', this.checked)" class="rounded border-gray-300 text-blue-600 focus:ring-blue-500">
                表示
            </label>
            <button onclick="deleteProjectTag('${tag.id}')" class="text-xs text-red-600 hover:text-red-800 shrink-0">削除</button>
        </div>
    `).join('');
}

function moveProjectTag(tagId, direction) {
    const currentIndex = projectTags.findIndex(tag => tag.id === tagId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= projectTags.length) return;

    [projectTags[currentIndex], projectTags[targetIndex]] = [projectTags[targetIndex], projectTags[currentIndex]];
    saveProjectTags();
    renderTagControls();
    renderTagSettings();
    renderTaskList();
}

function addProjectTag(event) {
    event.preventDefault();
    const input = document.getElementById('newTagNameInput');
    const name = input.value.trim();
    if (!name) return;
    if (projectTags.some(tag => tag.name.toLowerCase() === name.toLowerCase())) {
        alert('同じ名前のタグがすでにあります。');
        return;
    }

    projectTags.push({ id: generateId(), name, visible: true });
    input.value = '';
    saveProjectTags();
    renderTagControls();
    renderTagSettings();
    renderTaskList();
    input.focus();
}

function renameProjectTag(tagId, value) {
    const tag = projectTags.find(item => item.id === tagId);
    const name = value.trim();
    if (!tag || !name) {
        renderTagSettings();
        return;
    }
    if (projectTags.some(item => item.id !== tagId && item.name.toLowerCase() === name.toLowerCase())) {
        alert('同じ名前のタグがすでにあります。');
        renderTagSettings();
        return;
    }

    tag.name = name;
    saveProjectTags();
    renderTagControls();
    renderTaskList();
}

function setProjectTagVisibility(tagId, visible) {
    const tag = projectTags.find(item => item.id === tagId);
    if (!tag) return;
    tag.visible = visible;
    saveProjectTags();
    renderTagControls();
    renderTaskList();
}

function deleteProjectTag(tagId) {
    const tag = projectTags.find(item => item.id === tagId);
    if (!tag) return;
    const assignedCount = tasks.filter(task => task.projectTagId === tagId).length;
    const assignmentMessage = assignedCount > 0 ? `\nこのタグが設定された${assignedCount}件のタスクは「タグなし」になります。` : '';
    if (!confirm(`タグ「${tag.name}」を削除しますか？${assignmentMessage}`)) return;

    projectTags = projectTags.filter(item => item.id !== tagId);
    tasks.forEach(task => {
        if (task.projectTagId === tagId) task.projectTagId = '';
    });
    saveProjectTags();
    saveData();
    renderTagControls();
    renderTagSettings();
    renderTaskList();
    if (currentTaskId) selectTask(currentTaskId);
}

function setFilter(filterId) {
    currentFilter = filterId;
    localStorage.setItem('chatTaskCurrentFilter', filterId);
    // ボタンのスタイル更新
    FILTERS.forEach(f => {
        const btn = document.getElementById(`filterBtn_${f.id}`);
        if (btn) {
            if (f.id === filterId) {
                btn.className = `px-2 py-1 text-xs rounded-full border transition-colors bg-blue-600 text-white border-blue-600`;
            } else {
                btn.className = `px-2 py-1 text-xs rounded-full border transition-colors bg-white text-gray-600 border-gray-300 hover:bg-gray-100`;
            }
        }
    });
    renderTaskList();
}

function quickTaskAction(event, taskId, action) {
    event.preventDefault();
    event.stopPropagation();
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;
    const now = new Date().toISOString();
    if (action.startsWith('status:')) {
        const status = action.split(':')[1];
        if (task.status === 'recurring' && status === 'done') {
            alert('定期タスク本体は完了にできません。今日のページから今回分を実施済みにしてください。');
            return;
        }
        const oldStatus = task.status;
        if (oldStatus === status) return;
        task.status = status;
        task.completedAt = status === 'done' ? now : null;
        task.updatedAt = now;
        addHistoryEvent(task, 'system', `ステータスを「${STATUSES[oldStatus]?.label || oldStatus}」から「${STATUSES[status]?.label || status}」に変更しました。`);
        recordActivity(task, 'field-change', 'ステータスを変更', { field: 'status', oldValue: STATUSES[oldStatus]?.label || oldStatus, newValue: STATUSES[status]?.label || status }, now);
    } else if (action === 'today' || action === 'tomorrow') {
        const date = addDaysToDateValue(toDateInputValue(new Date()), action === 'tomorrow' ? 1 : 0);
        if (!isTaskPlannedForDate(task, date)) {
            task.plannedRanges = mergePlannedRanges([...(task.plannedRanges || []), { id: generateId(), startDate: date, endDate: date }]);
            task.isToday = isTaskPlannedForDate(task, toDateInputValue(new Date()));
            task.updatedAt = now;
            recordActivity(task, 'planned-date-added', action === 'today' ? '今日の予定に追加' : '翌日の予定に追加', { date }, now);
        }
    } else if (action === 'log') {
        selectTask(taskId);
        document.getElementById('chatInput').focus();
        return;
    }
    saveData();
    renderTaskList();
    if (currentTaskId === taskId) selectTask(taskId);
}

function createNewTask(parentTaskId = '') {
    const now = new Date().toISOString();
    const parentTask = tasks.find(task => task.id === parentTaskId);
    const newTask = {
        id: generateId(),
        title: '新規タスク',
        description: '',
        priority: 'B',
        status: 'todo',
        projectTagId: parentTask?.projectTagId || '',
        parentTaskId: parentTask?.id || '',
        links: [],
        nextAction: '',
        dueDate: null,
        reminderDate: '',
        isToday: false,
        plannedRanges: [],
        recurrence: null,
        recurrenceRecords: [],
        dailyPlans: {},
        dailyPlanCompleted: {},
        documents: [],
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        history: [
            {
                id: generateId(),
                type: 'system',
                text: 'タスクを作成しました。',
                timestamp: now
            }
        ]
    };
    tasks.push(newTask);
    recordActivity(newTask, 'task-created', 'タスクを作成');
    saveData();
    
    // 完了以外のフィルターの場合はタスクが見えるようにする
    if(currentFilter === 'done') setFilter('all');
    
    searchQuery = '';
    document.getElementById('searchInput').value = '';
    
    renderTaskList();
    selectTask(newTask.id);
    document.getElementById('taskTitleInput').focus();
    document.getElementById('taskTitleInput').select();
}

function createSubtask() {
    if (!currentTaskId) return;
    createNewTask(currentTaskId);
}

function deleteCurrentTask() {
    if (!currentTaskId) return;

    const task = tasks.find(t => t.id === currentTaskId);
    if (!task) return;

    const taskName = task.title || '無題のタスク';
    const childCount = tasks.filter(t => t.parentTaskId === currentTaskId).length;
    const childMessage = childCount > 0 ? `\n${childCount}件の子タスクは親タスクなしに変更されます。` : '';
    if (!confirm(`「${taskName}」を削除しますか？${childMessage}\nこの操作は取り消せません。`)) return;

    recordActivity(task, 'task-deleted', 'タスクを削除', { snapshot: { ...task } });
    tasks.forEach(t => {
        if (t.parentTaskId === currentTaskId) t.parentTaskId = '';
    });
    tasks = tasks.filter(t => t.id !== currentTaskId);
    collapsedTaskIds.delete(currentTaskId);
    localStorage.setItem('chatTaskCollapsedIds', JSON.stringify([...collapsedTaskIds]));
    currentTaskId = null;
    saveData();

    document.getElementById('emptyState').classList.remove('hidden');
    document.getElementById('taskQuickLinksBar').classList.add('hidden');
    document.getElementById('chatHistory').innerHTML = '';
    renderTaskList();
}

function addHistoryEvent(task, type, text) {
    const historyEvent = {
        id: generateId(),
        type: type, // 'system' or 'comment'
        text: text,
        timestamp: new Date().toISOString()
    };
    task.history.push(historyEvent);
    return historyEvent;
}

function toggleDetails() {
    const panel = document.getElementById('taskAttributesPanel');
    const btn = document.getElementById('toggleDetailsBtn');
    isDetailsHidden = !isDetailsHidden;
    localStorage.setItem('chatTaskDetailsHidden', String(isDetailsHidden));
    
    if (isDetailsHidden) {
        panel.classList.add('hidden');
        btn.textContent = '詳細情報を表示する';
    } else {
        panel.classList.remove('hidden');
        btn.textContent = '詳細情報を隠す';
    }
}

function getDescendantTaskIds(taskId) {
    const descendants = new Set();
    const collect = parentId => {
        tasks.filter(task => task.parentTaskId === parentId).forEach(child => {
            if (descendants.has(child.id)) return;
            descendants.add(child.id);
            collect(child.id);
        });
    };
    collect(taskId);
    return descendants;
}

function renderParentTaskSelect(task) {
    const select = document.getElementById('parentTaskSelect');
    const excludedIds = getDescendantTaskIds(task.id);
    excludedIds.add(task.id);
    const candidates = tasks.filter(candidate => !excludedIds.has(candidate.id));

    select.innerHTML = '<option value="">親タスクなし</option>' + candidates.map(candidate =>
        `<option value="${candidate.id}">${escapeHTML(candidate.title || '無題のタスク')}</option>`
    ).join('');
    select.value = task.parentTaskId || '';
}

function renderPlannedDates(task) {
    const list = document.getElementById('plannedDatesList');
    const ranges = Array.isArray(task.plannedRanges) ? task.plannedRanges : [];
    if (ranges.length === 0) {
        list.innerHTML = '<span class="text-xs text-gray-400">予定日は未設定です。</span>';
        return;
    }
    const today = toDateInputValue(new Date());
    const currentAndFutureRanges = ranges.filter(range => range.endDate >= today);
    const pastRanges = ranges.filter(range => range.endDate < today);
    const renderRangeChip = range => {
        const label = range.startDate === range.endDate ? range.startDate : `${range.startDate}〜${range.endDate}`;
        return `
        <span class="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
            ${label}
            <button type="button" data-remove-planned-range="${range.id}" class="hover:text-red-600 font-bold" aria-label="${label}を削除">&times;</button>
        </span>
    `; };
    list.innerHTML = `
        ${currentAndFutureRanges.map(renderRangeChip).join('')}
        ${pastRanges.length ? `
            <details class="w-full mt-1">
                <summary class="text-xs text-gray-500 hover:text-blue-700 cursor-pointer select-none">過去の予定 ${pastRanges.length}件</summary>
                <div class="flex flex-wrap gap-1.5 mt-2 pl-2 border-l-2 border-gray-200">
                    ${pastRanges.map(renderRangeChip).join('')}
                </div>
            </details>
        ` : ''}
    `;
    list.querySelectorAll('[data-remove-planned-range]').forEach(button => {
        button.addEventListener('click', () => removePlannedDateRange(button.dataset.removePlannedRange));
    });
}

function addPlannedDateRange(startValue = document.getElementById('plannedDateInput').value, endValue = document.getElementById('plannedEndDateInput').value) {
    const task = tasks.find(item => item.id === currentTaskId);
    if (!task || !startValue) return;
    const resolvedEndValue = endValue || startValue;
    if (resolvedEndValue < startValue) {
        alert('終了日は開始日以降にしてください。');
        return;
    }
    task.plannedRanges = mergePlannedRanges([...(task.plannedRanges || []), { id: generateId(), startDate: startValue, endDate: resolvedEndValue }]);
    task.isToday = isTaskPlannedForDate(task, toDateInputValue(new Date()));
    task.updatedAt = new Date().toISOString();
    recordActivity(task, 'planned-range-added', startValue === resolvedEndValue ? '予定日を追加' : '予定期間を追加', {
        date: startValue, startDate: startValue, endDate: resolvedEndValue
    }, task.updatedAt);
    saveData();
    renderPlannedDates(task);
    renderTaskDailyPlans(task);
    renderTaskList();
}

function addTodayAsPlannedDate() {
    const today = toDateInputValue(new Date());
    document.getElementById('plannedDateInput').value = today;
    document.getElementById('plannedEndDateInput').value = '';
    addPlannedDateRange(today, today);
}

function removePlannedDateRange(rangeId) {
    const task = tasks.find(item => item.id === currentTaskId);
    const range = task?.plannedRanges?.find(item => item.id === rangeId);
    if (!task || !range) return;
    task.plannedRanges = task.plannedRanges.filter(item => item.id !== rangeId);
    task.isToday = isTaskPlannedForDate(task, toDateInputValue(new Date()));
    task.updatedAt = new Date().toISOString();
    recordActivity(task, 'planned-range-removed', range.startDate === range.endDate ? '予定日を削除' : '予定期間を削除', {
        date: range.startDate, startDate: range.startDate, endDate: range.endDate
    }, task.updatedAt);
    saveData();
    renderPlannedDates(task);
    renderTaskDailyPlans(task);
    renderTaskList();
}

function normalizeLinkUrl(value) {
    let url = value.trim();
    if (!url) return null;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
    } catch (error) {
        return null;
    }
}

function renderTaskLinks(task) {
    renderQuickTaskLinks(task);
    const list = document.getElementById('taskLinksList');
    list.innerHTML = '';
    const links = Array.isArray(task.links) ? task.links : [];
    if (links.length === 0) {
        list.innerHTML = '<p class="text-xs text-gray-400">関連リンクはまだありません。</p>';
        return;
    }

    links.forEach(link => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-2 bg-white border border-gray-200 rounded px-2 py-1.5';

        const anchor = document.createElement('a');
        anchor.href = link.url;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.className = 'flex-1 min-w-0 text-sm text-blue-600 hover:text-blue-800 hover:underline truncate';
        anchor.textContent = link.label || link.url;
        anchor.title = link.url;

        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'text-xs text-gray-500 hover:text-blue-700 shrink-0';
        editButton.textContent = '編集';
        editButton.addEventListener('click', () => editTaskLink(task.id, link.id));

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'text-xs text-red-600 hover:text-red-800 shrink-0';
        deleteButton.textContent = '削除';
        deleteButton.addEventListener('click', () => deleteTaskLink(task.id, link.id));

        row.append(anchor, editButton, deleteButton);
        list.appendChild(row);
    });
}

function renderQuickTaskLinks(task) {
    const bar = document.getElementById('taskQuickLinksBar');
    const container = document.getElementById('taskQuickLinks');
    const links = Array.isArray(task?.links) ? task.links : [];
    container.innerHTML = '';
    bar.classList.toggle('hidden', links.length === 0);
    links.forEach(link => {
        const anchor = document.createElement('a');
        anchor.href = link.url;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.className = 'inline-flex items-center gap-1 px-2.5 py-1 text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-full whitespace-nowrap';
        anchor.textContent = `↗ ${link.label || link.url}`;
        anchor.title = link.url;
        container.appendChild(anchor);
    });
}

function addTaskLink(event) {
    event.preventDefault();
    const task = tasks.find(item => item.id === currentTaskId);
    if (!task) return;

    const labelInput = document.getElementById('taskLinkLabelInput');
    const urlInput = document.getElementById('taskLinkUrlInput');
    const url = normalizeLinkUrl(urlInput.value);
    if (!url) {
        alert('有効なURLを入力してください。');
        return;
    }

    const parsedUrl = new URL(url);
    task.links = Array.isArray(task.links) ? task.links : [];
    task.links.push({ id: generateId(), label: labelInput.value.trim() || parsedUrl.hostname, url });
    task.updatedAt = new Date().toISOString();
    recordActivity(task, 'link-added', '関連リンクを追加', { label: labelInput.value.trim() || parsedUrl.hostname, url }, task.updatedAt);
    labelInput.value = '';
    urlInput.value = '';
    saveData();
    renderTaskLinks(task);
    renderTaskList();
    labelInput.focus();
}

function editTaskLink(taskId, linkId) {
    const task = tasks.find(item => item.id === taskId);
    const link = task?.links?.find(item => item.id === linkId);
    if (!link) return;

    const label = prompt('リンク名を編集してください。', link.label || '');
    if (label === null) return;
    const urlValue = prompt('URLを編集してください。', link.url);
    if (urlValue === null) return;
    const url = normalizeLinkUrl(urlValue);
    if (!url) {
        alert('有効なURLを入力してください。');
        return;
    }

    link.label = label.trim() || new URL(url).hostname;
    link.url = url;
    task.updatedAt = new Date().toISOString();
    recordActivity(task, 'link-edited', '関連リンクを編集', { label: link.label, url }, task.updatedAt);
    saveData();
    renderTaskLinks(task);
    renderTaskList();
}

function deleteTaskLink(taskId, linkId) {
    const task = tasks.find(item => item.id === taskId);
    const link = task?.links?.find(item => item.id === linkId);
    if (!link || !confirm(`リンク「${link.label || link.url}」を削除しますか？`)) return;
    recordActivity(task, 'link-deleted', '関連リンクを削除', { label: link.label, url: link.url });
    task.links = task.links.filter(item => item.id !== linkId);
    task.updatedAt = new Date().toISOString();
    saveData();
    renderTaskLinks(task);
    renderTaskList();
}

function getTaskDepth(task) {
    let depth = 0;
    let parentId = task.parentTaskId;
    const visited = new Set([task.id]);
    while (parentId && depth < 3 && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = tasks.find(item => item.id === parentId);
        if (!parent) break;
        depth += 1;
        parentId = parent.parentTaskId;
    }
    return depth;
}

function isTaskHiddenByCollapsedParent(task, visibleTaskIds = null) {
    let parentId = task.parentTaskId;
    const visited = new Set([task.id]);
    while (parentId && !visited.has(parentId)) {
        if (collapsedTaskIds.has(parentId) && (!visibleTaskIds || visibleTaskIds.has(parentId))) return true;
        visited.add(parentId);
        parentId = tasks.find(item => item.id === parentId)?.parentTaskId;
    }
    return false;
}

function toggleSubtasks(event, taskId) {
    event.stopPropagation();
    if (collapsedTaskIds.has(taskId)) collapsedTaskIds.delete(taskId);
    else collapsedTaskIds.add(taskId);
    localStorage.setItem('chatTaskCollapsedIds', JSON.stringify([...collapsedTaskIds]));
    renderTaskList();
}

function renderTaskList() {
    const listEl = document.getElementById('taskList');
    listEl.innerHTML = '';

    let filtered = tasks.filter(t => {
        if (isRecurringTasksHidden && t.status === 'recurring') return false;
        if (currentTagFilter === 'none' && t.projectTagId) return false;
        if (currentTagFilter !== 'all' && currentTagFilter !== 'none' && t.projectTagId !== currentTagFilter) return false;

        // 検索
        if (searchQuery) {
            const tagName = projectTags.find(tag => tag.id === t.projectTagId)?.name || '';
            const linkText = (t.links || []).map(link => `${link.label || ''} ${link.url || ''}`).join(' ');
            const documentText = (t.documents || []).map(docEntry => `${docEntry.title || ''} ${docEntry.content || ''}`).join(' ');
            const searchStr = (t.title + ' ' + tagName + ' ' + linkText + ' ' + documentText + ' ' + (t.description || '') + ' ' + (t.nextAction || '') + ' ' + t.history.map(h => h.text).join(' ')).toLowerCase();
            if (!searchStr.includes(searchQuery)) return false;
        }

        // フィルター
        switch (currentFilter) {
            case 'today': {
                const today = toDateInputValue(new Date());
                return (isTaskPendingForDate(t, today) || isRecurringTaskDue(t, today)) && t.status !== 'done';
            }
            case 'my-turn': return ['doing', 'recurring', 'waiting-general', 'waiting-client', 'waiting-team', 'waiting-pr', 'waiting-staging', 'waiting-prod', 'pending'].includes(t.status);
            case 'waiting': return t.status.startsWith('waiting');
            case 'deadline': return (t.reminderDate || t.dueDate) && t.status !== 'done';
            case 'done': return t.status === 'done';
            case 'all-with-done': return true;
            case 'all': 
            default: 
                return t.status !== 'done';
        }
    });

    // ソート
    filtered.sort((a, b) => {
        // 1. 優先度
        const pA = PRIORITIES[a.priority]?.value || 0;
        const pB = PRIORITIES[b.priority]?.value || 0;
        if (pA !== pB) return pB - pA; // 高い順
        
        // 2. 今日やる
        const today = toDateInputValue(new Date());
        const aIsToday = isTaskPendingForDate(a, today) || isRecurringTaskDue(a, today);
        const bIsToday = isTaskPendingForDate(b, today) || isRecurringTaskDue(b, today);
        if (aIsToday && !bIsToday) return -1;
        if (!aIsToday && bIsToday) return 1;

        // 3. リマインド日 (近い順)
        if (a.reminderDate && b.reminderDate) {
            const dA = new Date(a.reminderDate).getTime();
            const dB = new Date(b.reminderDate).getTime();
            if (dA !== dB) return dA - dB;
        } else if (a.reminderDate) { return -1; }
        else if (b.reminderDate) { return 1; }

        // 4. 最終更新日 (新しい順)
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    // 親タスクの直後に子タスクが並ぶよう、ソート済み順序を保ちながら階層化
    const filteredIds = new Set(filtered.map(task => task.id));
    const orderedTasks = [];
    const appendedIds = new Set();
    const appendWithChildren = task => {
        if (appendedIds.has(task.id)) return;
        appendedIds.add(task.id);
        orderedTasks.push(task);
        filtered.filter(child => child.parentTaskId === task.id).forEach(appendWithChildren);
    };
    filtered.filter(task => !task.parentTaskId || !filteredIds.has(task.parentTaskId)).forEach(appendWithChildren);
    filtered.forEach(appendWithChildren);
    filtered = orderedTasks.filter(task => !isTaskHiddenByCollapsedParent(task, filteredIds));

    if (filtered.length === 0) {
        listEl.innerHTML = `<div class="p-4 text-center text-sm text-gray-500">該当するタスクがありません</div>`;
        return;
    }

    const todayStr = toDateInputValue(new Date());

    filtered.forEach(t => {
        const isSelected = t.id === currentTaskId;
        const statusInfo = STATUSES[t.status] || STATUSES['todo'];
        const priorityInfo = PRIORITIES[t.priority] || PRIORITIES['B'];
        const projectTag = projectTags.find(tag => tag.id === t.projectTagId && tag.visible);
        const parentTask = tasks.find(task => task.id === t.parentTaskId);
        const childTasks = tasks.filter(task => task.parentTaskId === t.id);
        const childCount = childTasks.length;
        const completedChildCount = childTasks.filter(task => task.status === 'done').length;
        const firstPlannedRange = t.plannedRanges?.find(range => range.endDate >= todayStr) || t.plannedRanges?.[t.plannedRanges.length - 1];
        const plannedDateSummary = firstPlannedRange ? `${firstPlannedRange.startDate.slice(5).replace('-', '/')}${firstPlannedRange.endDate !== firstPlannedRange.startDate ? `〜${firstPlannedRange.endDate.slice(5).replace('-', '/')}` : ''}${t.plannedRanges.length > 1 ? ` +${t.plannedRanges.length - 1}` : ''}` : '';
        const recurrenceLabel = t.status === 'recurring' ? getRecurrenceLabel(t) : '';
        
        let reminderLabel = '';
        if (t.reminderDate) {
            if (t.reminderDate < todayStr) reminderLabel = `<span class="text-xs font-bold text-red-600 bg-red-100 px-1 rounded">期限超過: ${t.reminderDate}</span>`;
            else if (t.reminderDate === todayStr) reminderLabel = `<span class="text-xs font-bold text-orange-600 bg-orange-100 px-1 rounded">本日リマインド</span>`;
            else reminderLabel = `<span class="text-xs text-gray-500">リマインド: ${t.reminderDate}</span>`;
        }

        const item = document.createElement('div');
        const isCompact = taskCardDensity !== 'standard';
        const isMinimal = taskCardDensity === 'minimal';
        item.className = `relative ${isMinimal ? 'px-2 py-1' : isCompact ? 'p-2' : 'p-3'} rounded-lg border cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 border-blue-400 shadow-sm' : 'bg-white border-gray-200 hover:bg-gray-50'}`;
        item.style.marginLeft = `${getTaskDepth(t) * 12}px`;
        item.onclick = () => selectTask(t.id);
        
        item.innerHTML = `
            <div class="flex justify-between items-start ${isCompact ? 'mb-0' : 'mb-1'}">
                <h3 class="font-bold text-sm text-gray-800 line-clamp-1 flex-1 ${t.status === 'done' ? 'line-through text-gray-500' : ''}">
                    ${isTaskPendingForDate(t, todayStr) || isRecurringTaskDue(t, todayStr) ? '<span class="text-xs bg-blue-500 text-white px-1.5 py-0.5 rounded mr-1">今日</span>' : ''}
                    ${escapeHTML(t.title) || '(無題)'}
                </h3>
                <details data-quick-menu class="relative ml-1 shrink-0">
                    <summary class="list-none w-6 h-6 rounded text-center text-gray-500 hover:bg-gray-200 cursor-pointer" aria-label="${escapeHTML(t.title || 'タスク')}の簡易操作">⋯</summary>
                    <div class="absolute right-0 top-full z-30 mt-1 w-40 bg-white border border-gray-200 rounded-md shadow-lg overflow-hidden text-xs font-normal">
                        <button onclick="quickTaskAction(event, '${t.id}', 'status:doing')" class="block w-full px-3 py-2 text-left hover:bg-gray-50">進行中にする</button>
                        <button onclick="quickTaskAction(event, '${t.id}', 'status:waiting-general')" class="block w-full px-3 py-2 text-left hover:bg-gray-50">待ちにする</button>
                        ${t.status !== 'recurring' ? `<button onclick="quickTaskAction(event, '${t.id}', 'status:done')" class="block w-full px-3 py-2 text-left hover:bg-gray-50">完了にする</button>` : ''}
                        <button onclick="quickTaskAction(event, '${t.id}', 'today')" class="block w-full px-3 py-2 text-left hover:bg-gray-50 border-t border-gray-100">今日へ追加</button>
                        <button onclick="quickTaskAction(event, '${t.id}', 'tomorrow')" class="block w-full px-3 py-2 text-left hover:bg-gray-50">翌日へ追加</button>
                        <button onclick="quickTaskAction(event, '${t.id}', 'log')" class="block w-full px-3 py-2 text-left hover:bg-gray-50 border-t border-gray-100">作業ログを追加</button>
                    </div>
                </details>
            </div>
            <div class="flex flex-wrap ${isMinimal ? 'gap-1 mb-0' : isCompact ? 'gap-1 mb-1' : 'gap-1.5 mb-2'} items-center">
                ${parentTask && !isMinimal ? `<span class="text-[10px] text-gray-500">↳ ${escapeHTML(parentTask.title || '無題')}</span>` : ''}
                ${childCount ? `<button type="button" data-subtask-toggle class="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600" aria-expanded="${!collapsedTaskIds.has(t.id)}">${collapsedTaskIds.has(t.id) ? '▸' : '▾'} 子タスク ${completedChildCount}/${childCount}完了</button>` : ''}
                ${projectTag ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700">${escapeHTML(projectTag.name)}</span>` : ''}
                ${plannedDateSummary && !isMinimal ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700">予定 ${plannedDateSummary}</span>` : ''}
                ${recurrenceLabel && !isMinimal ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-50 text-cyan-700">${t.recurrence.paused ? '停止中 ' : ''}${recurrenceLabel}</span>` : ''}
                <span class="text-[10px] px-1.5 py-0.5 rounded-full ${statusInfo.color}">${statusInfo.label}</span>
                <span class="text-[10px] ${priorityInfo.color}">優先度:${priorityInfo.label}</span>
            </div>
            ${t.nextAction && !isMinimal ? `<div class="text-xs text-gray-600 bg-gray-50 ${isCompact ? 'px-1 py-0.5 mb-0.5' : 'p-1 mb-1'} rounded border border-gray-100 line-clamp-1">次: ${escapeHTML(t.nextAction)}</div>` : ''}
            ${!isMinimal ? `<div class="flex justify-between items-center ${isCompact ? 'mt-0.5' : 'mt-2'}">
                ${reminderLabel}
                <span class="text-[10px] text-gray-400 ml-auto">${formatDate(t.updatedAt, false)} 更新</span>
            </div>` : ''}
        `;
        const subtaskToggle = item.querySelector('[data-subtask-toggle]');
        if (subtaskToggle) subtaskToggle.addEventListener('click', event => toggleSubtasks(event, t.id));
        const quickMenu = item.querySelector('[data-quick-menu]');
        if (quickMenu) quickMenu.addEventListener('click', event => event.stopPropagation());
        listEl.appendChild(item);
    });
}

function selectTask(id) {
    currentTaskId = id;
    
    // モバイル時の画面切り替え対応 (簡易)
    const rightSec = document.getElementById('taskDetailSection');
    rightSec.classList.remove('hidden');
    rightSec.classList.add('flex'); // 強制表示

    const task = tasks.find(t => t.id === id);
    if (!task) return;

    // UI更新
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('taskTitleInput').value = task.title;
    document.getElementById('statusSelect').value = task.status;
    document.getElementById('prioritySelect').value = task.priority;
    document.getElementById('reminderDateInput').value = task.reminderDate || '';
    document.getElementById('plannedDateInput').value = toDateInputValue(new Date());
    document.getElementById('plannedEndDateInput').value = '';
    renderPlannedDates(task);
    renderTagControls();
    renderParentTaskSelect(task);
    renderRecurringSettings(task);
    renderTaskDailyPlans(task);
    renderTaskLinks(task);
    document.getElementById('taskLinkLabelInput').value = '';
    document.getElementById('taskLinkUrlInput').value = '';
    document.getElementById('taskDescriptionInput').value = task.description || '';
    document.getElementById('nextActionInput').value = task.nextAction || '';

    // 折りたたみ状態の反映
    const panel = document.getElementById('taskAttributesPanel');
    const btn = document.getElementById('toggleDetailsBtn');
    if (isDetailsHidden) {
        panel.classList.add('hidden');
        btn.textContent = '詳細情報を表示する';
    } else {
        panel.classList.remove('hidden');
        btn.textContent = '詳細情報を隠す';
    }

    renderChatHistory();
    renderTaskList(); // 選択状態のスタイル更新
}

function renderChatHistory() {
    if (!currentTaskId) return;
    const task = tasks.find(t => t.id === currentTaskId);
    const chatEl = document.getElementById('chatHistory');
    chatEl.innerHTML = '';

    if (!task.history || task.history.length === 0) {
        chatEl.innerHTML = `<div class="text-center text-gray-400 text-sm py-4">作業ログ・変更履歴はまだありません</div>`;
        return;
    }

    task.history.forEach(h => {
        const wrapper = document.createElement('div');
        
        if (h.type === 'system') {
            // システムメッセージ（中央揃え、小さめ）
            wrapper.className = 'flex justify-center my-2';
            wrapper.innerHTML = `
                <div class="bg-gray-200/70 text-gray-600 text-xs px-3 py-1 rounded-full flex items-center gap-1">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    ${escapeHTML(h.text)}
                    <span class="text-[10px] ml-1 text-gray-400">${formatDate(h.timestamp)}</span>
                </div>
            `;
        } else {
            // 通常コメント（Slack風 左寄せ）
            wrapper.className = 'flex items-start gap-3 w-full';
            
            // Markdownをパースしてサニタイズし、リンクは別タブで開く
            const cleanHtml = renderMarkdown(h.text);
            
            wrapper.innerHTML = `
                <div class="w-8 h-8 rounded bg-blue-100 flex items-center justify-center text-blue-700 font-bold shrink-0 mt-1">
                    You
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-baseline gap-2 mb-0.5">
                        <span class="font-bold text-sm text-gray-800">あなた</span>
                        <span class="text-xs text-gray-400">${formatDate(h.timestamp)}</span>
                        ${h.editedAt ? '<span class="text-[10px] text-gray-400">編集済み</span>' : ''}
                        <div class="ml-auto flex items-center gap-2">
                            <button type="button" data-action="edit" class="text-xs text-blue-600 hover:text-blue-800 hover:underline">編集</button>
                            <button type="button" data-action="delete" class="text-xs text-red-600 hover:text-red-800 hover:underline">削除</button>
                        </div>
                    </div>
                    <!-- proseクラスを付与してMarkdownスタイルを適用 -->
                    <div data-memo-content class="prose prose-sm prose-blue max-w-none text-sm text-gray-700 leading-relaxed break-words bg-white border border-gray-100 p-3 rounded-lg shadow-sm">
                        ${cleanHtml}
                    </div>
                </div>
            `;
            wrapper.querySelector('[data-action="edit"]').addEventListener('click', () => startMemoEdit(task.id, h.id, wrapper));
            wrapper.querySelector('[data-action="delete"]').addEventListener('click', () => deleteMemo(task.id, h.id));
        }
        chatEl.appendChild(wrapper);
    });

    // スクロールを一番下へ
    chatEl.scrollTop = chatEl.scrollHeight;
}

function resizeChatInput() {
    const input = document.getElementById('chatInput');
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 192)}px`;
}

function startMemoEdit(taskId, memoId, wrapper) {
    const task = tasks.find(t => t.id === taskId);
    const memo = task?.history.find(h => h.id === memoId && h.type === 'comment');
    if (!memo) return;

    const content = wrapper.querySelector('[data-memo-content]');
    const editButton = wrapper.querySelector('[data-action="edit"]');
    const deleteButton = wrapper.querySelector('[data-action="delete"]');
    editButton.disabled = true;
    deleteButton.disabled = true;

    content.classList.remove('prose');
    content.innerHTML = `
        <textarea data-edit-input rows="5" class="w-full p-2 border border-blue-300 rounded-md text-sm leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
        <div class="flex items-center justify-between mt-2">
            <span class="text-[10px] text-gray-400">Ctrl / ⌘ + Enterでも保存できます</span>
            <div class="flex gap-2">
                <button type="button" data-edit-cancel class="px-3 py-1.5 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 rounded">キャンセル</button>
                <button type="button" data-edit-save class="px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded">保存</button>
            </div>
        </div>
    `;

    const input = content.querySelector('[data-edit-input]');
    const save = () => saveEditedMemo(taskId, memoId, input.value);
    input.value = memo.text;
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            save();
        } else if (event.key === 'Escape') {
            renderChatHistory();
        }
    });
    content.querySelector('[data-edit-save]').addEventListener('click', save);
    content.querySelector('[data-edit-cancel]').addEventListener('click', renderChatHistory);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
}

function saveEditedMemo(taskId, memoId, editedText) {
    const task = tasks.find(t => t.id === taskId);
    const memo = task?.history.find(h => h.id === memoId && h.type === 'comment');
    if (!memo) return;

    const text = editedText.trim();
    if (!text) {
        alert('メモを空にはできません。');
        return;
    }
    if (text === memo.text) {
        renderChatHistory();
        return;
    }

    memo.text = text;
    memo.editedAt = new Date().toISOString();
    task.updatedAt = memo.editedAt;
    recordActivity(task, 'memo-edited', 'メモを編集', { text }, task.updatedAt);
    saveData();
    renderChatHistory();
    renderTaskList();
}

function deleteMemo(taskId, memoId) {
    const task = tasks.find(t => t.id === taskId);
    const memo = task?.history.find(h => h.id === memoId && h.type === 'comment');
    if (!memo || !confirm('このメモを削除しますか？\nこの操作は取り消せません。')) return;

    recordActivity(task, 'memo-deleted', 'メモを削除', { text: memo.text });
    task.history = task.history.filter(h => h.id !== memoId);
    task.updatedAt = new Date().toISOString();
    saveData();
    renderChatHistory();
    renderTaskList();
}

function submitChat(e) {
    if(e) e.preventDefault();
    if (!currentTaskId) return;

    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    
    if (!text) return;

    const task = tasks.find(t => t.id === currentTaskId);
    
    const historyEvent = addHistoryEvent(task, 'comment', text);
    task.updatedAt = new Date().toISOString();
    recordActivity(task, 'memo', '作業ログを追加', { text }, task.updatedAt, historyEvent.id);
    
    input.value = '';
    resizeChatInput();
    saveData();
    renderChatHistory();
    renderTaskList();
}

function exportData() {
    const dataStr = JSON.stringify({ version: 10, tasks, projectTags, activityLog, dailyNotes, nonWorkingPeriods }, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chattask_export_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = JSON.parse(e.target.result);
            if (Array.isArray(imported) || (imported && Array.isArray(imported.tasks))) {
                tasks = Array.isArray(imported) ? imported : imported.tasks;
                normalizeTaskStatuses();
                normalizeTaskPriorities();
                normalizeTaskRelationships();
                if (!Array.isArray(imported) && Array.isArray(imported.projectTags)) {
                    projectTags = imported.projectTags;
                    saveProjectTags();
                }
                const hasImportedActivityLog = !Array.isArray(imported) && Array.isArray(imported.activityLog);
                activityLog = hasImportedActivityLog ? imported.activityLog : [];
                saveActivityLog();
                if (hasImportedActivityLog) localStorage.setItem('chatTaskActivityMigrationV1', 'done');
                else {
                    localStorage.removeItem('chatTaskActivityMigrationV1');
                    migrateExistingHistoryToActivityLog(true);
                }
                dailyNotes = !Array.isArray(imported) && imported.dailyNotes && typeof imported.dailyNotes === 'object' ? imported.dailyNotes : {};
                localStorage.setItem('chatTaskDailyNotes', JSON.stringify(dailyNotes));
                nonWorkingPeriods = !Array.isArray(imported) && Array.isArray(imported.nonWorkingPeriods) ? imported.nonWorkingPeriods : [];
                localStorage.setItem('chatTaskNonWorkingPeriods', JSON.stringify(nonWorkingPeriods));
                saveData();
                currentTaskId = null; // 選択解除
                document.getElementById('emptyState').classList.remove('hidden');
                document.getElementById('taskQuickLinksBar').classList.add('hidden');
                renderTagControls();
                renderTaskList();
                alert('データをインポートしました。');
            } else {
                alert('無効なデータ形式です。');
            }
        } catch (err) {
            alert('ファイルの読み込みに失敗しました。');
        }
        event.target.value = ''; // リセット
    };
    reader.readAsText(file);
}

// 初期実行
document.addEventListener('DOMContentLoaded', init);
