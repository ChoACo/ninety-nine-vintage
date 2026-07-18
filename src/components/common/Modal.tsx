"use client";

import {
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { createPortal } from "react-dom";

type ModalSize = "sm" | "md" | "lg" | "gallery" | "full";
type ModalTone = "light" | "dark";

export interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  description?: string;
  size?: ModalSize;
  tone?: ModalTone;
  showCloseButton?: boolean;
  closeOnBackdrop?: boolean;
  labelledBy?: string;
  className?: string;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: "max-w-[26rem]",
  md: "max-w-[36rem]",
  lg: "max-w-[64rem]",
  gallery: "max-w-[76rem]",
  full: "h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] sm:h-[calc(100dvh-2rem)] sm:max-w-[calc(100vw-2rem)]",
};

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export default function Modal({
  open,
  title,
  children,
  onClose,
  description,
  size = "md",
  tone = "light",
  showCloseButton = true,
  closeOnBackdrop = true,
  labelledBy,
  className = "",
}: ModalProps) {
  const generatedTitleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = labelledBy ?? generatedTitleId;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previousActiveElement = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      const firstFocusable =
        dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
      (firstFocusable ?? dialogRef.current)?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      );
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActiveElement?.focus();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center pt-6 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="모달 닫기"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-[2px] transition-opacity duration-200"
        onClick={closeOnBackdrop ? onClose : undefined}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`animate-fade-in-up relative flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-t-xl border outline-none sm:max-h-[calc(100dvh-2rem)] sm:rounded-xl ${
          tone === "dark"
            ? "border-white/15 bg-[#151514] text-[#f7f3e9] shadow-[0_30px_100px_rgba(0,0,0,0.62)]"
            : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] shadow-[0_30px_100px_rgba(18,18,17,0.32)]"
        } ${sizeClasses[size]} ${className}`}
      >
        <span
          aria-hidden="true"
          className={`mx-auto mt-2 block h-1 w-9 shrink-0 rounded-full sm:hidden ${
            tone === "dark" ? "bg-white/20" : "bg-[var(--border-strong)]"
          }`}
        />
        <div
          className={`flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4 sm:px-6 sm:py-5 ${
            tone === "dark"
              ? "border-white/10 bg-white/[0.025]"
              : "border-[var(--border)] bg-[var(--surface)]"
          }`}
        >
          <div className="min-w-0">
            <h2
              id={titleId}
              className={`text-lg font-extrabold tracking-[-0.025em] sm:text-xl ${
                tone === "dark" ? "text-white" : "text-[var(--text-strong)]"
              }`}
            >
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className={`mt-1.5 max-w-2xl break-keep text-sm font-medium leading-6 ${
                  tone === "dark" ? "text-white/60" : "text-[var(--text-muted)]"
                }`}
              >
                {description}
              </p>
            ) : null}
          </div>

          {showCloseButton ? (
            <button
              type="button"
              onClick={onClose}
              className={`grid size-9 shrink-0 place-items-center rounded-md border transition-all duration-200 ease-out hover:scale-[1.04] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
                tone === "dark"
                  ? "border-white/15 bg-white/[0.04] text-white/70 hover:border-white/30 hover:bg-white/10 hover:text-white"
                  : "border-[var(--border)] bg-transparent text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-strong)]"
              }`}
              aria-label="닫기"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                className="size-[18px]"
              >
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
