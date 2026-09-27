/** 最新の確定済み画面データを保存する。終了時はデバウンスを飛ばしてflushする。 */
export function createPendingSave<T>(save: (snapshot: T) => Promise<void>, onError: (error: unknown) => void) {
  let latest: { value: T } | undefined;
  let saved: typeof latest;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let replacing = false;
  let blocked = false;
  const cancelTimer = () => { clearTimeout(timer); timer = undefined; };
  const flush = (): Promise<void> => {
    cancelTimer();
    if (replacing || blocked) return Promise.reject(new Error("データの入れ替え中、または入れ替え失敗後のため保存を停止しています。再読み込みしてください。"));
    if (running) return running;
    running = (async () => {
      while (!replacing && !blocked && latest && latest !== saved) {
        const snapshot = latest;
        await save(snapshot.value);
        saved = snapshot;
        // 保存中に確定した変更も、終了を許可する前に保存する。
      }
    })().finally(() => { running = undefined; });
    return running;
  };
  return {
    update(value: T) {
      if (replacing || blocked) return;
      latest = { value };
      cancelTimer();
      timer = setTimeout(() => { void flush().catch(onError); }, 250);
    },
    flush,
    cancelTimer,
    async replace(operation: () => Promise<T>, adopt: (value: T) => void): Promise<void> {
      if (replacing) throw new Error("データの入れ替え処理は実行中です。");
      replacing = true;
      cancelTimer();
      try {
        // すでに発行した保存だけは完了を待つ。未発行の旧スナップショットは破棄。
        await running?.catch(() => undefined);
        const value = await operation();
        latest = { value };
        saved = latest;
        // Reactの確定まで保護を維持し、旧画面の再描画を保存に混ぜない。
        adopt(value);
        blocked = false;
      } catch (error) {
        // 復元は途中までDBが変わっている可能性がある。旧データで再保存しない。
        blocked = true;
        throw error;
      } finally {
        replacing = false;
      }
    },
  };
}

/** 多重終了をまとめ、失敗時は閉じずに再試行を許可する。 */
export function createSaveBeforeExit(flush: () => Promise<void>, exit: () => Promise<void>, setClosing: (closing: boolean) => void, onError: (error: unknown) => void) {
  let pending: Promise<void> | undefined;
  return () => {
    if (pending) return pending;
    setClosing(true);
    pending = Promise.resolve().then(flush).then(exit).catch(error => {
      setClosing(false);
      onError(error);
    }).finally(() => { pending = undefined; });
    return pending;
  };
}
