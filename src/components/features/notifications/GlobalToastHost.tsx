"use client";

import { CheckCircle2, X, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { useToastStore } from "@/store/useToastStore";

const TOAST_AUTO_DISMISS_MS = 5_000;

export function GlobalToastHost() {
  const toasts = useToastStore((state) => state.toasts);
  const dismissToast = useToastStore((state) => state.dismissToast);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) =>
      window.setTimeout(
        () => dismissToast(toast.id),
        toast.durationMs ?? TOAST_AUTO_DISMISS_MS,
      ),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [dismissToast, toasts]);

  return (
    <div
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[200] flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((toast) => (
        <div
          className="pointer-events-auto flex w-[min(24rem,calc(100vw-2rem))] items-start gap-3 border border-ink bg-paper p-4 text-ink shadow-2xl"
          key={toast.id}
          role="status"
        >
          <span className="mt-0.5 shrink-0">
            {toast.kind === "error" ? (
              <XCircle className="text-red-700" size={18} />
            ) : (
              <CheckCircle2 className="text-emerald-700" size={18} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold leading-5">{toast.text}</p>
            {toast.action && (
              <Link
                className="mt-2 inline-flex h-8 items-center gap-1 border border-ink bg-ink px-3 text-[11px] font-bold text-paper"
                href={toast.action.href}
              >
                {toast.action.label}
              </Link>
            )}
          </div>
          <button
            aria-label="알림 닫기"
            className="grid size-8 shrink-0 place-items-center text-muted"
            onClick={() => dismissToast(toast.id)}
            type="button"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
