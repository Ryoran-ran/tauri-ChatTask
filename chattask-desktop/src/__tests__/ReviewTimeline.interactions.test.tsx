// @vitest-environment jsdom
import { StrictMode, useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskChecklistItem, TaskCodeReviewTimelineEntry } from "../types";
import { addAttachment, removeAttachment, type Attachment } from "../services/attachments";
import { ReviewTimeline } from "../components/ReviewTimeline";
import { reviewStatusChanges, setReviewItemStatus, undoReviewStatus } from "../reviewTimeline";

vi.mock("../services/attachments", () => ({ addAttachment: vi.fn(), removeAttachment: vi.fn() }));
vi.mock("../components/Modal", () => ({ Modal: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div> }));
vi.mock("../components/AttachmentCards", () => ({
  AttachmentCards: ({ attachments, onRemove }: { attachments: Attachment[]; onRemove?: (attachment: Attachment) => void }) =>
    <div>{attachments.map((attachment) => <div key={attachment.id}>{attachment.name}{onRemove && <button type="button" onClick={() => onRemove(attachment)}>添付を削除</button>}</div>)}</div>,
}));

const items: TaskChecklistItem[] = [
  { id: "finding-1", title: "最初の指摘", category: "バグ", details: "", completed: false, createdAt: "2026-10-21T00:00:00Z" },
  { id: "finding-2", title: "次の指摘", category: "バグ", details: "", completed: false, createdAt: "2026-10-21T00:00:00Z" },
];
const entry = (id: string, changes: Partial<TaskCodeReviewTimelineEntry> = {}): TaskCodeReviewTimelineEntry => ({
  id, kind: "note", itemId: "finding-1", itemTitle: "最初の指摘", text: id, createdAt: "2026-10-21T00:00:00Z", ...changes,
});
const attachment = (id: string): Attachment => ({
  id, taskId: "task-1", name: id + ".txt", mimeType: "text/plain", size: 4, createdAt: "2026-10-21T00:00:00Z",
});
const stored = new Map<string, Attachment>();
let uploaded = 0;
const changed = vi.fn();
const cleanupError = vi.fn();

function Harness({ taskId = "task-1", initialEntries = [], protectedIds = [] }: {
  taskId?: string; initialEntries?: TaskCodeReviewTimelineEntry[]; protectedIds?: string[];
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [currentItems, setCurrentItems] = useState(items);
  const [filterItemId, setFilterItemId] = useState("");
  const [attachments, setAttachments] = useState([...stored.values()]);
  const [notice, setNotice] = useState("");
  return <>
    <button type="button" onClick={() => setFilterItemId("finding-2")}>二件目に絞る</button>
    {notice && <p role="alert">{notice}</p>}
    <ReviewTimeline taskId={taskId} items={currentItems} entries={entries} attachments={attachments}
      protectedAttachmentIds={protectedIds} filterItemId={filterItemId} onFilter={setFilterItemId}
      onBack={() => {}} onUndo={(entry) => {
        const item = currentItems.find((candidate) => candidate.id === entry.itemId)!;
        const { restored, reversal } = undoReviewStatus(entry, item);
        setCurrentItems(currentItems.map((candidate) => candidate.id === item.id ? restored : candidate));
        setEntries([...entries, reversal]);
      }} onCleanupError={(message) => { cleanupError(message); setNotice(message); }}
      onAttachmentsChange={() => setAttachments([...stored.values()])}
      onChange={(next, message) => { changed(next, message); setEntries(next); }}
      onStatusChange={(itemId, status, ignoredReason) => {
        const nextItems = currentItems.map((item) => item.id === itemId ? setReviewItemStatus(item, status, ignoredReason) : item);
        const nextEntries = [...entries, ...reviewStatusChanges(currentItems, nextItems)];
        setCurrentItems(nextItems); setEntries(nextEntries); changed(nextEntries, status);
      }} />
  </>;
}
const latestEntries = () => changed.mock.lastCall?.[0] as TaskCodeReviewTimelineEntry[];
const selectFile = (container: HTMLElement, fileName = "evidence.txt", reply = false) => {
  const inputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]');
  fireEvent.change(inputs[reply ? inputs.length - 1 : 0], { target: { files: [new File(["test"], fileName, { type: "text/plain" })] } });
};

beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn());
  HTMLElement.prototype.scrollTo = vi.fn();
  changed.mockClear();
  cleanupError.mockClear();
  stored.clear();
  uploaded = 0;
  vi.mocked(addAttachment).mockClear();
  vi.mocked(removeAttachment).mockClear();
  vi.mocked(addAttachment).mockImplementation(async (taskId, file) => {
    const value = { ...attachment("uploaded-" + ++uploaded), taskId, name: file.name };
    stored.set(value.id, value);
    return value;
  });
  vi.mocked(removeAttachment).mockImplementation(async (id) => { stored.delete(id); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("コードレビュータイムラインの操作", () => {
  it("指摘別の画面から状態を変え、履歴から元に戻せる", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "二件目に絞る" }));
    const status = screen.getByRole("combobox", { name: "次の指摘の対応状態" }) as HTMLSelectElement;
    expect(status.value).toBe("pending");
    fireEvent.change(status, { target: { value: "in-progress" } });
    expect(status.value).toBe("in-progress");
    expect(latestEntries()).toMatchObject([{ itemId: "finding-2", fromStatus: "pending", toStatus: "in-progress" }]);
    fireEvent.change(status, { target: { value: "completed" } });
    expect(status.value).toBe("completed");
    expect(latestEntries()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(status.value).toBe("in-progress");
    expect(screen.getAllByText("状態変更").length).toBeGreaterThan(0);
  });

  it("対応しない理由を入力して状態を変え、理由を編集できる", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "二件目に絞る" }));
    const status = screen.getByRole("combobox", { name: "次の指摘の対応状態" }) as HTMLSelectElement;
    fireEvent.change(status, { target: { value: "ignored" } });
    expect(status.value).toBe("pending");
    fireEvent.click(screen.getByRole("button", { name: "その他" }));
    expect(screen.getByRole("button", { name: "対応しないにする" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByRole("dialog").querySelector("textarea")!, { target: { value: "別途確認する" } });
    fireEvent.click(screen.getByRole("button", { name: "対応しないにする" }));
    expect(status.value).toBe("ignored");
    expect(latestEntries()).toMatchObject([{ fromStatus: "pending", toStatus: "ignored" }]);
    fireEvent.click(screen.getByRole("button", { name: "理由を編集" }));
    expect((screen.getByRole("dialog").querySelector("textarea") as HTMLTextAreaElement).value).toBe("別途確認する");
  });

  it("複数指摘を関連付け、二件目で絞っても記録を表示する", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "＋ 新しい記録" }));
    fireEvent.click(screen.getByRole("button", { name: "⌕ 指摘を選択" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "最初の指摘" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "次の指摘" }));
    fireEvent.click(screen.getByRole("button", { name: "選択を反映" }));
    fireEvent.change(screen.getByPlaceholderText(/対応内容/), { target: { value: "両方に関係する問題" } });
    fireEvent.click(screen.getByRole("button", { name: "記録を追加" }));
    expect(latestEntries()[0]).toMatchObject({ itemIds: ["finding-1", "finding-2"], itemTitles: ["最初の指摘", "次の指摘"], text: "両方に関係する問題" });
    fireEvent.click(screen.getByRole("button", { name: "二件目に絞る" }));
    expect(screen.getByText("両方に関係する問題")).toBeTruthy();
    expect(screen.getByText("次の指摘")).toBeTruthy();
  });

  it("返信を作成・編集・削除し、親を削除したら残りの返信も削除する", async () => {
    render(<Harness initialEntries={[entry("parent")]} />);
    fireEvent.click(screen.getByRole("button", { name: "返信" }));
    fireEvent.change(screen.getByPlaceholderText(/返信を入力/), { target: { value: "一度目の返信" } });
    fireEvent.click(screen.getByRole("button", { name: "返信する" }));
    expect(latestEntries()[1]).toMatchObject({ kind: "reply", parentEntryId: "parent", text: "一度目の返信" });
    const replies = document.querySelector(".verification-thread-replies")!;
    fireEvent.click(within(replies as HTMLElement).getByRole("button", { name: "編集" }));
    fireEvent.change(screen.getByRole("textbox", { name: "返信を編集" }), { target: { value: "編集した返信" } });
    fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));
    expect(latestEntries()[1].text).toBe("編集した返信");
    fireEvent.click(within(replies as HTMLElement).getByRole("button", { name: "削除" }));
    fireEvent.click(within(replies as HTMLElement).getByRole("button", { name: "削除する" }));
    await waitFor(() => expect(latestEntries()).toHaveLength(1));
    fireEvent.change(screen.getByPlaceholderText(/返信を入力/), { target: { value: "二度目の返信" } });
    fireEvent.click(screen.getByRole("button", { name: "返信する" }));
    fireEvent.click(screen.getByRole("button", { name: "タイムラインへ戻る" }));
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    await waitFor(() => expect(latestEntries()).toEqual([]));
  });

  it("親と返信の削除で専用ファイルだけ消し、他の記録と動作確認の参照を守る", async () => {
    const initialEntries = [
      entry("parent", { attachmentIds: ["parent-only", "shared-review", "shared-test"] }),
      entry("reply", { kind: "reply", parentEntryId: "parent", attachmentIds: ["reply-only"] }),
      entry("other", { attachmentIds: ["shared-review"] }),
    ];
    ["parent-only", "shared-review", "shared-test", "reply-only"].forEach((id) => stored.set(id, attachment(id)));
    render(<Harness initialEntries={initialEntries} protectedIds={["shared-test"]} />);
    const cards = screen.getAllByRole("article");
    fireEvent.click(within(cards[0]).getByRole("button", { name: "削除" }));
    fireEvent.click(within(cards[0]).getByRole("button", { name: "削除する" }));
    await waitFor(() => expect(vi.mocked(removeAttachment)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(removeAttachment).mock.calls.map(([id]) => id).sort()).toEqual(["parent-only", "reply-only"]);
    expect(latestEntries().map((record) => record.id)).toEqual(["other"]);
    expect(stored.has("shared-review")).toBe(true);
    expect(stored.has("shared-test")).toBe(true);
  });

  it("未投稿ファイルはキャンセルと画面離脱で削除し、投稿済みは残す", async () => {
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "＋ 新しい記録" }));
    selectFile(view.container);
    await waitFor(() => expect(screen.getByText("evidence.txt")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    await waitFor(() => expect(vi.mocked(removeAttachment)).toHaveBeenCalledWith("uploaded-1"));
    fireEvent.click(screen.getByRole("button", { name: "＋ 新しい記録" }));
    selectFile(view.container, "leave.txt");
    await waitFor(() => expect(screen.getByText("leave.txt")).toBeTruthy());
    view.unmount();
    await waitFor(() => expect(vi.mocked(removeAttachment)).toHaveBeenCalledWith("uploaded-2"));
    expect(stored.size).toBe(0);

    const posted = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "＋ 新しい記録" }));
    selectFile(posted.container, "posted.txt");
    await waitFor(() => expect(screen.getByText("posted.txt")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "記録を追加" }));
    const postedId = latestEntries()[0].attachmentIds?.[0];
    posted.unmount();
    await act(async () => {});
    expect(vi.mocked(removeAttachment)).not.toHaveBeenCalledWith(postedId);
    expect(stored.has(postedId!)).toBe(true);
  });

  it("タスク切り替え中のアップロード完了後も旧タスクの未投稿ファイルを消す", async () => {
    let completeUpload!: (value: Attachment) => void;
    vi.mocked(addAttachment).mockImplementationOnce(() => new Promise((resolve) => { completeUpload = resolve; }));
    const view = render(<Harness taskId="task-1" />);
    fireEvent.click(screen.getByRole("button", { name: "＋ 新しい記録" }));
    selectFile(view.container);
    view.rerender(<Harness taskId="task-2" />);
    await act(async () => { completeUpload(attachment("late-upload")); });
    await waitFor(() => expect(vi.mocked(removeAttachment)).toHaveBeenCalledWith("late-upload"));
    expect(screen.queryByText("evidence.txt")).toBeNull();
  });

  it("StrictModeの効果再実行後でも投稿前のファイルを保持し、離脱時に削除する", async () => {
    const view = render(<StrictMode><Harness /></StrictMode>);
    fireEvent.click(screen.getByRole("button", { name: "＋ 新しい記録" }));
    selectFile(view.container);
    await waitFor(() => expect(screen.getByText("evidence.txt")).toBeTruthy());
    expect(vi.mocked(removeAttachment)).not.toHaveBeenCalled();
    view.unmount();
    await waitFor(() => expect(vi.mocked(removeAttachment)).toHaveBeenCalledWith("uploaded-1"));
  });

  it("返信の未投稿ファイルを削除できないときは返信のエラーとして通知する", async () => {
    vi.mocked(removeAttachment).mockRejectedValueOnce(new Error("storage error"));
    const view = render(<Harness initialEntries={[entry("parent")]} />);
    fireEvent.click(screen.getByRole("button", { name: "返信" }));
    selectFile(view.container, "reply.txt", true);
    await waitFor(() => expect(screen.getByText("reply.txt")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "タイムラインへ戻る" }));
    await waitFor(() => expect(cleanupError).toHaveBeenCalledWith("返信の未投稿ファイルを一部削除できませんでした。"));
    expect(screen.getByRole("alert").textContent).toContain("返信の未投稿ファイル");
    expect(cleanupError).not.toHaveBeenCalledWith(expect.stringContaining("新しい記録"));
  });
});
