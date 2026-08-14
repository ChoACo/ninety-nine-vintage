"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AuctionPost, ProductSaleType } from "@/types/auction";
import { AuctionCard } from "@/components/features/auction/AuctionCard";
import { useAccountAuctionBids } from "@/components/features/auction/AuctionBidSummary";
import { AuctionFeedCard } from "@/components/features/auction/AuctionFeedCard";
import { SoldFeedCard } from "@/components/features/auction/SoldFeedCard";
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
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";
import { getDailyAuctionPhase } from "@/utils/auctionBidPolicy";
import { getCatalogGender, type CatalogGender } from "@/utils/catalogFilters";

const CATALOG_GENDERS: readonly CatalogGender[] = ["all", "남성", "여성", "공용"];

export interface ProductPayload {
  id: string;
  title: string;
  description: string;
  category: string;
  brand: string;
  brandSlug: string;
  gender?: "" | "남성" | "여성" | "공용";
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

async function fetchCompleteProductCatalog(input: {
  saleType: ProductSaleType;
  signal: AbortSignal;
  soldOnly: boolean;
  search?: string;
}): Promise<ProductPayload[]> {
  let offset = 0;
  let products: ProductPayload[] = [];

  for (let batchIndex = 0; batchIndex < MAX_CATALOG_FETCH_BATCHES; batchIndex += 1) {
    input.signal.throwIfAborted();
    const params = new URLSearchParams({
      limit: String(CATALOG_FETCH_BATCH_SIZE),
      offset: String(offset),
      saleType: input.saleType,
    });
    if (input.soldOnly) params.set("view", "sold");
    if (input.search?.trim()) params.set("q", input.search.trim());
    const response = await fetch(`/api/products?${params.toString()}`, {
      cache: "no-store",
      signal: input.signal,
    });
    if (!response.ok) {
      throw new Error(
        input.soldOnly
          ? "판매 완료 상품을 불러오지 못했습니다."
          : "상품 목록을 불러오지 못했습니다.",
      );
    }
    const payload = await response.json() as ProductCatalogResponse;
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
        pagination.offset !== offset
        || pagination.limit !== CATALOG_FETCH_BATCH_SIZE
        || pagination.returned !== batch.length
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
        computedNextOffset === null
        || pagination.nextOffset !== computedNextOffset
      ) {
        throw new Error("다음 상품 페이지 정보가 올바르지 않습니다.");
      }
    } else if (computedNextOffset === null) {
      return products;
    }

    if (computedNextOffset === null) return products;
    offset = computedNextOffset;
  }

  throw new Error("상품 목록이 한 번에 조회할 수 있는 안전 범위를 초과했습니다.");
}

export function AuctionFeedGrid(props: AuctionFeedGridProps) {
  if (props.saleType === "auction" && !LIVE_AUCTION_ENABLED) {
    return <section className={`grid min-h-64 place-items-center border border-dashed border-line bg-surface px-6 text-center ${props.className ?? ""}`}><div><p className="text-sm font-bold">라이브 경매 점검 중</p><p className="mt-2 text-xs text-muted">일반 바로 구매 상품은 정상적으로 이용할 수 있습니다.</p></div></section>;
  }
  return <EnabledAuctionFeedGrid {...props} />;
}

