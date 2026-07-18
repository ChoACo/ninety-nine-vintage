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
        className={`${className} grid place-items-center bg-[#f3e5d8] text-3xl`}
      >
        ◇
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
      <div className="grid aspect-[4/3] place-items-center rounded-[1.5rem] bg-[#f3e5d8] text-center text-[#846e60]">
        <div>
          <span aria-hidden="true" className="text-4xl">
            ◇
          </span>
          <p className="mt-2 text-sm font-semibold">등록된 사진이 없어요</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={compact ? "space-y-1.5" : "space-y-2.5"}>
        <button
          type="button"
          onClick={() => openAt(0)}
          aria-label={`${title} 메인 사진 크게 보기`}
          className={`group relative block aspect-[4/3] w-full overflow-hidden bg-[#eadfd4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec7866] focus-visible:ring-offset-2 ${
            compact ? "rounded-[1.1rem]" : "rounded-[1.5rem]"
          }`}
        >
          <GalleryImage
            key={galleryItems[0].thumbnail}
            src={galleryItems[0].thumbnail}
            alt={`${title} 메인 사진`}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]"
          />
          <span className="absolute bottom-3 right-3 rounded-full border border-white/40 bg-[#2f2924]/65 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-sm">
            사진 {cleanImages.length}장
          </span>
        </button>

        {thumbnails.length > 0 ? (
          <div
            className={`grid grid-cols-3 ${compact ? "gap-1.5" : "gap-2.5"}`}
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
                  className={`group relative overflow-hidden bg-[#eadfd4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec7866] focus-visible:ring-offset-2 ${
                    compact
                      ? "aspect-[2/1] rounded-xl"
                      : "aspect-[5/3] rounded-2xl"
                  }`}
                >
                  <GalleryImage
                    src={item.thumbnail}
                    alt=""
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                  {showMore ? (
                    <span className="absolute inset-0 grid place-items-center bg-[#2f2924]/55 text-xl font-black text-white backdrop-blur-[1px]">
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
