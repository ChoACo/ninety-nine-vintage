"use client";

import { useMemo, useState } from "react";
import { useAuctionPolicyClock } from "@/src/hooks/useAuctionPolicyClock";
import type { AuctionPost } from "@/src/types/auction";
import { getAuctionBidDecision } from "@/src/utils/auctionBidPolicy";
import DateFilterChips, { getKoreanDateKey } from "./DateFilterChips";
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
}: FeedListProps) {
  const [selectedDate, setSelectedDate] = useState("all");
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_POSTS);
  // A single shared one-second store keeps every anti-sniping deadline exact
  // without creating one interval per product card.
  const auctionNow = useAuctionPolicyClock();
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
  const filteredPosts = useMemo(
    () =>
      effectiveSelectedDate === "all"
        ? publishedPosts
        : publishedPosts.filter(
            (post) =>
              getKoreanDateKey(post.publish_at ?? post.createdAt) ===
              effectiveSelectedDate,
          ),
    [effectiveSelectedDate, publishedPosts],
  );
  const availableCount = filteredPosts.filter(
    (post) =>
      getAuctionBidDecision({ post, currentUserName, now: auctionNow }).allowed,
  ).length;
  const visiblePosts = filteredPosts.slice(0, visibleCount);
  const hiddenPostCount = Math.max(filteredPosts.length - visiblePosts.length, 0);

  const selectDate = (dateKey: string) => {
    setSelectedDate(dateKey);
    setVisibleCount(INITIAL_VISIBLE_POSTS);
  };

  const showMorePosts = async () => {
    if (
      hasMoreProducts &&
      hiddenPostCount <= VISIBLE_POST_STEP &&
      onLoadMore
    ) {
      await onLoadMore();
    }
    setVisibleCount((current) => current + VISIBLE_POST_STEP);
  };

  return (
    <section aria-labelledby="auction-feed-title" className="min-w-0">
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

      <div className="mb-5 border-b border-[var(--border)] pb-3">
        <DateFilterChips
          dateKeys={dateKeys}
          selectedDate={effectiveSelectedDate}
          onSelect={selectDate}
        />
      </div>

      {loadError && publishedPosts.length > 0 ? (
        <p
          role="status"
          className="mb-5 border-l-2 border-[var(--danger-text)] bg-[var(--danger-surface)] px-4 py-3 text-sm font-semibold text-[var(--danger-text)]"
        >
          {loadError} 기존에 불러온 상품을 표시하고 있어요.
        </p>
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
            다른 날짜 버튼이나 전체보기를 눌러 주세요.
          </p>
        </div>
      )}
    </section>
  );
}
