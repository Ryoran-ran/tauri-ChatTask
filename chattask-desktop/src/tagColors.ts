export const TAG_COLOR_PALETTE = [
  "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899",
  "#06b6d4", "#f97316", "#6366f1", "#14b8a6", "#ef4444",
];

export const randomTagColor = () => TAG_COLOR_PALETTE[Math.floor(Math.random() * TAG_COLOR_PALETTE.length)];
