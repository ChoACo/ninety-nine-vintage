"use client";

import { ArrowLeft, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { lockBodyScroll } from "@/lib/browser/bodyScrollLock";

const ROUTE_MODAL_EXIT_MS = 180;
const ROUTE_MODAL_FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function ModalShell({
  children,
  label,
  size = "default",
}: Readonly<{
  children: React.ReactNode;
  label: string;
  size?: "default" | "wide";
}>) {
  const router = useRouter();
  const [closing, setClosing] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const closingRef = useRef(false);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(
      () => router.back(),
      ROUTE_MODAL_EXIT_MS,
    );
  }, [router]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseBodyScroll = lockBodyScroll();
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[data-premium-modal-layer="nested"]')) {
        return;
      }
      if (event.key === "Escape") {
        close();
      } else if (event.key === "Tab" && dialogRef.current) {
        const focusable = [
          ...dialogRef.current.querySelectorAll<HTMLElement>(
            ROUTE_MODAL_FOCUSABLE,
          ),
        ];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (focusable.length === 0) {
          event.preventDefault();
          dialogRef.current.focus();
        } else if (!dialogRef.current.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
      releaseBodyScroll();
      returnFocusRef.current?.focus();
    };
  }, [close]);

  const widthClassName =
    size === "wide"
      ? "md:max-w-6xl xl:max-w-7xl"
      : "md:max-w-3xl";

  return (
    <div className="premium-dialog-overlay fixed inset-0 z-[110] overflow-hidden bg-black/60 backdrop-blur-md" data-state={closing ? "closed" : "open"} role="presentation">
      <div className="flex min-h-full items-center justify-center p-2 [padding-bottom:max(.5rem,env(safe-area-inset-bottom))] [padding-top:max(.5rem,env(safe-area-inset-top))] md:p-6" onMouseDown={(event) => event.target === event.currentTarget && close()}>
        <div aria-label={label} aria-modal="true" className={`premium-dialog-surface flex max-h-[calc(100dvh-1rem)] min-h-0 w-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-paper text-ink shadow-2xl shadow-black/20 outline-none md:max-h-[calc(100vh-3rem)] ${widthClassName}`} data-modal-size={size} data-state={closing ? "closed" : "open"} ref={dialogRef} role="dialog" tabIndex={-1}>
          <header className="z-20 flex h-14 shrink-0 items-center justify-between border-b border-line bg-paper/95 px-4 backdrop-blur-md md:px-6">
            <button className="inline-flex items-center gap-2 rounded-xl px-2 py-2 text-xs font-bold transition-all duration-300 hover:-translate-y-0.5 hover:bg-surface active:scale-95" onClick={close} type="button"><ArrowLeft size={16} /> 뒤로 가기</button>
            <p className="truncate px-4 text-xs font-bold">{label}</p>
            <button aria-label={`${label} 닫기`} className="grid size-10 place-items-center rounded-xl transition-all duration-300 hover:-translate-y-0.5 hover:bg-surface active:scale-95" onClick={close} type="button"><X size={18} /></button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
