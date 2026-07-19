"use client";

import Link from "next/link";
import { Button } from "@/src/components/common";
import DeferredProductImage from "@/src/components/common/DeferredProductImage";
import type { PublicSoldAuction } from "@/src/lib/supabase/auctionLifecycle";
import { getCatalogThumbnailUrl } from "@/src/utils/catalogImages";
import { formatKRW } from "@/src/utils/formatters";

export interface SoldAuctionFeedProps {
  auctions: readonly PublicSoldAuction[];
  isLoading: boolean;
  error: string;
  onRetry: () => void | Promise<void>;
}

const RECENT_SOLD_ITEMS = 6;

function SoldFeedSkeleton() {
  return (
    <article aria-hidden="true" className="overflow-hidden bg-[var(--surface-raised)]">
      <div className="commerce-skeleton aspect-square rounded-none" />
      <div className="space-y-2 p-2.5">
        <div className="commerce-skeleton h-3 w-3/4 rounded-sm" />
        <div className="commerce-skeleton h-3 w-1/2 rounded-sm" />
      </div>
    </article>
  );
}

function SoldEmptyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" fill="none" className="mx-auto h-9 w-9 text-[var(--text-muted)]">
      <path d="M7 10h18v16H7V10Zm4 0V8a5 5 0 0 1 10 0v2" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m12.5 18 2.2 2.2 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SoldAuctionFeed({
  auctions,
  isLoading,
  error,
  onRetry,
}: SoldAuctionFeedProps) {
  const visibleAuctions = auctions.slice(0, RECENT_SOLD_ITEMS);

  return (
    <section className="mt-12" aria-labelledby="sold-auction-feed-title">
      <header className="flex flex-wrap items-end justify-between gap-3 border-y border-[var(--border)] py-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--accent-text)]">
            SOLD NOW
          </p>
          <h2 id="sold-auction-feed-title" className="mt-1 text-xl font-black tracking-[-0.035em] text-[var(--text-strong)] sm:text-2xl">
            최근 판매 완료
          </h2>
          <p className="mt-1 text-[11px] font-medium text-[var(--text-muted)] sm:text-xs">
            낙찰 금액과 구매자 공개 닉네임을 투명하게 확인합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-black tabular-nums tracking-tight text-[var(--text-muted)]">
            {auctions.length.toLocaleString("ko-KR")} SOLD
          </span>
          <Link
            href="/sold"
            prefetch={false}
            aria-label="판매 완료 상품 전체보기"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 text-xs font-black text-[var(--text-strong)] transition-all duration-200 hover:scale-[1.02] hover:border-[var(--text-strong)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            전체보기 <span aria-hidden="true">→</span>
          </Link>
        </div>
      </header>

      {visibleAuctions.length > 0 ? (
        <div
          role="status"
          aria-label="최근 낙찰 현황 요약"
          className="mt-3 overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface-raised)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="flex min-w-max items-center divide-x divide-[var(--border)]">
            {visibleAuctions.map((auction) => (
              <span key={auction.productId} className="inline-flex h-9 items-center gap-2 px-3 text-[10px] font-bold text-[var(--text-muted)]">
                <span className="size-1.5 rounded-full bg-[var(--success-text)]" aria-hidden="true" />
                <span className="max-w-36 truncate text-[var(--text-strong)]">{auction.title}</span>
                <strong className="font-mono font-black tabular-nums tracking-tight text-[var(--accent-text)]">
                  {formatKRW(auction.winningAmount)}
                </strong>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div role="status" className="mt-3">
          <span className="sr-only">판매 완료 상품을 불러오는 중…</span>
          <div className="grid grid-cols-2 gap-3.5 bg-transparent sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: RECENT_SOLD_ITEMS }, (_, index) => <SoldFeedSkeleton key={index} />)}
          </div>
        </div>
      ) : error ? (
        <div className="mt-3 border border-[var(--danger-text)]/35 bg-[var(--danger-surface)] p-5 text-center">
          <p className="text-sm font-bold text-[var(--danger-text)]">{error}</p>
          <Button className="mt-3" size="sm" variant="secondary" onClick={() => void onRetry()}>
            다시 불러오기
          </Button>
        </div>
      ) : auctions.length === 0 ? (
        <div className="mt-3 border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)] p-9 text-center">
          <SoldEmptyIcon />
          <p className="mt-3 text-sm font-bold text-[var(--text-strong)]">아직 판매 완료된 상품이 없습니다.</p>
          <p className="mt-1 text-xs font-medium text-[var(--text-muted)]">판매가 완료되면 공개 결과가 이곳에 표시됩니다.</p>
        </div>
      ) : (
        <div
          id="sold-auction-items"
          className="mt-3 grid grid-cols-2 gap-3.5 bg-transparent sm:grid-cols-3 lg:grid-cols-6"
        >
          {visibleAuctions.map((auction) => {
            const thumbnailUrl = getCatalogThumbnailUrl(
              auction.thumbnailUrls[0],
              auction.imageUrls[0],
            );

            return (
              <article
                key={auction.productId}
                className="render-lazy group min-w-0 overflow-hidden border border-[var(--border)] bg-[var(--surface-raised)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-md"
              >
                <div className="relative aspect-square overflow-hidden bg-[var(--surface-muted)]">
                  <DeferredProductImage
                    key={thumbnailUrl || auction.productId}
                    src={thumbnailUrl}
                    alt={`${auction.title} 판매 완료 상품 이미지`}
                    sizes="(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 16vw"
                    wrapperClassName="h-full w-full"
                    className="h-full w-full object-cover group-hover:scale-[1.035]"
                    emptyLabel="상품 미리보기를 준비하지 못함"
                  />
                  <span className="absolute left-1.5 top-1.5 border border-white/15 bg-black/75 px-1.5 py-1 text-[8px] font-black tracking-[0.08em] text-white backdrop-blur-sm">
                    SOLD
                  </span>
                </div>
                <div className="p-2.5">
                  <h3 className="line-clamp-1 text-xs font-black tracking-[-0.02em] text-[var(--text-strong)]">
                    {auction.title}
                  </h3>
                  <p className="mt-1.5 font-mono text-[11px] font-black tabular-nums tracking-tight text-[var(--accent-text)]">
                    {formatKRW(auction.winningAmount)}
                  </p>
                  <p className="mt-1 truncate text-[9px] font-bold text-[var(--text-muted)]">
                    구매자 · {auction.winnerDisplayName}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
