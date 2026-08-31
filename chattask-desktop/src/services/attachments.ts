import { invoke } from "@tauri-apps/api/core";

export interface Attachment {
  id: string;
  taskId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export const listAttachments = (taskId: string) => invoke<Attachment[]>("list_attachments", { taskId });

export const addAttachment = async (taskId: string, file: File) => {
  if (file.size > 50 * 1024 * 1024) throw new Error("1ファイルの上限は50MBです。");
  return invoke<Attachment>("add_attachment", {
    id: crypto.randomUUID(),
    taskId,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    data: Array.from(new Uint8Array(await file.arrayBuffer())),
    createdAt: new Date().toISOString(),
  });
};

export const removeAttachment = async (id: string) => {
  const deleted = await invoke<boolean>("delete_attachment", { id });
  if (!deleted) throw new Error("削除対象の添付ファイルが見つかりませんでした。");
};
export const attachmentNameParts = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1
    ? { baseName: name.slice(0, dot), extension: name.slice(dot) }
    : { baseName: name, extension: "" };
};
export const renameAttachment = async (id: string, baseName: string, originalName: string) => {
  const original = attachmentNameParts(originalName);
  const entered = attachmentNameParts(baseName.trim());
  const normalizedBaseName = original.extension && entered.extension.toLowerCase() === original.extension.toLowerCase()
    ? entered.baseName
    : baseName.trim();
  const updated = await invoke<boolean>("rename_attachment", { id, name: normalizedBaseName });
  if (!updated) throw new Error("変更対象の添付ファイルが見つかりませんでした。");
  return `${normalizedBaseName}${original.extension}`;
};
export const removeTaskAttachments = (taskId: string) => invoke<void>("delete_task_attachments", { taskId });
export const openAttachment = (id: string) => invoke<void>("open_attachment", { id });
export const copyAttachment = (id: string) => invoke<void>("copy_attachment", { id });
export const downloadAttachment = (id: string) => invoke<string>("download_attachment", { id });

export const getAttachmentFile = (id: string) => invoke<{ name: string; mimeType: string; data: number[] }>("get_attachment", { id });

export const attachmentObjectUrl = async (id: string) => {
  const file = await getAttachmentFile(id);
  const blob = new Blob([new Uint8Array(file.data)], { type: file.mimeType });
  return URL.createObjectURL(blob);
};
