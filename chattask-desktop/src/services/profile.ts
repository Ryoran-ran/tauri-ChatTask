import { invoke } from "@tauri-apps/api/core";

export const saveAvatar = async (file: File) => {
  if (!file.type.startsWith("image/")) throw new Error("画像ファイルを選択してください。");
  if (file.size > 5 * 1024 * 1024) throw new Error("プロフィール画像の上限は5MBです。");
  await invoke("save_avatar", { mimeType: file.type, data: Array.from(new Uint8Array(await file.arrayBuffer())) });
};

export const avatarObjectUrl = async () => {
  const file = await invoke<{ mimeType: string; data: number[] }>("get_avatar");
  return URL.createObjectURL(new Blob([new Uint8Array(file.data)], { type: file.mimeType }));
};

export const removeAvatar = () => invoke<void>("delete_avatar");
