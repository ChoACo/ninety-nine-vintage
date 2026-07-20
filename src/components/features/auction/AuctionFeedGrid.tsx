"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ProductSaleType } from "@/types/auction";
import { AuctionCard } from "@/components/features/auction/AuctionCard";
import { AuctionBidSummary } from "@/components/features/auction/AuctionBidSummary";
import { AuctionFeedCard, type AuctionFeedPhase } from "@/components/features/auction/AuctionFeedCard";
import { getCatalogImageUrl } from "@/lib/images";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface ProductPayload {
  id: string;
  title: string;
  description: string;
  category: string;
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
  imageUrls: string[];
  thumbnailUrls: string[];
  sizeLabel: string;
}

interface CatalogFilters {
  sizes: string[];
  categories: string[];
  liveOnly: boolean;
  closingOnly: boolean;
  sort: "latest" | "ending" | "price_asc" | "price_desc";
}

interface AuctionFeedGridProps {
  className?: string;
  saleType?: ProductSaleType;
  title?: string;
}

function remainingLabel(closesAt: string) {
  const remaining = Math.max(0, new Date(closesAt).getTime() - Date.now());
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return remaining > 0 ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : "마감";
}

function auctionPhase(closesAt: string, now: number): AuctionFeedPhase {
  if (!now) return "OPEN";
  const closeTime = new Date(closesAt).getTime();
  if (!Number.isFinite(closeTime) || closeTime <= now) return "CLOSED";
  if (closeTime - now <= 4 * 60 * 1000) return "CLOSING_SOON";
  return "OPEN";
}

