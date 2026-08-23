"use client";

import { ImagePlus, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";

import { CatalogImage } from "@/components/ui/CatalogImage";
import { compressProductImageForUpload } from "@/lib/images/productImageCompression";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  hasSupportedProductImageSignature,
  isSupportedProductImageMimeType,
} from "@/lib/supabase/productImagePolicy";
import { useToastStore } from "@/store/useToastStore";

interface StoreImageUploaderProps {
  aspectClassName: string;
  kind: "logo" | "banner";
  label: string;
  onChange: (url: string) => void;
  placeholder: string;
  storeId: string;
  value: string;
  variant?: "dark" | "light";
}

async function uploadStoreImage(
  storeId: string,
  kind: StoreImageUploaderProps["kind"],
  file: File,
) {
  if (
    !isSupportedProductImageMimeType(file.type) ||
    file.size <= 0 ||
    file.size > 10 * 1024 * 1024 ||
    !(await hasSupportedProductImageSignature(file))
  ) {
    throw new Error("10MB 이하 JPG·PNG·WEBP 이미지를 선택해 주세요.");
  }

  const compressed = await compressProductImageForUpload(file);
  const extension = (compressed.name.split(".").pop() ?? "webp").replace(
    /[^a-z0-9]/giu,
    "",
  );
  const client = getSupabaseBrowserClient();
  const path = `${storeId}/${kind}-${crypto.randomUUID()}.${extension}`;
  const { data, error } = await client.storage
    .from("store-mall-images")
    .upload(path, compressed, {
      cacheControl: "31536000",
      contentType: compressed.type,
    });

  if (error || !data) throw new Error("이미지 업로드에 실패했습니다.");
  return client.storage.from("store-mall-images").getPublicUrl(data.path).data
    .publicUrl;
}

export function StoreImageUploader({
  aspectClassName,
  kind,
  label,
  onChange,
  placeholder,
  storeId,
  value,
  variant = "light",
}: StoreImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pushToast = useToastStore((state) => state.pushToast);
  const dark = variant === "dark";

  return (
    <div className="min-w-0 space-y-2">
      <label
        className={`block text-xs font-bold ${dark ? "text-zinc-300" : "text-ink"}`}
        htmlFor={`${kind}-${storeId}`}
      >
        {label}
      </label>
      <button
        aria-busy={busy}
        className={`${aspectClassName} group relative grid min-h-11 w-full place-items-center overflow-hidden rounded-2xl border border-dashed transition-colors ${dark ? "border-zinc-700 bg-zinc-950 hover:border-emerald-500" : "border-line bg-surface hover:border-ink"}`}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        {value ? (
          <CatalogImage
            alt={`${label} 미리보기`}
            className="size-full object-cover"
            height={525}
            src={value}
            width={1200}
          />
        ) : (
          <span
            className={`flex max-w-xs flex-col items-center gap-2 px-4 text-center text-xs leading-5 ${dark ? "text-zinc-400" : "text-muted"}`}
          >
            {busy ? (
              <LoaderCircle className="animate-spin" size={20} />
            ) : (
              <ImagePlus size={20} />
            )}
            {busy ? "압축 및 업로드 중…" : placeholder}
          </span>
        )}
        {value && !busy ? (
          <span className="absolute inset-0 hidden place-items-center bg-black/60 text-xs font-bold text-white group-hover:grid group-focus-visible:grid">
            이미지 변경
          </span>
        ) : null}
      </button>
      <input
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        id={`${kind}-${storeId}`}
        ref={inputRef}
        type="file"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            onChange(await uploadStoreImage(storeId, kind, file));
            pushToast(
              "success",
              "이미지를 업로드했습니다. 변경사항을 저장해 적용해 주세요.",
            );
          } catch (error) {
            pushToast(
              "error",
              error instanceof Error
                ? error.message
                : "이미지 업로드에 실패했습니다.",
            );
          } finally {
            setBusy(false);
            event.target.value = "";
          }
        }}
      />
    </div>
  );
}
