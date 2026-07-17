"use client";

/* eslint-disable @next/next/no-img-element -- 운영자가 입력하는 임의의 외부 목 URL을 미리 Next Image 도메인으로 제한할 수 없음 */
import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "@/src/components/common/Modal";

export interface PhotoGalleryModalProps {
  open: boolean;
  images: string[];
  title: string;
  initialIndex?: number;
  onClose: () => void;
}

function clampIndex(index: number, length: number) {
  if (length === 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

export default function PhotoGalleryModal({
  open,
  images,
  title,
  initialIndex = 0,
  onClose,
}: PhotoGalleryModalProps) {
  const [activeIndex, setActiveIndex] = useState(() =>
    clampIndex(initialIndex, images.length),
  );
  const touchStartX = useRef<number | null>(null);

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
      title={`사진 전체보기 · ${title}`}
      description="좌우 화살표 키나 화면의 버튼으로 사진을 넘겨보세요."
      size="gallery"
      tone="dark"
      className="h-[calc(100dvh-1rem)] rounded-[2rem] sm:h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-2rem)]"
    >
      <div
        className="flex h-full min-h-0 flex-col bg-[#282e33]"
        onTouchStart={(event) => {
          touchStartX.current = event.changedTouches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          if (touchStartX.current === null || images.length <= 1) return;
          const endX = event.changedTouches[0]?.clientX ?? touchStartX.current;
          const distance = endX - touchStartX.current;
          touchStartX.current = null;
          if (Math.abs(distance) < 45) return;
          if (distance > 0) showPrevious();
          else showNext();
        }}
      >
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,_#41484e_0%,_#282e33_72%)] px-2 py-4 sm:px-16 sm:py-5">
          <img
            key={images[activeIndex]}
            src={images[activeIndex]}
            alt={`${title} 사진 ${activeIndex + 1}`}
            className="max-h-full max-w-full select-none rounded-xl object-contain shadow-[0_18px_52px_rgba(0,0,0,0.34)]"
            draggable={false}
          />

          {images.length > 1 ? (
            <>
              <button
                type="button"
                onClick={showPrevious}
                aria-label="이전 사진"
                className="absolute left-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/25 bg-[#1b2024]/70 text-2xl text-white shadow-lg backdrop-blur transition hover:bg-[#15191c]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffad99] sm:left-5 sm:h-12 sm:w-12"
              >
                <span aria-hidden="true">‹</span>
              </button>
              <button
                type="button"
                onClick={showNext}
                aria-label="다음 사진"
                className="absolute right-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/25 bg-[#1b2024]/70 text-2xl text-white shadow-lg backdrop-blur transition hover:bg-[#15191c]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffad99] sm:right-5 sm:h-12 sm:w-12"
              >
                <span aria-hidden="true">›</span>
              </button>
            </>
          ) : null}

          <span
            aria-hidden="true"
            className="absolute right-3 top-3 rounded-full border border-white/15 bg-[#1b2024]/70 px-3 py-1.5 text-sm font-bold tabular-nums text-white backdrop-blur sm:right-5 sm:top-5"
          >
            {activeIndex + 1} / {images.length}
          </span>
          <p className="sr-only" aria-live="polite">
            {images.length}장 중 {activeIndex + 1}번째 사진
          </p>
        </div>

        {images.length > 1 ? (
          <div className="shrink-0 border-t border-white/10 bg-[#353c42] px-4 py-3">
            <div className="mx-auto flex max-w-3xl gap-2 overflow-x-auto pb-1">
              {images.map((image, index) => (
                <button
                  key={`${image}-${index}`}
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  aria-label={`${index + 1}번째 사진 보기`}
                  aria-current={index === activeIndex ? "true" : undefined}
                  className={`h-14 w-16 shrink-0 overflow-hidden rounded-xl border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffad99] sm:h-16 sm:w-20 ${
                    index === activeIndex
                      ? "border-[#ff9a82] opacity-100"
                      : "border-transparent opacity-55 hover:opacity-90"
                  }`}
                >
                  <img
                    src={image}
                    alt=""
                    className="h-full w-full object-cover"
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