export function AuctionFeedGrid({ className = "", saleType = "auction", title }: AuctionFeedGridProps) {
  const routeSearchParams = useSearchParams();
  const routeQuery = routeSearchParams.get("q") ?? "";
  const [products, setProducts] = useState<ProductPayload[]>([]);
  const [query, setQuery] = useState(routeQuery);
  const [sort, setSort] = useState<"latest" | "ending" | "price_asc" | "price_desc">(saleType === "fixed" ? "latest" : "ending");
  const [filters, setFilters] = useState<CatalogFilters>({ sizes: [], categories: [], liveOnly: true, closingOnly: false, sort: saleType === "fixed" ? "latest" : "ending" });
  const [now, setNow] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const lastRouteQuery = useRef(routeQuery);
  const realtimeRefreshTimer = useRef<number | null>(null);

  useEffect(() => {
    if (routeQuery === lastRouteQuery.current) return;
    lastRouteQuery.current = routeQuery;
    setQuery(routeQuery);
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
    };
    window.addEventListener("catalog-filters", receiveFilters);
    return () => window.removeEventListener("catalog-filters", receiveFilters);
  }, []);

  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    updateNow();
    const interval = window.setInterval(updateNow, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: "100", saleType, sort });
    if (query.trim()) params.set("q", query.trim());
    fetch(`/api/products?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("상품 목록을 불러오지 못했습니다.");
        return response.json() as Promise<{ products?: ProductPayload[] }>;
      })
      .then((payload) => { setError(""); setProducts(Array.isArray(payload.products) ? payload.products : []); })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError("상품 목록을 불러오지 못했습니다.");
        setProducts([]);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, refreshNonce, saleType, sort]);

  useEffect(() => {
    if (saleType !== "auction") return;
    let client: ReturnType<typeof getSupabaseBrowserClient>;
    try {
      client = getSupabaseBrowserClient();
    } catch {
      return;
    }
    const channel = client
      .channel("live-auction-feed-bids")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "auction_bids" }, (payload) => {
        const row = payload.new as Record<string, unknown>;
        const productId = typeof row.product_id === "string" ? row.product_id : "";
        const amount = typeof row.amount === "number" ? row.amount : Number(row.amount);
        if (!productId || !Number.isSafeInteger(amount)) return;
        setProducts((current) => current.map((product) => product.id === productId ? { ...product, currentPrice: Math.max(product.currentPrice, amount) } : product));
        if (realtimeRefreshTimer.current !== null) window.clearTimeout(realtimeRefreshTimer.current);
        realtimeRefreshTimer.current = window.setTimeout(() => {
          realtimeRefreshTimer.current = null;
          setRefreshNonce((value) => value + 1);
        }, 800);
      })
      .subscribe();
    return () => {
      if (realtimeRefreshTimer.current !== null) window.clearTimeout(realtimeRefreshTimer.current);
      realtimeRefreshTimer.current = null;
      void client.removeChannel(channel);
    };
  }, [saleType]);

  useEffect(() => {
    if (saleType !== "auction") return;
    const refresh = window.setInterval(() => setRefreshNonce((value) => value + 1), 30_000);
    return () => window.clearInterval(refresh);
  }, [saleType]);

  const cards = useMemo(() => products.map((product) => ({
    id: product.id,
    auctionId: product.id,
    name: product.title,
    brand: "NINETY-NINE VINTAGE",
    category: product.category,
    description: product.description,
    imageUrl: getCatalogImageUrl(product.thumbnailUrls[0] ?? product.imageUrls[0] ?? ""),
    thumbnailUrl: getCatalogImageUrl(product.thumbnailUrls[0] ?? product.imageUrls[0] ?? ""),
    startingPrice: product.startingPrice,
    currentBid: product.currentPrice,
    fixedPrice: product.fixedPrice,
    bidCount: Array.isArray(product.bidHistory) ? product.bidHistory.length : product.participantCount,
    participantCount: product.participantCount,
    status: product.status,
    saleType: product.saleType,
    closesAt: product.closesAt,
    publishAt: product.publishAt,
    bidIncrement: product.bidIncrement,
    sizeLabel: product.sizeLabel,
    auctionPhase: saleType === "auction" ? auctionPhase(product.closesAt, now) : undefined,
    timeLeft: saleType === "fixed" ? "IN STOCK" : remainingLabel(product.closesAt),
  })), [now, products, saleType]);

  const visibleCards = useMemo(() => cards.filter((card) => {
    const sizeMatch = filters.sizes.length === 0 || filters.sizes.includes(card.sizeLabel);
    const categoryMatch = filters.categories.length === 0 || filters.categories.includes(card.category);
    const liveMatch = !filters.liveOnly || saleType === "fixed" || card.auctionPhase !== "CLOSED";
    const closingMatch = !filters.closingOnly || (saleType === "auction" && card.auctionPhase === "CLOSING_SOON");
    return sizeMatch && categoryMatch && liveMatch && closingMatch;
  }), [cards, filters, saleType]);

  return (
    <section className={`min-w-0 ${className}`}>
      <div className="mb-6 border-b border-ink pb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] font-bold tracking-[0.14em] text-muted">{saleType === "fixed" ? "SHOP / BUY NOW" : "LIVE AUCTION / 21:00 KST CLOSE"}</p>
            <h1 className="text-2xl font-black tracking-[-0.05em]">{title ?? (saleType === "fixed" ? "상시 바로구매" : "LIVE DROP")}</h1>
          </div>
          <span className="font-mono text-xs font-bold tabular-nums text-muted">{loading ? "—" : `${visibleCards.length} ITEMS`}</span>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 border border-line bg-surface px-3 focus-within:border-ink">
            <Search size={16} className="shrink-0 text-muted" />
            <input aria-label="상품 검색" className="min-w-0 flex-1 bg-transparent text-sm outline-none" onChange={(event) => setQuery(event.target.value)} placeholder="상품명·설명 검색" value={query} />
          </label>
          <label className="flex h-11 items-center gap-2 border border-line px-3 text-xs font-bold">
            <SlidersHorizontal size={14} />
            <select aria-label="상품 정렬" className="bg-transparent outline-none" onChange={(event) => setSort(event.target.value as typeof sort)} value={sort}>
              <option value="latest">최신 등록순</option>
            {saleType === "auction" && <option value="ending">마감 임박순</option>}
              <option value="price_desc">가격 높은순</option>
              <option value="price_asc">가격 낮은순</option>
            </select>
          </label>
        </div>
      </div>

      {saleType === "auction" && <AuctionBidSummary />}

      {error && <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <div className="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{Array.from({ length: 10 }).map((_, index) => <div aria-hidden="true" className="aspect-[4/5] animate-pulse bg-surface" key={index} />)}</div>}
      {!loading && !error && visibleCards.length === 0 && <div className="grid min-h-64 place-items-center border border-dashed border-line px-6 text-center"><div><p className="text-sm font-bold">현재 조건에 맞는 상품이 없습니다.</p><p className="mt-2 text-xs text-muted">필터를 초기화하거나 새로운 드롭을 기다려 주세요.</p></div></div>}
      {!loading && visibleCards.length > 0 && <div className="grid grid-cols-2 gap-x-3 gap-y-9 md:grid-cols-3 lg:grid-cols-4 lg:gap-x-5 xl:grid-cols-5">{visibleCards.map((item) => saleType === "auction" ? <AuctionFeedCard item={item} key={item.id} /> : <AuctionCard item={item} key={item.id} />)}</div>}
    </section>
  );
}
