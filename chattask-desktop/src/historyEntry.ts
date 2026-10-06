import type { HistoryEntry } from "./types";

/** Keep the resolved work name even when it is identical to the parent task name. */
export const historyWorkTitle = (workTitle?: string): Pick<HistoryEntry, "workTitle"> => {
  const normalized = workTitle?.trim();
  return normalized ? { workTitle: normalized } : {};
};
