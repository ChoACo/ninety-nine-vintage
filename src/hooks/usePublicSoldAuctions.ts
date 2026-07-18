"use client";

import { useCallback, useEffect, useState } from "react";

import {
  fetchPublicSoldAuctions,
  type PublicSoldAuction,
} from "@/src/lib/supabase/auctionLifecycle";
import { getSupabaseBrowserClient } from "@/src/lib/supabase/client";
import { createRealtimeChannelName } from "@/src/lib/supabase/realtime";

export interface PublicSoldAuctionsState {
  auctions: PublicSoldAuction[];
  isLoading: boolean;
  error: string;
  refresh: () => Promise<void>;
}

export function usePublicSoldAuctions(): PublicSoldAuctionsState {
  const [auctions, setAuctions] = useState<PublicSoldAuction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (showLoading: boolean) => {
    if (showLoading) setIsLoading(true);
    try {
      setAuctions(await fetchPublicSoldAuctions({ limit: 30 }));
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "판매 완료 상품을 불러오지 못했습니다.",
      );
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let client;
    try {
      client = getSupabaseBrowserClient();
    } catch (configurationError) {
      const timer = window.setTimeout(() => {
        setError(
          configurationError instanceof Error
            ? configurationError.message
            : "판매 완료 상품 연결 정보를 확인해 주세요.",
        );
        setIsLoading(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    void load(true);
    const channel = client
      .channel(createRealtimeChannelName("public-sold-auctions"))
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "products" },
        () => void load(false),
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [load]);

  return {
    auctions,
    isLoading,
    error,
    refresh: useCallback(() => load(true), [load]),
  };
}
