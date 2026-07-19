"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProductSaleType } from "@/types/auction";
import { AuctionCard } from "@/components/features/auction/AuctionCard";
import { DEMO_PRODUCTS } from "@/lib/catalog";

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
  imageUrls: string[];
  thumbnailUrls: string[];
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
  return remaining > 0 ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}` : "마감";
}

export function AuctionFeedGrid({ className = "", saleType = "auction", title }: AuctionFeedGridProps) {
  const [products, setProducts] = useState<ProductPayload[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"latest" | "ending" | "price_asc" | "price_desc">("latest");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: "100", saleType, sort });
    if (query.trim()) params.set("q", query.trim());
    fetch(`/api/products?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("상품 목록을 불러오지 못했습니다.");
        return response.json() as Promise<{ products?: ProductPayload[] }>;
      })
      .then((payload) => setProducts(Array.isArray(payload.products) && payload.products.length > 0 ? payload.products : DEMO_PRODUCTS.filter((product) => product.saleType === saleType) as unknown as ProductPayload[]))
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError("");
        setProducts(DEMO_PRODUCTS.filter((product) => product.saleType === saleType) as unknown as ProductPayload[]);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [query, saleType, sort]);

  const cards = useMemo(() => products.map((product) => ({
    id: product.id,
    auctionId: product.id,
    name: product.title,
    brand: "NINETY-NINE VINTAGE",
    category: product.category,
    description: product.description,
    imageUrl: product.thumbnailUrls[0] ?? product.imageUrls[0] ?? "",
    thumbnailUrl: product.thumbnailUrls[0] ?? product.imageUrls[0] ?? "",
    startingPrice: product.startingPrice,
    currentBid: product.currentPrice,
    fixedPrice: product.fixedPrice,
    bidCount: product.participantCount,
    status: product.status,
    saleType: product.saleType,
    closesAt: product.closesAt,
    publishAt: product.publishAt,
    bidIncrement: product.bidIncrement,
    timeLeft: remainingLabel(product.closesAt),
  })), [products]);

  return (
    <section className={`min-w-0 ${className}`}>
      <div className="mb-6 border-b border-ink pb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] font-bold tracking-[0.14em] text-muted">{saleType === "fixed" ? "SHOP / BUY NOW" : "LIVE AUCTION / 21:00 KST CLOSE"}</p>
            <h1 className="text-2xl font-black tracking-[-0.05em]">{title ?? (saleType === "fixed" ? "상시 바로구매" : "LIVE DROP")}</h1>
          </div>
          <span className="font-mono text-xs font-bold tabular-nums text-muted">{loading ? "—" : `${cards.length} ITEMS`}</span>
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
              <option value="ending">마감 임박순</option>
              <option value="price_desc">가격 높은순</option>
              <option value="price_asc">가격 낮은순</option>
            </select>
          </label>
        </div>
      </div>

      {error && <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && <div className="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{Array.from({ length: 10 }).map((_, index) => <div aria-hidden="true" className="aspect-[4/5] animate-pulse bg-surface" key={index} />)}</div>}
      {!loading && !error && cards.length === 0 && <div className="grid min-h-64 place-items-center border border-dashed border-line px-6 text-center"><div><p className="text-sm font-bold">현재 공개된 상품이 없습니다.</p><p className="mt-2 text-xs text-muted">새로운 드롭이 준비되면 이곳에 표시됩니다.</p></div></div>}
      {!loading && cards.length > 0 && <div className="grid grid-cols-2 gap-x-3 gap-y-9 md:grid-cols-3 lg:grid-cols-4 lg:gap-x-5 xl:grid-cols-5">{cards.map((item) => <AuctionCard item={item} key={item.id} />)}</div>}
    </section>
  );
}