function EnabledAuctionFeedGrid({ basePath = "", className = "", initialProducts, saleType, surface = "desktop", title }: AuctionFeedGridProps) {
  const routeSearchParams = useSearchParams();
  const routeQuery = routeSearchParams.get("q") ?? "";
  const policyNow = useAuctionPolicyClock(saleType === "auction");
  const now = policyNow.getTime();
  const dailyAuctionPhase = now > 0 ? getDailyAuctionPhase(now) : "open";
  const [products, setProducts] = useState<ProductPayload[]>(initialProducts ?? []);
  const [query, setQuery] = useState(routeQuery);
  const [showSoldOnly, setShowSoldOnly] = useState(
    () => routeSearchParams.get("view") === "sold",
  );
  const [selectedDate, setSelectedDate] = useState(
    () => routeSearchParams.get("date") ?? "all",
  );
  const [selectedBrand, setSelectedBrand] = useState(() => routeSearchParams.get("brand") ?? "all");
  const [selectedGender, setSelectedGender] = useState<CatalogGender>(() => (routeSearchParams.get("gender") as CatalogGender | null) ?? "all");
  const [selectedStoreId, setSelectedStoreId] = useState(() => routeSearchParams.get("store") ?? "all");
  const feedSeed = useMemo(
    () => `${saleType}:${initialProducts?.map((product) => product.id).join(",") ?? "catalog"}`,
    [initialProducts, saleType],
  );
  const [page, setPage] = useState(() => {
    const requested = Number(routeSearchParams.get("page"));
    return Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  });
  const [refreshNonce, setRefreshNonce] = useState(0);
  const catalogRequestKey =
    `${saleType}:${showSoldOnly ? "sold" : "active"}:${refreshNonce}`;
  const [settledCatalogKey, setSettledCatalogKey] = useState(
    () => initialProducts !== undefined && !showSoldOnly ? catalogRequestKey : "",
  );
  const loading = settledCatalogKey !== catalogRequestKey;
  const [error, setError] = useState("");
  const accountBids = useAccountAuctionBids(
    saleType === "auction" && !showSoldOnly,
  );
  const accountBidCapability = accountBids.capability;
  const refreshAccountBids = accountBids.refresh;

  const lastRouteQuery = useRef(routeQuery);
  const realtimeRefreshTimer = useRef<number | null>(null);

  useEffect(() => {
    if (routeQuery === lastRouteQuery.current) return;
    lastRouteQuery.current = routeQuery;
    setQuery(routeQuery);
    setPage(1);
  }, [routeQuery]);

  useEffect(() => {
    const key = `ninety-nine:${saleType}:scroll`;
    const restore = () => {
      const value = Number(sessionStorage.getItem(key) ?? "0");
      if (value > 0) window.requestAnimationFrame(() => window.scrollTo({ top: value, behavior: "instant" as ScrollBehavior }));
    };
    const save = () => sessionStorage.setItem(key, String(window.scrollY));
    restore();
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
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
    if (initialProducts !== undefined && !showSoldOnly && !query.trim()) {
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
      soldOnly: showSoldOnly,
      search: query,
    })
      .then((nextProducts) => {
        setError("");
        setProducts(nextProducts);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
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
  }, [catalogRequestKey, initialProducts, query, saleType, showSoldOnly]);

  useEffect(() => {
    if (!LIVE_AUCTION_ENABLED || saleType !== "auction" || showSoldOnly) return;
    let client: ReturnType<typeof getSupabaseBrowserClient>;
    try {
      client = getSupabaseBrowserClient();
    } catch {
      return;
    }
    const channel = client
      .channel("live-auction-feed-products")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "products" }, (payload) => {
        const snapshot = parseAuctionProductRealtimeSnapshot(payload.new);
        if (!snapshot) return;
        setProducts((current) => current.map((product) => product.id === snapshot.id ? {
          ...product,
          antiSnipingBaseClosesAt: snapshot.antiSnipingBaseClosesAt,
          antiSnipingExtendedAt: snapshot.antiSnipingExtendedAt,
          antiSnipingExtensionCount: snapshot.antiSnipingExtensionCount,
          bidLockedAt: snapshot.bidLockedAt,
          closesAt: snapshot.closesAt,
          currentPrice: snapshot.currentPrice,
          finalBidAmount: snapshot.finalBidAmount,
          participantCount: snapshot.participantCount,
          publishAt: snapshot.publishAt,
          status: snapshot.status,
        } : product));
        if (realtimeRefreshTimer.current !== null) window.clearTimeout(realtimeRefreshTimer.current);
        realtimeRefreshTimer.current = window.setTimeout(() => {
          realtimeRefreshTimer.current = null;
          setRefreshNonce((value) => value + 1);
          if (accountBidCapability === "eligible_member") refreshAccountBids();
        }, 800);
      })
      .subscribe();
    return () => {
      if (realtimeRefreshTimer.current !== null) window.clearTimeout(realtimeRefreshTimer.current);
      realtimeRefreshTimer.current = null;
      void client.removeChannel(channel);
    };
  }, [accountBidCapability, refreshAccountBids, saleType, showSoldOnly]);

  useEffect(() => {
    if (!LIVE_AUCTION_ENABLED || saleType !== "auction" || showSoldOnly) return;
    const refresh = window.setInterval(() => {
      setRefreshNonce((value) => value + 1);
      if (accountBidCapability === "eligible_member") refreshAccountBids();
    }, 30_000);
    return () => window.clearInterval(refresh);
  }, [accountBidCapability, refreshAccountBids, saleType, showSoldOnly]);

  const orderedProducts = useMemo(() => { const ranked = [...products].sort((left, right) => {
    const leftDate = getKoreanFeedDateKey(left.publishAt);
    const rightDate = getKoreanFeedDateKey(right.publishAt);
    if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
    const score = (value: string) => {
      let hash = 2166136261;
      for (const character of `${feedSeed}:${value}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
      return hash >>> 0;
    };
    const leftScore = score(left.id) / (left.storeTier === "premium" ? 1.2 : 1);
    const rightScore = score(right.id) / (right.storeTier === "premium" ? 1.2 : 1);
    return leftScore - rightScore;
  });
    const top: ProductPayload[] = []; const deferred: ProductPayload[] = []; const counts = new Map<string,number>();
    for (const product of ranked) { const store = product.storeId ?? `product:${product.id}`; const count = counts.get(store) ?? 0; if (top.length < 8 && count >= 2) deferred.push(product); else { top.push(product); if (top.length <= 8) counts.set(store,count+1); } }
    return [...top,...deferred];
  }, [feedSeed, products]);

  const cards = useMemo(() => orderedProducts.map((product) => {
    const bidHistory = parsePublicBidHistory(Array.isArray(product.bidHistory) ? product.bidHistory : []);
    const activeBidHistory = bidHistory.filter(isActiveAuctionBid);
    const hasBidHistory = Array.isArray(product.bidHistory) && product.bidHistory.length > 0;
    const imageUrls = product.imageUrls.map((image) => getCatalogImageUrl(image)).filter(Boolean);
    const thumbnailUrls = product.thumbnailUrls.map((image) => getCatalogImageUrl(image)).filter(Boolean);
    const auctionPhase = saleType === "auction" ? getAuctionFeedPhase({
      antiSnipingBaseClosesAt: product.antiSnipingBaseClosesAt ?? null,
      antiSnipingExtendedAt: product.antiSnipingExtendedAt ?? null,
      antiSnipingExtensionCount: product.antiSnipingExtensionCount ?? 0,
      bidLockedAt: product.bidLockedAt ?? null,
      closesAt: product.closesAt,
      publishAt: product.publishAt,
      status: product.status,
    }, now, dailyAuctionPhase) : undefined;
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
      imageUrl: getCatalogImageUrl(product.thumbnailUrls[0] ?? product.imageUrls[0] ?? ""),
      thumbnailUrl: getCatalogImageUrl(product.thumbnailUrls[0] ?? product.imageUrls[0] ?? ""),
      imageUrls,
      thumbnailUrls,
      title: product.title,
      createdAt: product.publishAt,
      startingPrice: product.startingPrice,
      currentBid: product.currentPrice,
      fixedPrice: product.fixedPrice,
      bidCount: hasBidHistory ? activeBidHistory.length : product.participantCount,
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
      soldPrice: product.soldPrice
        ?? product.finalBidAmount
        ?? product.fixedPrice
        ?? product.currentPrice,
      auctionPhase,
      timeLeft: showSoldOnly
        ? "판매 완료"
        : saleType === "fixed"
        ? "재고 있음"
          : dailyAuctionPhase === "closed" && auctionPhase !== "CLOSING_SOON"
          ? "정산 중"
          : auctionPhase === "CLOSED"
            ? "마감됨"
            : getAuctionRemainingLabel(product.closesAt, now),
      enhancedTitle: product.enhancedTitle,
      hashtags: product.hashtags,
    };
  }), [dailyAuctionPhase, now, orderedProducts, saleType, showSoldOnly]);

  const dateKeys = useMemo(() => [...new Set(cards.map((card) => getKoreanFeedDateKey(card.publishAt ?? "")).filter(Boolean))].sort().reverse(), [cards]);
  const effectiveSelectedDate = selectedDate === "today"
      || selectedDate === "all"
      || dateKeys.includes(selectedDate)
    ? selectedDate
    : "all";
  const brandOptions = useMemo(() => ["all", ...new Set(cards.map((card) => card.brand.trim()).filter(Boolean))].sort((a, b) => a === "all" ? -1 : b === "all" ? 1 : a.localeCompare(b, "ko-KR")), [cards]);
  const storeOptions = useMemo(() => {
    const values = [...new Map(orderedProducts.filter((product) => product.storeId && product.storeName).map((product) => [product.storeId as string, product.storeName as string])).entries()];
    const score = (value: string) => { let hash = 0; for (const character of `${feedSeed}:store:${value}`) hash = Math.imul(31, hash) + character.charCodeAt(0) | 0; return hash; };
    return values.sort((left, right) => score(left[0]) - score(right[0])).map(([id, name]) => ({ id, name }));
  }, [feedSeed, orderedProducts]);
  const effectiveSelectedBrand = selectedBrand === "all" || brandOptions.includes(selectedBrand) ? selectedBrand : "all";
  const effectiveSelectedGender = CATALOG_GENDERS.includes(selectedGender) ? selectedGender : "all";
  const bidStateByProduct = useMemo(() => new Map(accountBids.items.map((item) => [item.productId, item.state])), [accountBids.items]);
  const handleBidPlaced = useCallback(() => {
    setRefreshNonce((value) => value + 1);
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

  const visibleCards = useMemo(() => cards.filter((card) => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    const queryMatch = !normalizedQuery
      || `${card.title} ${card.description}`.toLocaleLowerCase("ko-KR")
        .includes(normalizedQuery);
    const cardDate = getKoreanFeedDateKey(card.publishAt ?? "");
    const todayDate = getKoreanFeedDateKey(new Date().toISOString());
    const dateMatch = effectiveSelectedDate === "all"
      || cardDate === (effectiveSelectedDate === "today" ? todayDate : effectiveSelectedDate);
    const brandMatch = effectiveSelectedBrand === "all" || card.brand === effectiveSelectedBrand;
    const genderMatch = effectiveSelectedGender === "all" || card.catalogGender === effectiveSelectedGender;
    const source = productById.get(card.id);
    const storeMatch = selectedStoreId === "all" || source?.storeId === selectedStoreId;
    return queryMatch && dateMatch && brandMatch && genderMatch && storeMatch;
  }), [cards, effectiveSelectedBrand, effectiveSelectedDate, effectiveSelectedGender, productById, query, selectedStoreId]);
  const pagination = useMemo(() => paginateAuctionFeed(visibleCards, page), [page, visibleCards]);

  const urlHasMounted = useRef(false);
  const restoringUrl = useRef(false);

  useEffect(() => {
    const handlePopState = () => {
      restoringUrl.current = true;
      const params = new URLSearchParams(window.location.search);
      setQuery(params.get("q") ?? "");
      setShowSoldOnly(params.get("view") === "sold");
      setSelectedBrand(params.get("brand") ?? "all");
      setSelectedGender((params.get("gender") as CatalogGender | null) ?? "all");
      setSelectedStoreId(params.get("store") ?? "all");
      setSelectedDate(params.get("date") ?? "all");
      const requested = Number(params.get("page"));
      setPage(Number.isSafeInteger(requested) && requested > 0 ? requested : 1);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [saleType]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (query.trim()) params.set("q", query.trim()); else params.delete("q");
    if (pagination.page > 1) params.set("page", String(pagination.page)); else params.delete("page");
    if (effectiveSelectedBrand !== "all") params.set("brand", effectiveSelectedBrand); else params.delete("brand");
    if (effectiveSelectedDate !== "all") params.set("date", effectiveSelectedDate); else params.delete("date");
    if (effectiveSelectedGender !== "all") params.set("gender", effectiveSelectedGender); else params.delete("gender");
    if (selectedStoreId !== "all") params.set("store", selectedStoreId); else params.delete("store");
    if (showSoldOnly) params.set("view", "sold"); else params.delete("view");
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
  }, [effectiveSelectedBrand, effectiveSelectedDate, effectiveSelectedGender, pagination.page, query, saleType, selectedStoreId, showSoldOnly]);

  return (
    <section className={`min-w-0 ${className}`}>
      <div className="mb-6 border-b border-ink pb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] font-bold tracking-[0.14em] text-muted">{saleType === "fixed" ? "즉시 구매 상품" : "실시간 경매 · 21시 마감"}</p>
            <h1 className="text-2xl font-black tracking-[-0.05em]">{title ?? (saleType === "fixed" ? "상시 즉시 구매" : "오늘의 경매")}</h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="font-mono text-xs font-bold tabular-nums text-muted">{loading ? "—" : `${visibleCards.length}개 상품`}</span>
            <button
              aria-pressed={showSoldOnly}
              className={`h-10 border px-4 text-xs font-bold transition-colors ${showSoldOnly ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:border-ink"}`}
              onClick={() => {
                setShowSoldOnly((current) => !current);
                setPage(1);
              }}
              type="button"
            >
              {showSoldOnly ? "판매 중 상품 보기" : "판매 완료 상품만 보기"}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <div className={`grid grid-cols-2 gap-y-8 ${surface === "desktop" ? "grid-cols-4 gap-x-5" : "gap-x-3 min-[700px]:grid-cols-3"}`}>{Array.from({ length: 12 }).map((_, index) => <div aria-hidden="true" className="aspect-[4/5] animate-pulse bg-surface" key={index} />)}</div>}
      {!loading && !error && visibleCards.length === 0 && <div className="grid min-h-64 place-items-center border border-dashed border-line px-6 text-center"><div><p className="text-sm font-bold">{showSoldOnly ? "판매 완료 상품이 없습니다." : "현재 조건에 맞는 상품이 없습니다."}</p><p className="mt-2 text-xs text-muted">{showSoldOnly ? "판매 중 상품 보기로 돌아갈 수 있습니다." : "필터를 초기화하거나 새로운 드롭을 기다려 주세요."}</p></div></div>}
      {!loading && visibleCards.length > 0 && <><div className={`grid grid-cols-2 gap-y-9 ${surface === "desktop" ? "grid-cols-4 gap-x-5" : "gap-x-3 min-[700px]:grid-cols-3"}`}>{pagination.items.map((item) => { const source = productById.get(item.id); return <div key={item.id}>{showSoldOnly ? <SoldFeedCard basePath={basePath} brand={item.brand} id={item.id} imageUrl={item.imageUrl} saleType={item.saleType} soldAt={item.soldAt} soldPrice={item.soldPrice} surface={surface} title={item.title} /> : saleType === "auction" ? <AuctionFeedCard basePath={basePath} bidCapability={accountBidCapability} item={item} onBidPlaced={handleBidPlaced} participationState={bidStateByProduct.get(item.id)} surface={surface} /> : <AuctionCard basePath={basePath} item={item} surface={surface} />}{source?.storeName && <Link className="mt-2 inline-flex text-[10px] font-bold text-muted underline" href={`${basePath}/stores/${encodeURIComponent(source.storeSlug ?? source.storeId ?? "")}`}>센터 · {source.storeName}</Link>}</div>; })}</div><nav aria-label="상품 페이지 이동" className="mt-8 flex items-center justify-center gap-2"><button className="h-10 border border-line px-4 text-xs font-bold disabled:opacity-35" disabled={pagination.page <= 1} onClick={() => setPage(pagination.page - 1)} type="button">이전</button>{Array.from({ length: pagination.pageCount }, (_, index) => index + 1).map((pageNumber) => <button aria-current={pageNumber === pagination.page ? "page" : undefined} aria-label={`${pageNumber}페이지`} className={`size-10 border font-mono text-xs font-bold ${pageNumber === pagination.page ? "border-ink bg-ink text-paper" : "border-line"}`} key={pageNumber} onClick={() => setPage(pageNumber)} type="button">{pageNumber}</button>)}<button className="h-10 border border-line px-4 text-xs font-bold disabled:opacity-35" disabled={pagination.page >= pagination.pageCount} onClick={() => setPage(pagination.page + 1)} type="button">다음</button></nav><p className="mt-3 text-center font-mono text-[10px] text-muted">{pagination.page} / {pagination.pageCount}페이지 · 페이지당 {AUCTION_FEED_PAGE_SIZE}개</p></>}
    </section>
  );
}
