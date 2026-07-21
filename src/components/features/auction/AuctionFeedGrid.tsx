"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AuctionPost, ProductSaleType } from "@/types/auction";
import { AuctionCard } from "@/components/features/auction/AuctionCard";
import { AuctionBidSummary, useAccountAuctionBids } from "@/components/features/auction/AuctionBidSummary";
import { AuctionFeedCard } from "@/components/features/auction/AuctionFeedCard";
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
  sortCatalogProducts,
  type CatalogProductSort,
} from "@/lib/catalog/pagination";
import { getCatalogImageUrl } from "@/lib/images";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";
import { getDailyAuctionPhase } from "@/utils/auctionBidPolicy";
import { getCatalogCategory, getCatalogGender, type CatalogCategory, type CatalogGender } from "@/utils/catalogFilters";

const CATALOG_CATEGORIES: readonly CatalogCategory[] = ["all", "아우터", "셔츠", "티셔츠", "니트", "팬츠", "데님", "스커트", "원피스", "기타"];
const CATALOG_GENDERS: readonly CatalogGender[] = ["all", "남성", "여성", "공용"];

export interface ProductPayload {
  id: string;
  title: string;
  description: string;
  category: string;
  brand: string;
  brandSlug: string;
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
}

interface CatalogFilters {
  sizes: string[];
  categories: string[];
  liveOnly: boolean;
  closingOnly: boolean;
  sort: CatalogProductSort;
}

