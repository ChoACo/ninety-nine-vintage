"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AuctionPost, ProductSaleType } from "@/types/auction";
import { AuctionCard } from "@/components/features/auction/AuctionCard";
import { useAccountAuctionBids } from "@/components/features/auction/AuctionBidSummary";
import { AuctionFeedCard } from "@/components/features/auction/AuctionFeedCard";
import { SoldFeedCard } from "@/components/features/auction/SoldFeedCard";
import { AuctionInactiveTeaser } from "@/components/features/auction/AuctionInactiveTeaser";
import {
  AUCTION_FEED_PAGE_SIZE,
  getAuctionFeedPhase,
  getAuctionRemainingLabel,
  getKoreanFeedDateKey,
  isActiveAuctionBid,
  paginateAuctionFeed,
  parseAuctionProductRealtimeSnapshot,
  parsePublicBidHistory,
} from "@/components/features/auction/auctionFeedLogic";
import { useAuctionPolicyClock } from "@/hooks/useAuctionPolicyClock";
import {
  CATALOG_FETCH_BATCH_SIZE,
  getNextCatalogOffset,
  MAX_CATALOG_FETCH_BATCHES,
  mergeCatalogProductBatch,
} from "@/lib/catalog/pagination";
import { getCatalogImageUrl } from "@/lib/images";
import {
  AUCTION_BID_SUCCEEDED_EVENT,
  type AuctionBidSucceededDetail,
} from "@/lib/auction/bidEvents";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";
import { getDailyAuctionPhase, getKoreanAuctionTime } from "@/utils/auctionBidPolicy";
import { getCatalogGender, type CatalogGender } from "@/utils/catalogFilters";
import {
  CATALOG_SESSION_CHANGED_EVENT,
  getCatalogSessionSeed,
} from "@/components/layout/SiteSessionActivityTracker";

const CATALOG_GENDERS: readonly CatalogGender[] = [
  "all",
  "남성",
  "여성",
  "공용",
];

export interface ProductPayload {
  id: string;
  title: string;
  description: string;
  category: string;
  brand: string;
  brandSlug: string;
  gender?: "" | "남성" | "여성" | "공용";
  conditionGrade?: "" | "S" | "A" | "B" | "C";
  measurements?: unknown;
  publishAt: string;
  closesAt: string;
  status: "pending" | "active" | "closed";
  saleType: ProductSaleType;
  startingPrice: number;
  currentPrice: number;
  fixedPrice: number | null;
  bidIncrement: number;
  participantCount: number;
  bidHistory: unknown[];
  antiSnipingBaseClosesAt?: string | null;
  antiSnipingExtendedAt?: string | null;
  antiSnipingExtensionCount?: number;
  bidLockedAt?: string | null;
  finalBidAmount?: number | null;
  imageUrls: string[];
  thumbnailUrls: string[];
  sizeLabel: string;
  storeId?: string | null;
  storeName?: string;
  storeSlug?: string;
  storeTier?: "premium" | "standard";
  soldAt?: string;
  soldPrice?: number;
  enhancedTitle?: string | null;
  hashtags?: string[];
}

interface CatalogFilters {
  brand?: string;
  gender?: CatalogGender;
  date?: string;
  query?: string;
  storeId?: string;
}

interface AuctionFeedGridProps {
  basePath?: "" | "/m";
  className?: string;
  detailRoute?: "auction" | "shop";
  initialProducts?: ProductPayload[];
  saleType: ProductSaleType;
  surface?: "desktop" | "mobile";
  title?: string;
}

interface ProductCatalogResponse {
  pagination?: {
    hasMore: boolean;
    limit: number;
    nextOffset: number | null;
    offset: number;
    returned: number;
  };
  products?: ProductPayload[];
}

interface ProductDetailResponse {
  product?: ProductPayload;
}

