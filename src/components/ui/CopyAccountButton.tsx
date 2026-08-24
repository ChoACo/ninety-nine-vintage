"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useToastStore } from "@/store/useToastStore";

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("clipboard_unavailable");
}

export function CopyAccountButton({
  accountNumber,
  bankName,
}: {
  accountNumber: string;
  bankName: string;
}) {
  const pushToast = useToastStore((state) => state.pushToast);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeoutId = window.setTimeout(() => setCopied(false), 2_000);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);

  return (
    <button
      aria-label={`${bankName} 계좌번호 ${accountNumber} 복사`}
      className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-4 text-left transition-[transform,background-color,border-color] active:scale-[0.98] ${
        copied
          ? "border-emerald-500 bg-emerald-50 text-emerald-900"
          : "border-line bg-paper"
      }`}
      onClick={() => {
        void copyText(accountNumber)
          .then(() => {
            setCopied(true);
            pushToast("success", "계좌번호를 복사했습니다.");
          })
          .catch(() =>
            pushToast(
              "error",
              "계좌번호를 복사하지 못했습니다. 길게 눌러 직접 복사해 주세요.",
            ),
          );
      }}
      type="button"
    >
      <span className="min-w-0">
        <span className="block text-[10px] font-bold text-muted">
          {bankName} · 터치하여 복사
        </span>
        <span className="mt-0.5 block break-all font-mono text-sm font-black">
          {accountNumber}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[11px] font-black">
        {copied ? (
          <>
            <Check aria-hidden="true" size={16} /> 복사 완료
          </>
        ) : (
          <>
            <Copy aria-hidden="true" size={16} /> 복사
          </>
        )}
      </span>
    </button>
  );
}
