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
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-4xl",
  gallery: "max-w-6xl",
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4">
      <button
        type="button"
        aria-label="모달 닫기"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-[#302821]/60 backdrop-blur-sm"
        onClick={closeOnBackdrop ? onClose : undefined}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`relative flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-[1.75rem] border outline-none sm:max-h-[calc(100dvh-2rem)] ${
          tone === "dark"
            ? "border-white/15 bg-[#2b343b] text-white shadow-[0_28px_90px_rgba(18,22,25,0.52)]"
            : "border-white/70 bg-[#fffaf4] shadow-[0_24px_80px_rgba(48,40,33,0.3)]"
        } ${sizeClasses[size]} ${className}`}
      >
        <div
          className={`flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4 sm:px-6 ${
            tone === "dark"
              ? "border-white/10 bg-white/[0.035]"
              : "border-[#eee0d4]"
          }`}
        >
          <div className="min-w-0">
            <h2
              id={titleId}
              className={`text-lg font-bold sm:text-xl ${
                tone === "dark" ? "text-white" : "text-[#382f2a]"
              }`}
            >
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className={`mt-1 text-[17px] leading-7 ${
                  tone === "dark" ? "text-white/60" : "text-[#7b6b60]"
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
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border text-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec7866] ${
                tone === "dark"
                  ? "border-white/15 bg-white/10 text-white hover:bg-white/20"
                  : "border-[#eadbcd] bg-white text-[#6e5d52] hover:bg-[#fff1e4]"
              }`}
              aria-label="닫기"
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
