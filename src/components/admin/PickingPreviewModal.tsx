"use client";

/* eslint-disable @next/next/no-img-element -- 피킹 확인에는 서버가 보관한 원본 상품 사진을 표시합니다. */
import { useMemo, useState } from "react";

import Modal from "@/src/components/common/Modal";
import type { AdminShipmentBatch } from "@/src/types/auction";
import { formatKRW } from "@/src/utils/formatters";

interface PickingPreviewModalProps {
  batch: AdminShipmentBatch | null;
  onClose: () => void;
}

export function PickingPreviewModal({
  batch,
  onClose,
}: PickingPreviewModalProps) {
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);

  const activeItem = batch?.items[activeItemIndex];
  const photos = useMemo(() => {
    if (!activeItem) return [];
    return activeItem.imageUrls.length > 0
      ? activeItem.imageUrls
      : [activeItem.thumbnailUrl];
  }, [activeItem]);
  const activePhoto = photos[activePhotoIndex] ?? activeItem?.thumbnailUrl;

  const selectItem = (index: number) => {
    setActiveItemIndex(index);
    setActivePhotoIndex(0);
  };

  const handleClose = () => {
    setActiveItemIndex(0);
    setActivePhotoIndex(0);
    onClose();
  };

  return (
    <Modal
      open={Boolean(batch)}
      title={`👕 ${batch?.buyer.name ?? "고객"} 상품 상세 미리보기`}
      description="창고에서 원본 사진과 상품 내용을 대조한 뒤 피킹해 주세요."
      size="gallery"
      className="h-[min(94dvh,66rem)]"
      onClose={handleClose}
    >
      {batch && activeItem ? (
        <div className="grid min-h-full grid-cols-1 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="border-b border-[#eadfd4] bg-[#fff4e8] p-4 lg:border-b-0 lg:border-r lg:p-5">
            <p className="text-[17px] font-black text-[#735c4b]">
              피킹 목록 · 총 {batch.items.length}벌
            </p>
            <div className="mt-3 flex gap-3 overflow-x-auto pb-2 lg:max-h-[calc(94dvh-13rem)] lg:flex-col lg:overflow-y-auto">
              {batch.items.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={activeItemIndex === index}
                  onClick={() => selectItem(index)}
                  className={`flex min-w-[15rem] items-center gap-3 rounded-2xl border-2 p-3 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#efc4b8] lg:min-w-0 ${
                    activeItemIndex === index
                      ? "border-[#dd826e] bg-white shadow-sm"
                      : "border-transparent bg-white/65 hover:border-[#dfc5ae]"
                  }`}
                >
                  <img
                    src={item.thumbnailUrl}
                    alt=""
                    className="size-16 shrink-0 rounded-xl bg-[#eee4d9] object-cover"
                  />
                  <span className="min-w-0">
                    <span className="block text-[17px] font-black text-[#4e4037]">
                      {index + 1}번 옷
                    </span>
                    <span className="line-clamp-2 text-[17px] font-bold leading-6 text-[#75665c]">
                      {item.title}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <div className="min-w-0 p-4 sm:p-6">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="min-w-0">
                <div className="relative mx-auto flex h-[min(62dvh,48rem)] max-w-3xl items-center justify-center overflow-hidden rounded-[1.6rem] bg-[#302f2e]">
                  {activePhoto ? (
                    <img
                      src={activePhoto}
                      alt={`${activeItem.title} 원본 사진 ${activePhotoIndex + 1}`}
                      className="h-full w-full object-contain"
                    />
                  ) : null}
                  {photos.length > 1 ? (
                    <>
                      <button
                        type="button"
                        aria-label="이전 상품 사진"
                        onClick={() =>
                          setActivePhotoIndex((current) =>
                            (current - 1 + photos.length) % photos.length,
                          )
                        }
                        className="absolute left-3 grid size-14 place-items-center rounded-full bg-black/65 text-3xl font-black text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/70"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        aria-label="다음 상품 사진"
                        onClick={() =>
                          setActivePhotoIndex((current) =>
                            (current + 1) % photos.length,
                          )
                        }
                        className="absolute right-3 grid size-14 place-items-center rounded-full bg-black/65 text-3xl font-black text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/70"
                      >
                        ›
                      </button>
                    </>
                  ) : null}
                  <span className="absolute bottom-3 right-3 rounded-full bg-black/70 px-4 py-2 text-[17px] font-black text-white">
                    사진 {activePhotoIndex + 1} / {photos.length}
                  </span>
                </div>

                {photos.length > 1 ? (
                  <div className="mt-3 flex justify-center gap-2 overflow-x-auto pb-1">
                    {photos.map((photo, index) => (
                      <button
                        key={`${activeItem.id}-${photo}`}
                        type="button"
                        aria-label={`${index + 1}번 사진 보기`}
                        aria-pressed={activePhotoIndex === index}
                        onClick={() => setActivePhotoIndex(index)}
                        className={`shrink-0 overflow-hidden rounded-xl border-4 ${
                          activePhotoIndex === index
                            ? "border-[#e07c68]"
                            : "border-transparent"
                        }`}
                      >
                        <img
                          src={photo}
                          alt=""
                          className="h-20 w-16 object-cover"
                        />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <section className="rounded-[1.5rem] border-2 border-[#e7d7c6] bg-[#fffaf3] p-5 text-[17px] leading-8">
                <p className="font-black text-[#b86452]">
                  {activeItemIndex + 1} / {batch.items.length}번 옷
                </p>
                <h3 className="mt-2 text-2xl font-black leading-9 text-[#42372f]">
                  {activeItem.title}
                </h3>
                <p className="mt-4 whitespace-pre-wrap break-keep font-bold text-[#685a51]">
                  {activeItem.description}
                </p>
                <p className="mt-4 border-t border-[#eadfd4] pt-4 text-xl font-black text-[#c16451]">
                  낙찰가 {formatKRW(activeItem.winningBid)}
                </p>
                <p className="mt-4 rounded-2xl bg-[#eaf4f6] p-4 font-extrabold text-[#4f717c]">
                  고객: {batch.buyer.name}
                  <br />총 {batch.items.length}벌 합배송 피킹
                </p>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
