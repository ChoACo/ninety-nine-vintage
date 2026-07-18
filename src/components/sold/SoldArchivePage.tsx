"use client";

/* eslint-disable @next/next/no-img-element -- Supabase Storage 공개 썸네일을 지연 표시합니다. */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, ThemeToggle } from "@/src/components/common";
import { appendUniqueSoldAuctions } from "@/src/lib/soldArchivePagination";
import {
  fetchPublicSoldAuctionsPage,
  type PublicSoldAuction,
  type PublicSoldAuctionCursor,
} from "@/src/lib/supabase/auctionLifecycle";
import { formatKRW, formatKoreanDate } from "@/src/utils/formatters";

function toLoadError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "판매 완료 상품을 불러오지 못했습니다.";
}

export function SoldArchivePage() {
  const [auctions, setAuctions] = useState<PublicSoldAuction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] =
    useState<PublicSoldAuctionCursor | null>(null);
  const [error, setError] = useState("");
  const mountedRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const loadingMoreRef = useRef(false);

  const loadFirstPage = useCallback(async () => {
    const generation = ++requestGenerationRef.current;
    setIsLoading(true);
    setError("");

    try {
      const page = await fetchPublicSoldAuctionsPage();
      if (!mountedRef.current || generation !== requestGenerationRef.current) {
        return;
      }
      setAuctions(page.auctions);
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
    } catch (loadError) {
      if (!mountedRef.current || generation !== requestGenerationRef.current) {
        return;
      }
      setError(toLoadError(loadError));
    } finally {
      if (mountedRef.current && generation === requestGenerationRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const initialLoadTimer = window.setTimeout(() => {
      void loadFirstPage();
    }, 0);
    return () => {
      window.clearTimeout(initialLoadTimer);
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, [loadFirstPage]);

  const loadMore = async () => {
    if (loadingMoreRef.current || !hasMore || !nextCursor) return;

    const generation = requestGenerationRef.current;
    const cursor = nextCursor;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    setError("");

    try {
      const page = await fetchPublicSoldAuctionsPage({ cursor });
      if (!mountedRef.current || generation !== requestGenerationRef.current) {
        return;
      }
      setAuctions((current) =>
        appendUniqueSoldAuctions(current, page.auctions),
      );
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
    } catch (loadError) {
      if (mountedRef.current && generation === requestGenerationRef.current) {
        setError(toLoadError(loadError));
      }
    } finally {
      loadingMoreRef.current = false;
      if (mountedRef.current && generation === requestGenerationRef.current) {
        setIsLoadingMore(false);
      }
    }
  };

  return (
    <div className="theme-app-shell min-h-screen">
      <header className="theme-surface-glass sticky top-0 z-30 border-b px-3 py-2.5 backdrop-blur-xl sm:px-6 sm:py-3">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3">
          <Link
            href="/feed"
            className="flex min-w-0 items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <img
              src="/ninety-nine-vintage-brand.jpg"
              alt=""
              width="48"
              height="48"
              className="size-10 shrink-0 rounded-xl object-cover"
            />
            <span className="min-w-0">
              <span className="block truncate text-[10px] font-black tracking-[0.14em] text-[var(--accent-text)] sm:text-xs">
                NINETY-NINE VINTAGE
              </span>
              <span className="block truncate text-base font-black text-[var(--text-strong)] sm:text-lg">
                판매 완료 보관함
              </span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <Link
              href="/feed"
              className="inline-flex min-h-10 items-center rounded-xl bg-[var(--accent)] px-3 text-sm font-black text-white sm:px-4"
            >
              경매 피드
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-3 pb-16 pt-5 sm:px-6 sm:pt-8 lg:px-8">
        <section
          className="theme-panel rounded-[1.6rem] border p-5 sm:rounded-[1.9rem] sm:p-7"
          aria-labelledby="sold-archive-title"
        >
          <p className="text-xs font-black tracking-[0.16em] text-[var(--accent-text)]">
            SOLD ARCHIVE
          </p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1
                id="sold-archive-title"
                className="text-2xl font-black tracking-[-0.04em] text-[var(--text-strong)] sm:text-3xl"
              >
                판매 완료 상품 전체보기
              </h1>
              <p className="mt-2 max-w-2xl break-keep text-sm font-bold leading-6 text-[var(--text-muted)] sm:text-base sm:leading-7">
                마감된 상품의 낙찰가와 공개 닉네임을 최근 순서대로 투명하게 확인할 수 있습니다.
              </p>
            </div>
            <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-sm font-black text-[var(--text-muted)]">
              불러온 상품 {auctions.length.toLocaleString("ko-KR")}건
            </span>
          </div>
        </section>

        {isLoading ? (
          <p
            role="status"
            className="theme-panel mt-4 rounded-2xl border p-7 text-center font-bold text-[var(--text-muted)]"
          >
            판매 완료 상품을 불러오는 중…
          </p>
        ) : error && auctions.length === 0 ? (
          <div className="theme-panel mt-4 rounded-2xl border p-7 text-center">
            <p role="alert" className="font-bold text-[var(--danger-text)]">
              {error}
            </p>
            <Button
              className="mt-4"
              variant="secondary"
              onClick={() => void loadFirstPage()}
            >
              다시 불러오기
            </Button>
          </div>
        ) : auctions.length === 0 ? (
          <p className="theme-panel mt-4 rounded-2xl border p-7 text-center font-bold text-[var(--text-muted)]">
            아직 판매 완료된 상품이 없습니다.
          </p>
        ) : (
          <>
            <div
              id="sold-archive-items"
              className="mt-4 grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3"
            >
              {auctions.map((auction) => (
                <SoldArchiveCard key={auction.productId} auction={auction} />
              ))}
            </div>

            {error ? (
              <p
                role="alert"
                className="theme-panel mx-auto mt-4 max-w-2xl rounded-2xl border px-4 py-3 text-center text-sm font-bold text-[var(--danger-text)]"
              >
                {error}
              </p>
            ) : null}

            {hasMore ? (
              <div className="mt-6 flex justify-center">
                <Button
                  variant="secondary"
                  aria-controls="sold-archive-items"
                  isLoading={isLoadingMore}
                  onClick={() => void loadMore()}
                >
                  {isLoadingMore ? "이전 판매 상품 불러오는 중…" : "판매 완료 더 보기"}
                </Button>
              </div>
            ) : (
              <p className="mt-6 text-center text-sm font-bold text-[var(--text-muted)]">
                모든 판매 완료 상품을 확인했습니다.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function SoldArchiveCard({ auction }: { auction: PublicSoldAuction }) {
  const imageUrl = auction.thumbnailUrls[0] || auction.imageUrls[0];

  return (
    <article className="theme-panel render-lazy overflow-hidden rounded-[1.5rem] border">
      <div className="aspect-[4/3] overflow-hidden bg-[var(--surface-muted)]">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`${auction.title} 판매 완료 상품`}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
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
            dateTime={auction.soldAt}
            className="text-xs font-bold text-[var(--text-muted)]"
          >
            {formatKoreanDate(new Date(auction.soldAt))}
          </time>
        </div>
        <h2 className="mt-3 line-clamp-2 text-lg font-black text-[var(--text-strong)]">
          {auction.title}
        </h2>
        <p className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-[var(--text-muted)]">
          {auction.description}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-[var(--surface-muted)] p-3">
          <div>
            <dt className="text-xs font-bold text-[var(--text-muted)]">낙찰가</dt>
            <dd className="mt-1 font-black text-[var(--accent-text)]">
              {formatKRW(auction.winningAmount)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-[var(--text-muted)]">낙찰자</dt>
            <dd className="mt-1 truncate font-black text-[var(--text-strong)]">
              {auction.winnerDisplayName}
            </dd>
          </div>
        </dl>
      </div>
    </article>
  );
}
