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
  title?: string;
  description?: string;
}

export default function FeedList({
  posts,
  currentUserName,
  onBid,
  onInquiry,
  title = "날짜별 구제 의류 경매",
  description = "날짜별 상품을 빠르게 보고, 오후 8시 56분 신규 참여 제한 전에 여유 있게 입찰하세요.",
}: FeedListProps) {
  const [selectedDate, setSelectedDate] = useState("all");
  const auctionNow = useAuctionPolicyClock();
  const dateKeys = useMemo(
    () =>
      Array.from(
        new Set(posts.map((post) => getKoreanDateKey(post.createdAt))),
      ).sort((a, b) => b.localeCompare(a)),
    [posts],
  );
  const effectiveSelectedDate =
    selectedDate === "all" || dateKeys.includes(selectedDate)
      ? selectedDate
      : "all";
  const filteredPosts = useMemo(
    () =>
      effectiveSelectedDate === "all"
        ? posts
        : posts.filter(
            (post) => getKoreanDateKey(post.createdAt) === effectiveSelectedDate,
          ),
    [effectiveSelectedDate, posts],
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

      {filteredPosts.length > 0 ? (
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