interface AuctionFeedGridProps {
  className?: string;
  initialProducts?: ProductPayload[];
  saleType: ProductSaleType;
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
  query: string;
  saleType: ProductSaleType;
  signal: AbortSignal;
}): Promise<ProductPayload[]> {
  let offset = 0;
  let products: ProductPayload[] = [];

  for (let batchIndex = 0; batchIndex < MAX_CATALOG_FETCH_BATCHES; batchIndex += 1) {
    input.signal.throwIfAborted();
    const params = new URLSearchParams({
      limit: String(CATALOG_FETCH_BATCH_SIZE),
      offset: String(offset),
      saleType: input.saleType,
      sort: "latest",
    });
    if (input.query.trim()) params.set("q", input.query.trim());

    const response = await fetch(`/api/products?${params.toString()}`, {
      cache: "no-store",
      signal: input.signal,
    });
    if (!response.ok) throw new Error("상품 목록을 불러오지 못했습니다.");
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

function dateFilterLabel(dateKey: string) {
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

export function AuctionFeedGrid(props: AuctionFeedGridProps) {
  if (props.saleType === "auction" && !LIVE_AUCTION_ENABLED) {
    return <section className={`grid min-h-64 place-items-center border border-dashed border-line bg-surface px-6 text-center ${props.className ?? ""}`}><div><p className="text-sm font-bold">라이브 경매 점검 중</p><p className="mt-2 text-xs text-muted">일반 바로 구매 상품은 정상적으로 이용할 수 있습니다.</p></div></section>;
  }
  return <EnabledAuctionFeedGrid {...props} />;
}

function EnabledAuctionFeedGrid({ className = "", initialProducts, saleType, title }: AuctionFeedGridProps) {
  const routeSearchParams = useSearchParams();
  const routeQuery = routeSearchParams.get("q") ?? "";
  const policyNow = useAuctionPolicyClock(saleType === "auction");
  const now = policyNow.getTime();
  const dailyAuctionPhase = now > 0 ? getDailyAuctionPhase(now) : "open";
  const [products, setProducts] = useState<ProductPayload[]>(initialProducts ?? []);
  const [query, setQuery] = useState(routeQuery);
  const [sort, setSort] = useState<CatalogProductSort>(saleType === "fixed" ? "latest" : "ending");
  const [filters, setFilters] = useState<CatalogFilters>({ sizes: [], categories: [], liveOnly: true, closingOnly: false, sort: saleType === "fixed" ? "latest" : "ending" });
  const [selectedDate, setSelectedDate] = useState("all");
  const [selectedBrand, setSelectedBrand] = useState(() => routeSearchParams.get("brand") ?? "all");
  const [selectedCatalogCategory, setSelectedCatalogCategory] = useState<CatalogCategory>(() => (routeSearchParams.get("category") as CatalogCategory | null) ?? "all");
  const [selectedGender, setSelectedGender] = useState<CatalogGender>(() => (routeSearchParams.get("gender") as CatalogGender | null) ?? "all");
  const [page, setPage] = useState(() => {
    const requested = Number(routeSearchParams.get("page"));
    return Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  });
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loading, setLoading] = useState(initialProducts === undefined);
  const [error, setError] = useState("");
  const accountBids = useAccountAuctionBids(saleType === "auction");
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
      setFilters(next);
      setSort(next.sort);
      setPage(1);
    };
    window.addEventListener("catalog-filters", receiveFilters);
    return () => window.removeEventListener("catalog-filters", receiveFilters);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchCompleteProductCatalog({ query, saleType, signal: controller.signal })
      .then((nextProducts) => { setError(""); setProducts(nextProducts); })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError("상품 목록을 불러오지 못했습니다.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, refreshNonce, saleType]);

  useEffect(() => {
    if (!LIVE_AUCTION_ENABLED || saleType !== "auction") return;
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
  }, [accountBidCapability, refreshAccountBids, saleType]);

  useEffect(() => {
    if (!LIVE_AUCTION_ENABLED || saleType !== "auction") return;
    const refresh = window.setInterval(() => {
      setRefreshNonce((value) => value + 1);
      if (accountBidCapability === "eligible_member") refreshAccountBids();
    }, 30_000);
    return () => window.clearInterval(refresh);
  }, [accountBidCapability, refreshAccountBids, saleType]);

  const sortedProducts = useMemo(() => sortCatalogProducts(products, sort), [products, sort]);

  const cards = useMemo(() => sortedProducts.map((product) => {
    const bidHistory = parsePublicBidHistory(Array.isArray(product.bidHistory) ? product.bidHistory : []);
    const activeBidHistory = bidHistory.filter(isActiveAuctionBid);
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
      imageUrl: getCatalogImageUrl(product.thumbnailUrls[0] ?? product.imageUrls[0] ?? ""),
      thumbnailUrl: getCatalogImageUrl(product.thumbnailUrls[0] ?? product.imageUrls[0] ?? ""),
      imageUrls,
      thumbnailUrls,
      title: product.title,
      createdAt: product.publishAt,
      startingPrice: product.startingPrice,
      currentBid: product.currentPrice,
      fixedPrice: product.fixedPrice,
      bidCount: activeBidHistory.length > 0 ? activeBidHistory.length : product.participantCount,
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
      catalogCategory: getCatalogCategory(catalogPost),
      catalogGender: getCatalogGender(catalogPost),
      auctionPhase,
      timeLeft: saleType === "fixed"
        ? "재고 있음"
        : dailyAuctionPhase === "closed" && auctionPhase !== "CLOSING_SOON"
          ? "정산 중"
          : auctionPhase === "CLOSED"
            ? "마감"
            : getAuctionRemainingLabel(product.closesAt, now),
    };
  }), [dailyAuctionPhase, now, saleType, sortedProducts]);

  const dateKeys = useMemo(() => [...new Set(cards.map((card) => getKoreanFeedDateKey(card.publishAt ?? "")).filter(Boolean))].sort().reverse(), [cards]);
  const effectiveSelectedDate = selectedDate === "all" || dateKeys.includes(selectedDate) ? selectedDate : "all";
  const brandOptions = useMemo(() => ["all", ...new Set(cards.map((card) => card.brand.trim()).filter(Boolean))].sort((a, b) => a === "all" ? -1 : b === "all" ? 1 : a.localeCompare(b, "ko-KR")), [cards]);
  const effectiveSelectedBrand = selectedBrand === "all" || brandOptions.includes(selectedBrand) ? selectedBrand : "all";
  const effectiveSelectedCategory = CATALOG_CATEGORIES.includes(selectedCatalogCategory) ? selectedCatalogCategory : "all";
  const effectiveSelectedGender = CATALOG_GENDERS.includes(selectedGender) ? selectedGender : "all";
  const bidStateByProduct = useMemo(() => new Map(accountBids.items.map((item) => [item.productId, item.state])), [accountBids.items]);
  const handleBidPlaced = useCallback(() => {
    setRefreshNonce((value) => value + 1);
    refreshAccountBids();
  }, [refreshAccountBids]);

  const visibleCards = useMemo(() => cards.filter((card) => {
    const sizeMatch = filters.sizes.length === 0 || filters.sizes.includes(card.sizeLabel);
    const categoryMatch = filters.categories.length === 0 || filters.categories.includes(card.category);
    const liveMatch = !filters.liveOnly || saleType === "fixed" || card.auctionPhase !== "CLOSED";
    const closingMatch = !filters.closingOnly || (saleType === "auction" && card.auctionPhase === "CLOSING_SOON");
    const dateMatch = effectiveSelectedDate === "all" || getKoreanFeedDateKey(card.publishAt ?? "") === effectiveSelectedDate;
    const brandMatch = effectiveSelectedBrand === "all" || card.brand === effectiveSelectedBrand;
    const catalogCategoryMatch = effectiveSelectedCategory === "all" || card.catalogCategory === effectiveSelectedCategory;
    const genderMatch = effectiveSelectedGender === "all" || card.catalogGender === effectiveSelectedGender;
    return sizeMatch && categoryMatch && liveMatch && closingMatch && dateMatch && brandMatch && catalogCategoryMatch && genderMatch;
  }), [cards, effectiveSelectedBrand, effectiveSelectedCategory, effectiveSelectedDate, effectiveSelectedGender, filters, saleType]);
  const pagination = useMemo(() => paginateAuctionFeed(visibleCards, page), [page, visibleCards]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (pagination.page > 1) params.set("page", String(pagination.page)); else params.delete("page");
    if (effectiveSelectedBrand !== "all") params.set("brand", effectiveSelectedBrand); else params.delete("brand");
    if (effectiveSelectedCategory !== "all") params.set("category", effectiveSelectedCategory); else params.delete("category");
    if (effectiveSelectedGender !== "all") params.set("gender", effectiveSelectedGender); else params.delete("gender");
    const queryString = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`);
  }, [effectiveSelectedBrand, effectiveSelectedCategory, effectiveSelectedGender, pagination.page]);

  return (
    <section className={`min-w-0 ${className}`}>
      <div className="mb-6 border-b border-ink pb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] font-bold tracking-[0.14em] text-muted">{saleType === "fixed" ? "즉시 구매 상품" : "실시간 경매 · 21시 마감"}</p>
            <h1 className="text-2xl font-black tracking-[-0.05em]">{title ?? (saleType === "fixed" ? "상시 즉시 구매" : "오늘의 경매")}</h1>
          </div>
          <span className="font-mono text-xs font-bold tabular-nums text-muted">{loading ? "—" : `${visibleCards.length}개 상품`}</span>
        </div>
        <div className="mt-5 flex flex-col gap-2 ">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 border border-line bg-surface px-3 focus-within:border-ink">
            <Search size={16} className="shrink-0 text-muted" />
            <input aria-label="상품 검색" className="min-w-0 flex-1 bg-transparent text-sm outline-none" onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="상품명·설명 검색" value={query} />
          </label>
          <label className="flex h-11 items-center gap-2 border border-line px-3 text-xs font-bold">
            <SlidersHorizontal size={14} />
            <select aria-label="상품 정렬" className="bg-transparent outline-none" onChange={(event) => { setSort(event.target.value as typeof sort); setPage(1); }} value={sort}>
              <option value="latest">최신 등록순</option>
            {saleType === "auction" && <option value="ending">마감 임박순</option>}
              <option value="price_desc">가격 높은순</option>
              <option value="price_asc">가격 낮은순</option>
            </select>
          </label>
        </div>
        <div aria-label="상품 상세 필터" className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="grid gap-1 text-[9px] font-bold tracking-[0.1em] text-muted">브랜드<select className="h-10 border border-line bg-paper px-3 text-xs font-bold text-ink" onChange={(event) => { setSelectedBrand(event.target.value); setPage(1); }} value={effectiveSelectedBrand}>{brandOptions.map((brand) => <option key={brand} value={brand}>{brand === "all" ? "모든 브랜드" : brand}</option>)}</select></label>
          <label className="grid gap-1 text-[9px] font-bold tracking-[0.1em] text-muted">카테고리<select className="h-10 border border-line bg-paper px-3 text-xs font-bold text-ink" onChange={(event) => { setSelectedCatalogCategory(event.target.value as CatalogCategory); setPage(1); }} value={effectiveSelectedCategory}>{CATALOG_CATEGORIES.map((category) => <option key={category} value={category}>{category === "all" ? "모든 카테고리" : category}</option>)}</select></label>
          <label className="grid gap-1 text-[9px] font-bold tracking-[0.1em] text-muted">성별<select className="h-10 border border-line bg-paper px-3 text-xs font-bold text-ink" onChange={(event) => { setSelectedGender(event.target.value as CatalogGender); setPage(1); }} value={effectiveSelectedGender}>{CATALOG_GENDERS.map((gender) => <option key={gender} value={gender}>{gender === "all" ? "모든 성별" : gender}</option>)}</select></label>
        </div>
        {dateKeys.length > 1 && <nav aria-label="상품 등록 날짜 선택" className="mt-4 flex gap-2 overflow-x-auto pb-1"><button aria-pressed={effectiveSelectedDate === "all"} className={`h-9 shrink-0 border px-4 text-[10px] font-bold ${effectiveSelectedDate === "all" ? "border-ink bg-ink text-paper" : "border-line bg-paper text-muted"}`} onClick={() => { setSelectedDate("all"); setPage(1); }} type="button">전체 날짜</button>{dateKeys.map((dateKey) => <button aria-pressed={effectiveSelectedDate === dateKey} className={`h-9 shrink-0 border px-4 text-[10px] font-bold ${effectiveSelectedDate === dateKey ? "border-ink bg-ink text-paper" : "border-line bg-paper text-muted"}`} key={dateKey} onClick={() => { setSelectedDate(dateKey); setPage(1); }} type="button">{dateFilterLabel(dateKey)}</button>)}</nav>}
      </div>

      {saleType === "auction" && <AuctionBidSummary snapshot={accountBids} />}

      {error && <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <div className="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-4 md:gap-x-5">{Array.from({ length: 12 }).map((_, index) => <div aria-hidden="true" className="aspect-[4/5] animate-pulse bg-surface" key={index} />)}</div>}
      {!loading && !error && visibleCards.length === 0 && <div className="grid min-h-64 place-items-center border border-dashed border-line px-6 text-center"><div><p className="text-sm font-bold">현재 조건에 맞는 상품이 없습니다.</p><p className="mt-2 text-xs text-muted">필터를 초기화하거나 새로운 드롭을 기다려 주세요.</p></div></div>}
      {!loading && visibleCards.length > 0 && <><div className="grid grid-cols-2 gap-x-3 gap-y-9 md:grid-cols-4 md:gap-x-5">{pagination.items.map((item) => saleType === "auction" ? <AuctionFeedCard bidCapability={accountBidCapability} item={item} key={item.id} onBidPlaced={handleBidPlaced} participationState={bidStateByProduct.get(item.id)} /> : <AuctionCard item={item} key={item.id} />)}</div><nav aria-label="경매 상품 페이지 이동" className="mt-8 flex items-center justify-center gap-2"><button className="h-10 border border-line px-4 text-xs font-bold disabled:opacity-35" disabled={pagination.page <= 1} onClick={() => setPage(pagination.page - 1)} type="button">이전</button>{Array.from({ length: pagination.pageCount }, (_, index) => index + 1).map((pageNumber) => <button aria-current={pageNumber === pagination.page ? "page" : undefined} aria-label={`${pageNumber}페이지`} className={`size-10 border font-mono text-xs font-bold ${pageNumber === pagination.page ? "border-ink bg-ink text-paper" : "border-line"}`} key={pageNumber} onClick={() => setPage(pageNumber)} type="button">{pageNumber}</button>)}<button className="h-10 border border-line px-4 text-xs font-bold disabled:opacity-35" disabled={pagination.page >= pagination.pageCount} onClick={() => setPage(pagination.page + 1)} type="button">다음</button></nav><p className="mt-3 text-center font-mono text-[10px] text-muted">{pagination.page} / {pagination.pageCount}페이지 · 페이지당 {AUCTION_FEED_PAGE_SIZE}개</p></>}
    </section>
  );
}
