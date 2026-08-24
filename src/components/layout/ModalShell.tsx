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
    const onRequestedClose = () => close();
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("ninety-nine:close-route-modal", onRequestedClose);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("ninety-nine:close-route-modal", onRequestedClose);
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
      releaseBodyScroll();
      returnFocusRef.current?.focus();
    };
  }, [close]);

  const widthClassName =
    size === "wide"
      ? "max-w-7xl"
      : "max-w-3xl";

  return (
    <div className="route-modal-overlay premium-dialog-overlay fixed inset-0 z-[110] overflow-hidden bg-black/60 backdrop-blur-md" data-scroll-lock-owner="route-modal" data-state={closing ? "closed" : "open"} role="presentation">
      <div className="flex min-h-full w-full min-w-0 items-end justify-center md:items-center md:p-6" onMouseDown={(event) => event.target === event.currentTarget && close()}>
        <div aria-label={label} aria-modal="true" className={`route-modal-surface premium-dialog-surface flex max-h-[92dvh] min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-paper text-ink shadow-2xl shadow-black/20 outline-none md:max-h-[calc(100vh-3rem)] md:rounded-3xl ${widthClassName}`} data-modal-size={size} data-state={closing ? "closed" : "open"} ref={dialogRef} role="dialog" tabIndex={-1}>
          <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted/40 md:hidden" />
          <header className="z-20 flex min-h-14 shrink-0 items-center justify-between border-b border-line bg-paper/95 px-3 backdrop-blur-md sm:px-4 md:px-6">
            <button className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 py-2 text-xs font-bold transition-all duration-300 hover:-translate-y-0.5 hover:bg-surface active:scale-95" onClick={close} type="button"><ArrowLeft size={16} /> 뒤로 가기</button>
            <p className="truncate px-4 text-xs font-bold">{label}</p>
            <button aria-label={`${label} 닫기`} className="grid size-11 place-items-center rounded-xl transition-all duration-300 hover:-translate-y-0.5 hover:bg-surface active:scale-95" onClick={close} type="button"><X size={18} /></button>
          </header>
          <div className="min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5 md:p-6" data-route-modal-scroll>{children}</div>
        </div>
      </div>
    </div>
  );
}
