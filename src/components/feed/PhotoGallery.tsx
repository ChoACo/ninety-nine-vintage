"use client";

import { lazy, memo, Suspense, useMemo, useState } from "react";
import DeferredProductImage from "@/src/components/common/DeferredProductImage";
import { getCatalogThumbnailUrl } from "@/src/utils/catalogImages";

const PhotoGalleryModal = lazy(() => import("./PhotoGalleryModal"));

export interface PhotoGalleryProps {
  images: readonly string[];
  thumbnailImages?: readonly string[];
  title: string;
  lotLabel?: string;
  compact?: boolean;
}

function PhotoGallery({
  images,
  thumbnailImages,
  title,
  lotLabel,
  compact = false,
}: PhotoGalleryProps) {
  const galleryItems = useMemo(
    () =>
      images.flatMap((image, index) =>
        image
          ? [
              {
                image,
                thumbnail: getCatalogThumbnailUrl(
                  thumbnailImages?.[index],
                  image,
                ),
              },
            ]
          : [],
      ),
    [images, thumbnailImages],
  );
  const cleanImages = galleryItems.map((item) => item.image);
  const cleanThumbnails = galleryItems.map((item) => item.thumbnail);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const thumbnails = galleryItems.slice(1, 4);

  const openAt = (index: number) => {
    setSelectedIndex(index);
    setModalOpen(true);
  };

  if (cleanImages.length === 0) {
    return (
      <div className="grid aspect-[4/3] place-items-center bg-[var(--surface-muted)] text-center text-[var(--text-muted)]">
        <div>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="mx-auto h-9 w-9"><path d="m4 16 4.5-4.5 3 3 2-2L20 19M7.5 8.5h.01M4 4h16v16H4V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <p className="mt-2 text-xs font-bold tracking-[-0.01em]">등록된 사진이 없어요</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={compact ? "space-y-px bg-[var(--border)]" : "space-y-2.5"}>
        <button
          type="button"
          onClick={() => openAt(0)}
          aria-label={`${title} 메인 사진 크게 보기`}
          className={`group relative block aspect-[4/3] w-full overflow-hidden bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset ${
            compact ? "rounded-none" : "rounded-xl"
          }`}
        >
          <DeferredProductImage
            key={galleryItems[0].thumbnail}
            src={galleryItems[0].thumbnail}
            alt={`${title} 메인 사진`}
            sizes="(max-width: 639px) 50vw, (max-width: 1535px) 50vw, 33vw"
            wrapperClassName="h-full w-full"
            className="h-full w-full object-cover group-hover:scale-[1.035]"
          />
        </button>

        {!compact && thumbnails.length > 0 ? (
          <div
            className={`grid grid-cols-3 ${compact ? "gap-px max-sm:hidden" : "gap-2.5"}`}
          >
            {thumbnails.map((item, thumbnailIndex) => {
              const actualIndex = thumbnailIndex + 1;

              return (
                <button
                  key={`${item.image}-${actualIndex}`}
                  type="button"
                  onClick={() => openAt(actualIndex)}
                  aria-label={`${title} ${actualIndex + 1}번째 사진 크게 보기`}
                  className={`group relative overflow-hidden bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset ${
                    compact
                      ? "aspect-[2/1] rounded-none"
                      : "aspect-[5/3] rounded-lg"
                  }`}
                >
                  <DeferredProductImage
                    src={item.thumbnail}
                    alt=""
                    sizes="33vw"
                    wrapperClassName="h-full w-full"
                    className="h-full w-full object-cover group-hover:scale-[1.04]"
                  />
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {modalOpen ? (
        <Suspense fallback={null}>
          <PhotoGalleryModal
            open
            onClose={() => setModalOpen(false)}
            images={cleanImages}
            thumbnailImages={cleanThumbnails}
            title={title}
            lotLabel={lotLabel}
            initialIndex={selectedIndex}
          />
        </Suspense>
      ) : null}
    </>
  );
}

export default memo(PhotoGallery);
