"use client";

/* eslint-disable @next/next/no-img-element -- 운영자가 입력하는 임의의 외부 목 URL을 미리 Next Image 도메인으로 제한할 수 없음 */
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Modal from "@/src/components/common/Modal";

export interface PhotoGalleryModalProps {
  open: boolean;
  images: readonly string[];
  thumbnailImages?: readonly string[];
  title: string;
  lotLabel?: string;
  initialIndex?: number;
  onClose: () => void;
}

const zoomStageStyle = {
  "--zoom-origin-x": "50%",
  "--zoom-origin-y": "50%",
  touchAction: "none",
} as CSSProperties;

function clampIndex(index: number, length: number) {
  if (length === 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

interface ZoomableGalleryImageProps {
  images: readonly string[];
  title: string;
  activeIndex: number;
  gestureConsumedRef: { current: boolean };
}

function getTouchDistance(
  touches: ReactTouchEvent<HTMLButtonElement>["touches"],
) {
  const first = touches.item(0);
  const second = touches.item(1);
  if (!first || !second) return 0;
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

function ZoomableGalleryImage({
  images,
  title,
  activeIndex,
  gestureConsumedRef,
}: ZoomableGalleryImageProps) {
  const zoomStageRef = useRef<HTMLButtonElement>(null);
  const zoomFrameRef = useRef<number | null>(null);
  const pinchStartRef = useRef<{ distance: number; scale: number } | null>(null);
  const suppressClickRef = useRef(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [touchScale, setTouchScale] = useState<number | null>(null);

  useEffect(
    () => () => {
      if (zoomFrameRef.current !== null) {
        window.cancelAnimationFrame(zoomFrameRef.current);
      }
    },
    [],
  );

  const updateZoomOrigin = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isZoomed || event.pointerType === "touch") return;

    const stage = event.currentTarget;
    const bounds = stage.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;

    const x = Math.min(
      Math.max(((event.clientX - bounds.left) / bounds.width) * 100, 8),
      92,
    );
    const y = Math.min(
      Math.max(((event.clientY - bounds.top) / bounds.height) * 100, 8),
      92,
    );

    if (zoomFrameRef.current !== null) {
      window.cancelAnimationFrame(zoomFrameRef.current);
    }
    zoomFrameRef.current = window.requestAnimationFrame(() => {
      stage.style.setProperty("--zoom-origin-x", `${x}%`);
      stage.style.setProperty("--zoom-origin-y", `${y}%`);
      zoomFrameRef.current = null;
    });
  };

  const toggleZoom = () => {
    if (suppressClickRef.current) return;
    if (isZoomed) {
      zoomStageRef.current?.style.setProperty("--zoom-origin-x", "50%");
      zoomStageRef.current?.style.setProperty("--zoom-origin-y", "50%");
      setTouchScale(null);
    }
    setIsZoomed((current) => !current);
  };

  const beginPinchZoom = (event: ReactTouchEvent<HTMLButtonElement>) => {
    if (event.touches.length < 2) return;
    event.preventDefault();
    event.stopPropagation();
    gestureConsumedRef.current = true;
    suppressClickRef.current = true;

    const distance = getTouchDistance(event.touches);
    if (distance <= 0) return;
    pinchStartRef.current = {
      distance,
      scale: touchScale ?? (isZoomed ? 2.5 : 1),
    };
  };

  const updatePinchZoom = (event: ReactTouchEvent<HTMLButtonElement>) => {
    const pinchStart = pinchStartRef.current;
    if (!pinchStart || event.touches.length < 2) return;
    event.preventDefault();
    event.stopPropagation();
    gestureConsumedRef.current = true;

    const distance = getTouchDistance(event.touches);
    if (distance <= 0) return;
    const nextScale = Math.min(Math.max(pinchStart.scale * (distance / pinchStart.distance), 1), 3);
    const first = event.touches.item(0);
    const second = event.touches.item(1);
    const stage = event.currentTarget;
    if (first && second) {
      const bounds = stage.getBoundingClientRect();
      const midpointX = (first.clientX + second.clientX) / 2;
      const midpointY = (first.clientY + second.clientY) / 2;
      const originX = Math.min(Math.max(((midpointX - bounds.left) / bounds.width) * 100, 5), 95);
      const originY = Math.min(Math.max(((midpointY - bounds.top) / bounds.height) * 100, 5), 95);
      stage.style.setProperty("--zoom-origin-x", `${originX}%`);
      stage.style.setProperty("--zoom-origin-y", `${originY}%`);
    }
    setTouchScale(nextScale);
    setIsZoomed(nextScale > 1.02);
  };

  const finishPinchZoom = (event: ReactTouchEvent<HTMLButtonElement>) => {
    if (!pinchStartRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    gestureConsumedRef.current = true;

    if (event.touches.length >= 2) {
      const distance = getTouchDistance(event.touches);
      if (distance > 0) {
        pinchStartRef.current = { distance, scale: touchScale ?? 1 };
      }
      return;
    }

    pinchStartRef.current = null;
    if ((touchScale ?? 1) <= 1.02) {
      setTouchScale(null);
      setIsZoomed(false);
      zoomStageRef.current?.style.setProperty("--zoom-origin-x", "50%");
      zoomStageRef.current?.style.setProperty("--zoom-origin-y", "50%");
    }
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 250);
  };

  return (
    <button
      ref={zoomStageRef}
      type="button"
      aria-label={
        isZoomed
          ? `${title} 사진 원래 크기로 축소`
          : `${title} 사진 2.5배 확대`
      }
      aria-pressed={isZoomed}
      onClick={toggleZoom}
      onPointerMove={updateZoomOrigin}
      onTouchStart={beginPinchZoom}
      onTouchMove={updatePinchZoom}
      onTouchEnd={finishPinchZoom}
      onTouchCancel={finishPinchZoom}
      style={zoomStageStyle}
      className={`group/zoom relative flex h-full w-full touch-none items-center justify-center overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80 ${
        isZoomed ? "cursor-zoom-out" : "cursor-zoom-in"
      }`}
    >
      <img
        src={images[activeIndex]}
        alt={`${title} 사진 ${activeIndex + 1}`}
        className={`max-h-full max-w-full select-none object-contain shadow-[0_18px_52px_rgba(0,0,0,0.4)] transition-transform duration-300 ease-out motion-reduce:transition-none ${
          isZoomed ? "scale-[2.5] will-change-transform" : "scale-100"
        }`}
        style={{
          transformOrigin: "var(--zoom-origin-x) var(--zoom-origin-y)",
          transform: touchScale === null ? undefined : `scale(${touchScale})`,
        }}
        decoding="async"
        draggable={false}
      />
      <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/10 bg-black/45 px-3 py-1.5 font-mono text-[9px] font-black tabular-nums tracking-[0.12em] text-white/70 opacity-0 backdrop-blur-md transition-opacity duration-200 group-hover/zoom:opacity-100 sm:text-[10px]">
        <span className="sm:hidden">
          {isZoomed ? "두 손가락으로 확대 · 축소" : "핀치하거나 탭하여 확대 검수"}
        </span>
        <span className="hidden sm:inline">
          {isZoomed ? "2.5× · 마우스로 원단 탐색" : "클릭하여 2.5× 확대 검수"}
        </span>
      </span>
    </button>
  );
}

export default function PhotoGalleryModal({
  open,
  images,
  thumbnailImages,
  title,
  lotLabel,
  initialIndex = 0,
  onClose,
}: PhotoGalleryModalProps) {
  const [activeIndex, setActiveIndex] = useState(() =>
    clampIndex(initialIndex, images.length),
  );
  const touchStartX = useRef<number | null>(null);
  const gestureConsumedRef = useRef(false);

  const showPrevious = useCallback(() => {
    setActiveIndex((current) =>
      images.length ? (current - 1 + images.length) % images.length : 0,
    );
  }, [images.length]);

  const showNext = useCallback(() => {
    setActiveIndex((current) =>
      images.length ? (current + 1) % images.length : 0,
    );
  }, [images.length]);

  useEffect(() => {
    if (!open || images.length <= 1) return;

    const handleArrowKeys = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        showPrevious();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        showNext();
      }
    };

    document.addEventListener("keydown", handleArrowKeys);
    return () => document.removeEventListener("keydown", handleArrowKeys);
  }, [images.length, open, showNext, showPrevious]);

  if (images.length === 0) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      headerPrefix={lotLabel}
      description="모바일에서는 좌우로 밀고 두 손가락으로 확대하세요. 키보드 방향키와 화면 버튼도 지원합니다."
      closeShortcutLabel="ESC"
      headerVariant="editorial"
      size="gallery"
      tone="dark"
      className="h-dvh rounded-none border-0 sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)] sm:rounded-xl sm:border"
    >
      <div
        className="flex h-full min-h-0 flex-col bg-[#111315]"
        onTouchStart={(event) => {
          if (event.touches.length === 1) gestureConsumedRef.current = false;
          touchStartX.current = event.changedTouches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          if (gestureConsumedRef.current) {
            gestureConsumedRef.current = false;
            touchStartX.current = null;
            return;
          }
          if (touchStartX.current === null || images.length <= 1) return;
          const endX = event.changedTouches[0]?.clientX ?? touchStartX.current;
          const distance = endX - touchStartX.current;
          touchStartX.current = null;
          if (Math.abs(distance) < 45) return;
          if (distance > 0) showPrevious();
          else showNext();
        }}
      >
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,_#292d30_0%,_#111315_72%)] px-2 py-4 sm:px-16 sm:py-5">
          <ZoomableGalleryImage
            key={`${images[activeIndex]}-${activeIndex}`}
            images={images}
            title={title}
            activeIndex={activeIndex}
            gestureConsumedRef={gestureConsumedRef}
          />

          {images.length > 1 ? (
            <>
              <button
                type="button"
                onClick={showPrevious}
                aria-label="이전 사진"
                className="absolute left-3 top-1/2 z-20 hidden size-12 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/40 text-white shadow-[0_12px_36px_rgba(0,0,0,0.38)] backdrop-blur-md transition-all duration-200 ease-out hover:scale-110 hover:border-white/20 hover:bg-black/60 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:left-6 sm:grid sm:size-14 lg:size-16"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-6 sm:size-7">
                  <path d="m14.5 5-7 7 7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                onClick={showNext}
                aria-label="다음 사진"
                className="absolute right-3 top-1/2 z-20 hidden size-12 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/40 text-white shadow-[0_12px_36px_rgba(0,0,0,0.38)] backdrop-blur-md transition-all duration-200 ease-out hover:scale-110 hover:border-white/20 hover:bg-black/60 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-6 sm:grid sm:size-14 lg:size-16"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-6 sm:size-7">
                  <path d="m9.5 5 7 7-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </>
          ) : null}

          <span
            aria-hidden="true"
            className="absolute right-3 top-3 z-20 border border-white/15 bg-black/60 px-2.5 py-1.5 font-mono text-xs font-bold tabular-nums tracking-tight text-white backdrop-blur-md sm:right-5 sm:top-5"
          >
            {activeIndex + 1} / {images.length}
          </span>
          <p className="sr-only" aria-live="polite">
            {images.length}장 중 {activeIndex + 1}번째 사진
          </p>
        </div>

        {images.length > 1 ? (
          <div className="shrink-0 border-t border-white/10 bg-[#191c1e] px-4 pb-[max(.875rem,env(safe-area-inset-bottom))] pt-3.5">
            <div className="mx-auto flex max-w-3xl snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain scroll-smooth px-1 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {images.map((image, index) => (
                <button
                  key={`${image}-${index}`}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  aria-label={`${index + 1}번째 사진 보기`}
                  aria-current={index === activeIndex ? "true" : undefined}
                  className={`h-14 w-16 shrink-0 snap-center overflow-hidden rounded-md border-2 transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#191c1e] sm:h-16 sm:w-20 ${
                    index === activeIndex
                      ? "scale-105 border-white opacity-100 brightness-110 shadow-[0_8px_24px_rgba(0,0,0,0.32)]"
                      : "border-transparent opacity-50 hover:scale-[1.03] hover:opacity-80"
                  }`}
                >
                  <img
                    src={thumbnailImages?.[index] || image}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                  />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