function getRealtimeProductId(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

async function fetchCompleteProductCatalog(input: {
  saleType: ProductSaleType;
  signal: AbortSignal;
  view: "active" | "sold" | "upcoming" | "won";
  search?: string;
}): Promise<ProductPayload[]> {
  let offset = 0;
  let products: ProductPayload[] = [];

  for (
    let batchIndex = 0;
    batchIndex < MAX_CATALOG_FETCH_BATCHES;
    batchIndex += 1
  ) {
    input.signal.throwIfAborted();
    const params = new URLSearchParams({
      limit: String(CATALOG_FETCH_BATCH_SIZE),
      offset: String(offset),
      saleType: input.saleType,
    });
    if (input.view !== "active") params.set("view", input.view);
    if (input.search?.trim()) params.set("q", input.search.trim());
    const response = await fetch(`/api/products?${params.toString()}`, {
      cache: "no-store",
      signal: input.signal,
    });
    if (!response.ok) {
      throw new Error(
        input.view === "sold" || input.view === "won"
          ? "판매 완료 상품을 불러오지 못했습니다."
          : "상품 목록을 불러오지 못했습니다.",
      );
    }
    const payload = (await response.json()) as ProductCatalogResponse;
    input.signal.throwIfAborted();
    const batch = Array.isArray(payload.products) ? payload.products : [];
    if (batch.length > CATALOG_FETCH_BATCH_SIZE) {
      throw new Error("상품 목록 응답 범위가 올바르지 않습니다.");
    }
    products = mergeCatalogProductBatch(products, batch);

    const computedNextOffset = getNextCatalogOffset(
      offset,
      batch.length,
      CATALOG_FETCH_BATCH_SIZE,
    );
    const pagination = payload.pagination;
    if (pagination) {
      if (
        pagination.offset !== offset ||
        pagination.limit !== CATALOG_FETCH_BATCH_SIZE ||
        pagination.returned !== batch.length
      ) {
        throw new Error("상품 페이지 응답이 요청 범위와 일치하지 않습니다.");
      }
      if (!pagination.hasMore) {
        if (pagination.nextOffset !== null) {
          throw new Error("상품 페이지 종료 정보가 올바르지 않습니다.");
        }
        return products;
      }
      if (
        computedNextOffset === null ||
        pagination.nextOffset !== computedNextOffset
      ) {
        throw new Error("다음 상품 페이지 정보가 올바르지 않습니다.");
      }
    } else if (computedNextOffset === null) {
      return products;
    }

    if (computedNextOffset === null) return products;
    offset = computedNextOffset;
  }

  throw new Error(
    "상품 목록이 한 번에 조회할 수 있는 안전 범위를 초과했습니다.",
  );
}

export function AuctionFeedGrid(props: AuctionFeedGridProps) {
  if (props.saleType === "auction" && !LIVE_AUCTION_ENABLED) {
    return (
      <section
        className={`grid min-h-64 place-items-center border border-dashed border-line bg-surface px-6 text-center ${props.className ?? ""}`}
      >
        <div>
          <p className="text-sm font-bold">라이브 경매 점검 중</p>
          <p className="mt-2 text-xs text-muted">
            일반 바로 구매 상품은 정상적으로 이용할 수 있습니다.
          </p>
        </div>
      </section>
    );
  }
  return <EnabledAuctionFeedGrid {...props} />;
}

function EnabledAuctionFeedGrid({
  basePath = "",
  className = "",
  initialProducts,
  saleType,
  surface = "desktop",
  title,
}: AuctionFeedGridProps) {
  const routeSearchParams = useSearchParams();
  const catalogRootRef = useRef<HTMLElement>(null);
  const routeQuery = routeSearchParams.get("q") ?? "";
  const routeCategory = routeSearchParams.get("category") ?? "";
  const routeGrade = routeSearchParams.get("grade") ?? "";
  const routeSort = routeSearchParams.get("sort") ?? "latest";
  const policyNow = useAuctionPolicyClock(saleType === "auction");
  const now = policyNow.getTime();
  const dailyAuctionPhase = now > 0 ? getDailyAuctionPhase(now) : "open";
  const koreanClock = getKoreanAuctionTime(now);
  const isPreparingUpcoming = saleType === "auction"
    && koreanClock.secondsSinceMidnight >= 9 * 60 * 60 + 30 * 60
    && koreanClock.secondsSinceMidnight < 10 * 60 * 60;
  const [products, setProducts] = useState<ProductPayload[]>(
    initialProducts ?? [],
  );
  const [query, setQuery] = useState(routeQuery);
  const [showSoldOnly, setShowSoldOnly] = useState(
    () => routeSearchParams.get("view") === "sold",
  );
  const [selectedDate, setSelectedDate] = useState(
    () => routeSearchParams.get("date") ?? "latest",
  );
  const [selectedBrand, setSelectedBrand] = useState(
    () => routeSearchParams.get("brand") ?? "all",
  );
  const [selectedGender, setSelectedGender] = useState<CatalogGender>(
    () => (routeSearchParams.get("gender") as CatalogGender | null) ?? "all",
  );
  const [selectedStoreId, setSelectedStoreId] = useState(
    () => routeSearchParams.get("store") ?? "all",
  );
  const [feedSeed, setFeedSeed] = useState("initial-session");
  const [bidEventNotice, setBidEventNotice] = useState("");
  const [page, setPage] = useState(() => {
    const requested = Number(routeSearchParams.get("page"));
    return Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  });
  const catalogView = showSoldOnly
    ? saleType === "auction" ? "won" : "sold"
    : isPreparingUpcoming
      ? "upcoming"
      : "active";
  const catalogRequestKey = `${saleType}:${catalogView}:${dailyAuctionPhase}`;
  const [settledCatalogKey, setSettledCatalogKey] = useState(() =>
    initialProducts !== undefined && !showSoldOnly && !isPreparingUpcoming
      ? catalogRequestKey
      : "",
  );
  const loading = settledCatalogKey !== catalogRequestKey;
  const [error, setError] = useState("");
  const accountBids = useAccountAuctionBids(
    saleType === "auction" && !showSoldOnly,
  );
  const accountBidCapability = accountBids.capability;
  const refreshAccountBids = accountBids.refresh;
  const catalogGridClass = surface === "desktop"
    ? "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-4 lg:gap-5 xl:grid-cols-5 2xl:grid-cols-6"
    : "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-3 md:gap-6 lg:grid-cols-4";

  const lastRouteQuery = useRef(routeQuery);
  const productRefreshTimers = useRef(new Map<string, number>());
  const bidNoticeTimer = useRef<number | null>(null);

  useEffect(() => {
    const applySeed = () => {
      const seed = getCatalogSessionSeed();
      if (seed) setFeedSeed(`${saleType}:${seed}`);
    };
    queueMicrotask(applySeed);
    window.addEventListener(CATALOG_SESSION_CHANGED_EVENT, applySeed);
    return () => {
      window.removeEventListener(CATALOG_SESSION_CHANGED_EVENT, applySeed);
    };
  }, [saleType]);

  useEffect(() => {
    if (routeQuery === lastRouteQuery.current) return;
    lastRouteQuery.current = routeQuery;
    setQuery(routeQuery);
    setPage(1);
  }, [routeQuery]);

  useEffect(() => {
    const key = `ninety-nine:${saleType}:scroll`;
    const scrollPane = catalogRootRef.current?.closest<HTMLElement>(
      "[data-independent-scroll-main]",
    );
    const restore = () => {
      const value = Number(sessionStorage.getItem(key) ?? "0");
      if (value > 0) {
        window.requestAnimationFrame(() =>
          (scrollPane ?? window).scrollTo({
            top: value,
            behavior: "instant" as ScrollBehavior,
          }),
        );
      }
    };
    const save = () =>
      sessionStorage.setItem(
        key,
        String(scrollPane?.scrollTop ?? window.scrollY),
      );
    const scrollTarget = scrollPane ?? window;
    restore();
    scrollTarget.addEventListener("scroll", save, { passive: true });
    return () => scrollTarget.removeEventListener("scroll", save);
  }, [saleType]);

  useEffect(() => {
    const receiveFilters = (event: Event) => {
      const next = (event as CustomEvent<CatalogFilters>).detail;
      if (!next) return;
      if (typeof next.query === "string") setQuery(next.query);
      if (typeof next.brand === "string") setSelectedBrand(next.brand);
      if (typeof next.date === "string") {
        setSelectedDate(next.date);
      }
      if (
        typeof next.gender === "string" &&
        CATALOG_GENDERS.includes(next.gender)
      ) {
        setSelectedGender(next.gender);
      }
      if (typeof next.storeId === "string") setSelectedStoreId(next.storeId);
      setPage(1);
    };
    window.addEventListener("catalog-filters", receiveFilters);
    return () => window.removeEventListener("catalog-filters", receiveFilters);
  }, [saleType]);

  useEffect(() => {
    if (initialProducts !== undefined
      && catalogView === "active"
      && !showSoldOnly
      && !query.trim()) {
      queueMicrotask(() => {
        setProducts(initialProducts);
        setSettledCatalogKey(catalogRequestKey);
      });
      return;
    }
    const controller = new AbortController();
    fetchCompleteProductCatalog({
      saleType,
      signal: controller.signal,
      view: catalogView,
      search: query,
    })
      .then((nextProducts) => {
        setError("");
        setProducts(nextProducts);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
        setError(
          showSoldOnly
            ? "판매 완료 상품을 불러오지 못했습니다."
            : "상품 목록을 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSettledCatalogKey(catalogRequestKey);
        }
      });
    return () => controller.abort();
  }, [catalogRequestKey, catalogView, initialProducts, query, saleType, showSoldOnly]);

  useEffect(() => () => {
    if (bidNoticeTimer.current !== null) window.clearTimeout(bidNoticeTimer.current);
  }, []);

  const refreshProductById = useCallback(
    async (productId: string) => {
      try {
        const response = await fetch(
          `/api/products/${encodeURIComponent(productId)}`,
          {
            cache: "no-store",
          },
        );
        if (response.status === 404) {
          setProducts((current) =>
            current.filter((product) => product.id !== productId),
          );
          return;
        }
        if (!response.ok) return;
        const payload = (await response.json()) as ProductDetailResponse;
        const nextProduct = payload.product;
        if (!nextProduct || nextProduct.saleType !== saleType) {
          setProducts((current) =>
            current.filter((product) => product.id !== productId),
          );
          return;
        }
        setProducts((current) => {
          const index = current.findIndex(
            (product) => product.id === productId,
          );
          if (index < 0) return [...current, nextProduct];
          const existing = current[index];
          const merged = {
            ...existing,
            ...nextProduct,
            storeTier: nextProduct.storeTier ?? existing.storeTier,
          };
          const next = [...current];
          next[index] = merged;
          return next;
        });
      } catch {
        // A transient single-product refresh failure must not replace or flash the feed.
      }
    },
    [saleType],
  );

  const scheduleProductRefresh = useCallback(
    (productId: string) => {
      const currentTimer = productRefreshTimers.current.get(productId);
      if (currentTimer !== undefined) window.clearTimeout(currentTimer);
      const timer = window.setTimeout(() => {
        productRefreshTimers.current.delete(productId);
        void refreshProductById(productId);
      }, 500);
      productRefreshTimers.current.set(productId, timer);
    },
    [refreshProductById],
  );

  useEffect(() => {
    if (showSoldOnly
      || dailyAuctionPhase === "closed"
      || isPreparingUpcoming
      || (saleType === "auction" && !LIVE_AUCTION_ENABLED))
      return;
    const refreshTimers = productRefreshTimers.current;
    let client: ReturnType<typeof getSupabaseBrowserClient>;
    try {
      client = getSupabaseBrowserClient();
    } catch {
      return;
    }
    const channel = client
      .channel(`live-${saleType}-feed-products`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        (payload) => {
          const productId =
            getRealtimeProductId(payload.new) ??
            getRealtimeProductId(payload.old);
          if (!productId) return;
          if (payload.eventType === "DELETE") {
            setProducts((current) =>
              current.filter((product) => product.id !== productId),
            );
            return;
          }
          const snapshot = parseAuctionProductRealtimeSnapshot(payload.new);
          if (snapshot) {
            setProducts((current) => {
              const previous = current.find((product) => product.id === snapshot.id);
              if (previous && snapshot.currentPrice > previous.currentPrice) {
                setBidEventNotice("새로운 입찰이 진행되었습니다. 현재 입찰가를 갱신했습니다.");
                if (bidNoticeTimer.current !== null) window.clearTimeout(bidNoticeTimer.current);
                bidNoticeTimer.current = window.setTimeout(() => setBidEventNotice(""), 4_000);
              }
              return current.map((product) =>
                product.id === snapshot.id ? {
                      ...product,
                      antiSnipingBaseClosesAt: snapshot.antiSnipingBaseClosesAt,
                      antiSnipingExtendedAt: snapshot.antiSnipingExtendedAt,
                      antiSnipingExtensionCount:
                        snapshot.antiSnipingExtensionCount,
                      bidLockedAt: snapshot.bidLockedAt,
                      closesAt: snapshot.closesAt,
                      currentPrice: snapshot.currentPrice,
                      finalBidAmount: snapshot.finalBidAmount,
                      participantCount: snapshot.participantCount,
                      publishAt: snapshot.publishAt,
                      status: snapshot.status,
                    } : product,
              );
            });
          }
          scheduleProductRefresh(productId);
          if (
            saleType === "auction" &&
            accountBidCapability === "eligible_member"
          ) {
            refreshAccountBids();
          }
        },
      )
      .subscribe();
    return () => {
      for (const timer of refreshTimers.values()) window.clearTimeout(timer);
      refreshTimers.clear();
      void client.removeChannel(channel);
    };
  }, [
    accountBidCapability,
    dailyAuctionPhase,
    isPreparingUpcoming,
    refreshAccountBids,
    saleType,
    scheduleProductRefresh,
    showSoldOnly,
  ]);

  useEffect(() => {
    if (saleType !== "auction" || showSoldOnly) return;
    const receiveBidSuccess = (event: Event) => {
      const productId = (event as CustomEvent<AuctionBidSucceededDetail>).detail
        ?.productId;
      if (!productId) return;
      scheduleProductRefresh(productId);
      refreshAccountBids();
    };
    window.addEventListener(AUCTION_BID_SUCCEEDED_EVENT, receiveBidSuccess);
    return () =>
      window.removeEventListener(
        AUCTION_BID_SUCCEEDED_EVENT,
        receiveBidSuccess,
      );
  }, [refreshAccountBids, saleType, scheduleProductRefresh, showSoldOnly]);

  const orderedProducts = useMemo(() => {
    const ranked = [...products].sort((left, right) => {
      const leftDate = getKoreanFeedDateKey(left.publishAt);
      const rightDate = getKoreanFeedDateKey(right.publishAt);
      if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
      const score = (value: string) => {
        let hash = 2166136261;
        for (const character of `${feedSeed}:${value}`)
          hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
        return hash >>> 0;
      };
      const leftScore = score(left.id);
      const rightScore = score(right.id);
      return leftScore - rightScore;
    });
    const top: ProductPayload[] = [];
    const deferred: ProductPayload[] = [];
    const counts = new Map<string, number>();
    for (const product of ranked) {
      const store = product.storeId ?? `product:${product.id}`;
      const count = counts.get(store) ?? 0;
      if (top.length < 8 && count >= 2) deferred.push(product);
      else {
        top.push(product);
        if (top.length <= 8) counts.set(store, count + 1);
      }
    }
    return [...top, ...deferred];
  }, [feedSeed, products]);

  const cards = useMemo(
    () =>
      orderedProducts.map((product) => {
        const bidHistory = parsePublicBidHistory(
          Array.isArray(product.bidHistory) ? product.bidHistory : [],
        );
        const activeBidHistory = bidHistory.filter(isActiveAuctionBid);
        const hasBidHistory =
          Array.isArray(product.bidHistory) && product.bidHistory.length > 0;
        const imageUrls = product.imageUrls
          .map((image) => getCatalogImageUrl(image))
          .filter(Boolean);
        const thumbnailUrls = product.thumbnailUrls
          .map((image) => getCatalogImageUrl(image))
          .filter(Boolean);
        const auctionPhase =
          saleType === "auction"
            ? getAuctionFeedPhase(
                {
                  antiSnipingBaseClosesAt:
                    product.antiSnipingBaseClosesAt ?? null,
                  antiSnipingExtendedAt: product.antiSnipingExtendedAt ?? null,
                  antiSnipingExtensionCount:
                    product.antiSnipingExtensionCount ?? 0,
                  bidLockedAt: product.bidLockedAt ?? null,
                  closesAt: product.closesAt,
                  publishAt: product.publishAt,
                  status: product.status,
                },
                now,
                dailyAuctionPhase,
              )
            : undefined;
        const catalogPost: AuctionPost = {
          id: product.id,
          title: product.title,
          description: product.description,
          brand: product.brand,
          brandSlug: product.brandSlug,
          gender: product.gender,
          category: product.category,
          createdAt: product.publishAt,
          publish_at: product.publishAt,
          closesAt: product.closesAt,
          status: product.status,
          saleType: product.saleType,
          fixedPrice: product.fixedPrice,
          participantCount: product.participantCount,
          startingPrice: product.startingPrice,
          currentPrice: product.currentPrice,
          bidIncrement: product.bidIncrement,
          imageUrls,
          thumbnailUrls,
          antiSnipingBaseClosesAt: product.antiSnipingBaseClosesAt ?? undefined,
          antiSnipingExtendedAt: product.antiSnipingExtendedAt ?? undefined,
          antiSnipingExtensionCount: product.antiSnipingExtensionCount ?? 0,
          bidLockedAt: product.bidLockedAt ?? undefined,
          finalBidAmount: product.finalBidAmount ?? undefined,
          bidHistory,
        };
        return {
          id: product.id,
          auctionId: product.id,
          name: product.title,
          brand: product.brand,
          category: product.category,
          description: product.description,
          gender: product.gender,
          conditionGrade: product.conditionGrade,
          measurements: product.measurements,
          imageUrl: getCatalogImageUrl(
            product.thumbnailUrls[0] ?? product.imageUrls[0] ?? "",
          ),
          thumbnailUrl: getCatalogImageUrl(
            product.thumbnailUrls[0] ?? product.imageUrls[0] ?? "",
          ),
          imageUrls,
          thumbnailUrls,
          title: product.title,
          createdAt: product.publishAt,
          startingPrice: product.startingPrice,
          currentBid: product.currentPrice,
          fixedPrice: product.fixedPrice,
          bidCount: hasBidHistory
            ? activeBidHistory.length
            : product.participantCount,
          bidHistory,
          antiSnipingBaseClosesAt: product.antiSnipingBaseClosesAt,
          antiSnipingExtendedAt: product.antiSnipingExtendedAt,
          antiSnipingExtensionCount: product.antiSnipingExtensionCount,
          bidLockedAt: product.bidLockedAt,
          participantCount: product.participantCount,
          status: product.status,
          saleType: product.saleType,
          closesAt: product.closesAt,
          publishAt: product.publishAt,
          bidIncrement: product.bidIncrement,
          size: product.sizeLabel,
          sizeLabel: product.sizeLabel,
          catalogGender: getCatalogGender(catalogPost),
          soldAt: product.soldAt ?? product.closesAt,
          soldPrice:
            product.soldPrice ??
            product.finalBidAmount ??
            product.fixedPrice ??
            product.currentPrice,
          auctionPhase,
          timeLeft: showSoldOnly
            ? "판매 완료"
            : isPreparingUpcoming
              ? "오전 10시부터 입찰 진행"
            : saleType === "fixed"
              ? "재고 있음"
              : dailyAuctionPhase === "closed" &&
                  auctionPhase !== "CLOSING_SOON"
                ? "마감·동기화 점검 중"
                : auctionPhase === "CLOSED"
                  ? "마감됨"
                  : getAuctionRemainingLabel(product.closesAt, now),
          enhancedTitle: product.enhancedTitle,
          hashtags: product.hashtags,
        };
      }),
    [dailyAuctionPhase, isPreparingUpcoming, now, orderedProducts, saleType, showSoldOnly],
  );

  const dateKeys = useMemo(
    () =>
      [
        ...new Set(
          cards
            .map((card) => getKoreanFeedDateKey(card.publishAt ?? ""))
            .filter(Boolean),
        ),
      ]
        .sort()
        .reverse(),
    [cards],
  );
  const effectiveSelectedDate =
    selectedDate === "latest"
      ? dateKeys[0] ?? "all"
      : selectedDate === "today" ||
    selectedDate === "all" ||
    dateKeys.includes(selectedDate)
      ? selectedDate
      : "all";
  const brandOptions = useMemo(
    () =>
      [
        "all",
        ...new Set(cards.map((card) => card.brand.trim()).filter(Boolean)),
      ].sort((a, b) =>
        a === "all" ? -1 : b === "all" ? 1 : a.localeCompare(b, "ko-KR"),
      ),
    [cards],
  );
  const storeOptions = useMemo(() => {
    const values = [
      ...new Map(
        orderedProducts
          .filter((product) => product.storeId && product.storeName)
          .map((product) => [
            product.storeId as string,
            product.storeName as string,
          ]),
      ).entries(),
    ];
    const score = (value: string) => {
      let hash = 0;
      for (const character of `${feedSeed}:store:${value}`)
        hash = (Math.imul(31, hash) + character.charCodeAt(0)) | 0;
      return hash;
    };
    return values
      .sort((left, right) => score(left[0]) - score(right[0]))
      .map(([id, name]) => ({ id, name }));
  }, [feedSeed, orderedProducts]);
  const effectiveSelectedBrand =
    selectedBrand === "all" || brandOptions.includes(selectedBrand)
      ? selectedBrand
      : "all";
  const effectiveSelectedGender = CATALOG_GENDERS.includes(selectedGender)
    ? selectedGender
    : "all";
  const bidStateByProduct = useMemo(
    () =>
      new Map(accountBids.items.map((item) => [item.productId, item.state])),
    [accountBids.items],
  );
  const handleBidPlaced = useCallback(() => {
    refreshAccountBids();
  }, [refreshAccountBids]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("catalog-filter-options", {
        detail: {
          brands: brandOptions.filter((brand) => brand !== "all"),
          dates: dateKeys,
          stores: storeOptions,
        },
      }),
    );
  }, [brandOptions, dateKeys, storeOptions]);

  const productById = useMemo(
    () => new Map(orderedProducts.map((product) => [product.id, product])),
    [orderedProducts],
  );

  const visibleCards = useMemo(
    () =>
      cards
        .filter((card) => {
          const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
          const queryMatch =
            !normalizedQuery ||
            `${card.title} ${card.description}`
              .toLocaleLowerCase("ko-KR")
              .includes(normalizedQuery);
          const cardDate = getKoreanFeedDateKey(card.publishAt ?? "");
          const todayDate = getKoreanFeedDateKey(new Date().toISOString());
          const dateMatch =
            effectiveSelectedDate === "all" ||
            cardDate ===
              (effectiveSelectedDate === "today"
                ? todayDate
                : effectiveSelectedDate);
          const brandMatch =
            effectiveSelectedBrand === "all" ||
            card.brand === effectiveSelectedBrand;
          const genderMatch =
            effectiveSelectedGender === "all" ||
            card.catalogGender === effectiveSelectedGender;
          const source = productById.get(card.id);
          const storeMatch =
            selectedStoreId === "all" || source?.storeId === selectedStoreId;
          const categoryMatch =
            !routeCategory || card.category.includes(routeCategory);
          const gradeMatch = !routeGrade || card.conditionGrade === routeGrade;
          return (
            queryMatch &&
            dateMatch &&
            brandMatch &&
            genderMatch &&
            storeMatch &&
            categoryMatch &&
            gradeMatch
          );
        })
        .toSorted((left, right) => {
          if (routeSort === "price-asc")
            return (
              (left.fixedPrice ?? left.currentBid) -
              (right.fixedPrice ?? right.currentBid)
            );
          if (routeSort === "price-desc")
            return (
              (right.fixedPrice ?? right.currentBid) -
              (left.fixedPrice ?? left.currentBid)
            );
          if (routeSort === "condition")
            return String(left.conditionGrade).localeCompare(
              String(right.conditionGrade),
            );
          return (
            Date.parse(right.publishAt ?? "") - Date.parse(left.publishAt ?? "")
          );
        }),
    [
      cards,
      effectiveSelectedBrand,
      effectiveSelectedDate,
      effectiveSelectedGender,
      productById,
      query,
      routeCategory,
      routeGrade,
      routeSort,
      selectedStoreId,
    ],
  );
  const pagination = useMemo(
    () => paginateAuctionFeed(visibleCards, page),
    [page, visibleCards],
  );

  const hasAnyFilter = useMemo(
    () =>
      Boolean(query.trim()) ||
      effectiveSelectedBrand !== "all" ||
      selectedDate !== "latest" ||
      effectiveSelectedGender !== "all" ||
      selectedStoreId !== "all",
    [
      effectiveSelectedBrand,
      effectiveSelectedGender,
      query,
      selectedDate,
      selectedStoreId,
    ],
  );

  const urlHasMounted = useRef(false);
  const restoringUrl = useRef(false);

  useEffect(() => {
    const handlePopState = () => {
      restoringUrl.current = true;
      const params = new URLSearchParams(window.location.search);
      setQuery(params.get("q") ?? "");
      setShowSoldOnly(params.get("view") === "sold");
      setSelectedBrand(params.get("brand") ?? "all");
      setSelectedGender(
        (params.get("gender") as CatalogGender | null) ?? "all",
      );
      setSelectedStoreId(params.get("store") ?? "all");
      setSelectedDate(params.get("date") ?? "latest");
      const requested = Number(params.get("page"));
      setPage(Number.isSafeInteger(requested) && requested > 0 ? requested : 1);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [saleType]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (query.trim()) params.set("q", query.trim());
    else params.delete("q");
    if (pagination.page > 1) params.set("page", String(pagination.page));
    else params.delete("page");
    if (effectiveSelectedBrand !== "all")
      params.set("brand", effectiveSelectedBrand);
    else params.delete("brand");
    if (selectedDate !== "latest" && selectedDate !== "all")
      params.set("date", selectedDate);
    else params.delete("date");
    if (effectiveSelectedGender !== "all")
      params.set("gender", effectiveSelectedGender);
    else params.delete("gender");
    if (selectedStoreId !== "all") params.set("store", selectedStoreId);
    else params.delete("store");
    if (showSoldOnly) params.set("view", "sold");
    else params.delete("view");
    const queryString = params.toString();
    const nextUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`;
    if (restoringUrl.current) {
      restoringUrl.current = false;
      window.history.replaceState(window.history.state, "", nextUrl);
    } else if (urlHasMounted.current) {
      window.history.pushState(window.history.state, "", nextUrl);
    } else {
      window.history.replaceState(window.history.state, "", nextUrl);
      urlHasMounted.current = true;
    }
  }, [
    effectiveSelectedBrand,
    effectiveSelectedDate,
    effectiveSelectedGender,
    pagination.page,
    query,
    saleType,
    selectedStoreId,
    selectedDate,
    showSoldOnly,
  ]);

  return (
    <section className={`min-w-0 ${className}`} ref={catalogRootRef}>
      <div className="mb-6 border-b border-ink pb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] font-bold tracking-[0.14em] text-muted">
              {saleType === "fixed"
                ? "즉시 구매 상품"
                : "실시간 경매 · 21시 마감"}
            </p>
            <h1 className="text-2xl font-black tracking-[-0.05em]">
              {title ??
                (saleType === "fixed" ? "상시 즉시 구매" : "오늘의 경매")}
            </h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {loading ? (
              <span
                aria-label="상품 수 불러오는 중"
                className="h-4 w-16 animate-pulse rounded bg-zinc-800"
                role="status"
              />
            ) : (
              <span className="font-mono text-xs font-bold tabular-nums text-muted">
                {visibleCards.length}개 상품
              </span>
            )}
            <button
              aria-pressed={showSoldOnly}
              className={`h-10 border px-4 text-xs font-bold transition-colors ${showSoldOnly ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:border-ink"}`}
              onClick={() => {
                setShowSoldOnly((current) => !current);
                setPage(1);
              }}
              type="button"
            >
              {showSoldOnly
                ? saleType === "auction" ? "진행 경매 보기" : "판매 중 상품 보기"
                : saleType === "auction" ? "낙찰 완료 상품" : "판매 완료 상품만 보기"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {saleType === "auction" && isPreparingUpcoming && !showSoldOnly && (
        <div className="mb-5 border border-amber-300 bg-amber-50 px-4 py-4 text-amber-950" role="status">
          <p className="text-sm font-black">새로운 상품들이 준비 중입니다.</p>
          <p className="mt-1 text-xs">아래 예약 상품은 오늘 오전 10시부터 입찰할 수 있습니다.</p>
        </div>
      )}
      {bidEventNotice && (
        <div aria-live="polite" className="mb-5 border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
          {bidEventNotice}
        </div>
      )}
      {saleType === "auction" && dateKeys.length > 0 && (
        <nav aria-label="경매 날짜 필터" className="mb-5 flex gap-2 overflow-x-auto pb-1">
          <button
            aria-pressed={selectedDate === "latest"}
            className={`min-h-10 shrink-0 border px-4 text-xs font-bold ${selectedDate === "latest" ? "border-ink bg-ink text-paper" : "border-line bg-paper"}`}
            onClick={() => { setSelectedDate("latest"); setPage(1); }}
            type="button"
          >
            최신 드롭
          </button>
          {dateKeys.map((dateKey) => {
            const weekday = new Intl.DateTimeFormat("ko-KR", {
              timeZone: "Asia/Seoul",
              weekday: "short",
            }).format(new Date(`${dateKey}T12:00:00+09:00`));
            return (
              <button
                aria-pressed={effectiveSelectedDate === dateKey && selectedDate !== "latest"}
                className={`min-h-10 shrink-0 border px-4 text-xs font-bold ${effectiveSelectedDate === dateKey && selectedDate !== "latest" ? "border-ink bg-ink text-paper" : "border-line bg-paper"}`}
                key={dateKey}
                onClick={() => { setSelectedDate(dateKey); setPage(1); }}
                type="button"
              >
                {dateKey.slice(5).replace("-", ".")} ({weekday})
              </button>
            );
          })}
        </nav>
      )}
      {loading && (
        <div className={catalogGridClass}>
          {Array.from({ length: 12 }).map((_, index) => (
            <div
              aria-hidden="true"
              className="mx-auto aspect-[3/4] w-full max-w-[260px] animate-pulse rounded-xl bg-surface"
              key={index}
            />
          ))}
        </div>
      )}
      {!loading &&
        !error &&
        visibleCards.length === 0 &&
        (showSoldOnly ? (
          <div className="grid min-h-64 place-items-center border border-dashed border-line px-6 text-center">
            <div>
              <p className="text-sm font-bold">{saleType === "auction" ? "낙찰 완료 상품이 없습니다." : "판매 완료 상품이 없습니다."}</p>
              <p className="mt-2 text-xs text-muted">
                판매 중 상품 보기로 돌아갈 수 있습니다.
              </p>
            </div>
          </div>
        ) : hasAnyFilter ? (
          <div className="grid min-h-64 place-items-center border border-dashed border-line px-6 text-center">
            <div>
              <p className="text-sm font-bold">
                현재 조건에 맞는 상품이 없습니다.
              </p>
              <p className="mt-2 text-xs text-muted">
                필터를 초기화하거나 새로운 드롭을 기다려 주세요.
              </p>
            </div>
          </div>
        ) : saleType === "fixed" ? (
          <div className="grid min-h-64 place-items-center border border-dashed border-line px-6 text-center">
            <div>
              <p className="text-sm font-bold">등록된 상품이 없습니다.</p>
              <p className="mt-2 text-xs text-muted">
                새로운 아카이브 상품을 준비하고 있습니다.
              </p>
            </div>
          </div>
        ) : (
          <AuctionInactiveTeaser
            basePath={basePath}
            dailyPhase={dailyAuctionPhase}
            onViewSold={() => {
              setShowSoldOnly(true);
              setPage(1);
            }}
            surface={surface}
          />
        ))}
      {!loading && visibleCards.length > 0 && (
        <>
          <div className={catalogGridClass}>
            {pagination.items.map((item) => {
              const source = productById.get(item.id);
              return (
                <div
                  className={
                    surface === "desktop"
                      ? "mx-auto w-full max-w-[260px]"
                      : "min-w-0"
                  }
                  key={item.id}
                >
                  {showSoldOnly ? (
                    <SoldFeedCard
                      basePath={basePath}
                      brand={item.brand}
                      id={item.id}
                      imageUrl={item.imageUrl}
                      saleType={item.saleType}
                      soldAt={item.soldAt}
                      soldPrice={item.soldPrice}
                      surface={surface}
                      title={item.title}
                    />
                  ) : saleType === "auction" ? (
                    <AuctionFeedCard
                      basePath={basePath}
                      bidCapability={accountBidCapability}
                      item={item}
                      onBidPlaced={handleBidPlaced}
                      participationState={bidStateByProduct.get(item.id)}
                      surface={surface}
                    />
                  ) : (
                    <AuctionCard
                      basePath={basePath}
                      item={item}
                      surface={surface}
                    />
                  )}
                  {source?.storeName && (
                    <Link
                      className="mt-2 inline-flex text-[10px] font-bold text-muted underline"
                      href={`${basePath}/stores/${encodeURIComponent(source.storeSlug ?? source.storeId ?? "")}`}
                    >
                      센터 · {source.storeName}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
          <nav
            aria-label="상품 페이지 이동"
            className="mt-8 flex items-center justify-center gap-2"
          >
            <button
              className="min-h-11 border border-line px-4 text-xs font-bold disabled:opacity-35"
              disabled={pagination.page <= 1}
              onClick={() => setPage(pagination.page - 1)}
              type="button"
            >
              이전
            </button>
            {Array.from(
              { length: pagination.pageCount },
              (_, index) => index + 1,
            ).map((pageNumber) => (
              <button
                aria-current={
                  pageNumber === pagination.page ? "page" : undefined
                }
                aria-label={`${pageNumber}페이지`}
                className={`size-11 border font-mono text-xs font-bold ${pageNumber === pagination.page ? "border-ink bg-ink text-paper" : "border-line"}`}
                key={pageNumber}
                onClick={() => setPage(pageNumber)}
                type="button"
              >
                {pageNumber}
              </button>
            ))}
            <button
              className="min-h-11 border border-line px-4 text-xs font-bold disabled:opacity-35"
              disabled={pagination.page >= pagination.pageCount}
              onClick={() => setPage(pagination.page + 1)}
              type="button"
            >
              다음
            </button>
          </nav>
          <p className="mt-3 text-center font-mono text-[10px] text-muted">
            {pagination.page} / {pagination.pageCount}페이지 · 페이지당{" "}
            {AUCTION_FEED_PAGE_SIZE}개
          </p>
        </>
      )}
    </section>
  );
}
