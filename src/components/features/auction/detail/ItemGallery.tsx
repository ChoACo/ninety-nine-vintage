"use client";

import { useState } from "react";
import type { ItemDetail } from "@/types/detail";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { AuctionGalleryModal } from "@/components/features/auction/AuctionGalleryModal";
import { formatProductDisplayNumber } from "@/lib/productDisplayNumber";

interface ItemGalleryProps {
  compact?: boolean;
  item: ItemDetail;
  surface?: "desktop" | "mobile";
}

const MOBILE_FULL_PAGE_IMAGE_SIZES =
  "(max-width: 767px) calc(100vw - 2rem), (max-width: 1023px) calc(100vw - 5rem), (max-width: 1279px) calc(58.333vw - 4.166rem), (max-width: 1679px) calc(58.333vw - 4.75rem), 56.5rem";
const MOBILE_COMPACT_IMAGE_SIZES =
  "(max-width: 767px) calc(100vw - 2rem), (max-width: 1279px) 56vw, 44rem";
const MOBILE_FULL_PAGE_THUMBNAIL_SIZES =
  "(max-width: 767px) calc(25vw - 0.875rem), (max-width: 1023px) calc(25vw - 1.625rem), (max-width: 1279px) calc(14.583vw - 1.416rem), (max-width: 1679px) calc(14.583vw - 1.5625rem), 13.75rem";
const MOBILE_COMPACT_THUMBNAIL_SIZES =
  "(max-width: 767px) calc(25vw - 0.875rem), (max-width: 815px) calc(25vw - 1.875rem), 10.875rem";

export function ItemGallery({ compact = false, item, surface = "desktop" }: ItemGalleryProps) {
  const [activeImage, setActiveImage] = useState(0);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const images = item.images.filter(Boolean);
  const imageSizes = surface === "desktop"
    ? compact ? "650px" : "680px"
    : compact ? MOBILE_COMPACT_IMAGE_SIZES : MOBILE_FULL_PAGE_IMAGE_SIZES;
  const thumbnailSizes = surface === "desktop"
    ? compact ? "156px" : "164px"
    : compact ? MOBILE_COMPACT_THUMBNAIL_SIZES : MOBILE_FULL_PAGE_THUMBNAIL_SIZES;

  return (
    <section className="min-w-0">
      <button aria-label={`${item.name} 사진 크게 보기`} className="group relative block aspect-[4/5] w-full overflow-hidden rounded-3xl border border-white/10 bg-zinc-100 text-left shadow-xl shadow-black/10 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl active:scale-[0.99]" disabled={images.length === 0} onClick={() => setGalleryOpen(true)} type="button">
        <CatalogImage alt={`${item.name} 대표 이미지`} className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.035]" decoding="async" fetchPriority="high" loading="eager" maxDimension={1280} sizes={imageSizes} src={images[activeImage] ?? ""} />
        <span className={`absolute rounded-xl border border-white/60 bg-white/90 px-3 py-2 text-xs font-bold text-zinc-950 shadow-lg backdrop-blur-md ${surface === "desktop" ? "left-5 top-5" : "left-3 top-3"}`}>{formatProductDisplayNumber(item.id)}</span>
        <span className={`absolute rounded-xl border border-white/10 bg-zinc-950/90 px-3 py-2 text-xs font-bold text-white shadow-lg backdrop-blur-md ${surface === "desktop" ? "right-5 top-5" : "right-3 top-3"}`}>상태 {item.conditionGrade || "미입력"}</span>
        {images.length > 0 && <span className="absolute bottom-5 right-5 rounded-xl border border-white/20 bg-zinc-950/75 px-3 py-2 text-[10px] font-bold tracking-[0.08em] text-white shadow-lg backdrop-blur-md">사진 확대 · {activeImage + 1}/{images.length}</span>}
      </button>
      <div className="detail-thumbnail-grid mt-4 grid grid-cols-4 gap-2">
        {images.map((image, index) => (
          <button
            aria-label={`${item.name} 이미지 ${index + 1} 보기`}
            className={`relative aspect-square overflow-hidden rounded-2xl bg-zinc-100 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95 ${activeImage === index ? "ring-2 ring-zinc-950 ring-offset-2 ring-offset-paper" : "opacity-60 hover:opacity-100"}`}
            key={image}
            onClick={() => setActiveImage(index)}
            type="button"
          >
            <CatalogImage alt={`${item.name} 이미지 ${index + 1}`} className="absolute inset-0 h-full w-full object-cover" loading="lazy" maxDimension={480} sizes={thumbnailSizes} src={image} />
          </button>
        ))}
      </div>
      <AuctionGalleryModal images={images} initialIndex={activeImage} key={activeImage} onClose={() => setGalleryOpen(false)} open={galleryOpen} surface={surface} title={item.name} />
    </section>
  );
}
