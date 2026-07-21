"use client";

import { useState } from "react";
import type { ItemDetail } from "@/types/detail";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { AuctionGalleryModal } from "@/components/features/auction/AuctionGalleryModal";
import { formatProductDisplayNumber } from "@/lib/productDisplayNumber";

interface ItemGalleryProps {
  compact?: boolean;
  item: ItemDetail;
}

const FULL_PAGE_IMAGE_SIZES =
  "(max-width: 767px) calc(100vw - 2rem), (max-width: 1023px) calc(100vw - 5rem), (max-width: 1279px) calc(58.333vw - 4.166rem), (max-width: 1679px) calc(58.333vw - 4.75rem), 56.5rem";
const COMPACT_IMAGE_SIZES =
  "(max-width: 767px) calc(100vw - 2rem), (max-width: 815px) calc(100vw - 6rem), 45rem";
const FULL_PAGE_THUMBNAIL_SIZES =
  "(max-width: 767px) calc(25vw - 0.875rem), (max-width: 1023px) calc(25vw - 1.625rem), (max-width: 1279px) calc(14.583vw - 1.416rem), (max-width: 1679px) calc(14.583vw - 1.5625rem), 13.75rem";
const COMPACT_THUMBNAIL_SIZES =
  "(max-width: 767px) calc(25vw - 0.875rem), (max-width: 815px) calc(25vw - 1.875rem), 10.875rem";

export function ItemGallery({ compact = false, item }: ItemGalleryProps) {
  const [activeImage, setActiveImage] = useState(0);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const images = item.images.filter(Boolean);
  const imageSizes = compact ? COMPACT_IMAGE_SIZES : FULL_PAGE_IMAGE_SIZES;
  const thumbnailSizes = compact
    ? COMPACT_THUMBNAIL_SIZES
    : FULL_PAGE_THUMBNAIL_SIZES;

  return (
    <section>
      <button aria-label={`${item.name} 사진 크게 보기`} className="group relative block aspect-[4/5] w-full overflow-hidden bg-zinc-100 text-left" disabled={images.length === 0} onClick={() => setGalleryOpen(true)} type="button">
        <CatalogImage alt={`${item.name} 대표 이미지`} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" decoding="async" fetchPriority="high" loading="eager" maxDimension={1280} sizes={imageSizes} src={images[activeImage] ?? ""} />
        <span className="absolute left-3 top-3 bg-white px-3 py-2 text-xs font-bold text-zinc-950 md:left-5 md:top-5">{formatProductDisplayNumber(item.id)}</span>
        <span className="absolute right-3 top-3 bg-zinc-950 px-3 py-2 text-xs font-bold text-white md:right-5 md:top-5">상태 {item.conditionGrade}</span>
        {images.length > 0 && <span className="absolute bottom-5 right-5 border border-white/40 bg-zinc-950/80 px-3 py-2 text-[10px] font-bold tracking-[0.08em] text-white">사진 확대 · {activeImage + 1}/{images.length}</span>}
      </button>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {images.map((image, index) => (
          <button
            aria-label={`${item.name} 이미지 ${index + 1} 보기`}
            className={`relative aspect-square overflow-hidden bg-zinc-100 ${activeImage === index ? "ring-2 ring-zinc-950 ring-offset-2" : "opacity-60 transition-opacity hover:opacity-100"}`}
            key={image}
            onClick={() => setActiveImage(index)}
            type="button"
          >
            <CatalogImage alt={`${item.name} 이미지 ${index + 1}`} className="absolute inset-0 h-full w-full object-cover" loading="lazy" maxDimension={480} sizes={thumbnailSizes} src={image} />
          </button>
        ))}
      </div>
      <AuctionGalleryModal images={images} initialIndex={activeImage} key={`${galleryOpen}-${activeImage}`} onClose={() => setGalleryOpen(false)} open={galleryOpen} title={item.name} />
    </section>
  );
}
