import { useEffect, useState } from "react";
import { buildReportMarkdown, reportPeriodRange, type ReportAnalysisScope, type ReportPeriod, type ReportPurpose } from "../services/reportMarkdown";
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

const REPORT_SETTINGS_KEY = "chatTaskReportSettings";
const DEFAULT_ANALYSIS_SCOPES: ReportAnalysisScope[] = ["effort", "schedule", "workload", "task-management"];
const REPORT_PERIODS: ReportPeriod[] = ["daily", "weekly", "monthly", "custom"];
const REPORT_PURPOSES: ReportPurpose[] = ["business-report", "effort-analysis"];
const ANALYSIS_SCOPES: ReportAnalysisScope[] = ["effort", "schedule", "workload", "task-management"];

const loadReportSettings = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(REPORT_SETTINGS_KEY) || "{}") as Partial<{
      period: ReportPeriod;
      tag: string;
      purpose: ReportPurpose;
      anonymizeTaskNames: boolean;
      analysisScopes: ReportAnalysisScope[];
    }>;
    return {
      period: stored.period && REPORT_PERIODS.includes(stored.period) ? stored.period : "daily" as ReportPeriod,
      tag: typeof stored.tag === "string" ? stored.tag : "all",
      purpose: stored.purpose && REPORT_PURPOSES.includes(stored.purpose) ? stored.purpose : "business-report" as ReportPurpose,
      anonymizeTaskNames: Boolean(stored.anonymizeTaskNames),
      analysisScopes: Array.isArray(stored.analysisScopes)
        ? stored.analysisScopes.filter((scope): scope is ReportAnalysisScope => ANALYSIS_SCOPES.includes(scope))
        : DEFAULT_ANALYSIS_SCOPES,
    };
  } catch {
    return { period: "daily" as ReportPeriod, tag: "all", purpose: "business-report" as ReportPurpose, anonymizeTaskNames: false, analysisScopes: DEFAULT_ANALYSIS_SCOPES };
  }
};

export function ReportModal({ tasks, projects, tags, activity, dailyNotes, nonWorkingPeriods, onClose }: Props) {
  const [savedSettings] = useState(loadReportSettings);
  const [period, setPeriod] = useState<ReportPeriod>(savedSettings.period);
  const [base, setBase] = useState(todayValue());
  const [customStart, setCustomStart] = useState(todayValue());
  const [customEnd, setCustomEnd] = useState(todayValue());
  const [tag, setTag] = useState(() => savedSettings.tag === "all" || savedSettings.tag === "none" || tags.some((item) => item.id === savedSettings.tag) ? savedSettings.tag : "all");
  const [purpose, setPurpose] = useState<ReportPurpose>(savedSettings.purpose);
  const [anonymizeTaskNames, setAnonymizeTaskNames] = useState(savedSettings.anonymizeTaskNames);
  const [analysisScopes, setAnalysisScopes] = useState<ReportAnalysisScope[]>(savedSettings.analysisScopes);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [from, to] = reportPeriodRange(period, base, customStart, customEnd);
  useEffect(() => {
    localStorage.setItem(REPORT_SETTINGS_KEY, JSON.stringify({ period, tag, purpose, anonymizeTaskNames, analysisScopes }));
  }, [period, tag, purpose, anonymizeTaskNames, analysisScopes]);

  const content = () => buildReportMarkdown({
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
    purpose,
    anonymizeTaskNames,
    analysisScopes,
  });
  const validPeriod = () => {
    if (!from || !to || to < from) {
      alert("期間を正しく指定してください。");
      return false;
    }
    if (purpose === "effort-analysis" && analysisScopes.length === 0) {
      alert("分析する内容を1つ以上選択してください。");
      return false;
    }
    return true;
  };
  const download = () => {
    if (!validPeriod()) return;
    const blob = new Blob([content()], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `chattask_${purpose === "effort-analysis" ? "ai_work_analysis" : period}_${from}_${to}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    onClose();
  };
  const copy = async () => {
    if (!validPeriod()) return;
    try {
      await navigator.clipboard.writeText(content());
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
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
      <label>出力目的
        <select value={purpose} onChange={(event) => {
          const next = event.target.value as ReportPurpose;
          setPurpose(next);
          setCopyState("idle");
          if (next === "effort-analysis") setAnonymizeTaskNames(true);
        }}>
          <option value="business-report">業務報告</option>
          <option value="effort-analysis">AI仕事分析</option>
        </select>
      </label>
      <div className="report-options">
        <label className="report-check"><input type="checkbox" checked={anonymizeTaskNames} onChange={(event) => { setAnonymizeTaskNames(event.target.checked); setCopyState("idle"); }} /><span><strong>タスク名を匿名化</strong><small>タスク001のように置換し、同じタスクは出力内で同じIDにします。</small></span></label>
      </div>
      {purpose === "effort-analysis" && <fieldset className="report-analysis-scopes"><legend>分析する内容</legend><div>{([
        ["effort", "工数・見積精度", "予定と実績、表記揺れ、推奨工数"],
        ["schedule", "スケジュール進行", "完了率、遅延、停滞している予定"],
        ["workload", "日別の仕事量", "過密日、余裕日、仕事量の偏り"],
        ["task-management", "タスク管理", "期限、待ち、優先度、分解状況"],
      ] as [ReportAnalysisScope, string, string][]).map(([value, label, description]) => <label key={value} className={analysisScopes.includes(value) ? "selected" : ""}><input type="checkbox" checked={analysisScopes.includes(value)} onChange={(event) => { setAnalysisScopes((current) => event.target.checked ? [...current, value] : current.filter((scope) => scope !== value)); setCopyState("idle"); }} /><span><strong>{label}</strong><small>{description}</small></span></label>)}</div></fieldset>}
      <p className="report-range">出力範囲: {from}〜{to}</p>
      <p className="muted">{purpose === "effort-analysis" ? "選択した観点を表形式にまとめ、回答形式まで指定した分析用プロンプトをデータ末尾へ追加します。" : "タスク ＞ 作業の工数、完了内容、待ち状態、プロジェクト進捗、関連ブランチ、日次メモをMarkdown形式で出力します。"}</p>
      {anonymizeTaskNames && <p className="report-privacy-note">タスク名のみを匿名化します。案件タグ、作業名、メモなどは出力目的に応じて含まれるため、共有前に内容を確認してください。</p>}
      <div className="modal-actions"><button onClick={onClose}>キャンセル</button>{purpose === "effort-analysis" && <button onClick={() => void copy()}>{copyState === "copied" ? "コピーしました" : copyState === "error" ? "コピーに失敗" : "データ＋プロンプトをコピー"}</button>}<button className="primary" onClick={download}>{purpose === "effort-analysis" ? "分析用Markdownを出力" : "Markdownを出力"}</button></div>
    </div>
  </Modal>;
}
