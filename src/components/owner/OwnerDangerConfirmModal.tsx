"use client";

import { useEffect } from "react";

import { Button } from "@/src/components/common";

interface OwnerDangerConfirmModalProps {
  open: boolean;
  eyebrow?: string;
  title: string;
  description: string;
  confirmLabel: string;
  isLoading?: boolean;
  tone?: "danger" | "warning";
  details?: Array<{ label: string; value: string }>;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function OwnerDangerConfirmModal({
  open,
  eyebrow = "PRIVILEGED ACTION",
  title,
  description,
  confirmLabel,
  isLoading = false,
  tone = "danger",
  details = [],
  onCancel,
  onConfirm,
}: OwnerDangerConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isLoading) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isLoading, onCancel, open]);

  if (!open) return null;

  const accentClass =
    tone === "danger"
      ? "border-red-500/30 bg-red-500/10 text-red-200"
      : "border-amber-400/30 bg-amber-400/10 text-amber-100";

  return (
    <div
      className="fixed inset-0 z-[100] grid min-h-dvh place-items-end overscroll-none bg-black/75 p-0 backdrop-blur-sm sm:place-items-center sm:p-5"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isLoading) onCancel();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="owner-danger-dialog-title"
        aria-describedby="owner-danger-dialog-description"
        className="flex max-h-[calc(100dvh-env(safe-area-inset-top)-.5rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-zinc-800 bg-[#09090b] shadow-2xl shadow-black/70 sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl"
      >
        <span aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-zinc-700 sm:hidden" />
        <div className="min-h-0 overflow-y-auto overscroll-contain">
        <div className={`border-b px-5 py-4 ${accentClass}`}>
          <p className="font-mono text-[10px] font-black uppercase tracking-[0.18em]">
            {eyebrow}
          </p>
          <div className="mt-2 flex items-start gap-3">
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-current/30 font-mono text-lg font-black"
            >
              !
            </span>
            <div className="min-w-0">
              <h2 id="owner-danger-dialog-title" className="text-lg font-black tracking-tight text-white">
                {title}
              </h2>
              <p id="owner-danger-dialog-description" className="mt-1 break-keep text-sm font-semibold leading-6 text-zinc-300">
                {description}
              </p>
            </div>
          </div>
        </div>

        {details.length > 0 ? (
          <dl className="divide-y divide-zinc-800 border-b border-zinc-800 px-5">
            {details.map((item) => (
              <div key={item.label} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-3 text-xs">
                <dt className="font-black text-zinc-500">{item.label}</dt>
                <dd className="break-all text-right font-mono font-bold tabular-nums text-zinc-200">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 bg-zinc-950/80 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:flex-row sm:justify-end sm:p-4">
          <Button className="w-full sm:w-auto" variant="ghost" disabled={isLoading} onClick={onCancel}>
            취소
          </Button>
          <Button
            className="w-full sm:w-auto"
            variant={tone === "danger" ? "danger" : "secondary"}
            isLoading={isLoading}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}
