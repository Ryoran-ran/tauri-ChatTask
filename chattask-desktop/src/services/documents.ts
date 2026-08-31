import { invoke } from "@tauri-apps/api/core";

export const exportMarkdown = (fileName: string, content: string) => invoke<string>("export_markdown", { fileName, content });
