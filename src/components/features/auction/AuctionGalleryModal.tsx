"use client";

import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CatalogImage } from "@/components/ui/CatalogImage";

interface AuctionGalleryModalProps {
  images: readonly string[];
  initialIndex?: number;
  onClose: () => void;
  open: boolean;
  title: string;
}

function clampIndex(index: number, length: number) {
  if (length === 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

export function AuctionGalleryModal({
  images,
  initialIndex = 0,
  onClose,
  open,
  title,
}: AuctionGalleryModalProps) {
  const startIndex = clampIndex(initialIndex, images.length);
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "center",
    dragFree: false,
    loop: true,
    skipSnaps: false,
    startIndex,
  });
  const [activeIndex, setActiveIndex] = useState(startIndex);
  const [zoomed, setZoomed] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const showPrevious = useCallback(() => {
    setZoomed(false);
    emblaApi?.scrollPrev();
  }, [emblaApi]);
  const showNext = useCallback(() => {
    setZoomed(false);
    emblaApi?.scrollNext();
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    const select = () => {
      setActiveIndex(emblaApi.selectedScrollSnap());
      setZoomed(false);
    };
    select();
    emblaApi.on("select", select);
    emblaApi.on("reInit", select);
    return () => {
      emblaApi.off("select", select);
      emblaApi.off("reInit", select);
    };
  }, [emblaApi]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      else if (event.key === "ArrowLeft") showPrevious();
      else if (event.key === "ArrowRight") showNext();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      window.cancelAnimationFrame(focusFrame);
      returnFocusRef.current?.focus();
    };
  }, [open, showNext, showPrevious]);

  if (!open || images.length === 0) return null;
  const visibleIndex = clampIndex(activeIndex, images.length);

  return (
    <div aria-label={`${title} 사진 확대 보기`} aria-modal="true" className="fixed inset-0 z-[120] flex flex-col bg-zinc-950 text-white" role="dialog">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-6 border-b border-white/15 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:h-16 md:px-6 md:py-0">
        <div className="min-w-0">
          <p className="truncate text-xs font-bold">{title}</p>
          <p className="mt-1 font-mono text-[10px] text-zinc-400">{visibleIndex + 1} / {images.length}</p>
        </div>
        <button aria-label="사진 확대 보기 닫기" className="grid size-10 place-items-center border border-white/20 hover:bg-white hover:text-zinc-950" onClick={onClose} ref={closeButtonRef} type="button"><X size={19} /></button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_center,_#303030_0%,_#090909_72%)]" ref={emblaRef}>
        <div className="flex h-full touch-pan-y">
          {images.map((image, index) => (
            <div className="relative min-w-0 flex-[0_0_100%]" key={`${image}-${index}`}>
              <button aria-label={zoomed && index === visibleIndex ? "사진 원래 크기로 축소" : "사진 확대"} aria-pressed={zoomed && index === visibleIndex} className={`absolute inset-0 h-full w-full overflow-hidden ${zoomed && index === visibleIndex ? "cursor-zoom-out" : "cursor-zoom-in"}`} onClick={() => index === visibleIndex && setZoomed((value) => !value)} type="button">
                <CatalogImage alt={`${title} 사진 ${index + 1}`} className={`h-full w-full object-contain p-3 transition-transform duration-300 md:p-8 ${zoomed && index === visibleIndex ? "scale-[2.25]" : "scale-100"}`} decoding="async" fetchPriority={index === visibleIndex ? "high" : "auto"} loading={Math.abs(index - startIndex) <= 1 ? "eager" : "lazy"} maxDimension={1600} sizes="100vw" src={image} />
              </button>
            </div>
          ))}
        </div>
        {images.length > 1 && <>
          <button aria-label="이전 사진" className="absolute left-6 top-1/2 hidden size-12 -translate-y-1/2 place-items-center border border-white/20 bg-black/50 hover:bg-white hover:text-zinc-950 md:grid" onClick={showPrevious} type="button"><ChevronLeft size={24} /></button>
          <button aria-label="다음 사진" className="absolute right-6 top-1/2 hidden size-12 -translate-y-1/2 place-items-center border border-white/20 bg-black/50 hover:bg-white hover:text-zinc-950 md:grid" onClick={showNext} type="button"><ChevronRight size={24} /></button>
        </>}
      </div>

      {images.length > 1 && <>
        <div aria-label="상품 사진 위치" className="flex min-h-12 shrink-0 items-center justify-center gap-2 border-t border-white/15 pb-[env(safe-area-inset-bottom)] md:hidden">{images.map((_, index) => <button aria-label={`${index + 1}번째 사진 보기`} className={`size-2 rounded-full ${visibleIndex === index ? "bg-white" : "bg-white/30"}`} key={index} onClick={() => emblaApi?.scrollTo(index)} type="button" />)}</div>
        <nav aria-label="상품 사진 선택" className="hidden h-24 shrink-0 items-center justify-center gap-2 overflow-x-auto border-t border-white/15 bg-zinc-900 px-6 md:flex">
          {images.map((image, index) => <button aria-current={visibleIndex === index ? "true" : undefined} aria-label={`${index + 1}번째 사진 보기`} className={`relative h-16 w-16 shrink-0 overflow-hidden border-2 ${visibleIndex === index ? "border-white" : "border-transparent opacity-50 hover:opacity-100"}`} key={`${image}-thumb-${index}`} onClick={() => emblaApi?.scrollTo(index)} type="button"><CatalogImage alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" maxDimension={128} sizes="64px" src={image} /></button>)}
        </nav>
      </>}
    </div>
  );
}
