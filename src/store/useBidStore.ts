"use client";

import { create } from "zustand";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { BidHistoryEntry } from "@/types/detail";

interface BidStore {
  itemId: string | null;
  bids: BidHistoryEntry[];
  currentPrice: number;
  hydrate: (itemId: string, bids: BidHistoryEntry[], currentPrice: number) => void;
  replaceAuthoritative: (itemId: string, bids: BidHistoryEntry[], currentPrice: number) => void;
  addBid: (amount: number) => Promise<PlacedBidEntry>;
  receiveBid: (bid: BidHistoryEntry) => void;
}

export interface PlacedBidEntry extends BidHistoryEntry {
  bidLockedAt: string | null;
  currentPrice: number;
  finalBidId: string | null;
  isFinal: boolean;
  participantCount: number;
}

export const useBidStore = create<BidStore>((set, get) => ({
  itemId: null,
  bids: [],
  currentPrice: 0,
  hydrate: (itemId, bids, currentPrice) => {
    if (get().itemId === itemId && get().bids.length > 0) return;
    set({ itemId, bids, currentPrice });
  },
  replaceAuthoritative: (itemId, bids, currentPrice) => {
    set({ itemId, bids, currentPrice });
  },
  addBid: async (amount) => {
    const state = get();
    if (!state.itemId) throw new Error("입찰 상품을 확인하지 못했습니다.");

    const { data: sessionData } = await getSupabaseBrowserClient().auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error("로그인 후 입찰할 수 있습니다.");

    const response = await fetch("/api/auction/bids", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ productId: state.itemId, amount }),
    });
    const payload = (await response.json().catch(() => null)) as {
      bid?: {
        bidId: string;
        productId: string;
        bidderId: string;
        bidderDisplayName: string;
        amount: number;
        createdAt: string;
        bidLockedAt: string | null;
        currentPrice: number;
        finalBidId: string | null;
        isFinal: boolean;
        participantCount: number;
      };
      error?: string;
    } | null;
    if (!response.ok || !payload?.bid) {
      const message = payload?.error || "입찰을 저장하지 못했습니다.";
      if (message.includes("카카오 회원 로그인")) {
        throw new Error("현재 계정은 운영자 계정이거나 회원 프로필이 완성되지 않았습니다. 입찰은 카카오 회원 계정으로 이용해 주세요.");
      }
      throw new Error(message);
    }

    const newBid: PlacedBidEntry = {
      id: payload.bid.bidId,
      itemId: payload.bid.productId,
      bidderId: payload.bid.bidderId,
      bidderName: payload.bid.bidderDisplayName,
      bidderMaskedId: payload.bid.bidderDisplayName,
      amount: payload.bid.amount,
      createdAt: payload.bid.createdAt,
      outcome: "active",
      timeLabel: "방금 전",
      bidLockedAt: payload.bid.bidLockedAt,
      currentPrice: payload.bid.currentPrice,
      finalBidId: payload.bid.finalBidId,
      isFinal: payload.bid.isFinal,
      participantCount: payload.bid.participantCount,
    };
    set({ bids: [newBid, ...state.bids], currentPrice: payload.bid.currentPrice });
    return newBid;
  },
  receiveBid: (bid) => {
    const state = get();
    if (state.bids.some((existingBid) => existingBid.id === bid.id)) return;
    set({ bids: [bid, ...state.bids], currentPrice: Math.max(state.currentPrice, bid.amount) });
  },
}));
