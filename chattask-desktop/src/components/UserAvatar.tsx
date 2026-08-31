import { useEffect, useState } from "react";
import { avatarObjectUrl } from "../services/profile";
import type { UserProfile } from "../types";

export function UserAvatar({ profile, className = "avatar" }: { profile: UserProfile; className?: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true, objectUrl = "";
    setUrl("");
    if (!profile.avatarUpdatedAt) return;
    void avatarObjectUrl().then((value) => { objectUrl = value; if (active) setUrl(value); else URL.revokeObjectURL(value); }).catch(() => setUrl(""));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [profile.avatarUpdatedAt]);
  return <div className={className}>{url ? <img src={url} alt={profile.displayName} /> : <span>{profile.displayName.trim().slice(0, 1).toUpperCase() || "U"}</span>}</div>;
}
