"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, ThemeToggle } from "@/src/components/common";
import DeferredProductImage from "@/src/components/common/DeferredProductImage";
import { appendUniqueSoldAuctions } from "@/src/lib/soldArchivePagination";
import {
  fetchPublicSoldAuctionsPage,
  type PublicSoldAuction,
  type PublicSoldAuctionCursor,
} from "@/src/lib/supabase/auctionLifecycle";
import { getCatalogThumbnailUrl } from "@/src/utils/catalogImages";
import { formatKRW, formatKoreanDate } from "@/src/utils/formatters";

function toLoadError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "판매 완료 상품을 불러오지 못했습니다.";
}

function SoldArchiveSkeleton() {
  return (
    <article aria-hidden="true" className="bg-[var(--surface-raised)]">
      <div className="commerce-skeleton aspect-[4/3] rounded-none" />
      <div className="space-y-3 p-4">
        <div className="commerce-skeleton h-3 w-16 rounded-sm" />
        <div className="commerce-skeleton h-5 w-4/5 rounded-sm" />
        <div className="commerce-skeleton h-14 rounded-md" />
      </div>
    </article>
  );
}

function SoldArchiveEmptyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" fill="none" className="mx-auto h-11 w-11 text-[var(--text-muted)]">
      <path d="M7 10h18v16H7V10Zm4 0V8a5 5 0 0 1 10 0v2" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m12.5 18 2.2 2.2 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
            className="flex min-w-0 items-center gap-2.5 rounded-md transition-opacity duration-200 hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 검증된 로컬 브랜드 자산입니다. */}
            <img
              src="/ninety-nine-vintage-brand.jpg"
              alt=""
              width="48"
              height="48"
              className="size-9 shrink-0 object-cover sm:size-10"
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
              className="inline-flex min-h-10 items-center rounded-md bg-[var(--accent)] px-3 text-sm font-black text-[var(--accent-contrast)] transition-all duration-200 ease-out hover:scale-[1.02] hover:bg-[var(--accent-hover)] hover:shadow-md sm:px-4"
            >
              경매 피드
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-3 pb-16 pt-5 sm:px-6 sm:pt-8 lg:px-8">
        <section
          className="border-y border-[var(--border)] py-6 sm:py-8"
          aria-labelledby="sold-archive-title"
        >
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent-text)]">
            SOLD ARCHIVE
          </p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1
                id="sold-archive-title"
                className="text-3xl font-black tracking-[-0.05em] text-[var(--text-strong)] sm:text-4xl"
              >
                판매 완료 상품 전체보기
              </h1>
              <p className="mt-3 max-w-2xl break-keep text-sm font-medium leading-6 text-[var(--text-muted)] sm:text-[15px]">
                마감된 상품의 낙찰가와 공개 닉네임을 최근 순서대로 투명하게 확인할 수 있습니다.
              </p>
            </div>
            <span className="border-y border-[var(--border)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              LOADED <strong className="ml-1 font-mono text-sm font-black tabular-nums tracking-tight text-[var(--text-strong)]">{auctions.length.toLocaleString("ko-KR")}</strong>
            </span>
          </div>
        </section>

        {isLoading ? (
          <div role="status" className="mt-5">
            <span className="sr-only">판매 완료 상품을 불러오는 중…</span>
            <div className="grid grid-cols-1 gap-px overflow-hidden border border-[var(--border)] bg-[var(--border)] md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, index) => <SoldArchiveSkeleton key={index} />)}
            </div>
          </div>
        ) : error && auctions.length === 0 ? (
          <div className="mt-5 border border-[var(--danger-text)]/35 bg-[var(--danger-surface)] p-10 text-center">
            <p role="alert" className="font-bold text-[var(--danger-text)]">
              {error}
            </p>
            <Button
              className="mt-4 rounded-lg transition-all duration-200 ease-out hover:scale-[1.02]"
              variant="secondary"
              onClick={() => void loadFirstPage()}
            >
              다시 불러오기
            </Button>
          </div>
        ) : auctions.length === 0 ? (
          <div className="mt-5 border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)] p-14 text-center">
            <SoldArchiveEmptyIcon />
            <p className="mt-3 text-sm font-bold text-[var(--text-strong)]">아직 판매 완료된 상품이 없습니다.</p>
            <p className="mt-1 text-xs font-medium text-[var(--text-muted)]">첫 경매가 마감되면 투명한 낙찰 기록이 시작됩니다.</p>
          </div>
        ) : (
          <>
            <div
              id="sold-archive-items"
              className="mt-5 grid grid-cols-1 gap-px overflow-hidden border border-[var(--border)] bg-[var(--border)] md:grid-cols-2 xl:grid-cols-3"
            >
              {auctions.map((auction) => (
                <SoldArchiveCard key={auction.productId} auction={auction} />
              ))}
            </div>

            {error ? (
              <p
                role="alert"
                className="mx-auto mt-4 max-w-2xl border-l-2 border-[var(--danger-text)] bg-[var(--danger-surface)] px-4 py-3 text-center text-sm font-bold text-[var(--danger-text)]"
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
                  className="rounded-lg transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-md"
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
  const imageUrl = getCatalogThumbnailUrl(
    auction.thumbnailUrls[0],
    auction.imageUrls[0],
  );

  return (
    <article className="render-lazy group overflow-hidden bg-[var(--surface-raised)] transition-all duration-200 ease-out hover:relative hover:z-[1] hover:shadow-[var(--shadow-hover)]">
      <div className="aspect-[4/3] overflow-hidden bg-[var(--surface-muted)]">
        <DeferredProductImage
          key={imageUrl || auction.productId}
          src={imageUrl}
          alt={`${auction.title} 판매 완료 상품 이미지`}
          wrapperClassName="h-full w-full"
          className="h-full w-full object-cover group-hover:scale-[1.035]"
          emptyLabel="상품 미리보기를 준비하지 못함"
        />
      </div>
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="border border-[var(--success-text)]/25 bg-[var(--success-surface)] px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-[var(--success-text)]">
            판매 완료
          </span>
          <time
            dateTime={auction.soldAt}
            className="font-mono text-[10px] font-medium tabular-nums tracking-tight text-[var(--text-muted)]"
          >
            {formatKoreanDate(new Date(auction.soldAt))}
          </time>
        </div>
        <h2 className="mt-3 line-clamp-2 text-lg font-black tracking-[-0.025em] text-[var(--text-strong)]">
          {auction.title}
        </h2>
        <p className="mt-2 line-clamp-2 text-sm font-medium leading-6 text-[var(--text-muted)]">
          {auction.description}
        </p>
        <dl className="mt-4 grid grid-cols-2 divide-x divide-[var(--border)] border-y border-[var(--border)] py-3">
          <div>
            <dt className="px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">낙찰가</dt>
            <dd className="mt-1 px-3 font-mono text-sm font-black tabular-nums tracking-tight text-[var(--accent-text)]">
              {formatKRW(auction.winningAmount)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">낙찰자</dt>
            <dd className="mt-1 break-all px-3 text-sm font-black text-[var(--text-strong)]">
              {auction.winnerDisplayName}
            </dd>
          </div>
        </dl>
      </div>
    </article>
  );
}
