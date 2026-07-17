"use client";

import { useEffect, useRef } from "react";
import type { AuctionPost } from "@/src/types/auction";
import { getUserBidStatus } from "@/src/utils/bidStatus";
import { QUICK_BID_INCREMENT } from "@/src/utils/bidding";

const MOCK_EXTERNAL_BIDDERS = [
  "김민수",
  "이선영",
  "박정진",
  "최은희",
  "정미자",
  "한경숙",
] as const;

export interface UseMockLiveBidsOptions {
  posts: readonly AuctionPost[];
  currentUserName: string;
  onExternalBid: (
    postId: string,
    bidderName: string,
    amount: number,
  ) => void | Promise<void>;
  /** 자동 외부 입찰 간격. 기본값은 22초입니다. */
  intervalMs?: number;
  enabled?: boolean;
}

/**
 * 데모에서만 사용하는 외부 입찰 시뮬레이터입니다.
 *
 * 현재 사용자가 최고가인 판매 중 상품 하나를 골라 Mock 회원이 1,000원 더
 * 입찰하도록 부모 상태 갱신 콜백을 호출합니다. 실제 서비스에서는 이 훅 대신
 * 서버의 실시간 구독(WebSocket/Firebase listener)을 연결해야 합니다.
 */
export default function useMockLiveBids({
  posts,
  currentUserName,
  onExternalBid,
  intervalMs = 22_000,
  enabled = true,
}: UseMockLiveBidsOptions): void {
  const postsRef = useRef(posts);
  const callbackRef = useRef(onExternalBid);
  const bidderCursorRef = useRef(0);
  const postCursorRef = useRef(0);

  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  useEffect(() => {
    callbackRef.current = onExternalBid;
  }, [onExternalBid]);

  useEffect(() => {
    if (!enabled || !currentUserName) return;

    const timerId = window.setInterval(() => {
      if (document.hidden) return;

      const userLeadingPosts = postsRef.current.filter(
        (post) =>
          post.status === "active" &&
          getUserBidStatus(post, currentUserName) === "user-leading",
      );

      if (userLeadingPosts.length === 0) return;

      const target =
        userLeadingPosts[postCursorRef.current % userLeadingPosts.length];
      postCursorRef.current += 1;

      const eligibleBidders = MOCK_EXTERNAL_BIDDERS.filter(
        (bidder) => bidder !== currentUserName,
      );
      const bidder =
        eligibleBidders[bidderCursorRef.current % eligibleBidders.length];
      bidderCursorRef.current += 1;

      // TODO: DB 연동 시 부모의 Mock 갱신 대신 서버 실시간 입찰 이벤트를 구독합니다.
      void callbackRef.current(
        target.id,
        bidder,
        target.currentPrice + QUICK_BID_INCREMENT,
      );
    }, Math.max(intervalMs, 5_000));

    return () => window.clearInterval(timerId);
  }, [currentUserName, enabled, intervalMs]);
}

