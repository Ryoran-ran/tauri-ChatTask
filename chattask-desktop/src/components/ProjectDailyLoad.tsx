import type { ProjectDailyCapacity } from "../projectCapacity";

const hours = (value: number) => `${Number(value.toFixed(2))}h`;
export function ProjectDailyLoad({ days, dayWidth }: { days: ProjectDailyCapacity[]; dayWidth: number }) {
  return <div className="project-daily-load-days" style={{ gridTemplateColumns: `repeat(${days.length}, ${dayWidth}px)` }}>
    {days.map(day => {
      const summary = `${day.date}：予定${hours(day.plannedHours)}／確保${hours(day.capacityHours)}${day.over ? "（超過）" : ""}${day.nonWorking ? "（休日）" : ""}${day.missingEstimateCount ? `・工数未入力${day.missingEstimateCount}件` : ""}`;
      const detail = [summary, `このプロジェクト ${hours(day.currentProjectHours)}／他プロジェクト ${hours(day.otherProjectHours)}`,
        ...day.contributions.map(item => `${item.projectTitle || "名称未設定"} / ${item.workTitle || "名称未設定"}：${hours(item.hours)}`),
        "未完了作業の予定工数を、目標期間全体の営業日へ均等配分しています。"].join("\n");
      return <div key={day.date} className={`project-daily-load-day ${day.over ? "is-over" : ""} ${day.nonWorking ? "is-non-working" : ""} ${day.missingEstimateCount ? "has-missing" : ""}`} title={detail} role="img" aria-label={summary}>
        <b>{day.over ? <span className="project-daily-load-over" aria-hidden="true">!</span> : null}{Number(day.plannedHours.toFixed(2))}</b>
        <small>/{Number(day.capacityHours.toFixed(2))}</small>
        {day.missingEstimateCount > 0 && <span className="project-daily-load-missing" aria-hidden="true">?</span>}
      </div>;
    })}
  </div>;
}
