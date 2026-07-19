"use client";

import Button from "@/src/components/common/Button";
import Modal from "@/src/components/common/Modal";
import type { AuctionPost } from "@/src/types/auction";
import type { ProductFeedDetails } from "@/src/utils/productFeedDetails";
import { formatKRW } from "@/src/utils/formatters";
import PhotoGallery from "./PhotoGallery";

export interface ProductDetailModalProps {
  open: boolean;
  onClose: () => void;
  post: AuctionPost;
  details: ProductFeedDetails;
  lotLabel: string;
  galleryTitle: string;
  closingLabel: string;
  priceLabel: string;
  displayedPrice: number;
  bidCount: number;
  bidAllowed: boolean;
  unavailableBidLabel: string;
  quickBidLabel: string;
  onOpenInquiry: () => void;
  onOpenSizeScanner: () => void;
  onOpenBidHistory: () => void;
  onOpenManualBid: () => void;
  onQuickBid: () => void;
}

export default function ProductDetailModal({
  open,
  onClose,
  post,
  details,
  lotLabel,
  galleryTitle,
  closingLabel,
  priceLabel,
  displayedPrice,
  bidCount,
  bidAllowed,
  unavailableBidLabel,
  quickBidLabel,
  onOpenInquiry,
  onOpenSizeScanner,
  onOpenBidHistory,
  onOpenManualBid,
  onQuickBid,
}: ProductDetailModalProps) {
  const continueWith = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={galleryTitle}
      headerPrefix={lotLabel}
      description="사진과 실측, 상태, 현재 입찰가를 한 화면에서 확인하세요."
      closeShortcutLabel="ESC"
      headerVariant="editorial"
      size="gallery"
      className="max-sm:absolute max-sm:bottom-0 max-sm:max-h-[94dvh] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0"
    >
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        <div className="grid min-h-0 lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,.65fr)] lg:items-start">
          <section
            aria-label={`${galleryTitle} 상품 사진`}
            className="min-w-0 border-b border-[var(--border)] bg-[var(--surface-muted)] p-3 sm:p-5 lg:border-b-0 lg:border-r lg:p-6"
          >
            <PhotoGallery
              images={post.imageUrls}
              thumbnailImages={post.thumbnailUrls}
              title={galleryTitle}
              lotLabel={lotLabel}
            />
          </section>

          <aside className="min-w-0 bg-[var(--surface)] p-5 sm:p-6 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-8rem)] lg:self-start lg:overflow-y-auto lg:p-7">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-4">
              <span className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1 font-mono text-[10px] font-black tabular-nums tracking-[0.1em] text-[var(--text-muted)]">
                {closingLabel}
              </span>
              <button
                type="button"
                onClick={() => continueWith(onOpenInquiry)}
                className="min-h-10 rounded-md border border-[var(--border)] px-3 text-xs font-black text-[var(--text-muted)] transition-all duration-200 hover:border-[var(--text-strong)] hover:text-[var(--text-strong)] active:scale-[0.98]"
              >
                상품 문의
              </button>
            </div>

            <div className="pt-5">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">
                Product information
              </p>
              <h3 className="mt-2 break-keep text-2xl font-black leading-tight tracking-[-0.045em] text-[var(--text-strong)]">
                {details.name}
              </h3>
              {details.isCanonical ? (
                <dl className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)] text-sm">
                  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-3">
                    <dt className="font-mono text-[10px] font-black uppercase tracking-[0.1em] text-[var(--text-muted)]">
                      Size
                    </dt>
                    <dd className="break-words font-bold text-[var(--text-strong)]">
                      {details.size || "표기 없음"}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-3">
                    <dt className="font-mono text-[10px] font-black uppercase tracking-[0.1em] text-[var(--text-muted)]">
                      Condition
                    </dt>
                    <dd className="break-words font-bold text-[var(--text-strong)]">
                      {details.condition || "상세 사진 참고"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-4 whitespace-pre-line break-keep text-sm font-medium leading-7 text-[var(--text-muted)]">
                  {details.legacyDescription}
                </p>
              )}

              <button
                type="button"
                onClick={() => continueWith(onOpenSizeScanner)}
                className="mt-5 flex min-h-12 w-full items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-4 text-sm font-black text-[var(--text-strong)] transition-all duration-200 hover:border-[var(--accent)] hover:bg-[var(--accent-surface)] active:scale-[0.98]"
              >
                <span>📏 내 옷과 실측 비교하기</span>
                <span aria-hidden="true">→</span>
              </button>
            </div>

            <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    {priceLabel}
                  </p>
                  <p className="mt-1 font-mono text-2xl font-black tabular-nums tracking-tight text-[var(--accent-text)]">
                    {formatKRW(displayedPrice)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => continueWith(onOpenBidHistory)}
                  className="min-h-10 rounded-md border border-[var(--border)] px-3 text-xs font-black text-[var(--text-muted)] transition-colors hover:border-[var(--text-strong)] hover:text-[var(--text-strong)]"
                >
                  입찰 {bidCount.toLocaleString("ko-KR")}건
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {bidAllowed ? (
                <>
                  <Button
                    fullWidth
                    size="lg"
                    className="min-h-12 rounded-lg text-sm font-black active:scale-[0.98]"
                    onClick={() => continueWith(onOpenManualBid)}
                  >
                    경매하기
                  </Button>
                  <Button
                    fullWidth
                    size="lg"
                    variant="secondary"
                    className="min-h-12 rounded-lg text-sm font-black active:scale-[0.98]"
                    onClick={() => continueWith(onQuickBid)}
                  >
                    {quickBidLabel}
                  </Button>
                </>
              ) : (
                <Button
                  fullWidth
                  size="lg"
                  disabled
                  className="min-h-12 rounded-lg text-sm font-black sm:col-span-2 lg:col-span-1 xl:col-span-2"
                >
                  {unavailableBidLabel}
                </Button>
              )}
            </div>
          </aside>
        </div>
      </div>
    </Modal>
  );
}
