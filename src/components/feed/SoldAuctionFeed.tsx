"use client";

/* eslint-disable @next/next/no-img-element -- Supabase Storage의 공개 파생 이미지를 표시합니다. */

import Link from "next/link";
import { Button } from "@/src/components/common";
import type { PublicSoldAuction } from "@/src/lib/supabase/auctionLifecycle";
import { formatKRW, formatKoreanDate } from "@/src/utils/formatters";

export interface SoldAuctionFeedProps {
  auctions: readonly PublicSoldAuction[];
  isLoading: boolean;
  error: string;
  onRetry: () => void | Promise<void>;
}

const RECENT_SOLD_ITEMS = 9;

function SoldFeedSkeleton() {
  return (
    <article aria-hidden="true" className="bg-[var(--surface-raised)]">
      <div className="commerce-skeleton aspect-[4/3] rounded-none" />
      <div className="space-y-2.5 p-2.5 sm:p-4">
        <div className="commerce-skeleton h-3 w-16 rounded-sm" />
        <div className="commerce-skeleton h-5 w-3/4 rounded-sm" />
        <div className="commerce-skeleton h-12 rounded-md" />
      </div>
    </article>
  );
}

function SoldEmptyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" fill="none" className="mx-auto h-10 w-10 text-[var(--text-muted)]">
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
      <header className="border-y border-[var(--border)] py-5 sm:py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent-text)]">
              SOLD ARCHIVE
            </p>
            <h2
              id="sold-auction-feed-title"
              className="mt-1.5 text-2xl font-black tracking-[-0.04em] text-[var(--text-strong)]"
            >
              판매 완료 상품
            </h2>
            <p className="mt-2 break-keep text-sm font-medium leading-6 text-[var(--text-muted)]">
              마감된 상품과 낙찰 금액, 공개 닉네임을 투명하게 확인할 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="border-y border-[var(--border)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              RECENT <strong className="ml-1 font-mono text-sm font-black tabular-nums tracking-tight text-[var(--text-strong)]">{auctions.length.toLocaleString("ko-KR")}</strong>
            </span>
            <Link
              href="/sold"
              prefetch={false}
              aria-label="판매 완료 상품 전체보기"
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--border-strong)] bg-[var(--surface-raised)] px-4 py-2 text-sm font-bold text-[var(--text-strong)] transition-all duration-200 ease-out hover:scale-[1.02] hover:border-[var(--text-strong)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
            >
              전체보기
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-4 w-4"
              >
                <path
                  d="m9 18 6-6-6-6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          </div>
        </div>
      </header>

      {isLoading ? (
        <div role="status" className="mt-4">
          <span className="sr-only">판매 완료 상품을 불러오는 중…</span>
          <div className="grid grid-cols-2 gap-3.5 bg-transparent sm:gap-px sm:overflow-hidden sm:border sm:border-[var(--border)] sm:bg-[var(--border)] 2xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => <SoldFeedSkeleton key={index} />)}
          </div>
        </div>
      ) : error ? (
        <div className="mt-4 border border-[var(--danger-text)]/35 bg-[var(--danger-surface)] p-7 text-center">
          <p className="font-bold text-[var(--danger-text)]">{error}</p>
          <Button
            className="mt-4 rounded-lg transition-all duration-200 ease-out hover:scale-[1.02]"
            size="sm"
            variant="secondary"
            onClick={() => void onRetry()}
          >
            다시 불러오기
          </Button>
        </div>
      ) : auctions.length === 0 ? (
        <div className="mt-4 border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)] p-12 text-center">
          <SoldEmptyIcon />
          <p className="mt-3 text-sm font-bold text-[var(--text-strong)]">아직 판매 완료된 상품이 없습니다.</p>
          <p className="mt-1 text-xs font-medium text-[var(--text-muted)]">경매가 마감되면 낙찰 기록이 이곳에 공개됩니다.</p>
        </div>
      ) : (
        <div
          id="sold-auction-items"
          className="mt-4 grid grid-cols-2 gap-3.5 bg-transparent sm:gap-px sm:overflow-hidden sm:border sm:border-[var(--border)] sm:bg-[var(--border)] 2xl:grid-cols-3"
        >
          {visibleAuctions.map((auction) => (
            <article
              key={auction.productId}
              className="render-lazy group overflow-hidden bg-[var(--surface-raised)] transition-all duration-200 ease-out hover:relative hover:z-[1] hover:shadow-[var(--shadow-hover)]"
            >
              <div className="aspect-[4/3] overflow-hidden bg-[var(--surface-muted)]">
                {auction.thumbnailUrls[0] || auction.imageUrls[0] ? (
                  <img
                    src={auction.thumbnailUrls[0] || auction.imageUrls[0]}
                    alt={`${auction.title} 판매 완료 상품`}
                    className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.035]"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="grid h-full place-items-center text-sm font-bold text-[var(--text-muted)]">
                    상품 사진 없음
                  </div>
                )}
              </div>
              <div className="p-2.5 sm:p-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="border border-[var(--success-text)]/25 bg-[var(--success-surface)] px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--success-text)]">
                    판매 완료
                  </span>
                  <time
                    className="hidden font-mono text-[10px] font-medium tabular-nums tracking-tight text-[var(--text-muted)] sm:block"
                    dateTime={auction.soldAt}
                  >
                    {formatKoreanDate(new Date(auction.soldAt))}
                  </time>
                </div>
                <h3 className="mt-2.5 line-clamp-2 text-sm font-black leading-5 tracking-[-0.025em] text-[var(--text-strong)] sm:mt-3 sm:text-lg sm:leading-6">
                  {auction.title}
                </h3>
                <p className="mt-1.5 line-clamp-2 text-xs font-medium leading-5 text-[var(--text-muted)] sm:mt-2 sm:text-sm sm:leading-6">
                  {auction.description}
                </p>
                <dl className="mt-3 grid grid-cols-1 divide-y divide-[var(--border)] border-y border-[var(--border)] py-1 sm:mt-4 sm:grid-cols-2 sm:divide-x sm:divide-y-0 sm:py-3">
                  <div className="py-2 sm:py-0">
                    <dt className="px-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)] sm:px-3 sm:text-[10px] sm:tracking-[0.12em]">
                      낙찰가
                    </dt>
                    <dd className="mt-1 break-all px-1 font-mono text-xs font-black tabular-nums tracking-tight text-[var(--accent-text)] sm:px-3 sm:text-sm">
                      {formatKRW(auction.winningAmount)}
                    </dd>
                  </div>
                  <div className="min-w-0 py-2 sm:py-0">
                    <dt className="px-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)] sm:px-3 sm:text-[10px] sm:tracking-[0.12em]">
                      낙찰자
                    </dt>
                    <dd className="mt-1 break-all px-1 text-xs font-black text-[var(--text-strong)] sm:px-3 sm:text-sm">
                      {auction.winnerDisplayName}
                    </dd>
                  </div>
                </dl>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
