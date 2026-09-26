import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Goal, ProjectWorkItem } from "../types";
import { workDatesDiffer, workDateSyncError, workDateSyncSignature, type SyncWorkDates, type WorkDateSyncDirection } from "../projectWorkDateSync";
import { Modal } from "./Modal";

const period = (start?: string, end?: string) => !start && !end ? "未設定" : `${start || "未設定"} 〜 ${end || "未設定"}`;
const workPeriod = (work: ProjectWorkItem) => (work.plannedRanges || []).map((range) => period(range.startDate, range.endDate || range.startDate)).join(" / ") || "未設定";

export function WorkDateSyncStatus({ work }: { work: ProjectWorkItem }) {
  return workDatesDiffer(work) ? <small className="work-date-sync-status">日付に差異あり</small> : null;
}

export function ProjectWorkDateSyncButton({ project, onSync }: { project: Goal; onSync: SyncWorkDates }) {
  const works = project.workItems || [];
  const differences = works.filter(workDatesDiffer);
  const [snapshot, setSnapshot] = useState<ProjectWorkItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [direction, setDirection] = useState<WorkDateSyncDirection>("schedule-to-work");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const close = () => { setSnapshot(null); setError(""); };
  const rows = (snapshot || []).map((work) => {
    const current = works.find((item) => item.id === work.id);
    const stale = !current || workDateSyncSignature(current) !== workDateSyncSignature(work);
    return { work, problem: stale ? "確認中に作業日が変更されました。開き直してください。" : workDateSyncError(work, direction) };
  });
  const selectedRows = rows.filter(({ work }) => selected.has(work.id));
  const blocked = selectedRows.some(({ problem }) => problem);
  return <div className="project-work-date-sync">
    <button type="button" className="project-work-date-sync-trigger" disabled={!differences.length} onClick={() => {
      const next = structuredClone(differences);
      setSnapshot(next); setDirection("schedule-to-work"); setError(""); setNotice("");
      setSelected(new Set(next.filter((work) => !workDateSyncError(work, "schedule-to-work")).map((work) => work.id)));
    }}>作業日を同期（差異{differences.length}件）</button>
    {notice && createPortal(<div role="status" aria-atomic="true" className="work-date-sync-notice">{notice}</div>, document.body)}
    {snapshot && <Modal title="プロジェクトの作業日を同期" onClose={close} wide>
      <div className="work-date-sync-dialog">
        <strong>{project.title}</strong>
        <p>このプロジェクト全体の差異 {snapshot.length}件を表示しています。反映する作業を選択してください。表示期間外・折りたたみ中の作業も対象です。</p>
        <label>同期する方向<select value={direction} onChange={(event) => {
          const next = event.target.value as WorkDateSyncDirection;
          setDirection(next); setError("");
          // 方向変更で対象を勝手に増やさない。新しい方向で無効な作業だけを外す。
          setSelected((current) => new Set(snapshot.filter((work) => current.has(work.id) && !workDateSyncError(work, next)).map((work) => work.id)));
        }}>
          <option value="schedule-to-work">作業スケジュール → マイルストーンの作業日</option>
          <option value="work-to-schedule">マイルストーンの作業日 → 作業スケジュール</option>
        </select></label>
        <div className="work-date-sync-selection"><span>{selectedRows.length}件選択 / {snapshot.length}件</span><button type="button" onClick={() => setSelected(new Set(rows.filter(({ problem }) => !problem).map(({ work }) => work.id)))}>同期可能な作業をすべて選択</button><button type="button" onClick={() => setSelected(new Set())}>選択を解除</button></div>
        <div className="work-date-sync-table-scroll"><table className="work-date-sync-table">
          <thead><tr><th scope="col">反映</th><th scope="col">マイルストーン / 作業</th><th scope="col">変更前<br /><small>{direction === "schedule-to-work" ? "マイルストーンの作業日" : "作業スケジュール"}</small></th><th scope="col">変更後<br /><small>{direction === "schedule-to-work" ? "作業スケジュール" : "マイルストーンの作業日"}</small></th></tr></thead>
          <tbody>{rows.map(({ work, problem }) => {
            const schedule = period(work.targetWorkStartDate, work.targetWorkEndDate);
            const milestone = workPeriod(work);
            return <tr key={work.id} className={selected.has(work.id) ? "is-selected" : ""}>
              <td><input type="checkbox" aria-label={`${work.title}を同期対象にする`} checked={selected.has(work.id)} disabled={Boolean(problem) && !selected.has(work.id)} onChange={(event) => {
                const checked = event.target.checked;
                setSelected((current) => { const next = new Set(current); if (checked) next.add(work.id); else next.delete(work.id); return next; }); setError("");
              }} /></td>
              <th scope="row"><small>{project.milestones.find((item) => item.id === work.milestoneId)?.title || "プロジェクト直属"}</small><strong>{work.title || "名称未設定"}</strong>{problem && <span className="work-date-sync-error">{problem}</span>}</th>
              <td>{direction === "schedule-to-work" ? milestone : schedule}</td><td>{direction === "schedule-to-work" ? schedule : milestone}</td>
            </tr>;
          })}</tbody>
        </table></div>
        <small>空欄や不正な日付は同期できません。予定工数・実績・メモ・完了状態は保持します。{direction === "schedule-to-work" ? "関連ChatTaskの対応する予定日も更新します。" : ""}</small>
        {(error || blocked) && <p role="alert" className="work-date-sync-error">{error || "選択した作業に変更・不備があります。対象から外すか、画面を開き直してください。"}</p>}
        <div className="modal-actions"><button type="button" onClick={close}>キャンセル</button><button type="button" className="primary" disabled={!selectedRows.length || blocked} onClick={() => {
          if (!selectedRows.length || blocked) return;
          const failure = onSync(selectedRows.map(({ work }) => ({ id: work.id, expectedSignature: workDateSyncSignature(work) })), direction);
          if (failure) { setError(failure); return; }
          setNotice(`${selectedRows.length}件の作業日を同期しました`); close();
        }}>選択した{selectedRows.length}件を同期</button></div>
      </div>
    </Modal>}
  </div>;
}
