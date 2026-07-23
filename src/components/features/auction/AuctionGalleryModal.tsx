"use client";

import useEmblaCarousel from "embla-carousel-react";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { lockBodyScroll } from "@/lib/browser/bodyScrollLock";
import { CatalogImage } from "@/components/ui/CatalogImage";
import {
  clampTransform,
  fitContain,
  panBy,
  pinchTransform,
  zoomAtPoint,
  type PanZoomPoint,
  type PanZoomTransform,
} from "@/lib/images/panZoomMath";

interface AuctionGalleryModalProps {
  images: readonly string[];
  initialIndex?: number;
  onClose: () => void;
  open: boolean;
  surface?: "desktop" | "mobile";
  title: string;
}

interface PointerPosition extends PanZoomPoint {
  pointerType: string;
}

type GestureState =
  | {
      kind: "mouse" | "pan";
      last: PanZoomPoint;
      moved: boolean;
      start: PanZoomPoint;
    }
  | {
      kind: "swipe";
      last: PanZoomPoint;
      start: PanZoomPoint;
    }
  | {
      initialCenter: PanZoomPoint;
      initialDistance: number;
      initialTransform: PanZoomTransform;
      kind: "pinch";
    }
  | null;

const IDENTITY_TRANSFORM: PanZoomTransform = { scale: 1, x: 0, y: 0 };
const EXIT_DURATION_MS = 180;
const MIN_SWIPE_PX = 56;

