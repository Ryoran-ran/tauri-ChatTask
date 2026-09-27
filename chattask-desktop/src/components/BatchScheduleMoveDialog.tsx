import { useMemo, useState } from "react";
import type { Goal, NonWorkingPeriod } from "../types";
import { batchMoveContextSignature, buildBatchScheduleMoveChanges, moveWorkByWorkingDays, shiftByWorkingDays, type BatchScheduleMoveRequest, type MoveScheduleWorks } from "../projectScheduleBatchMove";
import { compareScheduleWorks } from "../projectScheduleOrder";
import { assessProjectDailyCapacity, projectWorkWorkingDates } from "../projectCapacity";
import { Modal } from "./Modal";

const message = (error: unknown) => error instanceof Error ? error.message : "移動内容を確認してください。";
const period = (start?: string, end?: string) => `${start || "未設定"} 〜 ${end || "未設定"}`;

export function BatchScheduleMoveDialog({ project, projects, milestoneId, periods, dailyCapacityHours, onApply, onClose }: {
  project: Goal; projects: Goal[]; milestoneId: string; periods: NonWorkingPeriod[]; dailyCapacityHours: number; onApply: MoveScheduleWorks; onClose: () => void;
}) {
  const [snapshot] = useState(() => structuredClone({ project, projects, periods, dailyCapacityHours }));
  const milestone = snapshot.project.milestones.find(item => item.id === milestoneId)!;
  const works = useMemo(() => (snapshot.project.workItems || []).filter(work => work.milestoneId === milestoneId).sort(compareScheduleWorks), [snapshot, milestoneId]);
  const [selected, setSelected] = useState(() => new Set(works.filter(work => { try { moveWorkByWorkingDays(work, 1, snapshot.periods); return true; } catch { return false; } }).map(work => work.id)));
  const [daysInput, setDaysInput] = useState("3");
  const [direction, setDirection] = useState(1);
  const [moveDeadline, setMoveDeadline] = useState(false);
  const [error, setError] = useState("");
  const days = Number(daysInput) * direction;
  const request: BatchScheduleMoveRequest = useMemo(() => ({
    projectId: snapshot.project.id, milestoneId, milestoneSignature: JSON.stringify(milestone),
    works: works.filter(work => selected.has(work.id)).map(work => ({ id: work.id, signature: JSON.stringify(work) })),
    days, moveDeadline, contextSignature: batchMoveContextSignature(snapshot.projects, snapshot.periods, snapshot.dailyCapacityHours),
  }), [snapshot, milestone, milestoneId, works, selected, days, moveDeadline]);
  const preview = useMemo(() => {
    try {
      if (!Number.isInteger(Number(daysInput)) || Number(daysInput) < 1 || Number(daysInput) > 365) throw new Error("移動日数は1〜365営業日で指定してください。");
      const changes = buildBatchScheduleMoveChanges(snapshot.project, snapshot.project, snapshot.projects, snapshot.periods, snapshot.dailyCapacityHours, request);
      // 表示中に変わったデータで黙ってプレビューを差し替えない。
      buildBatchScheduleMoveChanges(project, project, projects, periods, dailyCapacityHours, request);
      const next = { ...snapshot.project, ...changes };
      const targetWorks = (next.workItems || []).filter(work => selected.has(work.id));
      const dates = [...new Set(targetWorks.flatMap(work => projectWorkWorkingDates(work, snapshot.periods)))].sort();
      const nextProjects = snapshot.projects.map(item => item.id === next.id ? next : item);
      const load = assessProjectDailyCapacity({ projects: nextProjects, periods: snapshot.periods, dates, dailyCapacityHours: snapshot.dailyCapacityHours, currentProjectId: next.id });
      return { next, overloaded: load.days.filter(day => day.over), missingEstimate: load.days.some(day => day.missingEstimateCount > 0), error: "" };
    } catch (failure) { return { next: null, overloaded: [], missingEstimate: false, error: message(failure) }; }
  }, [snapshot, project, projects, periods, dailyCapacityHours, request, selected, daysInput]);
  const nextMilestone = preview.next?.milestones.find(item => item.id === milestoneId);
  const eligible = works.filter(work => { try { moveWorkByWorkingDays(work, days, snapshot.periods); return true; } catch { return false; } });
  let nextDeadline = "";
  try { if (moveDeadline) nextDeadline = shiftByWorkingDays(milestone.dueDate || "", days, snapshot.periods); } catch { /* プレビューに理由を表示 */ }

  return <Modal title="配下の作業をまとめて移動" onClose={onClose} wide>
    <div className="project-batch-move" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <p><strong>{milestone.title || "名称未設定"}</strong> の作業を営業日単位で移動します。各作業の営業日数は維持します。</p>
      <div className="project-batch-move-controls">
        <label>移動日数<input type="number" min="1" max="365" step="1" value={daysInput} onChange={event => { setDaysInput(event.target.value); setError(""); }} /><span>営業日</span></label>
        <label>方向<select value={direction} onChange={event => { setDirection(Number(event.target.value)); setError(""); }}><option value={1}>後ろへ（遅らせる）</option><option value={-1}>前へ（早める）</option></select></label>
      </div>
      <label className="project-batch-move-deadline"><input type="checkbox" checked={moveDeadline} disabled={!milestone.dueDate} onChange={event => { setMoveDeadline(event.target.checked); setError(""); }} />マイルストーンの期限も移動する</label>
      <p className="project-batch-move-note">期限：{milestone.dueDate || "未設定（自動では設定しません）"}{moveDeadline && nextDeadline ? ` → ${nextDeadline}` : milestone.dueDate ? "（変更しません）" : ""}</p>
      <div className="work-date-sync-selection"><span>{selected.size}件選択 / {works.length}件</span><button type="button" onClick={() => { setSelected(new Set(eligible.map(work => work.id))); setError(""); }}>移動可能な作業をすべて選択</button><button type="button" onClick={() => { setSelected(new Set()); setError(""); }}>選択を解除</button></div>
      <div className="work-date-sync-table-scroll"><table className="work-date-sync-table"><thead><tr><th>移動</th><th>作業</th><th>変更前の目標期間</th><th>変更後の目標期間</th></tr></thead><tbody>
        {works.map(work => {
          let problem = "";
          try { moveWorkByWorkingDays(work, days, snapshot.periods); } catch (failure) { problem = message(failure); }
          const next = selected.has(work.id) ? preview.next?.workItems?.find(item => item.id === work.id) : undefined;
          const deadlines = [work.dueDate, nextMilestone?.dueDate || milestone.dueDate, snapshot.project.dueDate].filter(Boolean).sort();
          const exceeded = next?.targetWorkEndDate && deadlines[0] && next.targetWorkEndDate > deadlines[0];
          return <tr key={work.id} className={selected.has(work.id) ? "is-selected" : ""}>
            <td><input type="checkbox" aria-label={`${work.title}を移動対象にする`} checked={selected.has(work.id)} disabled={Boolean(problem) && !selected.has(work.id)} onChange={event => { const checked = event.target.checked; setSelected(current => { const result = new Set(current); if (checked) result.add(work.id); else result.delete(work.id); return result; }); setError(""); }} /></td>
            <th scope="row">{work.title || "名称未設定"}{problem && <small className="work-date-sync-error">{problem}</small>}</th>
            <td>{period(work.targetWorkStartDate, work.targetWorkEndDate)}</td>
            <td>{next ? period(next.targetWorkStartDate, next.targetWorkEndDate) : "変更しません"}{exceeded && <small className="work-date-sync-error">期限超過（{deadlines[0]}）</small>}</td>
          </tr>;
        })}
      </tbody></table>{!works.length && <p>このマイルストーンには作業がありません。</p>}</div>
      {preview.overloaded.length > 0 && <p className="project-batch-move-warning" role="status">移動後に全プロジェクト合算で負荷超過：{preview.overloaded.slice(0, 8).map(day => `${day.date}（${Number(day.plannedHours.toFixed(2))}h／${day.capacityHours}h）`).join("、")}{preview.overloaded.length > 8 ? ` ほか${preview.overloaded.length - 8}日` : ""}。警告を確認したうえで移動できます。</p>}
      {preview.missingEstimate && <p className="project-batch-move-warning">工数未入力の作業があるため、負荷が過小に表示される場合があります。</p>}
      <p className="project-batch-move-note">変更するのは選択した作業の目標期間だけです（チェック時はマイルストーン期限も変更）。マイルストーンの青い目標期間・各作業の期限・工数・状態・順序・実作業日・関連タスクの予定は変更しません。作業日の反映には別途「作業日を同期」を使用してください。</p>
      {(preview.error || error) && <p className="work-date-sync-error" role="alert">{error || preview.error}</p>}
      <div className="modal-actions"><button type="button" onClick={onClose}>キャンセル</button><button type="button" className="primary" disabled={!preview.next || !selected.size} onClick={() => { const failure = onApply(request); if (failure) setError(failure); else onClose(); }}>選択した{selected.size}件を移動</button></div>
    </div>
  </Modal>;
}
