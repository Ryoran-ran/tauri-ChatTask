/** 期限日の終端を示す。日付・保存データ・期限超過判定は変更しない。 */
export function ProjectScheduleDeadline({ date, index, dayWidth, lastColumn = false, milestone = false }: {
  date: string;
  index: number;
  dayWidth: number;
  lastColumn?: boolean;
  milestone?: boolean;
}) {
  return <span
    className={`project-schedule-deadline ${milestone ? "is-milestone" : ""} ${lastColumn ? "is-last-column" : ""}`}
    style={{ left: (index + 1) * dayWidth }}
    role="img"
    aria-label={`${milestone ? "マイルストーン" : "作業"}期限 ${date}（この日の終わり）`}
  >
    <span className="project-schedule-deadline-symbol" aria-hidden="true">◆</span>
    <small aria-hidden="true">{date.slice(5).replace("-", "/")}</small>
    <i aria-hidden="true" />
  </span>;
}
