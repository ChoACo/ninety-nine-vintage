"use client";

/* eslint-disable @next/next/no-img-element -- Supabase Storage의 공개 파생 이미지를 표시합니다. */

import { Button } from "@/src/components/common";
import type { PublicSoldAuction } from "@/src/lib/supabase/auctionLifecycle";
import { formatKRW, formatKoreanDate } from "@/src/utils/formatters";

export interface SoldAuctionFeedProps {
  auctions: readonly PublicSoldAuction[];
  isLoading: boolean;
  error: string;
  onRetry: () => void | Promise<void>;
}

export function SoldAuctionFeed({
  auctions,
  isLoading,
  error,
  onRetry,
}: SoldAuctionFeedProps) {
  return (
    <section className="mt-8" aria-labelledby="sold-auction-feed-title">
      <header className="theme-panel rounded-[1.8rem] border p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black tracking-[0.16em] text-[var(--accent-text)]">
              SOLD ARCHIVE
            </p>
            <h2
              id="sold-auction-feed-title"
              className="mt-1 text-2xl font-black text-[var(--text-strong)]"
            >
              판매 완료 상품
            </h2>
            <p className="mt-2 break-keep font-bold leading-7 text-[var(--text-muted)]">
              마감된 상품과 낙찰 금액을 공개합니다. 낙찰자 닉네임은 개인정보
              보호를 위해 일부만 표시합니다.
            </p>
          </div>
          <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-sm font-black text-[var(--text-muted)]">
            최근 {auctions.length.toLocaleString("ko-KR")}건
          </span>
        </div>
      </header>

      {isLoading ? (
        <p className="theme-panel mt-3 rounded-2xl border p-5 text-center font-bold text-[var(--text-muted)]">
          판매 완료 상품을 불러오는 중…
        </p>
      ) : error ? (
        <div className="theme-panel mt-3 rounded-2xl border p-5 text-center">
          <p className="font-bold text-[var(--danger-text)]">{error}</p>
          <Button
            className="mt-3"
            size="sm"
            variant="secondary"
            onClick={() => void onRetry()}
          >
            다시 불러오기
          </Button>
        </div>
      ) : auctions.length === 0 ? (
        <p className="theme-panel mt-3 rounded-2xl border p-5 text-center font-bold text-[var(--text-muted)]">
          아직 판매 완료된 상품이 없습니다.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {auctions.map((auction) => (
            <article
              key={auction.productId}
              className="theme-panel overflow-hidden rounded-[1.6rem] border"
            >
              <div className="aspect-[4/3] overflow-hidden bg-[var(--surface-muted)]">
                {auction.thumbnailUrls[0] || auction.imageUrls[0] ? (
                  <img
                    src={auction.thumbnailUrls[0] || auction.imageUrls[0]}
                    alt={`${auction.title} 판매 완료 상품`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="grid h-full place-items-center text-sm font-bold text-[var(--text-muted)]">
                    상품 사진 없음
                  </div>
                )}
              </div>
              <div className="p-4 sm:p-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-[var(--success-surface)] px-3 py-1 text-xs font-black text-[var(--success-text)]">
                    판매 완료
                  </span>
                  <time
                    className="text-xs font-bold text-[var(--text-muted)]"
                    dateTime={auction.soldAt}
                  >
                    {formatKoreanDate(new Date(auction.soldAt))}
                  </time>
                </div>
                <h3 className="mt-3 line-clamp-2 text-lg font-black text-[var(--text-strong)]">
                  {auction.title}
                </h3>
                <p className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-[var(--text-muted)]">
                  {auction.description}
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-[var(--surface-muted)] p-3">
                  <div>
                    <dt className="text-xs font-bold text-[var(--text-muted)]">
                      낙찰가
                    </dt>
                    <dd className="mt-1 font-black text-[var(--accent-text)]">
                      {formatKRW(auction.winningAmount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold text-[var(--text-muted)]">
                      낙찰자
                    </dt>
                    <dd className="mt-1 font-black text-[var(--text-strong)]">
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
