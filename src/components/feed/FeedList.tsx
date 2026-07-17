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

export interface FeedListProps {
  posts: AuctionPost[];
  currentUserName: string;
  onBid?: BidHandler;
  onInquiry: InquiryHandler;
  isLoading?: boolean;
  loadError?: string;
  onRetry?: () => void | Promise<void>;
  title?: string;
  description?: string;
}

export default function FeedList({
  posts,
  currentUserName,
  onBid,
  onInquiry,
  isLoading = false,
  loadError = "",
  onRetry,
  title = "날짜별 구제 의류 경매",
  description = "날짜별 상품을 빠르게 보고, 오후 8시 56분 신규 참여 제한 전에 여유 있게 입찰하세요.",
}: FeedListProps) {
  const [selectedDate, setSelectedDate] = useState("all");
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

  return (
    <section aria-labelledby="auction-feed-title">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-black tracking-[0.16em] text-[#b65343]">
            DAILY CURATION
          </p>
          <h2
            id="auction-feed-title"
            className="mt-1 text-3xl font-black tracking-[-0.04em] text-[#342c27] sm:text-4xl"
          >
            {title}
          </h2>
          <p className="mt-2 max-w-2xl break-keep text-base font-medium leading-7 text-[#67584f] sm:text-[17px]">
            {description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-[#e7f3f5] px-3.5 py-2 text-sm font-black text-[#416b76]">
            상품 {filteredPosts.length}건
          </span>
          <span className="rounded-full bg-[#ffe3d9] px-3.5 py-2 text-sm font-black text-[#a24033]">
            입찰 가능 {availableCount}건
          </span>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border border-[#ead9cb] bg-white/55 p-2.5 sm:p-3">
        <DateFilterChips
          dateKeys={dateKeys}
          selectedDate={effectiveSelectedDate}
          onSelect={setSelectedDate}
        />
      </div>

      {loadError && publishedPosts.length > 0 ? (
        <p
          role="status"
          className="mb-4 rounded-2xl border border-[#edc2b5] bg-[#fff3ed] px-4 py-3 text-sm font-bold text-[#805044]"
        >
          {loadError} 기존에 불러온 상품을 표시하고 있어요.
        </p>
      ) : null}

      {isLoading && publishedPosts.length === 0 ? (
        <div
          role="status"
          className="flex min-h-44 items-center justify-center gap-3 rounded-[1.5rem] border border-[#ead9cb] bg-[#fffaf4] px-6 py-12 text-center text-base font-black text-[#68564c]"
        >
          <span
            aria-hidden="true"
            className="h-6 w-6 animate-spin rounded-full border-2 border-[#e6cfc0] border-t-[#df6f5d]"
          />
          Supabase에서 경매 상품을 불러오는 중이에요.
        </div>
      ) : loadError && publishedPosts.length === 0 ? (
        <div
          role="alert"
          className="rounded-[1.5rem] border border-[#edc2b5] bg-[#fff3ed] px-6 py-10 text-center"
        >
          <h3 className="text-lg font-black text-[#8f4035]">
            상품 목록을 연결하지 못했어요
          </h3>
          <p className="mx-auto mt-2 max-w-xl break-keep text-sm font-semibold leading-6 text-[#805f54]">
            {loadError}
          </p>
          {onRetry ? (
            <button
              type="button"
              onClick={() => void onRetry()}
              className="mt-5 min-h-11 rounded-full bg-[#df6f5d] px-5 text-sm font-black text-white transition hover:bg-[#c95b4b] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#df6f5d]/20"
            >
              다시 불러오기
            </button>
          ) : null}
        </div>
      ) : filteredPosts.length > 0 ? (
        <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredPosts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserName={currentUserName}
              auctionNow={auctionNow}
              onBid={onBid}
              onInquiry={onInquiry}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-[1.5rem] border border-dashed border-[#dfcdbc] bg-[#fff9f2] px-6 py-14 text-center">
          <span aria-hidden="true" className="text-4xl text-[#c8aa96]">
            ◇
          </span>
          <h3 className="mt-3 text-lg font-black text-[#54463e]">
            이 날짜에 등록된 상품이 없어요
          </h3>
          <p className="mt-1 text-base text-[#89776b]">
            다른 날짜 버튼이나 전체보기를 눌러 주세요.
          </p>
        </div>
      )}
    </section>
  );
}
