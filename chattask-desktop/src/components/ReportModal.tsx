import { useState } from "react";
import { buildReportMarkdown, reportPeriodRange, type ReportPeriod } from "../services/reportMarkdown";
import type { ActivityEvent, Goal, NonWorkingPeriod, ProjectTag, Task } from "../types";
import { todayValue } from "../utils";
import { Modal } from "./Modal";
import { WorkDatePicker } from "./WorkDatePicker";

interface Props {
  tasks: Task[];
  projects: Goal[];
  tags: ProjectTag[];
  activity: ActivityEvent[];
  dailyNotes: Record<string, string>;
  nonWorkingPeriods: NonWorkingPeriod[];
  onClose: () => void;
}

export function ReportModal({ tasks, projects, tags, activity, dailyNotes, nonWorkingPeriods, onClose }: Props) {
  const [period, setPeriod] = useState<ReportPeriod>("daily");
  const [base, setBase] = useState(todayValue());
  const [customStart, setCustomStart] = useState(todayValue());
  const [customEnd, setCustomEnd] = useState(todayValue());
  const [tag, setTag] = useState("all");
  const [from, to] = reportPeriodRange(period, base, customStart, customEnd);

  const download = () => {
    if (!from || !to || to < from) {
      alert("期間を正しく指定してください。");
      return;
    }
    const content = buildReportMarkdown({
      period,
      from,
      to,
      tagId: tag,
      tasks,
      projects,
      tags,
      activity,
      dailyNotes,
      nonWorkingPeriods,
    });
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `chattask_${period}_${from}_${to}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    onClose();
  };

  return <Modal title="まとめ出力" onClose={onClose}>
    <div className="report-form">
      <label>期間
        <select value={period} onChange={(event) => setPeriod(event.target.value as ReportPeriod)}>
          <option value="daily">日次</option>
          <option value="weekly">週次</option>
          <option value="monthly">月次</option>
          <option value="custom">任意期間</option>
        </select>
      </label>
      {period === "custom"
        ? <div className="inline-form"><WorkDatePicker ariaLabel="出力期間の開始日" value={customStart} onChange={setCustomStart} allowClear={false} /><span>〜</span><WorkDatePicker ariaLabel="出力期間の終了日" value={customEnd} min={customStart} onChange={setCustomEnd} allowClear={false} /></div>
        : <label>基準日<WorkDatePicker ariaLabel="出力の基準日" value={base} onChange={setBase} allowClear={false} /></label>}
      <label>案件タグ
        <select value={tag} onChange={(event) => setTag(event.target.value)}>
          <option value="all">すべて</option>
          <option value="none">タグなし</option>
          {tags.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
      </label>
      <p className="report-range">出力範囲: {from}〜{to}</p>
      <p className="muted">タスク ＞ 作業の工数、完了内容、待ち状態、プロジェクト進捗、関連ブランチ、日次メモをMarkdown形式で出力します。</p>
      <div className="modal-actions"><button onClick={onClose}>キャンセル</button><button className="primary" onClick={download}>Markdownを出力</button></div>
    </div>
  </Modal>;
}
