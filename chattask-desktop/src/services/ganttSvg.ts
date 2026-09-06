import type { PlannedRange } from "../types";
import { xmlEscape } from "./xmlSpreadsheet";

export interface GanttSvgRow {
  kind: "project" | "task" | "schedule" | "milestone" | "work";
  title: string;
  periodLabel?: string;
  depth: number;
  hasChildren?: boolean;
  status: string;
  statusTone: "cancelled" | "handed-over" | "done" | "waiting" | "doing" | "todo";
  priority?: string;
  tagName?: string;
  baselineRanges: PlannedRange[];
  plannedRanges: PlannedRange[];
  actualDates: string[];
  achievedDates: string[];
  plannedHours: number;
  actualHours: number;
  dueDate: string;
  delayed: boolean;
}

type DisplayMode = "compare" | "planned" | "actual";

const hours = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
const dateObject = (value: string) => new Date(`${value}T12:00:00`);
const badgeWidth = (label: string) => Array.from(label).reduce((sum, character) => sum + (/^[\x00-\x7F]$/.test(character) ? 6 : 10), 12);
const badge = (label: string, x: number, y: number, fill: string, color: string, border = "none") => {
  const width = badgeWidth(label);
  return { width, svg: `<g><rect x="${x}" y="${y}" width="${width}" height="17" rx="8.5" fill="${fill}" stroke="${border}"/><text x="${x + 6}" y="${y + 12}" fill="${color}" font-size="9" font-weight="700">${xmlEscape(label)}</text></g>` };
};
const contiguousDateRanges = (values: string[]) => {
  const sorted = [...new Set(values)].filter(Boolean).sort();
  const ranges: Array<{ start: string; end: string }> = [];
  sorted.forEach((date) => {
    const previous = ranges[ranges.length - 1];
    if (previous) {
      const next = dateObject(previous.end);
      next.setDate(next.getDate() + 1);
      if (next.toISOString().slice(0, 10) === date) {
        previous.end = date;
        return;
      }
    }
    ranges.push({ start: date, end: date });
  });
  return ranges;
};

