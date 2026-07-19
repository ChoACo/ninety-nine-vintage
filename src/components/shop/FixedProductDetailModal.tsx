"use client";

import Button from "@/src/components/common/Button";
import Modal from "@/src/components/common/Modal";
import PhotoGallery from "@/src/components/feed/PhotoGallery";
import type { AuctionPost } from "@/src/types/auction";
import { formatKRW } from "@/src/utils/formatters";
import { toCommerceProductView } from "@/src/features/commerce/productViewModel";

export interface FixedProductDetailModalProps {
  open: boolean;
  post: AuctionPost | null;
  onClose: () => void;
  onPurchase: (post: AuctionPost) => void;
}

export default function FixedProductDetailModal({
  open,
  post,
  onClose,
  onPurchase,
}: FixedProductDetailModalProps) {
  if (!post) return null;

  const productView = toCommerceProductView(post);
  const productLabel = productView.name;
  const fixedPrice = post.fixedPrice ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={productLabel}
      headerPrefix={`SHOP ${post.id.slice(0, 8).toUpperCase()}`}
      description="상태와 실측, 사진을 확인한 뒤 표시된 정가로 구매할 수 있습니다."
      closeShortcutLabel="ESC"
      headerVariant="editorial"
      size="gallery"
      className="max-sm:absolute max-sm:bottom-0 max-sm:max-h-[94dvh] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0"
    >
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        <div className="grid min-h-0 lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,.65fr)] lg:items-start">
          <section
            aria-label={`${productLabel} 상품 사진`}
            className="min-w-0 border-b border-[var(--border)] bg-[var(--surface-muted)] p-3 sm:p-5 lg:border-b-0 lg:border-r lg:p-6"
          >
            <PhotoGallery
              images={post.imageUrls}
              thumbnailImages={post.thumbnailUrls}
              title={productLabel}
              lotLabel={`SHOP ${post.id.slice(0, 8).toUpperCase()}`}
            />
          </section>

          <aside className="min-w-0 bg-[var(--surface)] p-5 sm:p-6 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-8rem)] lg:self-start lg:overflow-y-auto lg:p-7">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black tracking-[0.1em] text-emerald-600">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />
                BUY NOW
              </span>
              <span className="text-[10px] font-black text-[var(--text-muted)]">
                선착순 1명
              </span>
            </div>

            <div className="pt-5">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">
                Fixed price product
              </p>
              <h2 className="mt-2 break-keep text-2xl font-black leading-tight tracking-[-0.045em] text-[var(--text-strong)]">
                {productLabel}
              </h2>
              <dl className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)] text-sm">
                <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-3">
                  <dt className="font-mono text-[10px] font-black uppercase tracking-[0.1em] text-[var(--text-muted)]">
                    Size
                  </dt>
                  <dd className="break-words font-bold text-[var(--text-strong)]">
                    {productView.size}
                  </dd>
                </div>
                <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-3">
                  <dt className="font-mono text-[10px] font-black uppercase tracking-[0.1em] text-[var(--text-muted)]">
                    Condition
                  </dt>
                  <dd className="break-words font-bold text-[var(--text-strong)]">
                    {productView.condition}
                  </dd>
                </div>
              </dl>
              {productView.description ? (
                <p className="mt-4 whitespace-pre-line break-keep text-sm font-medium leading-7 text-[var(--text-muted)]">
                  {productView.description}
                </p>
              ) : null}
            </div>

            <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">
                판매 정가
              </p>
              <p className="mt-1 font-mono text-3xl font-black tabular-nums tracking-tight text-[var(--accent-text)]">
                {formatKRW(fixedPrice)}
              </p>
            </div>

            <Button
              fullWidth
              size="lg"
              disabled={fixedPrice <= 0}
              className="mt-5 min-h-12 rounded-lg text-sm font-black active:scale-[0.98]"
              onClick={() => {
                onClose();
                onPurchase(post);
              }}
            >
              바로 구매하기
            </Button>
            <p className="mt-3 break-keep text-center text-[11px] font-medium leading-5 text-[var(--text-muted)]">
              서버 재고 확인 후 기존 결제 대기 목록으로 안전하게 연결됩니다.
            </p>
          </aside>
        </div>
      </div>
    </Modal>
  );
}
