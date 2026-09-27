import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppData } from "./types";
import { saveAppData, type AppEnvironment, type StorageBackend } from "./services/storage";
import { createPendingSave, createSaveBeforeExit } from "./services/pendingSave";

export function useAppPersistence(data: AppData, backend: StorageBackend | null, environment: AppEnvironment, adoptData: (data: AppData) => void) {
  const [closing, setClosing] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [replacementError, setReplacementError] = useState("");
  const replacementInFlight = useRef(false);
  const latest = useRef({ data, backend, environment });
  const [saver] = useState(() => createPendingSave(
    (snapshot: { data: AppData; backend: StorageBackend; environment: AppEnvironment }) => saveAppData(snapshot.data, snapshot.backend, snapshot.environment),
    error => console.error("アプリデータの保存に失敗しました。", error),
  ));
  useLayoutEffect(() => {
    latest.current = { data, backend, environment };
    if (backend) saver.update({ data, backend, environment });
    return saver.cancelTimer;
  }, [data, backend, environment, saver]);

  useEffect(() => {
    // 終了保護はデスクトップの終了要求に限定する。復元・環境切替のための
    // ページ再読込では、切替前の画面データを書き戻してはいけない。
    if (!isTauri()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    const requestExit = createSaveBeforeExit(async () => {
      if (!latest.current.backend) throw new Error("データの読み込み中です。読み込みが終わってから終了してください。");
      await saver.flush();
    }, async () => {
      if (active) await invoke("finish_app_exit");
    }, setClosing, error => {
      console.error("終了前の保存に失敗しました。", error);
      window.alert(`保存が完了していないため、終了を中止しました。\n再度終了をお試しください。\n\n${String(error)}`);
    });
    void listen("app-save-before-exit", () => { if (active) void requestExit(); }).then(async stop => {
      if (!active) { stop(); return; }
      unlisten = stop;
      // リスナー登録前に届いた終了要求も回収する。
      await invoke("app_exit_listener_ready");
    }).catch(error => {
      if (active) window.alert(`終了時の保存処理を準備できませんでした。安全のため通常の終了は停止しています。\n${String(error)}`);
    });
    return () => { active = false; unlisten?.(); };
  }, [saver]);
  const replaceData = async (operation: () => Promise<AppData>) => {
    if (!latest.current.backend) throw new Error("データの読み込みが終わるまでお待ちください。");
    if (replacementInFlight.current) throw new Error("データの入れ替え処理は実行中です。");
    replacementInFlight.current = true;
    setReplacing(true);
    try {
      await saver.replace(async () => ({ data: await operation(), backend: latest.current.backend!, environment }), snapshot => {
        flushSync(() => adoptData(snapshot.data));
      });
      setReplacementError("");
    } catch (error) {
      setReplacementError(String(error));
      throw error;
    } finally { replacementInFlight.current = false; setReplacing(false); }
  };
  return { closing, replacing, replacementError, replaceData };
}
