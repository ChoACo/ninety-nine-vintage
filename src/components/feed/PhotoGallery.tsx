"use client";

/* eslint-disable @next/next/no-img-element -- 운영자가 입력하는 임의의 외부 목 URL을 미리 Next Image 도메인으로 제한할 수 없음 */
import { useState } from "react";
import PhotoGalleryModal from "./PhotoGalleryModal";

export interface PhotoGalleryProps {
  images: readonly string[];
  thumbnailImages?: readonly string[];
  title: string;
  compact?: boolean;
}

interface GalleryImageProps {
  src: string;
  alt: string;
  className: string;
}

function GalleryImage({ src, alt, className }: GalleryImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        role="img"
        aria-label={`${alt} 이미지를 불러오지 못함`}
        className={`${className} grid place-items-center bg-[var(--surface-muted)] text-[var(--text-muted)]`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-8 w-8"><path d="m4 16 4.5-4.5 3 3 2-2L20 19M7.5 8.5h.01M4 4h16v16H4V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export default function PhotoGallery({
  images,
  thumbnailImages,
  title,
  compact = false,
}: PhotoGalleryProps) {
  const galleryItems = images.flatMap((image, index) =>
    image
      ? [
          {
            image,
            thumbnail: thumbnailImages?.[index] || image,
          },
        ]
      : [],
  );
  const cleanImages = galleryItems.map((item) => item.image);
  const cleanThumbnails = galleryItems.map((item) => item.thumbnail);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const thumbnails = galleryItems.slice(1, 4);
  const hiddenCount = Math.max(cleanImages.length - 4, 0);

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
          <GalleryImage
            key={galleryItems[0].thumbnail}
            src={galleryItems[0].thumbnail}
            alt={`${title} 메인 사진`}
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.035]"
          />
          <span className="absolute bottom-3 right-3 border border-white/20 bg-black/70 px-2 py-1 font-mono text-[10px] font-bold tabular-nums tracking-tight text-white backdrop-blur-md">
            사진 {cleanImages.length}장
          </span>
        </button>

        {thumbnails.length > 0 ? (
          <div
            className={`grid grid-cols-3 ${compact ? "gap-px" : "gap-2.5"}`}
          >
            {thumbnails.map((item, thumbnailIndex) => {
              const actualIndex = thumbnailIndex + 1;
              const showMore =
                hiddenCount > 0 && thumbnailIndex === thumbnails.length - 1;

              return (
                <button
                  key={`${item.image}-${actualIndex}`}
                  type="button"
                  onClick={() => openAt(actualIndex)}
                  aria-label={`${title} ${actualIndex + 1}번째 사진 크게 보기${
                    showMore ? `, 추가 사진 ${hiddenCount}장` : ""
                  }`}
                  className={`group relative overflow-hidden bg-[var(--surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset ${
                    compact
                      ? "aspect-[2/1] rounded-none"
                      : "aspect-[5/3] rounded-lg"
                  }`}
                >
                  <GalleryImage
                    src={item.thumbnail}
                    alt=""
                    className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.04]"
                  />
                  {showMore ? (
                    <span className="absolute inset-0 grid place-items-center bg-black/60 font-mono text-lg font-black tabular-nums tracking-tight text-white backdrop-blur-[1px]">
                      +{hiddenCount}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {modalOpen ? (
        <PhotoGalleryModal
          open
          onClose={() => setModalOpen(false)}
          images={cleanImages}
          thumbnailImages={cleanThumbnails}
          title={title}
          initialIndex={selectedIndex}
        />
      ) : null}
    </>
  );
}
