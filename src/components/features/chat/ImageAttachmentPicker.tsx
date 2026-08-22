"use client";

import { ImagePlus, X } from "lucide-react";
import Image from "next/image";
import { useId, useState } from "react";

export const SUPPORT_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
export const SUPPORT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export interface PendingSupportImage {
  file: File;
  previewUrl: string;
}

export async function uploadSupportImages(input: {
  token: string;
  conversationId: string;
  messageId: string;
  images: PendingSupportImage[];
}) {
  return Promise.all(input.images.map(async ({ file }) => {
    const form = new FormData();
    form.set("conversationId", input.conversationId);
    form.set("messageId", input.messageId);
    form.set("file", file);
    const response = await fetch("/api/chat/attachments", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.token}` },
      body: form,
    });
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    if (!response.ok) throw new Error(payload?.message ?? "이미지를 첨부하지 못했습니다.");
    return payload;
  }));
}

export function ImageAttachmentPicker({
  images,
  maxCount,
  disabled = false,
  onChange,
  onError,
}: {
  images: PendingSupportImage[];
  maxCount: number;
  disabled?: boolean;
  onChange: (images: PendingSupportImage[]) => void;
  onError: (message: string) => void;
}) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  const append = (files: File[]) => {
    const room = maxCount - images.length;
    if (files.length > room) {
      onError(`이미지는 최대 ${maxCount}장까지 첨부할 수 있습니다.`);
      return;
    }
    const invalid = files.find((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > SUPPORT_IMAGE_MAX_BYTES);
    if (invalid) {
      onError("5MB 이하 JPG, PNG, WEBP 이미지만 첨부할 수 있습니다.");
      return;
    }
    onError("");
    onChange([...images, ...files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))]);
  };

  const remove = (index: number) => {
    const target = images[index];
    if (target) URL.revokeObjectURL(target.previewUrl);
    onChange(images.filter((_, itemIndex) => itemIndex !== index));
  };

  return <div className="space-y-3">
    <label
      className={`flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-4 text-xs font-bold transition-colors ${dragging ? "border-ink bg-surface" : "border-line hover:border-ink"} ${disabled ? "pointer-events-none opacity-40" : ""}`}
      htmlFor={inputId}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); setDragging(false); append(Array.from(event.dataTransfer.files)); }}
    >
      <ImagePlus size={16} /> 사진 첨부 ({images.length}/{maxCount})
    </label>
    <input className="sr-only" disabled={disabled || images.length >= maxCount} id={inputId} accept={SUPPORT_IMAGE_ACCEPT} multiple={maxCount > 1} onChange={(event) => { append(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} type="file" />
    {images.length > 0 && <div className="flex flex-wrap gap-2">{images.map((image, index) => <div className="relative size-20 overflow-hidden rounded-xl border border-line" key={`${image.file.name}-${image.file.lastModified}`}>
      <Image alt={`첨부 이미지 ${index + 1} 미리보기`} className="object-cover" fill sizes="80px" src={image.previewUrl} unoptimized />
      <button aria-label={`첨부 이미지 ${index + 1} 삭제`} className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/70 text-white" disabled={disabled} onClick={() => remove(index)} type="button"><X size={13} /></button>
    </div>)}</div>}
    <p className="text-[10px] leading-4 text-muted">JPG, PNG, WEBP · 장당 최대 5MB</p>
  </div>;
}
