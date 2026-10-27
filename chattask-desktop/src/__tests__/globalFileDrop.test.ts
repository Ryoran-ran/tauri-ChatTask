// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installGlobalFileDrop } from "../globalFileDrop";

const file = new File(["image"], "recent.png", { type: "image/png" });
const transfer = (files: File[] = [file]) => ({
  types: ["Files", "text/plain"],
  files,
  setData(type: string) { if (!this.types.includes(type)) this.types.push(type); },
});
const dragEvent = (type: string, dataTransfer = transfer()) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return event;
};

let uninstall = () => {};
afterEach(() => { uninstall(); document.body.replaceChildren(); });

describe("全画面のファイルドロップ", () => {
  it("アプリ内の並べ替えドラッグがファイルを含むように見えても取り込まない", () => {
    const onFiles = vi.fn();
    const onUnreadable = vi.fn();
    uninstall = installGlobalFileDrop({ onFiles, onUnreadable });
    const row = document.createElement("div");
    row.draggable = true;
    document.body.append(row);

    const internalTransfer = transfer();
    row.dispatchEvent(dragEvent("dragstart", internalTransfer));
    window.dispatchEvent(new Event("blur"));
    const internalDrop = dragEvent("drop", internalTransfer);
    row.dispatchEvent(internalDrop);
    expect(internalDrop.defaultPrevented).toBe(true);
    expect(onFiles).not.toHaveBeenCalled();
    expect(onUnreadable).not.toHaveBeenCalled();

    const externalDrop = dragEvent("drop");
    document.body.dispatchEvent(externalDrop);
    expect(onFiles).toHaveBeenCalledOnce();
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it("ドラッグを取り消した後は外部ファイルを取り込める", () => {
    const onFiles = vi.fn();
    uninstall = installGlobalFileDrop({ onFiles, onUnreadable: vi.fn() });
    document.body.dispatchEvent(dragEvent("dragstart"));
    window.dispatchEvent(dragEvent("dragend"));
    document.body.dispatchEvent(dragEvent("drop"));
    expect(onFiles).toHaveBeenCalledWith([file]);
  });
});
