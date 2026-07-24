"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useAccountAuctionBids } from "@/components/features/auction/AuctionBidSummary";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";

interface ActiveBidNavigationValue {
  hasActiveBid: boolean;
  loading: boolean;
}

const ActiveBidNavigationContext =
  createContext<ActiveBidNavigationValue>({
    hasActiveBid: false,
    loading: true,
  });

export function ActiveBidNavigationProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const snapshot = useAccountAuctionBids(LIVE_AUCTION_ENABLED);
  const value = useMemo(
    () => ({
      hasActiveBid:
        snapshot.capability === "eligible_member" &&
        snapshot.items.some((item) => item.productStatus === "active"),
      loading: snapshot.loading,
    }),
    [snapshot.capability, snapshot.items, snapshot.loading],
  );

  return (
    <ActiveBidNavigationContext.Provider value={value}>
      {children}
    </ActiveBidNavigationContext.Provider>
  );
}

export function useActiveBidNavigation() {
  return useContext(ActiveBidNavigationContext);
}
