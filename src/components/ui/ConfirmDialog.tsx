"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { PremiumDialog } from "@/components/ui/PremiumDialog";

interface ConfirmDialogProps {
  busy?: boolean;
  children?: ReactNode;
  confirmLabel: string;
  description: string;
  disabled?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
}

export function ConfirmDialog({
  busy = false,
  children,
  confirmLabel,
  description,
  disabled = false,
  onClose,
  onConfirm,
  open,
  title,
}: ConfirmDialogProps) {
  return (
    <PremiumDialog
      ariaLabel={title}
      closeDisabled={busy}
      onClose={onClose}
      open={open}
      panelClassName="max-w-md p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-black">{title}</h2>
          <p className="mt-2 text-xs leading-5 text-muted">{description}</p>
        </div>
        <button aria-label="확인창 닫기" className="grid min-h-11 min-w-11 place-items-center" disabled={busy} onClick={onClose} type="button"><X size={19} /></button>
      </div>
      {children}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button className="min-h-11 rounded-xl border border-line text-xs font-bold" disabled={busy} onClick={onClose} type="button">취소</button>
        <button className="min-h-11 rounded-xl bg-amber-500 px-3 text-xs font-black text-zinc-950 disabled:opacity-40" disabled={busy || disabled} onClick={onConfirm} type="button">{busy ? "처리 중…" : confirmLabel}</button>
      </div>
    </PremiumDialog>
  );
}
