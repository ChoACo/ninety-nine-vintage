"use client";

import { useMemo } from "react";

import { useAuctionPolicyClock } from "@/src/hooks/useAuctionPolicyClock";
import type { CountdownParts } from "@/src/types/auction";
import {
  getCountdown,
  getNextAuctionDeadline,
  getTodayAuctionDeadline,
} from "@/src/utils/formatters";

export interface UseAuctionClockOptions {
  /** true면 오늘 마감 후 다음 날 오후 9시로 자동 전환합니다. */
  rollover?: boolean;
}

export interface AuctionClockState {
  currentTime: Date;
  deadline: Date;
  countdown: CountdownParts;
}

export function useAuctionClock({
  rollover = false,
}: UseAuctionClockOptions = {}): AuctionClockState {
  const currentTime = useAuctionPolicyClock();

  return useMemo(() => {
    const deadline = rollover
      ? getNextAuctionDeadline(currentTime)
      : getTodayAuctionDeadline(currentTime);

    return {
      currentTime,
      deadline,
      countdown: getCountdown(deadline, currentTime),
    };
  }, [currentTime, rollover]);
}
