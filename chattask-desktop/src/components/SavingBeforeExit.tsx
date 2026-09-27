import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function SavingBeforeExit({ replacing = false, error = "" }: { replacing?: boolean; error?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return createPortal(<dialog ref={dialog} className="saving-before-exit" aria-labelledby="saving-before-exit-title" onCancel={event => event.preventDefault()}>
    <h2 id="saving-before-exit-title">{error ? "データの入れ替えを完了できませんでした" : replacing ? "データを入れ替えています" : "変更を保存しています"}</h2>
    <p role="status">{error ? "古いデータによる上書きを防ぐため、保存を停止しています。再読み込みして保存先の状態を確認してください。" : replacing ? "保存が完了するまで、このままお待ちください。" : "保存が完了すると自動的に終了します。このままお待ちください。"}</p>
    {error && <><pre style={{ whiteSpace: "pre-wrap" }}>{error}</pre><button type="button" onClick={() => window.location.reload()}>再読み込み</button></>}
  </dialog>, document.body);
}
