/** 開始日の左端から終了日の右端まで、両端の日を含めた目標期間。 */
export function ProjectTargetLine({ start, end, dayWidth, className = "", clippedStart = false, clippedEnd = false }: {
  start: number;
  end: number;
  dayWidth: number;
  className?: string;
  clippedStart?: boolean;
  clippedEnd?: boolean;
}) {
  return <span
    className={`project-target-line ${className}`}
    style={{ left: start * dayWidth, width: (end - start + 1) * dayWidth }}
    data-schedule-drag="move"
    title="ドラッグで営業日数を保って移動・両端で期間を変更"
    aria-hidden="true"
  >{!clippedStart && <i className="project-target-start" data-schedule-drag="start" title="開始日を変更" />}{!clippedEnd && <i className="project-target-end" data-schedule-drag="end" title="終了日を変更" />}</span>;
}
