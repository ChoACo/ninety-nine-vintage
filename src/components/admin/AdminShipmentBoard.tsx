/* eslint-disable @next/next/no-img-element -- 관리자 물류 이미지는 추후 CDN 원본 URL로 교체합니다. */
import type { AdminShipmentBatch } from "@/src/types/auction";
import { formatKoreanDate, formatKRW } from "@/src/utils/formatters";

interface AdminShipmentBoardProps {
  batches: readonly AdminShipmentBatch[];
  onOpenPreview: (batch: AdminShipmentBatch) => void;
  onOpenRegistration: (batch: AdminShipmentBatch) => void;
}

function getItemSummary(batch: AdminShipmentBatch): string {
  const titles = batch.items.map((item) => item.title);
  if (titles.length <= 2) return titles.join(", ");
  return `${titles.slice(0, 2).join(", ")} 외 ${titles.length - 2}벌`;
}

function EmptyState({ children }: { children: string }) {
  return (
    <p className="rounded-[1.4rem] border-2 border-dashed border-[#d8cbbb] bg-white/70 px-5 py-10 text-center text-[17px] font-bold leading-7 text-[#75675e]">
      {children}
    </p>
  );
}

function ShipmentThumbs({ batch }: { batch: AdminShipmentBatch }) {
  const thumbnails = batch.items.slice(0, 3);
  return (
    <div className="flex -space-x-3" aria-label={`상품 사진 ${batch.items.length}장`}>
      {thumbnails.map((item, index) => (
        <img
          key={item.id}
          src={item.thumbnailUrl}
          alt={item.title}
          className="size-16 rounded-2xl border-4 border-white bg-[#eee4da] object-cover"
          style={{ zIndex: thumbnails.length - index }}
        />
      ))}
      {batch.items.length > thumbnails.length ? (
        <span className="relative z-10 grid size-16 place-items-center rounded-2xl border-4 border-white bg-[#e9f1f3] text-[17px] font-black text-[#4e707b]">
          +{batch.items.length - thumbnails.length}
        </span>
      ) : null}
    </div>
  );
}

export function AdminShipmentBoard({
  batches,
  onOpenPreview,
  onOpenRegistration,
}: AdminShipmentBoardProps) {
  const packingBatches = batches.filter((batch) => batch.status === "packing");
  const shippedBatches = batches.filter((batch) => batch.status === "shipped");

  return (
    <section aria-labelledby="admin-shipment-board-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[17px] font-black tracking-[0.12em] text-[#668493]">
            WAREHOUSE PICKING
          </p>
          <h2
            id="admin-shipment-board-title"
            className="mt-1 text-2xl font-black text-[#473a32] sm:text-3xl"
          >
            📦 관리자 발송 관리
          </h2>
        </div>
        <p className="rounded-full bg-[#fff1e4] px-4 py-2 text-[17px] font-black text-[#a45e4d]">
          포장 대기 {packingBatches.length}건
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <article className="rounded-[1.8rem] border-2 border-[#bed8e2] bg-[#edf7fa] p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-xl font-black text-[#395a67]">
              관리자 발송 대기열
            </h3>
            <span className="rounded-full bg-white px-3 py-1.5 text-[17px] font-black text-[#477382]">
              {packingBatches.length}건
            </span>
          </div>

          {packingBatches.length === 0 ? (
            <EmptyState>현재 포장할 발송 요청이 없습니다.</EmptyState>
          ) : (
            <ul className="space-y-4" aria-label="포장 대기 발송 요청">
              {packingBatches.map((batch) => (
                <li
                  key={batch.id}
                  className="rounded-[1.45rem] border border-[#c7dde5] bg-white p-4 shadow-[0_8px_24px_rgba(61,91,103,0.08)]"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    <ShipmentThumbs batch={batch} />
                    <div className="min-w-0 flex-1 text-[17px] leading-7">
                      <p className="text-xl font-black text-[#3d4d54]">
                        고객명: {batch.buyer.name}
                      </p>
                      <p className="font-black text-[#b66050]">
                        총 상품 수량: 총 {batch.items.length}벌
                      </p>
                      <p className="mt-1 line-clamp-2 font-bold text-[#6e625b]">
                        상품명: {getItemSummary(batch)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => onOpenPreview(batch)}
                      className="min-h-14 rounded-2xl border-2 border-[#c8ab91] bg-[#fff8ef] px-4 py-3 text-[17px] font-black text-[#6d5543] transition hover:bg-[#ffedd8] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#ead8c5]"
                    >
                      👕 상품 상세 미리보기
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenRegistration(batch)}
                      className="min-h-14 rounded-2xl bg-[#e27b67] px-4 py-3 text-[18px] font-black text-white shadow-[0_10px_24px_rgba(190,91,72,0.2)] transition hover:bg-[#cf6855] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f0b8ad]"
                    >
                      🚚 배송하기
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="rounded-[1.8rem] border-2 border-[#b9d9c9] bg-[#eef8f3] p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-xl font-black text-[#3d6656]">
              🚚 배송 중 / 발송 완료
            </h3>
            <span className="rounded-full bg-white px-3 py-1.5 text-[17px] font-black text-[#4d7b68]">
              {shippedBatches.length}건
            </span>
          </div>

          {shippedBatches.length === 0 ? (
            <EmptyState>아직 송장이 등록된 발송 건이 없습니다.</EmptyState>
          ) : (
            <ul className="space-y-4" aria-label="배송 중 또는 발송 완료 목록">
              {shippedBatches.map((batch) => (
                <li
                  key={batch.id}
                  className="rounded-[1.45rem] border border-[#c7e0d5] bg-white p-4 text-[17px] leading-7"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xl font-black text-[#3d5148]">
                        {batch.buyer.name} · 총 {batch.items.length}벌
                      </p>
                      <p className="mt-1 line-clamp-2 font-bold text-[#6a746f]">
                        {getItemSummary(batch)}
                      </p>
                    </div>
                    <ShipmentThumbs batch={batch} />
                  </div>
                  <dl className="mt-4 rounded-2xl bg-[#e9f6ef] p-4">
                    <div className="flex flex-wrap gap-x-3">
                      <dt className="font-black text-[#557264]">택배사</dt>
                      <dd className="font-extrabold text-[#365748]">
                        {batch.courier ?? "한진택배"}
                      </dd>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3">
                      <dt className="font-black text-[#557264]">송장번호</dt>
                      <dd className="break-all font-mono text-xl font-black text-[#2f5142]">
                        {batch.trackingNumber ?? "동기화 대기"}
                      </dd>
                    </div>
                  </dl>
                  {batch.shippedAt ? (
                    <p className="mt-3 font-bold text-[#66766e]">
                      {formatKoreanDate(batch.shippedAt)} 발송 처리 · 상품 합계 {formatKRW(
                        batch.items.reduce((sum, item) => sum + item.winningBid, 0),
                      )}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onOpenPreview(batch)}
                    className="mt-3 min-h-12 w-full rounded-2xl border-2 border-[#a9cdbd] bg-white px-4 py-2 text-[17px] font-black text-[#436e5c] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#cde5da]"
                  >
                    👕 발송 상품 다시 보기
                  </button>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}
