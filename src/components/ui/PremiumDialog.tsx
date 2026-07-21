"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { lockBodyScroll } from "@/lib/browser/bodyScrollLock";

const EXIT_DURATION_MS = 180;
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface PremiumDialogProps {
  ariaLabel?: string;
  children: ReactNode;
  closeDisabled?: boolean;
  labelledBy?: string;
  onClose: () => void;
  open: boolean;
  overlayClassName?: string;
  panelClassName?: string;
  panelViewportClassName?: string;
  placement?: "center" | "drawer-left" | "sheet-bottom";
  zIndexClassName?: string;
}

/**
 * Shared nested-modal surface for detail actions. It deliberately owns its
 * short exit-presence window so callers can set open=false without losing the
 * fade/scale-out frame.
 */
export function PremiumDialog({
  ariaLabel,
  children,
  closeDisabled = false,
  labelledBy,
  onClose,
  open,
  overlayClassName = "",
  panelClassName = "",
  panelViewportClassName,
  placement = "center",
  zIndexClassName = "z-[130]",
}: PremiumDialogProps) {
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(open);
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  }, [closeDisabled, onClose]);

  useEffect(() => {
    if (open) {
      const frame = window.requestAnimationFrame(() => {
        setRendered(true);
        setVisible(true);
      });
      return () => window.cancelAnimationFrame(frame);
    }

    const frame = window.requestAnimationFrame(() => setVisible(false));
    const timer = window.setTimeout(
      () => setRendered(false),
      EXIT_DURATION_MS,
    );
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [open]);

  const requestClose = useCallback(() => {
    if (!closeDisabledRef.current) onCloseRef.current();
  }, []);

  useEffect(() => {
    if (!rendered) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const releaseBodyScroll = lockBodyScroll();
    const focusFrame = window.requestAnimationFrame(() => {
      const focusable = dialogRef.current?.querySelector<HTMLElement>(
        FOCUSABLE_SELECTOR,
      );
      (focusable ?? dialogRef.current)?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      const modalLayers = document.querySelectorAll<HTMLElement>(
        '[data-premium-modal-layer="nested"]',
      );
      const topLayer = modalLayers.item(modalLayers.length - 1);
      if (topLayer && !topLayer.contains(dialogRef.current)) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        requestClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      event.stopImmediatePropagation();
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ].filter((element) => !element.hasAttribute("disabled"));
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown, true);
      releaseBodyScroll();
      returnFocusRef.current?.focus();
    };
  }, [rendered, requestClose]);

  if (!rendered || typeof document === "undefined") return null;

  const overlayPlacementClassName =
    placement === "drawer-left"
      ? "flex items-stretch justify-start p-0"
      : placement === "sheet-bottom"
        ? "flex items-end justify-center p-0"
        : "flex items-center justify-center p-3 [padding-bottom:max(.75rem,env(safe-area-inset-bottom))] [padding-left:max(.75rem,env(safe-area-inset-left))] [padding-right:max(.75rem,env(safe-area-inset-right))] [padding-top:max(.75rem,env(safe-area-inset-top))] md:p-8";
  const panelPlacementClassName =
    placement === "drawer-left"
      ? "h-dvh w-[min(88vw,380px)] rounded-r-3xl"
      : placement === "sheet-bottom"
        ? "w-full rounded-t-3xl"
        : "w-full rounded-3xl";
  const resolvedPanelViewportClassName =
    panelViewportClassName ??
    (placement === "drawer-left"
      ? "max-h-dvh"
      : placement === "sheet-bottom"
        ? "max-h-[86dvh]"
        : "max-h-[min(88dvh,900px)]");

  return createPortal(
    <div
      className={`premium-dialog-overlay fixed inset-0 ${zIndexClassName} ${overlayPlacementClassName} bg-black/60 backdrop-blur-md ${overlayClassName}`.trim()}
      data-premium-modal-layer="nested"
      data-premium-modal-placement={placement}
      data-state={visible ? "open" : "closed"}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      role="presentation"
    >
      <section
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={`premium-dialog-surface ${resolvedPanelViewportClassName} ${panelPlacementClassName} overflow-x-hidden overflow-y-auto border border-white/10 bg-paper text-ink shadow-2xl shadow-black/20 outline-none ${panelClassName}`.trim()}
        data-state={visible ? "open" : "closed"}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </section>
    </div>,
    document.body,
  );
}
