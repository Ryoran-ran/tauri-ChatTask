export type HabitArea = "health" | "learning" | "life" | "mind" | "hobby" | "other";
export type HabitRecordStatus = "done" | "rest";

export interface HabitRecord {
  date: string;
  status: HabitRecordStatus;
  value?: number;
  note?: string;
  updatedAt: string;
}

/** 継続する行動。完了して終わるTaskとは分けて管理する。 */
export interface Habit {
  id: string;
  title: string;
  area: HabitArea;
  projectTagId: string;
  projectId: string;
  targetPerWeek: number;
  /** 0（日）〜6（土）。空の場合は曜日を固定しない。 */
  weekdays: number[];
  minimumAction: string;
  active: boolean;
  records: HabitRecord[];
  createdAt: string;
  updatedAt: string;
}
