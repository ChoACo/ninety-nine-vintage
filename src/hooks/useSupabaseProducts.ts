"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { AuctionPost } from "@/src/types/auction";
import { getSupabaseBrowserClient } from "@/src/lib/supabase/client";
import { fetchPublishedProductsPage } from "@/src/lib/supabase/products";
import { createRealtimeChannelName } from "@/src/lib/supabase/realtime";

const REALTIME_REFETCH_DEBOUNCE_MS = 160;

export interface SupabaseProductsState {
  posts: AuctionPost[];
  setPosts: Dispatch<SetStateAction<AuctionPost[]>>;
  isLoading: boolean;
  hasMoreProducts: boolean;
  isLoadingMore: boolean;
  error: string;
  refreshProducts: () => Promise<void>;
  loadMoreProducts: () => Promise<void>;
}

interface UseSupabaseProductsOptions {
  enabled?: boolean;
}

export function useSupabaseProducts({
  enabled = true,
}: UseSupabaseProductsOptions = {}): SupabaseProductsState {
  const [posts, setPosts] = useState<AuctionPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasMoreProducts, setHasMoreProducts] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const enabledRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const activeRequestRef = useRef<Promise<void> | null>(null);
  const realtimeTimerRef = useRef<number | null>(null);
  const realtimeRefreshQueuedRef = useRef(false);
  const hasMoreProductsRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const nextPageRef = useRef(1);
  const pageSnapshotRef = useRef<Date | null>(null);

  const loadProducts = useCallback((showLoading: boolean) => {
    if (!enabledRef.current) return Promise.resolve();

    const requestGeneration = ++requestGenerationRef.current;
    const pageSnapshot = new Date();
    // Realtime updates must not collapse a deeply explored catalog back to the
    // first 24 rows. Re-fetch the same number of pages with one shared snapshot.
    const requestedPageCount = Math.max(nextPageRef.current, 1);
    isLoadingMoreRef.current = false;
    setIsLoadingMore(false);
    if (showLoading) setIsLoading(true);

    const request = (async () => {
      try {
        const refreshedPages = [];
        for (let page = 0; page < requestedPageCount; page += 1) {
          const refreshedPage = await fetchPublishedProductsPage({
            page,
            now: pageSnapshot,
          });
          refreshedPages.push(refreshedPage);
          if (!refreshedPage.hasMore) break;
        }
        if (
          !enabledRef.current ||
          requestGeneration !== requestGenerationRef.current
        ) {
          return;
        }
        const refreshedPosts = refreshedPages.flatMap((page) => page.posts);
        const uniquePosts = Array.from(
          new Map(refreshedPosts.map((post) => [post.id, post])).values(),
        );
        const lastPage = refreshedPages.at(-1);
        pageSnapshotRef.current = pageSnapshot;
        nextPageRef.current = refreshedPages.length;
        hasMoreProductsRef.current = lastPage?.hasMore ?? false;
        setPosts(uniquePosts);
        setHasMoreProducts(lastPage?.hasMore ?? false);
        setError("");
      } catch (loadError) {
        if (
          !enabledRef.current ||
          requestGeneration !== requestGenerationRef.current
        ) {
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "경매 상품을 불러오지 못했어요.",
        );
      } finally {
        if (
          showLoading &&
          enabledRef.current &&
          requestGeneration === requestGenerationRef.current
        ) {
          setIsLoading(false);
        }
      }
    })();

    activeRequestRef.current = request;
    void request.then(() => {
      if (activeRequestRef.current === request) {
        activeRequestRef.current = null;
      }
    });
    return request;
  }, []);

  const loadMoreProducts = useCallback(() => {
    if (
      !enabledRef.current ||
      !hasMoreProductsRef.current ||
      isLoadingMoreRef.current
    ) {
      return Promise.resolve();
    }

    const activeRequest = activeRequestRef.current;
    if (activeRequest) return activeRequest;

    const requestGeneration = requestGenerationRef.current;
    const page = nextPageRef.current;
    const pageSnapshot = pageSnapshotRef.current ?? new Date();
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);

    const request = (async () => {
      try {
        const nextPage = await fetchPublishedProductsPage({
          page,
          now: pageSnapshot,
        });
        if (
          !enabledRef.current ||
          requestGeneration !== requestGenerationRef.current
        ) {
          return;
        }

        setPosts((currentPosts) => {
          const currentIds = new Set(currentPosts.map((post) => post.id));
          const uniqueNextPosts = nextPage.posts.filter(
            (post) => !currentIds.has(post.id),
          );
          return uniqueNextPosts.length > 0
            ? [...currentPosts, ...uniqueNextPosts]
            : currentPosts;
        });
        nextPageRef.current = page + 1;
        hasMoreProductsRef.current = nextPage.hasMore;
        setHasMoreProducts(nextPage.hasMore);
        setError("");
      } catch (loadError) {
        if (
          !enabledRef.current ||
          requestGeneration !== requestGenerationRef.current
        ) {
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "추가 경매 상품을 불러오지 못했어요.",
        );
      } finally {
        if (
          enabledRef.current &&
          requestGeneration === requestGenerationRef.current
        ) {
          isLoadingMoreRef.current = false;
          setIsLoadingMore(false);
        }
      }
    })();

    activeRequestRef.current = request;
    void request.then(() => {
      if (activeRequestRef.current === request) {
        activeRequestRef.current = null;
      }
    });
    return request;
  }, []);

  const scheduleRealtimeRefresh = useCallback(() => {
    if (!enabledRef.current) return;

    realtimeRefreshQueuedRef.current = true;
    if (realtimeTimerRef.current !== null) {
      window.clearTimeout(realtimeTimerRef.current);
    }

    realtimeTimerRef.current = window.setTimeout(() => {
      realtimeTimerRef.current = null;
      if (!enabledRef.current || !realtimeRefreshQueuedRef.current) return;

      const activeRequest = activeRequestRef.current;
      if (activeRequest) {
        void activeRequest.then(() => {
          if (enabledRef.current && realtimeRefreshQueuedRef.current) {
            scheduleRealtimeRefresh();
          }
        });
        return;
      }

      realtimeRefreshQueuedRef.current = false;
      void loadProducts(false).then(() => {
        if (enabledRef.current && realtimeRefreshQueuedRef.current) {
          scheduleRealtimeRefresh();
        }
      });
    }, REALTIME_REFETCH_DEBOUNCE_MS);
  }, [loadProducts]);

  const stopProductRequests = useCallback(() => {
    enabledRef.current = false;
    requestGenerationRef.current += 1;
    activeRequestRef.current = null;
    realtimeRefreshQueuedRef.current = false;
    hasMoreProductsRef.current = false;
    isLoadingMoreRef.current = false;
    nextPageRef.current = 1;
    pageSnapshotRef.current = null;
    if (realtimeTimerRef.current !== null) {
      window.clearTimeout(realtimeTimerRef.current);
      realtimeTimerRef.current = null;
    }
  }, []);

  const refreshProducts = useCallback(() => {
    if (!enabled) return Promise.resolve();
    return loadProducts(true);
  }, [enabled, loadProducts]);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      stopProductRequests();

      const resetTimer = window.setTimeout(() => {
        setPosts([]);
        setError("");
        setIsLoading(false);
        setHasMoreProducts(false);
        setIsLoadingMore(false);
      }, 0);
      return () => window.clearTimeout(resetTimer);
    }

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
        setHasMoreProducts(false);
        setIsLoadingMore(false);
      }, 0);
      return () => {
        window.clearTimeout(timer);
        stopProductRequests();
      };
    }

    void loadProducts(true);

    const channel = client
      .channel(createRealtimeChannelName("products-feed"))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        scheduleRealtimeRefresh,
      )
      .subscribe((status) => {
        if (!enabledRef.current) return;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError("상품 실시간 연결이 지연되고 있어요. 다시 시도해 주세요.");
        }
      });

    return () => {
      stopProductRequests();
      void client.removeChannel(channel);
    };
  }, [enabled, loadProducts, scheduleRealtimeRefresh, stopProductRequests]);

  return {
    posts,
    setPosts,
    isLoading: enabled ? isLoading : false,
    hasMoreProducts: enabled ? hasMoreProducts : false,
    isLoadingMore: enabled ? isLoadingMore : false,
    error: enabled ? error : "",
    refreshProducts,
    loadMoreProducts,
  };
}
