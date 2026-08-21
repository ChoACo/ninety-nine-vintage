"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";
import { useToastStore } from "@/store/useToastStore";

interface ShareProductButtonProps {
  ariaLabel?: string;
  className?: string;
  label?: string;
  priceText: string;
  title: string;
  url: string;
}

export function ShareProductButton({
  ariaLabel,
  className = "",
  label,
  priceText,
  title,
  url,
}: ShareProductButtonProps) {
  const pushToast = useToastStore((state) => state.pushToast);
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const shareData: ShareData = {
      title,
      text: `${title}\n${priceText}`,
      url,
    };
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function"
    ) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      pushToast("success", "공유 링크가 복사되었습니다.");
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      pushToast("error", "링크 복사에 실패했습니다. 다시 시도해 주세요.");
    }
  };

  return (
    <button
      aria-label={
        copied
          ? "공유 링크가 복사되었습니다"
          : ariaLabel ?? `${title} 공유`
      }
      className={className}
      onClick={() => void handleShare()}
      type="button"
    >
      {copied ? (
        <Check size={15} strokeWidth={1.6} />
      ) : (
        <Share2 size={15} strokeWidth={1.6} />
      )}
      {label !== undefined && (
        <span>{copied ? "링크 복사됨" : label}</span>
      )}
    </button>
  );
}