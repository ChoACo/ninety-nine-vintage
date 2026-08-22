"use client";

import Image from "next/image";
import { Camera, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useToastStore } from "@/store/useToastStore";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function ProfileAvatarUploader({
  currentAvatarUrl,
  nickname,
  userId,
  onAvatarUpdated,
}: Readonly<{
  currentAvatarUrl?: string | null;
  nickname: string;
  userId: string;
  onAvatarUpdated: (url: string) => void;
}>) {
  const [uploadedAvatarUrl, setUploadedAvatarUrl] = useState<string | null>(
    null,
  );
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pushToast = useToastStore((state) => state.pushToast);

  const avatarUrl = uploadedAvatarUrl ?? currentAvatarUrl ?? null;

  const uploadAvatar = async (file: File) => {
    if (!AVATAR_TYPES.has(file.type)) {
      pushToast("error", "JPG, PNG, WEBP 형식의 이미지만 사용할 수 있습니다.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      pushToast("error", "프로필 사진은 5MB 이하만 업로드할 수 있습니다.");
      return;
    }

    setUploading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const path = `${userId}/avatar`;
      const { error: uploadError } = await supabase.storage
        .from("member-avatars")
        .upload(path, file, {
          cacheControl: "3600",
          contentType: file.type,
          upsert: true,
        });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from("member-avatars")
        .getPublicUrl(path);
      const publicUrl = `${data.publicUrl}?v=${Date.now()}`;
      const { error: metadataError } = await supabase.auth.updateUser({
        data: { avatar_url: publicUrl },
      });
      if (metadataError) throw metadataError;

      setUploadedAvatarUrl(publicUrl);
      onAvatarUpdated(publicUrl);
      pushToast("success", "프로필 사진을 변경했습니다.");
    } catch {
      pushToast(
        "error",
        "프로필 사진 업로드에 실패했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const initial = nickname.trim().slice(0, 1) || "회";
  return (
    <div className="relative shrink-0">
      <input
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={uploading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadAvatar(file);
        }}
        ref={inputRef}
        type="file"
      />
      <button
        aria-label="프로필 사진 변경"
        className="group relative grid size-20 place-items-center overflow-hidden rounded-full border-2 border-zinc-700 bg-zinc-800 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        {uploading ? (
          <Loader2 className="animate-spin text-amber-500" size={24} />
        ) : avatarUrl ? (
          <Image
            alt={`${nickname} 프로필 사진`}
            className="h-full w-full object-cover"
            fill
            sizes="80px"
            src={avatarUrl}
          />
        ) : (
          <span className="text-2xl font-black text-zinc-100">{initial}</span>
        )}
        {!uploading ? (
          <span className="absolute inset-0 grid place-items-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <Camera aria-hidden size={23} />
          </span>
        ) : null}
      </button>
      <span className="pointer-events-none absolute -right-1 -top-1 grid size-7 place-items-center rounded-full border-2 border-zinc-950 bg-amber-500 text-zinc-950">
        <Camera aria-hidden size={14} />
      </span>
    </div>
  );
}
