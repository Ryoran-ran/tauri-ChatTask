import type { TaskReflectionTheme } from "./types";

export type TaskReflectionThemeGroup = "planning" | "progress" | "implementation" | "quality" | "collaboration" | "release";

export interface ReflectionThemeGroupDefinition {
  id: TaskReflectionThemeGroup;
  label: string;
  themes: TaskReflectionTheme[];
  defaultTheme: TaskReflectionTheme;
}

export const REFLECTION_THEME_GROUPS: ReflectionThemeGroupDefinition[] = [
  { id: "planning", label: "計画", themes: ["requirements", "task-breakdown", "estimate", "priority"], defaultTheme: "requirements" },
  { id: "progress", label: "進行", themes: ["schedule", "process"], defaultTheme: "schedule" },
  { id: "implementation", label: "実装", themes: ["implementation", "branch-split"], defaultTheme: "implementation" },
  { id: "quality", label: "品質", themes: ["review", "testing"], defaultTheme: "testing" },
  { id: "collaboration", label: "連携", themes: ["communication", "documentation"], defaultTheme: "communication" },
  { id: "release", label: "リリース", themes: ["release"], defaultTheme: "release" },
];

export const reflectionThemeGroup = (theme: TaskReflectionTheme) => REFLECTION_THEME_GROUPS.find((group) => group.themes.includes(theme));

export const selectedReflectionThemeGroups = (themes: TaskReflectionTheme[]) => REFLECTION_THEME_GROUPS.filter((group) => group.themes.some((theme) => themes.includes(theme)));

export const groupedReflectionThemeLabels = (themes: TaskReflectionTheme[], otherTheme = "") => [
  ...selectedReflectionThemeGroups(themes).map((group) => group.label),
  ...(themes.includes("other") ? [otherTheme.trim() || "その他"] : []),
];
