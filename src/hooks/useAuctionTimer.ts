"use client";

import { useAuctionPolicyClock } from "@/hooks/useAuctionPolicyClock";
import {
  getAuctionTimerState,
  type AuctionTimerState,
} from "@/utils/auctionTimer";

export { getAuctionTimerState } from "@/utils/auctionTimer";
export type { AuctionTimerState } from "@/utils/auctionTimer";

export function useAuctionTimer(): AuctionTimerState {
  return getAuctionTimerState(useAuctionPolicyClock());
}
