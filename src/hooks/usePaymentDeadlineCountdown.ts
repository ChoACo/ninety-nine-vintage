"use client";

import { useMemo } from "react";

import { useAuctionPolicyClock } from "@/src/hooks/useAuctionPolicyClock";
import type { CountdownParts, WonAuction } from "@/src/types/auction";
import { getCountdown } from "@/src/utils/formatters";

export interface PaymentDeadlineCountdownState {
  deadline: Date | null;
  countdown: CountdownParts;
  isClockReady: boolean;
}

function getFallbackDeadline(closedAt: string): Date | null {
  const closedDate = new Date(closedAt);
  if (Number.isNaN(closedDate.getTime())) return null;

  const deadline = new Date(closedDate);
  deadline.setDate(deadline.getDate() + 1);
  deadline.setHours(11, 59, 59, 999);
  return deadline;
}

function getAuctionPaymentDeadline(auction: WonAuction): Date | null {
  if (auction.paymentDeadlineAt) {
    const explicitDeadline = new Date(auction.paymentDeadlineAt);
    if (!Number.isNaN(explicitDeadline.getTime())) return explicitDeadline;
  }

  return getFallbackDeadline(auction.closedAt);
}

/**
 * 입금 대기 상품 중 가장 이른 마감 시각을 실시간으로 계산합니다.
 * 상품 수가 늘어도 앱 전역의 1초짜리 공유 시계만 사용합니다.
 */
export function usePaymentDeadlineCountdown(
  auctions: readonly WonAuction[],
): PaymentDeadlineCountdownState {
  const currentTime = useAuctionPolicyClock();

  const deadline = useMemo(() => {
    const timestamps = auctions
      .map(getAuctionPaymentDeadline)
      .filter((value): value is Date => value !== null)
      .map((value) => value.getTime());

    if (timestamps.length === 0) return null;
    return new Date(Math.min(...timestamps));
  }, [auctions]);

  const isClockReady = currentTime.getTime() !== 0;
  const countdown = getCountdown(deadline ?? currentTime, currentTime);

  return { deadline, countdown, isClockReady };
}