function clampIndex(index: number, length: number) {
  if (length === 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

function distance([first, second]: readonly PointerPosition[]) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function center([first, second]: readonly PointerPosition[]): PanZoomPoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

export function AuctionGalleryModal({
  images,
  initialIndex = 0,
  onClose,
  open,
  surface = "desktop",
  title,
}: AuctionGalleryModalProps) {
  const startIndex = clampIndex(initialIndex, images.length);
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "center",
    dragFree: false,
    loop: true,
    skipSnaps: false,
    startIndex,
    watchDrag: false,
  });
  const [activeIndex, setActiveIndex] = useState(startIndex);
  const [announcement, setAnnouncement] = useState("");
  const [dragging, setDragging] = useState(false);
  const [naturalSizes, setNaturalSizes] = useState<
    Record<number, { height: number; width: number }>
  >({});
  const [rendered, setRendered] = useState(open);
  const [transform, setTransform] =
    useState<PanZoomTransform>(IDENTITY_TRANSFORM);
  const [viewportSize, setViewportSize] = useState({ height: 1, width: 1 });
  const [visible, setVisible] = useState(open);
  const [wheelZooming, setWheelZooming] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<GestureState>(null);
  const naturalSizesRef = useRef(naturalSizes);
  const onCloseRef = useRef(onClose);
  const pointersRef = useRef(new Map<number, PointerPosition>());
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const transformRef = useRef(transform);
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewportSizeRef = useRef(viewportSize);
  const wheelEndTimerRef = useRef<number | null>(null);

  const visibleIndex = clampIndex(activeIndex, images.length);

  useEffect(() => {
    naturalSizesRef.current = naturalSizes;
  }, [naturalSizes]);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);
  useEffect(() => {
    viewportSizeRef.current = viewportSize;
  }, [viewportSize]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAnnouncement(
        `사진 ${visibleIndex + 1}/${images.length}, 확대 ${Math.round(transform.scale * 100)}%`,
      );
    }, 180);
    return () => window.clearTimeout(timer);
  }, [images.length, transform.scale, visibleIndex]);

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

  const setViewportNode = useCallback(
    (node: HTMLDivElement | null) => {
      viewportRef.current = node;
      emblaRef(node);
    },
    [emblaRef],
  );

  const getBounds = useCallback((index = activeIndex) => {
    const viewport = viewportSizeRef.current;
    const natural = naturalSizesRef.current[index] ?? viewport;
    const content = fitContain(
      viewport.width,
      viewport.height,
      natural.width,
      natural.height,
    );
    const nativeScale = Math.min(
      natural.width / Math.max(1, content.width),
      natural.height / Math.max(1, content.height),
    );
    return {
      contentHeight: content.height,
      contentWidth: content.width,
      maxScale: Math.min(4, Math.max(2, nativeScale)),
      minScale: 1,
      viewportHeight: viewport.height,
      viewportWidth: viewport.width,
    };
  }, [activeIndex]);

  const applyTransform = useCallback((next: PanZoomTransform) => {
    transformRef.current = next;
    setTransform(next);
  }, []);

  const resetTransform = useCallback(() => {
    gestureRef.current = null;
    pointersRef.current.clear();
    setDragging(false);
    applyTransform(IDENTITY_TRANSFORM);
  }, [applyTransform]);

  const zoomTo = useCallback(
    (scale: number, point: PanZoomPoint = { x: 0, y: 0 }) => {
      applyTransform(
        zoomAtPoint(transformRef.current, scale, point, getBounds()),
      );
    },
    [applyTransform, getBounds],
  );

  const showPrevious = useCallback(() => {
    resetTransform();
    emblaApi?.scrollPrev();
  }, [emblaApi, resetTransform]);
  const showNext = useCallback(() => {
    resetTransform();
    emblaApi?.scrollNext();
  }, [emblaApi, resetTransform]);
  const galleryActionsRef = useRef({
    applyTransform,
    getBounds,
    resetTransform,
    showNext,
    showPrevious,
    zoomTo,
  });
  useEffect(() => {
    galleryActionsRef.current = {
      applyTransform,
      getBounds,
      resetTransform,
      showNext,
      showPrevious,
      zoomTo,
    };
  }, [applyTransform, getBounds, resetTransform, showNext, showPrevious, zoomTo]);

  useEffect(() => {
    if (!emblaApi) return;
    const select = () => {
      setActiveIndex(emblaApi.selectedScrollSnap());
      resetTransform();
    };
    select();
    emblaApi.on("select", select);
    emblaApi.on("reInit", select);
    return () => {
      emblaApi.off("select", select);
      emblaApi.off("reInit", select);
    };
  }, [emblaApi, resetTransform]);

  useEffect(() => {
    if (!rendered || !viewportRef.current) return;
    const viewport = viewportRef.current;
    const measure = () => {
      const rect = viewport.getBoundingClientRect();
      const next = {
        height: Math.max(1, rect.height),
        width: Math.max(1, rect.width),
      };
      viewportSizeRef.current = next;
      setViewportSize(next);
      applyTransform(clampTransform(transformRef.current, getBounds()));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [applyTransform, getBounds, rendered]);

  useEffect(() => {
    if (!rendered) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const releaseBodyScroll = lockBodyScroll();
    const focusFrame = window.requestAnimationFrame(() =>
      closeButtonRef.current?.focus(),
    );
    const onKeyDown = (event: KeyboardEvent) => {
      const modalLayers = document.querySelectorAll<HTMLElement>(
        '[data-premium-modal-layer="nested"]',
      );
      if (modalLayers.item(modalLayers.length - 1) !== dialogRef.current) {
        return;
      }

      const actions = galleryActionsRef.current;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
      } else if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        actions.zoomTo(transformRef.current.scale * 1.35);
      } else if (event.key === "-") {
        event.preventDefault();
        actions.zoomTo(transformRef.current.scale / 1.35);
      } else if (event.key === "0") {
        event.preventDefault();
        actions.resetTransform();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (transformRef.current.scale === 1) actions.showPrevious();
        else
          actions.applyTransform(
            panBy(transformRef.current, { x: 56, y: 0 }, actions.getBounds()),
          );
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (transformRef.current.scale === 1) actions.showNext();
        else
          actions.applyTransform(
            panBy(transformRef.current, { x: -56, y: 0 }, actions.getBounds()),
          );
      } else if (event.key === "ArrowUp" && transformRef.current.scale > 1) {
        event.preventDefault();
        actions.applyTransform(
          panBy(transformRef.current, { x: 0, y: 56 }, actions.getBounds()),
        );
      } else if (
        event.key === "ArrowDown" &&
        transformRef.current.scale > 1
      ) {
        event.preventDefault();
        actions.applyTransform(
          panBy(transformRef.current, { x: 0, y: -56 }, actions.getBounds()),
        );
      } else if (event.key === "Tab" && dialogRef.current) {
        event.stopImmediatePropagation();
        const focusable = [
          ...dialogRef.current.querySelectorAll<HTMLElement>(
            "button:not([disabled]), [tabindex]:not([tabindex='-1'])",
          ),
        ];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!dialogRef.current.contains(document.activeElement)) {
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
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown, true);
      releaseBodyScroll();
      returnFocusRef.current?.focus();
    };
  }, [rendered]);

  useEffect(() => {
    if (!rendered || !viewportRef.current) return;
    const viewport = viewportRef.current;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      setWheelZooming(true);
      if (wheelEndTimerRef.current !== null) {
        window.clearTimeout(wheelEndTimerRef.current);
      }
      wheelEndTimerRef.current = window.setTimeout(() => {
        wheelEndTimerRef.current = null;
        setWheelZooming(false);
      }, 140);
      const rect = viewport.getBoundingClientRect();
      const point = {
        x: event.clientX - (rect.left + rect.width / 2),
        y: event.clientY - (rect.top + rect.height / 2),
      };
      const normalizedDeltaY =
        event.deltaY *
        (event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? rect.height
            : 1);
      const multiplier = Math.exp(-normalizedDeltaY * 0.0015);
      zoomTo(transformRef.current.scale * multiplier, point);
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      if (wheelEndTimerRef.current !== null) {
        window.clearTimeout(wheelEndTimerRef.current);
        wheelEndTimerRef.current = null;
      }
      setWheelZooming(false);
    };
  }, [rendered, zoomTo]);

  const relativePoint = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: clientX - (rect.left + rect.width / 2),
      y: clientY - (rect.top + rect.height / 2),
    };
  }, []);

  const pointerValues = () => [...pointersRef.current.values()];

  const rebaseRemainingGesture = () => {
    const remaining = pointerValues();
    if (remaining.length >= 2) {
      const pair = remaining.slice(0, 2);
      gestureRef.current = {
        initialCenter: center(pair),
        initialDistance: Math.max(1, distance(pair)),
        initialTransform: transformRef.current,
        kind: "pinch",
      };
      setDragging(true);
    } else if (remaining.length === 1) {
      const nextPoint = remaining[0];
      gestureRef.current =
        transformRef.current.scale > 1
          ? {
              kind: "pan",
              last: nextPoint,
              moved: false,
              start: nextPoint,
            }
          : nextPoint.pointerType === "touch"
            ? { kind: "swipe", last: nextPoint, start: nextPoint }
            : {
                kind: "mouse",
                last: nextPoint,
                moved: false,
                start: nextPoint,
              };
    } else if (remaining.length === 0) {
      gestureRef.current = null;
      setDragging(false);
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      event.target instanceof Element &&
      event.target.closest("button, a, input, select, textarea")
    ) {
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const point = relativePoint(event.clientX, event.clientY);
    pointersRef.current.set(event.pointerId, {
      ...point,
      pointerType: event.pointerType,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();

    const pointers = pointerValues();
    if (event.pointerType === "touch" && pointers.length >= 2) {
      const pair = pointers.slice(0, 2);
      gestureRef.current = {
        initialCenter: center(pair),
        initialDistance: Math.max(1, distance(pair)),
        initialTransform: transformRef.current,
        kind: "pinch",
      };
      setDragging(true);
      return;
    }
    if (event.pointerType === "touch" && transformRef.current.scale === 1) {
      gestureRef.current = { kind: "swipe", last: point, start: point };
      return;
    }
    gestureRef.current = {
      kind: event.pointerType === "mouse" ? "mouse" : "pan",
      last: point,
      moved: false,
      start: point,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    const point = relativePoint(event.clientX, event.clientY);
    const previous = pointersRef.current.get(event.pointerId);
    pointersRef.current.set(event.pointerId, {
      ...point,
      pointerType: event.pointerType,
    });
    event.preventDefault();
    const pointers = pointerValues();
    const gesture = gestureRef.current;

    if (gesture?.kind === "pinch" && pointers.length >= 2) {
      const pair = pointers.slice(0, 2);
      applyTransform(
        pinchTransform(
          gesture.initialTransform,
          gesture.initialCenter,
          center(pair),
          distance(pair) / gesture.initialDistance,
          getBounds(),
        ),
      );
      return;
    }
    if (gesture?.kind === "swipe") {
      gesture.last = point;
      if (Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 4) {
        setDragging(true);
      }
      return;
    }
    if ((gesture?.kind === "mouse" || gesture?.kind === "pan") && previous) {
      const delta = { x: point.x - previous.x, y: point.y - previous.y };
      if (Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 3) {
        gesture.moved = true;
        setDragging(true);
      }
      if (transformRef.current.scale > 1) {
        applyTransform(panBy(transformRef.current, delta, getBounds()));
      }
      gesture.last = point;
    }
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    const point = relativePoint(event.clientX, event.clientY);
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (gesture?.kind === "swipe" && pointersRef.current.size === 0) {
      const deltaX = point.x - gesture.start.x;
      const deltaY = point.y - gesture.start.y;
      if (
        Math.abs(deltaX) >= MIN_SWIPE_PX &&
        Math.abs(deltaX) > Math.abs(deltaY) * 1.15
      ) {
        if (deltaX < 0) showNext();
        else showPrevious();
      }
    } else if (
      gesture?.kind === "mouse" &&
      !gesture.moved &&
      pointersRef.current.size === 0
    ) {
      zoomTo(transformRef.current.scale > 1 ? 1 : 2, point);
    }

    rebaseRemainingGesture();
  };

  const cancelPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    rebaseRemainingGesture();
  };

  const onImageLoad = (
    index: number,
    event: SyntheticEvent<HTMLImageElement>,
  ) => {
    const next = {
      height: Math.max(1, event.currentTarget.naturalHeight),
      width: Math.max(1, event.currentTarget.naturalWidth),
    };
    naturalSizesRef.current = { ...naturalSizesRef.current, [index]: next };
    setNaturalSizes(naturalSizesRef.current);
    if (index === activeIndex) {
      applyTransform(
        clampTransform(transformRef.current, getBounds(index)),
      );
    }
  };

  const activeNatural = naturalSizes[visibleIndex] ?? viewportSize;
  const activeContent = useMemo(
    () =>
      fitContain(
        viewportSize.width,
        viewportSize.height,
        activeNatural.width,
        activeNatural.height,
      ),
    [activeNatural.height, activeNatural.width, viewportSize],
  );
  const nativeScale = Math.min(
    activeNatural.width / Math.max(1, activeContent.width),
    activeNatural.height / Math.max(1, activeContent.height),
  );
  const sourceLimited =
    nativeScale < 0.95 || transform.scale > Math.max(1, nativeScale + 0.05);

  if (!rendered || images.length === 0 || typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-describedby="gallery-gesture-help"
      aria-labelledby="gallery-lightbox-title"
      aria-modal="true"
      className={`theme-invariant-dark premium-dialog-overlay fixed inset-0 z-[140] flex flex-col overflow-hidden bg-zinc-950 text-white ${surface === "desktop" ? "min-w-[1280px]" : ""}`}
      data-premium-modal-layer="nested"
      data-state={visible ? "open" : "closed"}
      ref={dialogRef}
      role="dialog"
    >
      <header className={`flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-zinc-950/90 backdrop-blur-md ${surface === "desktop" ? "h-18 px-6" : "min-h-16 pb-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[max(0.75rem,env(safe-area-inset-top))]"}`}>
        <div className="min-w-0">
          <p className="truncate text-xs font-bold tracking-tight" id="gallery-lightbox-title">{title}</p>
          <p className="mt-1 font-mono text-[10px] text-zinc-400">사진 {visibleIndex + 1} / {images.length} · {Math.round(transform.scale * 100)}%</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-2xl border border-white/10 bg-white/5 p-1.5 shadow-xl shadow-black/20">
          <button aria-label="사진 축소" className="grid size-11 place-items-center rounded-xl transition-all duration-300 hover:-translate-y-0.5 hover:bg-white hover:text-zinc-950 active:scale-95 disabled:opacity-35" disabled={transform.scale <= 1} onClick={() => zoomTo(transform.scale / 1.35)} type="button"><Minus size={18} /></button>
          <button aria-label="확대와 위치 초기화" className="grid size-11 place-items-center rounded-xl transition-all duration-300 hover:-translate-y-0.5 hover:bg-white hover:text-zinc-950 active:scale-95 disabled:opacity-35" disabled={transform.scale === 1 && transform.x === 0 && transform.y === 0} onClick={resetTransform} type="button"><RotateCcw size={17} /></button>
          <button aria-label="사진 확대" className="grid size-11 place-items-center rounded-xl transition-all duration-300 hover:-translate-y-0.5 hover:bg-white hover:text-zinc-950 active:scale-95" onClick={() => zoomTo(transform.scale * 1.35)} type="button"><Plus size={18} /></button>
          <span aria-hidden="true" className="mx-1 h-7 w-px bg-white/15" />
          <button aria-label="사진 확대 보기 닫기" className="grid size-11 place-items-center rounded-xl transition-all duration-300 hover:-translate-y-0.5 hover:bg-white hover:text-zinc-950 active:scale-95" onClick={onClose} ref={closeButtonRef} type="button"><X size={19} /></button>
        </div>
      </header>

      <div
        className={`${transform.scale > 1 ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"} relative min-h-0 flex-1 touch-none overflow-hidden bg-[radial-gradient(circle_at_center,_#303030_0%,_#090909_72%)]`}
        data-dragging={dragging ? "true" : "false"}
        data-gallery-index={visibleIndex}
        data-pan-x={transform.x.toFixed(2)}
        data-pan-y={transform.y.toFixed(2)}
        data-zoom-scale={transform.scale.toFixed(3)}
        onPointerCancel={cancelPointer}
        onPointerDown={onPointerDown}
        onLostPointerCapture={cancelPointer}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        ref={setViewportNode}
        role="group"
      >
        <div className="flex h-full">
          {images.map((image, index) => {
            const active = index === visibleIndex;
            const natural = naturalSizes[index] ?? viewportSize;
            const content = fitContain(
              viewportSize.width,
              viewportSize.height,
              natural.width,
              natural.height,
            );
            const imageTransform = active ? transform : IDENTITY_TRANSFORM;
            return (
              <div aria-hidden={!active} className="relative min-w-0 flex-[0_0_100%] overflow-hidden" key={`${image}-${index}`}>
                <div
                  className={`absolute left-1/2 top-1/2 ${active ? "will-change-transform" : ""} ${(dragging || wheelZooming) && active ? "" : "transition-transform duration-200 ease-out"}`}
                  style={{
                    height: `${content.height}px`,
                    transform: `translate3d(calc(-50% + ${imageTransform.x}px), calc(-50% + ${imageTransform.y}px), 0) scale(${imageTransform.scale})`,
                    transformOrigin: "center",
                    width: `${content.width}px`,
                  }}
                >
                  <CatalogImage alt={`${title} 사진 ${index + 1}`} className="h-full w-full select-none object-contain" decoding="async" draggable={false} fetchPriority={active ? "high" : "auto"} loading={active ? "eager" : "lazy"} maxDimension={3200} onDragStart={(event) => event.preventDefault()} onLoad={(event) => onImageLoad(index, event)} sizes={surface === "desktop" ? "1180px" : "100vw"} src={image} unoptimized />
                </div>
              </div>
            );
          })}
        </div>

        {images.length > 1 && <>
          <button aria-label="이전 사진" className={`absolute left-5 top-1/2 size-12 -translate-y-1/2 place-items-center rounded-2xl border border-white/15 bg-black/50 shadow-xl backdrop-blur-md transition-all duration-300 hover:-translate-y-[calc(50%+4px)] hover:bg-white hover:text-zinc-950 active:scale-95 ${surface === "desktop" ? "grid" : "hidden"}`} onClick={showPrevious} type="button"><ChevronLeft size={24} /></button>
          <button aria-label="다음 사진" className={`absolute right-5 top-1/2 size-12 -translate-y-1/2 place-items-center rounded-2xl border border-white/15 bg-black/50 shadow-xl backdrop-blur-md transition-all duration-300 hover:-translate-y-[calc(50%+4px)] hover:bg-white hover:text-zinc-950 active:scale-95 ${surface === "desktop" ? "grid" : "hidden"}`} onClick={showNext} type="button"><ChevronRight size={24} /></button>
        </>}

        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-2xl border border-white/10 bg-black/55 px-4 py-2 text-center text-[10px] leading-4 text-zinc-300 shadow-xl backdrop-blur-md" id="gallery-gesture-help">
          <span>{surface === "desktop" ? "휠로 확대 · 확대 후 드래그 · + / − / 0 키" : "한 손가락 넘기기 · 두 손가락 확대 · 확대 후 드래그"}</span>
          {sourceLimited && <span className="ml-2 font-bold text-amber-300">원본 해상도 한계</span>}
        </div>
        <p aria-live="polite" className="sr-only">{announcement}</p>
      </div>

      {images.length > 1 && <>
        {surface === "mobile" && <div aria-label="상품 사진 위치" className="flex min-h-12 shrink-0 items-center justify-start overflow-x-auto border-t border-white/10 bg-zinc-950 pb-[env(safe-area-inset-bottom)] pl-[max(0.25rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))]">{images.map((_, index) => <button aria-current={visibleIndex === index ? "true" : undefined} aria-label={`${index + 1}번째 사진 보기`} className="grid size-11 shrink-0 place-items-center rounded-full active:scale-95" key={index} onClick={() => emblaApi?.scrollTo(index)} type="button"><span aria-hidden="true" className={`size-2 rounded-full transition-transform ${visibleIndex === index ? "scale-125 bg-white" : "bg-white/30"}`} /></button>)}</div>}
        {surface === "desktop" && <nav aria-label="상품 사진 선택" className="flex h-24 shrink-0 items-center justify-center gap-2 overflow-x-auto border-t border-white/10 bg-zinc-900/95 px-6">
          {images.map((image, index) => <button aria-current={visibleIndex === index ? "true" : undefined} aria-label={`${index + 1}번째 사진 보기`} className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95 ${visibleIndex === index ? "border-white shadow-lg" : "border-transparent opacity-50 hover:opacity-100"}`} key={`${image}-thumb-${index}`} onClick={() => emblaApi?.scrollTo(index)} type="button"><CatalogImage alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" maxDimension={128} sizes="64px" src={image} /></button>)}
        </nav>}
      </>}
    </div>,
    document.body,
  );
}
