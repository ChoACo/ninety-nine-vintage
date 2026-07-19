"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFeedCatalogState } from "@/src/hooks/useFeedCatalogState";
import { useAuctionPolicyMinuteClock } from "@/src/hooks/useAuctionPolicyClock";
import type { AuctionPost } from "@/src/types/auction";
import { getAuctionBidDecision } from "@/src/utils/auctionBidPolicy";
import {
  matchesCatalogSearch,
  matchesCatalogSize,
  sortCatalogPosts,
  type CatalogSize,
  type CatalogSort,
} from "@/src/utils/catalogFilters";
import DateFilterChips, { getKoreanDateKey } from "./DateFilterChips";
import FeedProductControlModal, {
  type FeedProductControlAction,
} from "./FeedProductControlModal";
import PostCard, {
  type BidHandler,
  type InquiryHandler,
} from "./PostCard";

const INITIAL_VISIBLE_POSTS = 8;
const VISIBLE_POST_STEP = 8;

export interface FeedListProps {
  posts: AuctionPost[];
  currentUserName: string;
  currentUserId?: string | null;
  onBid?: BidHandler;
  onInquiry: InquiryHandler;
  isLoading?: boolean;
  hasMoreProducts?: boolean;
  isLoadingMore?: boolean;
  loadError?: string;
  onRetry?: () => void | Promise<void>;
  onLoadMore?: () => void | Promise<void>;
  title?: string;
  description?: string;
  showOperatorControls?: boolean;
  onDeleteProduct?: (post: AuctionPost) => void | Promise<void>;
}

function FeedSkeleton() {
  return (
    <article
      aria-hidden="true"
      className="overflow-hidden border border-[var(--border)] bg-[var(--surface-raised)]"
    >
      <div className="commerce-skeleton aspect-[4/3] rounded-none" />
      <div className="space-y-3 p-4">
        <div className="commerce-skeleton h-3 w-20 rounded-sm" />
        <div className="commerce-skeleton h-5 w-4/5 rounded-sm" />
        <div className="commerce-skeleton h-4 w-3/5 rounded-sm" />
        <div className="commerce-skeleton mt-5 h-12 rounded-lg" />
      </div>
    </article>
  );
}

function EmptyRackIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 48 48"
      fill="none"
      className="mx-auto h-11 w-11 text-[var(--text-muted)]"
    >
      <path
        d="M24 9a5 5 0 0 1 5 5c0 3.5-5 4-5 7M8 34l16-10 16 10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 35h24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function FeedList({
  posts,
  currentUserName,
  currentUserId,
  onBid,
  onInquiry,
  isLoading = false,
  hasMoreProducts = false,
  isLoadingMore = false,
  loadError = "",
  onRetry,
  onLoadMore,
  title = "날짜별 구제 의류 경매",
  description = "날짜별 상품을 빠르게 보고, 오후 8시 56분 신규 참여 제한 전에 여유 있게 입찰하세요.",
  showOperatorControls = false,
  onDeleteProduct,
}: FeedListProps) {
  const [pendingControl, setPendingControl] = useState<{
    post: AuctionPost;
    action: FeedProductControlAction;
  } | null>(null);
  const [isDeletingProduct, setIsDeletingProduct] = useState(false);
  const [productControlError, setProductControlError] = useState("");
  const fullCatalogLoadAttemptRef = useRef(-1);
  const {
    query,
    selectedDate,
    sort,
    size,
    visibleCount,
    showTopButton,
    restorationMinHeight,
    feedRootRef,
    setQuery,
    setSelectedDate,
    setSort,
    setSize,
    showMore,
    resetCatalog,
    scrollToTop,
  } = useFeedCatalogState({
    initialVisibleCount: INITIAL_VISIBLE_POSTS,
    visibleStep: VISIBLE_POST_STEP,
    loadedProductCount: posts.length,
    isLoading,
    hasMoreProducts,
    isLoadingMore,
    onLoadMore,
  });
  // Catalog filtering only needs minute boundaries. The header countdown keeps
  // its precise shared second clock without re-rendering 100+ feed cards.
  const auctionNow = useAuctionPolicyMinuteClock();
  const publishedPosts = useMemo(
    () =>
      posts.filter((post) => {
        if (post.status !== "active") return false;
        const publishTime = Date.parse(post.publish_at ?? post.createdAt);
        return (
          Number.isFinite(publishTime) && publishTime <= auctionNow.getTime()
        );
      }),
    [auctionNow, posts],
  );
  const dateKeys = useMemo(
    () =>
      Array.from(
        new Set(
          publishedPosts.map((post) =>
            getKoreanDateKey(post.publish_at ?? post.createdAt),
          ),
        ),
      ).sort((a, b) => b.localeCompare(a)),
    [publishedPosts],
  );
  const effectiveSelectedDate =
    selectedDate === "all" || dateKeys.includes(selectedDate)
      ? selectedDate
      : "all";
  const filteredPosts = useMemo(() => {
    const dateFiltered =
      effectiveSelectedDate === "all"
        ? publishedPosts
        : publishedPosts.filter(
            (post) =>
              getKoreanDateKey(post.publish_at ?? post.createdAt) ===
              effectiveSelectedDate,
          );
    const refined = dateFiltered.filter(
      (post) =>
        matchesCatalogSize(post, size) &&
        matchesCatalogSearch(post, query),
    );
    return sortCatalogPosts(refined, sort);
  }, [
    query,
    size,
    sort,
    effectiveSelectedDate,
    publishedPosts,
  ]);
  const availableCount = filteredPosts.filter(
    (post) =>
      getAuctionBidDecision({ post, currentUserName, now: auctionNow }).allowed,
  ).length;
  const visiblePosts = filteredPosts.slice(0, visibleCount);
  const hiddenPostCount = Math.max(filteredPosts.length - visiblePosts.length, 0);

  const selectDate = (dateKey: string) => {
    setSelectedDate(dateKey);
  };

  const needsCompleteCatalog =
    query.trim().length > 0 ||
    size !== "all" ||
    sort !== "latest" ||
    selectedDate !== "all";

  useEffect(() => {
    if (isLoading) fullCatalogLoadAttemptRef.current = -1;
  }, [isLoading]);

  useEffect(() => {
    if (
      !needsCompleteCatalog ||
      !hasMoreProducts ||
      isLoading ||
      isLoadingMore ||
      Boolean(loadError) ||
      !onLoadMore ||
      fullCatalogLoadAttemptRef.current === posts.length
    ) {
      return;
    }

    fullCatalogLoadAttemptRef.current = posts.length;
    void onLoadMore();
  }, [
    hasMoreProducts,
    isLoading,
    isLoadingMore,
    loadError,
    needsCompleteCatalog,
    onLoadMore,
    posts.length,
  ]);

  const showMorePosts = async () => {
    if (
      hasMoreProducts &&
      hiddenPostCount <= VISIBLE_POST_STEP &&
      onLoadMore
    ) {
      await onLoadMore();
    }
    showMore();
  };

  const confirmDeleteProduct = async () => {
    if (
      pendingControl?.action !== "delete" ||
      !onDeleteProduct ||
      isDeletingProduct
    ) {
      return;
    }

    setIsDeletingProduct(true);
    setProductControlError("");
    try {
      await onDeleteProduct(pendingControl.post);
      setPendingControl(null);
    } catch (error) {
      setProductControlError(
        error instanceof Error
          ? error.message
          : "상품을 삭제하지 못했습니다. 서버 보호 정책을 확인해 주세요.",
      );
    } finally {
      setIsDeletingProduct(false);
    }
  };

  return (
    <section
      ref={feedRootRef}
      aria-labelledby="auction-feed-title"
      className="min-w-0"
      style={
        restorationMinHeight
          ? { minHeight: `${restorationMinHeight}px` }
          : undefined
      }
    >
      <div className="mb-5 flex flex-col gap-4 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--accent-text)]">
            Daily auction edit
          </p>
          <h2
            id="auction-feed-title"
            className="mt-1.5 text-[1.65rem] font-black tracking-[-0.045em] text-[var(--text-strong)] sm:text-[2rem]"
          >
            {title}
          </h2>
          <p className="mt-2 max-w-2xl break-keep text-sm font-medium leading-6 text-[var(--text-muted)] sm:text-[15px]">
            {description}
          </p>
        </div>
        <div className="flex shrink-0 divide-x divide-[var(--border)] border-y border-[var(--border)] py-2">
          <span className="px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            LOTS <strong className="ml-1 font-mono text-sm font-black tabular-nums tracking-tight text-[var(--text-strong)]">{filteredPosts.length}</strong>
          </span>
          <span className="px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            OPEN <strong className="ml-1 font-mono text-sm font-black tabular-nums tracking-tight text-[var(--accent-text)]">{availableCount}</strong>
          </span>
        </div>
      </div>

      <div className="mb-4 grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 shadow-sm sm:p-4 lg:grid-cols-[minmax(15rem,1fr)_auto] lg:items-end">
        <label className="block min-w-0">
          <span className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Catalog search
          </span>
          <span className="mt-1.5 flex min-h-11 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--input-surface)] px-3 transition-colors focus-within:border-[var(--accent)]">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-4 shrink-0 text-[var(--text-muted)]"><path d="m20 20-4.6-4.6M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="상품명·설명·사이즈 검색"
              maxLength={80}
              className="min-w-0 flex-1 bg-transparent text-sm font-bold text-[var(--text-strong)] outline-none placeholder:text-[var(--text-muted)]"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="검색어 지우기"
                className="grid min-h-9 min-w-9 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text-strong)]"
              >
                ×
              </button>
            ) : null}
          </span>
        </label>

        <button
          type="button"
          onClick={resetCatalog}
          className="min-h-11 rounded-lg border border-[var(--border)] px-4 text-xs font-black text-[var(--text-muted)] transition-all duration-200 hover:border-[var(--text-strong)] hover:text-[var(--text-strong)] active:scale-[0.98]"
        >
          검색·필터 초기화
        </button>
      </div>

      <div className="mb-4 space-y-3 border-b border-[var(--border)] pb-4">
        <div className="overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex min-w-max items-center gap-2" role="group" aria-label="경매 상품 정렬">
            {(
              [
                ["latest", "최신 등록순"],
                ["closing", "🔥 마감 임박순"],
                ["price-desc", "💰 현재가 높은순"],
                ["price-asc", "현재가 낮은순"],
              ] as const satisfies readonly (readonly [CatalogSort, string])[]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={sort === value}
                onClick={() => setSort(value)}
                className={`min-h-10 rounded-full border px-3.5 text-xs font-black transition-all duration-200 active:scale-[0.98] ${
                  sort === value
                    ? "border-[var(--text-strong)] bg-[var(--text-strong)] text-[var(--surface)] shadow-sm"
                    : "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)] hover:border-[var(--text-strong)] hover:text-[var(--text-strong)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="의류 사이즈 필터">
          <span className="mr-1 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Size
          </span>
          {(["all", "S", "M", "L", "XL"] as const satisfies readonly CatalogSize[]).map((sizeOption) => (
            <button
              key={sizeOption}
              type="button"
              aria-pressed={size === sizeOption}
              onClick={() => setSize(sizeOption)}
              className={`min-h-10 min-w-10 rounded-md border px-3 font-mono text-xs font-black tabular-nums transition-all duration-200 active:scale-[0.97] ${
                size === sizeOption
                  ? "border-[var(--accent)] bg-[var(--accent-surface)] text-[var(--accent-text)]"
                  : "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)] hover:border-[var(--text-strong)] hover:text-[var(--text-strong)]"
              }`}
            >
              {sizeOption === "all" ? "ALL" : sizeOption}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5 border-b border-[var(--border)] pb-3">
        <DateFilterChips
          dateKeys={dateKeys}
          selectedDate={effectiveSelectedDate}
          onSelect={selectDate}
        />
      </div>

      {needsCompleteCatalog && hasMoreProducts && !loadError ? (
        <p
          role="status"
          className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--info-border)] bg-[var(--info-surface)] px-3 py-2 text-xs font-bold text-[var(--info-text)]"
        >
          <span className="size-3 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
          전체 상품을 불러와 검색·정렬 결과를 정확히 맞추는 중…
        </p>
      ) : null}

      {loadError && publishedPosts.length > 0 ? (
        <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 border-l-2 border-[var(--danger-text)] bg-[var(--danger-surface)] px-4 py-3 text-sm font-semibold text-[var(--danger-text)]">
          <p>{loadError} 기존에 불러온 상품을 표시하고 있어요.</p>
          {onRetry ? (
            <button
              type="button"
              onClick={() => {
                fullCatalogLoadAttemptRef.current = -1;
                void onRetry();
              }}
              className="min-h-9 rounded-md border border-current px-3 text-xs font-black transition-transform active:scale-[0.97]"
            >
              다시 연결
            </button>
          ) : null}
        </div>
      ) : null}

      {isLoading && publishedPosts.length === 0 ? (
        <div role="status">
          <span className="sr-only">Supabase에서 경매 상품을 불러오는 중이에요.</span>
          <div className="grid grid-cols-2 gap-3.5 bg-transparent sm:gap-px sm:overflow-hidden sm:border sm:border-[var(--border)] sm:bg-[var(--border)] 2xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <FeedSkeleton key={index} />
            ))}
          </div>
        </div>
      ) : loadError && publishedPosts.length === 0 ? (
        <div
          role="alert"
          className="border border-[var(--danger-text)]/35 bg-[var(--danger-surface)] px-6 py-12 text-center"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="mx-auto h-9 w-9 text-[var(--danger-text)]"><path d="M12 8v5m0 3.5v.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
          <h3 className="mt-3 text-lg font-black tracking-[-0.02em] text-[var(--danger-text)]">
            상품 목록을 연결하지 못했어요
          </h3>
          <p className="mx-auto mt-2 max-w-xl break-keep text-sm font-medium leading-6 text-[var(--text-muted)]">
            {loadError}
          </p>
          {onRetry ? (
            <button
              type="button"
              onClick={() => void onRetry()}
              className="mt-5 min-h-10 rounded-lg bg-[var(--text-strong)] px-5 text-sm font-bold text-[var(--surface)] transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              다시 불러오기
            </button>
          ) : null}
        </div>
      ) : needsCompleteCatalog && hasMoreProducts && filteredPosts.length === 0 ? (
        <div role="status" className="grid grid-cols-2 gap-3.5 sm:gap-px sm:overflow-hidden sm:border sm:border-[var(--border)] sm:bg-[var(--border)] 2xl:grid-cols-3">
          {Array.from({ length: 4 }, (_, index) => <FeedSkeleton key={index} />)}
        </div>
      ) : filteredPosts.length > 0 ? (
        <>
        <div
          id="auction-feed-items"
          className="grid grid-cols-2 items-stretch gap-3.5 bg-transparent sm:gap-px sm:overflow-hidden sm:border sm:border-[var(--border)] sm:bg-[var(--border)] 2xl:grid-cols-3"
        >
          {visiblePosts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserName={currentUserName}
              currentUserId={currentUserId}
              auctionNow={auctionNow}
              onBid={onBid}
              onInquiry={onInquiry}
              showOperatorControls={showOperatorControls}
              onRequestProductControl={(selectedPost, action) => {
                setProductControlError("");
                setPendingControl({ post: selectedPost, action });
              }}
            />
          ))}
        </div>
        {hiddenPostCount > 0 || hasMoreProducts ? (
          <div className="mt-7 flex justify-center">
            <button
              type="button"
              aria-controls="auction-feed-items"
              disabled={isLoadingMore}
              onClick={() => void showMorePosts()}
              className="min-h-10 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] px-5 text-sm font-bold text-[var(--text-strong)] transition-all duration-200 ease-out hover:scale-[1.02] hover:border-[var(--text-strong)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-wait disabled:opacity-60"
            >
              {isLoadingMore
                ? "추가 상품 불러오는 중…"
                : hiddenPostCount > 0
                  ? `상품 더 보기 · ${hiddenPostCount.toLocaleString("ko-KR")}${hasMoreProducts ? "+" : ""}개 남음`
                  : "추가 상품 불러오기"}
            </button>
          </div>
        ) : null}
        </>
      ) : (
        <div className="border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)] px-6 py-16 text-center">
          <EmptyRackIcon />
          <h3 className="mt-4 text-lg font-black tracking-[-0.02em] text-[var(--text-strong)]">
            이 날짜에 등록된 상품이 없어요
          </h3>
          <p className="mt-1.5 text-sm font-medium text-[var(--text-muted)]">
            검색어나 날짜·사이즈 필터를 바꾸거나 전체보기를 눌러 주세요.
          </p>
        </div>
      )}

      {showTopButton && typeof document !== "undefined" ? createPortal(
        <button
          type="button"
          onClick={scrollToTop}
          aria-label="페이지 맨 위로 이동"
          className="fixed bottom-[calc(10rem+env(safe-area-inset-bottom))] right-3 z-50 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)]/95 px-3.5 font-mono text-[11px] font-black tabular-nums text-[var(--text-strong)] shadow-[0_14px_36px_rgba(0,0,0,0.24)] backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--text-strong)] active:scale-[0.96] md:bottom-24 md:right-6"
        >
          <span aria-hidden="true">↑</span> TOP
        </button>,
        document.body,
      )
      : null}

      {pendingControl ? (
        <FeedProductControlModal
          action={pendingControl.action}
          post={pendingControl.post}
          isSubmitting={isDeletingProduct}
          error={productControlError}
          onClose={() => {
            if (isDeletingProduct) return;
            setPendingControl(null);
            setProductControlError("");
          }}
          onConfirmDelete={confirmDeleteProduct}
        />
      ) : null}
    </section>
  );
}
