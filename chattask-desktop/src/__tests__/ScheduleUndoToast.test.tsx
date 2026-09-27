import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScheduleUndoToast } from "../components/ScheduleUndoToast";

describe("操作後の取り消し通知", () => {
  it("変更通知の中に取り消しと閉じるボタンを表示する", () => {
    const html = renderToStaticMarkup(<ScheduleUndoToast message="作業の目標期間変更を反映しました。" revision={1} onUndo={vi.fn()} onDismiss={vi.fn()} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain("作業の目標期間変更を反映しました。");
    expect(html).toContain('class="schedule-undo-toast-action"');
    expect(html).toContain("元に戻す</button>");
    expect(html).toContain('aria-label="操作の通知を閉じる"');
  });
  it("取り消し完了後は元に戻すボタンを出さない", () => {
    const html = renderToStaticMarkup(<ScheduleUndoToast message="元に戻しました。" revision={2} onDismiss={vi.fn()} />);
    expect(html).toContain("元に戻しました。");
    expect(html).not.toContain('class="schedule-undo-toast-action"');
  });
  it("データ競合時は警告を表示し取り消しを再実行させない", () => {
    const html = renderToStaticMarkup(<ScheduleUndoToast message="対象が変更されたため元に戻せません。" error revision={3} onDismiss={vi.fn()} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("is-error");
    expect(html).not.toContain('class="schedule-undo-toast-action"');
  });
});
