"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
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
  const dragStartRef = useRef<{
    pointerId: number;
    position: number;
    startedAt: number;
  } | null>(null);
  const draggedRef = useRef(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

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

  const draggable = placement === "sheet-bottom" || placement === "drawer-left";
  const pointerPosition = (event: ReactPointerEvent<HTMLElement>) =>
    placement === "sheet-bottom" ? event.clientY : event.clientX;
  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!draggable || closeDisabledRef.current) return;
    dragStartRef.current = {
      pointerId: event.pointerId,
      position: pointerPosition(event),
      startedAt: performance.now(),
    };
    draggedRef.current = false;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const updateDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const delta = pointerPosition(event) - start.position;
    const directionalDelta = placement === "drawer-left" ? -delta : delta;
    const nextOffset = Math.max(0, directionalDelta);
    if (nextOffset > 4) draggedRef.current = true;
    setDragOffset(nextOffset);
  };
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const elapsed = Math.max(1, performance.now() - start.startedAt);
    const velocity = dragOffset / elapsed;
    const shouldClose = dragOffset >= 88 || (dragOffset >= 36 && velocity > 0.55);
    dragStartRef.current = null;
    setDragging(false);
    setDragOffset(0);
    if (shouldClose) requestClose();
  };

  // The portal mounts as soon as `open` becomes true, while `rendered` only
  // preserves the exit animation. Waiting for the animation frame can leave a
  // visible mobile sheet competing with page scroll when frames are throttled.
  const scrollLockActive = open || rendered;

  useEffect(() => {
    if (!scrollLockActive) return;
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
  }, [requestClose, scrollLockActive]);

  // Mount immediately when the caller opens the dialog. `rendered` is only
  // needed to keep the portal alive during the short closing animation.
  if ((!open && !rendered) || typeof document === "undefined") return null;

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
  const dragStyle: CSSProperties | undefined =
    dragging && dragOffset > 0
      ? {
          transform:
            placement === "drawer-left"
              ? `translate3d(${-dragOffset}px, 0, 0)`
              : `translate3d(0, ${dragOffset}px, 0)`,
        }
      : undefined;

  return createPortal(
    <div
      className={`premium-dialog-overlay fixed inset-0 ${zIndexClassName} ${overlayPlacementClassName} bg-black/60 backdrop-blur-md ${overlayClassName}`.trim()}
      data-premium-modal-layer="nested"
      data-premium-modal-placement={placement}
      data-scroll-lock-owner="premium-dialog"
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
        className={`premium-dialog-surface relative ${resolvedPanelViewportClassName} ${panelPlacementClassName} overflow-x-hidden overflow-y-auto overscroll-contain border border-border/50 bg-card text-card-foreground shadow-2xl shadow-black/20 outline-none ${panelClassName}`.trim()}
        data-dragging={dragging ? "true" : "false"}
        data-state={visible ? "open" : "closed"}
        ref={dialogRef}
        role="dialog"
        style={dragStyle}
        tabIndex={-1}
      >
        {draggable && (
          <button
            aria-label={
              placement === "sheet-bottom"
                ? "아래로 밀어 창 닫기"
                : "왼쪽으로 밀어 메뉴 닫기"
            }
            className={
              placement === "sheet-bottom"
                ? "absolute left-1/2 top-1 z-20 flex h-7 w-16 -translate-x-1/2 touch-none items-start justify-center pt-2 after:h-1 after:w-10 after:rounded-full after:bg-muted-foreground/35"
                : "absolute right-0 top-1/2 z-20 flex h-20 w-7 -translate-y-1/2 touch-none items-center justify-center after:h-10 after:w-1 after:rounded-full after:bg-muted-foreground/35"
            }
            onClick={() => {
              if (draggedRef.current) {
                draggedRef.current = false;
                return;
              }
              requestClose();
            }}
            onPointerCancel={endDrag}
            onPointerDown={beginDrag}
            onPointerMove={updateDrag}
            onPointerUp={endDrag}
            type="button"
          />
        )}
        {children}
      </section>
    </div>,
    document.body,
  );
}
