import { useEffect, useState } from "react";
import { attachmentObjectUrl } from "../services/attachments";
import type { ProjectTag } from "../types";

export function TagIcon({ tag, className = "" }: { tag: ProjectTag; className?: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true, objectUrl = "";
    setUrl("");
    if (tag.iconType !== "image" || !tag.logoAttachmentId) return;
    void attachmentObjectUrl(tag.logoAttachmentId).then((value) => { objectUrl = value; if (active) setUrl(value); else URL.revokeObjectURL(value); }).catch(() => setUrl(""));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [tag.iconType, tag.logoAttachmentId, tag.logoUpdatedAt]);
  return <span className={`tag-visual-icon ${tag.iconType === "image" ? "tag-visual-logo" : ""} ${className}`} style={{ backgroundColor: tag.color || "#3b82f6" }}>{url ? <img src={url} alt="" /> : null}</span>;
}