export const createGanttSvg = ({
  title,
  start,
  end,
  dates,
  dateLabels,
  plannedEffort,
  nonWorkingDates,
  display,
  cellWidth,
  rows,
}: {
  title: string;
  start: string;
  end: string;
  dates: string[];
  dateLabels: string[];
  plannedEffort: number[];
  nonWorkingDates: Set<string>;
  display: DisplayMode;
  cellWidth: number;
  rows: GanttSvgRow[];
}) => {
  const labelWidth = 420;
  const topHeight = 88;
  const overviewHeight = 34;
  const headerHeight = 58;
  const hasBaseline = display === "compare" && rows.some((row) => row.baselineRanges.length);
  const rowHeight = display === "compare" ? hasBaseline ? 82 : 72 : 52;
  const timelineWidth = Math.max(cellWidth, dates.length * cellWidth);
  const width = labelWidth + timelineWidth;
  const chartTop = topHeight + overviewHeight;
  const rowsTop = chartTop + headerHeight;
  const height = rowsTop + Math.max(1, rows.length) * rowHeight + 18;
  const statusColors: Record<GanttSvgRow["statusTone"], string> = {
    cancelled: "#64748b",
    "handed-over": "#7c3aed",
    done: "#16a34a",
    waiting: "#d97706",
    doing: "#2563eb",
    todo: "#64748b",
  };
  const kindColors: Record<GanttSvgRow["kind"], { fill: string; color: string; icon: string }> = {
    project: { fill: "#dbeafe", color: "#1d4ed8", icon: "◫" },
    milestone: { fill: "#fef3c7", color: "#92400e", icon: "◆" },
    task: { fill: "#e2e8f0", color: "#475569", icon: "≡" },
    schedule: { fill: "#dcfce7", color: "#166534", icon: "▣" },
    work: { fill: "#dcfce7", color: "#166534", icon: "▣" },
  };
  const priorityColors: Record<string, { fill: string; color: string }> = {
    A: { fill: "#fee2e2", color: "#b91c1c" },
    B: { fill: "#dcfce7", color: "#166534" },
    C: { fill: "#dbeafe", color: "#1d4ed8" },
    D: { fill: "#f3e8ff", color: "#7e22ce" },
  };
  const rangeRect = (startDate: string, endDate: string, y: number, rectHeight: number, fill: string, stroke = "none", dash = "") => {
    const clippedStart = startDate < start ? start : startDate;
    const clippedEnd = endDate > end ? end : endDate;
    const startIndex = dates.indexOf(clippedStart);
    const endIndex = dates.indexOf(clippedEnd);
    if (startIndex < 0 || endIndex < startIndex) return "";
    const dashAttribute = dash ? ` stroke-dasharray="${dash}"` : "";
    return `<rect x="${labelWidth + startIndex * cellWidth + 1}" y="${y}" width="${Math.max(2, (endIndex - startIndex + 1) * cellWidth - 2)}" height="${rectHeight}" rx="5" fill="${fill}" stroke="${stroke}"${dashAttribute}/>`;
  };

  const effortFill = (effort: number) => effort > 8 ? "#fee2e2" : effort > 6 ? "#fef3c7" : effort > 4 ? "#dbeafe" : effort > 0 ? "#dcfce7" : "#f8fafc";
  const dateHeader = dates.map((_, index) => {
    const x = labelWidth + index * cellWidth;
    const effort = plannedEffort[index] || 0;
    return `<g><rect x="${x}" y="${chartTop}" width="${cellWidth}" height="${headerHeight}" fill="#f8fafc"/><rect x="${x}" y="${chartTop + 28}" width="${cellWidth}" height="${headerHeight - 28}" fill="${effortFill(effort)}"/><line x1="${x + cellWidth}" y1="${chartTop}" x2="${x + cellWidth}" y2="${height}" stroke="#e2e8f0"/><text x="${x + cellWidth / 2}" y="${chartTop + 17}" text-anchor="middle" fill="#475569" font-size="10" font-weight="700">${xmlEscape(dateLabels[index] || "")}</text>${effort > 0 && cellWidth >= 18 ? `<text x="${x + cellWidth / 2}" y="${chartTop + 47}" text-anchor="middle" fill="${effort > 8 ? "#b91c1c" : "#334155"}" font-size="8" font-weight="700">${hours(effort)}h</text>` : ""}</g>`;
  }).join("");
  const legend = `<g transform="translate(${Math.max(330, width - 870)} 55)" font-size="9" fill="#475569"><rect x="0" y="-8" width="22" height="8" rx="3" fill="#f8fafc" stroke="#64748b" stroke-dasharray="4 3"/><text x="28" y="0">親の集約期間</text><rect x="120" y="-8" width="22" height="8" rx="3" fill="#e2e8f0" stroke="#64748b" stroke-dasharray="4 3"/><text x="148" y="0">当初予定</text><rect x="215" y="-8" width="22" height="8" rx="3" fill="#93c5fd"/><text x="243" y="0">作業予定</text><rect x="310" y="-8" width="22" height="8" rx="3" fill="#22c55e"/><text x="338" y="0">作業あり</text><rect x="407" y="-8" width="10" height="10" fill="#f97316" transform="rotate(45 412 -3)"/><text x="426" y="0">期限</text></g>`;
  const overview = `<g><rect x="0" y="${topHeight}" width="${width}" height="${overviewHeight}" fill="#f8fafc"/><text x="14" y="${topHeight + 21}" fill="#64748b" font-size="10"><tspan fill="#1e293b" font-weight="700">${rows.length}</tspan>件を表示</text><text x="88" y="${topHeight + 21}" fill="#dc2626" font-size="10">${rows.filter((row) => row.delayed).length ? `${rows.filter((row) => row.delayed).length}件の期限超過` : ""}</text><text x="${Math.max(260, width - 635)}" y="${topHeight + 21}" fill="#475569" font-size="9" font-weight="700">日別工数　</text><rect x="${Math.max(310, width - 585)}" y="${topHeight + 12}" width="10" height="10" rx="2" fill="#dcfce7"/><text x="${Math.max(324, width - 571)}" y="${topHeight + 21}" fill="#64748b" font-size="9">〜4h</text><rect x="${Math.max(354, width - 541)}" y="${topHeight + 12}" width="10" height="10" rx="2" fill="#dbeafe"/><text x="${Math.max(368, width - 527)}" y="${topHeight + 21}" fill="#64748b" font-size="9">〜6h</text><rect x="${Math.max(398, width - 497)}" y="${topHeight + 12}" width="10" height="10" rx="2" fill="#fef3c7"/><text x="${Math.max(412, width - 483)}" y="${topHeight + 21}" fill="#64748b" font-size="9">〜8h</text><rect x="${Math.max(442, width - 453)}" y="${topHeight + 12}" width="10" height="10" rx="2" fill="#fee2e2"/><text x="${Math.max(456, width - 439)}" y="${topHeight + 21}" fill="#64748b" font-size="9">8h超</text></g>`;
  const rowSvg = rows.map((row, rowIndex) => {
    const y = rowsTop + rowIndex * rowHeight;
    const timelineBackground = rowIndex % 2 ? "#f8fafc" : "#ffffff";
    const labelBackground = row.kind === "project" || row.kind === "task" && row.depth === 0
      ? "#eff6ff"
      : row.kind === "milestone"
        ? "#fffbeb"
        : row.kind === "schedule" || row.kind === "work"
          ? "#f7fee7"
          : timelineBackground;
    const columns = dates.map((date, index) => `<rect x="${labelWidth + index * cellWidth}" y="${y}" width="${cellWidth}" height="${rowHeight}" fill="${nonWorkingDates.has(date) ? "#faf5ff" : timelineBackground}"/>`).join("");
    const titleBase = 14 + row.depth * 18;
    const icon = kindColors[row.kind];
    const titleX = titleBase + 28;
    const titleColor = row.kind === "schedule" || row.kind === "work" ? "#166534" : row.kind === "task" && row.depth === 0 ? "#1e3a8a" : "#1e293b";
    let metaX = titleX;
    const metaY = y + rowHeight - 23;
    const meta: string[] = [];
    if (row.kind === "schedule" && row.periodLabel) {
      meta.push(`<text x="${metaX}" y="${metaY + 12}" fill="#475569" font-size="9" font-weight="700">${xmlEscape(row.periodLabel)}</text>`);
      metaX += Math.min(125, badgeWidth(row.periodLabel) + 12);
    }
    if (row.hasChildren) {
      const item = badge("集約", metaX, metaY, "#f8fafc", "#475569", "#cbd5e1");
      meta.push(item.svg);
      metaX += item.width + 6;
    }
    if (row.tagName) {
      const item = badge(row.tagName, metaX, metaY, "#ccfbf1", "#0f766e", "#99f6e4");
      meta.push(item.svg);
      metaX += item.width + 6;
    }
    const statusText = row.kind === "schedule" && row.delayed ? "遅延" : row.status;
    const status = badge(statusText, metaX, metaY, statusColors[row.statusTone], "#ffffff");
    meta.push(status.svg);
    metaX += status.width + 6;
    if (row.priority) {
      const colors = priorityColors[row.priority] || { fill: "#f1f5f9", color: "#475569" };
      const priority = badge(row.priority, metaX, metaY, colors.fill, colors.color);
      meta.push(priority.svg);
      metaX += priority.width + 6;
    }
    meta.push(`<text x="${metaX}" y="${metaY + 12}" fill="#64748b" font-size="9">予定 ${hours(row.plannedHours)}h / 実績 ${hours(row.actualHours)}h</text>`);
    const actualRanges = contiguousDateRanges([...row.actualDates, ...row.achievedDates]);
    const baselineY = y + 8;
    const plannedY = y + (display === "compare" ? hasBaseline ? 30 : 12 : 16);
    const actualY = y + (display === "compare" ? hasBaseline ? 56 : 42 : 16);
    const baseline = display === "compare" ? row.baselineRanges.map((range) => rangeRect(range.startDate, range.endDate, baselineY, 10, "#e2e8f0", "#64748b", "4 3")).join("") : "";
    const plannedFill = row.hasChildren ? "#f8fafc" : row.statusTone === "waiting" ? "#fbbf24" : row.statusTone === "done" ? "#4ade80" : "#60a5fa";
    const planned = display !== "actual" ? row.plannedRanges.map((range) => rangeRect(range.startDate, range.endDate, plannedY, row.hasChildren ? 9 : 19, plannedFill, row.hasChildren ? "#64748b" : "none", row.hasChildren ? "4 3" : "")).join("") : "";
    const actual = display !== "planned" ? actualRanges.map((range) => rangeRect(range.start, range.end, actualY, row.hasChildren ? 8 : 16, row.hasChildren ? "#bbf7d0" : "#22c55e", row.hasChildren ? "#15803d" : "none", row.hasChildren ? "4 3" : "")).join("") : "";
    const dueIndex = dates.indexOf(row.dueDate);
    const markerX = labelWidth + dueIndex * cellWidth + cellWidth / 2;
    const markerY = y + rowHeight / 2;
    const deadline = dueIndex >= 0 ? `<rect x="${markerX - 6}" y="${markerY - 6}" width="12" height="12" rx="2" fill="${row.delayed ? "#dc2626" : "#f97316"}" stroke="#ffffff" stroke-width="2" transform="rotate(45 ${markerX} ${markerY})"/>` : "";
    return `<g clip-path="url(#rowClip)"><rect x="0" y="${y}" width="${labelWidth}" height="${rowHeight}" fill="${labelBackground}"/>${row.delayed ? `<rect x="0" y="${y}" width="4" height="${rowHeight}" fill="#ef4444"/>` : ""}${columns}<line x1="0" y1="${y + rowHeight}" x2="${width}" y2="${y + rowHeight}" stroke="#e2e8f0"/><text x="${titleBase}" y="${y + 26}" fill="#475569" font-size="9">${row.hasChildren ? "▼" : ""}</text><rect x="${titleBase + 12}" y="${y + 12}" width="19" height="19" rx="5" fill="${icon.fill}"/><text x="${titleBase + 21.5}" y="${y + 25}" text-anchor="middle" fill="${icon.color}" font-size="10" font-weight="800">${icon.icon}</text><text x="${titleX}" y="${y + 26}" fill="${titleColor}" font-size="12" font-weight="700">${xmlEscape(row.title)}</text>${meta.join("")}${baseline}${planned}${actual}${deadline}</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><clipPath id="rowClip"><rect width="${width}" height="${height}"/></clipPath><clipPath id="labelClip"><rect width="${labelWidth}" height="${height}"/></clipPath></defs><rect width="100%" height="100%" fill="#ffffff"/><g font-family="-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic', sans-serif"><text x="14" y="28" fill="#0f172a" font-size="18" font-weight="800">${xmlEscape(title)}</text><text x="14" y="49" fill="#64748b" font-size="10">${start}〜${end}</text>${legend}${overview}<rect x="0" y="${chartTop}" width="${labelWidth}" height="${headerHeight}" fill="#f8fafc"/><text x="14" y="${chartTop + 39}" fill="#1e293b" font-size="11" font-weight="700">項目</text><text x="${labelWidth - 14}" y="${chartTop + 39}" text-anchor="end" fill="#64748b" font-size="9">予定／実績・期限</text>${dateHeader}<line x1="${labelWidth}" y1="${chartTop}" x2="${labelWidth}" y2="${height}" stroke="#cbd5e1"/>${rowSvg}<rect x="0.5" y="${chartTop + .5}" width="${width - 1}" height="${height - chartTop - 1}" fill="none" stroke="#e2e8f0"/></g></svg>`;
};
