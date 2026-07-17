"use client";

import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { AuctionPost } from "@/src/types/auction";
import { getSupabaseBrowserClient } from "@/src/lib/supabase/client";
import { fetchPublishedProducts } from "@/src/lib/supabase/products";

export interface SupabaseProductsState {
  posts: AuctionPost[];
  setPosts: Dispatch<SetStateAction<AuctionPost[]>>;
  isLoading: boolean;
  error: string;
  refreshProducts: () => Promise<void>;
}

export function useSupabaseProducts(): SupabaseProductsState {
  const [posts, setPosts] = useState<AuctionPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadProducts = useCallback(async (showLoading: boolean) => {
    if (showLoading) setIsLoading(true);

    try {
      const nextPosts = await fetchPublishedProducts();
      setPosts(nextPosts);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "경매 상품을 불러오지 못했어요.",
      );
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, []);

  const refreshProducts = useCallback(
    () => loadProducts(true),
    [loadProducts],
  );

  useEffect(() => {
    let client;

    try {
      client = getSupabaseBrowserClient();
    } catch (configurationError) {
      const timer = window.setTimeout(() => {
        setError(
          configurationError instanceof Error
            ? configurationError.message
            : "Supabase 연결 정보를 확인해 주세요.",
        );
        setIsLoading(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    void loadProducts(true);

    const channel = client
      .channel("products-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        () => void loadProducts(false),
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError("상품 실시간 연결이 지연되고 있어요. 다시 시도해 주세요.");
        }
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [loadProducts]);

  return { posts, setPosts, isLoading, error, refreshProducts };
}
