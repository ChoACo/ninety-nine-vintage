"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SoldFeedCard } from "@/components/features/auction/SoldFeedCard";
import type { DailyAuctionPhase } from "@/utils/auctionBidPolicy";
import type { ProductSaleType } from "@/types/auction";

interface AuctionInactiveTeaserProps {
  basePath?: "" | "/m";
  dailyPhase: DailyAuctionPhase;
  onViewSold: () => void;
  surface?: "desktop" | "mobile";
}

interface SoldTeaserProduct {
  id: string;
  title: string;
  brand: string;
  saleType: ProductSaleType;
  soldAt: string;
  soldPrice: number;
  imageUrl: string;
  imageUrls?: string[];
  thumbnailUrls?: string[];
  closesAt?: string;
  finalBidAmount?: number | null;
  fixedPrice?: number | null;
  currentPrice?: number;
}

const TEASER_PRODUCT_LIMIT = 8;

export function AuctionInactiveTeaser({
  basePath = "",
  dailyPhase,
  onViewSold,
  surface = "desktop",
}: AuctionInactiveTeaserProps) {
  const [products, setProducts] = useState<SoldTeaserProduct[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(
      `/api/products?limit=${TEASER_PRODUCT_LIMIT}&saleType=auction&view=sold`,
      {
        cache: "no-store",
        signal: controller.signal,
      },
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error("판매 완료 상품을 불러오지 못했습니다.");
        }
        return response.json() as Promise<{ products?: SoldTeaserProduct[] }>;
      })
      .then((payload) => {
        const batch = Array.isArray(payload.products) ? payload.products : [];
        setProducts(
          batch.slice(0, TEASER_PRODUCT_LIMIT).map((product) => ({
            ...product,
            imageUrl:
              product.imageUrl ??
              product.imageUrls?.[0] ??
              product.thumbnailUrls?.[0] ??
              "",
            soldAt: product.soldAt ?? product.closesAt ?? "",
            soldPrice:
              product.soldPrice ??
              product.finalBidAmount ??
              product.fixedPrice ??
              product.currentPrice ??
              0,
          })),
        );
      })
      .catch(() => setProducts([]));
    return () => controller.abort();
  }, []);

  const scheduleMessage =
    dailyPhase === "closed"
      ? "오후 9시부터 10시까지 경매 마감 및 동기화 점검 중입니다. 미판매 상품은 오후 10시부터 다시 입찰할 수 있습니다."
      : "현재 진행 중인 경매가 없습니다. 다음 경매는 매일 오전 10시에 시작됩니다.";
  const teaserGridClass =
    surface === "desktop"
      ? "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-4 lg:gap-5 xl:grid-cols-5 2xl:grid-cols-6"
      : "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-3 md:gap-6 lg:grid-cols-4";

  return (
    <section
      aria-labelledby="auction-inactive-heading"
      className="border-t border-line pt-8"
    >
      <div className="mb-8 border border-dashed border-line bg-surface px-6 py-8 text-center">
        <p id="auction-inactive-heading" className="text-sm font-bold">
          경매 비활성 시간대
        </p>
        <p className="mt-2 text-xs text-muted">{scheduleMessage}</p>
        <button
          className="mt-4 inline-flex h-10 items-center justify-center border border-ink bg-ink px-5 text-xs font-bold text-paper transition-colors hover:bg-paper hover:text-ink"
          onClick={onViewSold}
          type="button"
        >
          판매 완료 상품 보기
        </button>
      </div>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] font-bold tracking-[0.14em] text-muted">
            판매 완료 상품 미리보기
          </p>
          <h2 className="text-xl font-black tracking-[-0.05em]">
            최근 판매 완료 상품
          </h2>
        </div>
        <button
          className="h-10 border border-line bg-paper px-4 text-xs font-bold text-ink transition-colors hover:border-ink"
          onClick={onViewSold}
          type="button"
        >
          판매 완료 상품만 보기
        </button>
      </div>

      {products === null ? (
        <div className={teaserGridClass}>
          {Array.from({ length: Math.min(8, TEASER_PRODUCT_LIMIT) }).map(
            (_, index) => (
              <div
                aria-hidden="true"
                className="mx-auto aspect-[3/4] w-full max-w-[260px] animate-pulse rounded-xl bg-surface"
                key={index}
              />
            ),
          )}
        </div>
      ) : products.length > 0 ? (
        <div className={teaserGridClass}>
          {products.map((product) => (
            <div className="mx-auto w-full max-w-[260px]" key={product.id}>
              <SoldFeedCard
                basePath={basePath}
                brand={product.brand}
                id={product.id}
                imageUrl={product.imageUrl}
                saleType={product.saleType}
                soldAt={product.soldAt}
                soldPrice={product.soldPrice}
                surface={surface}
                title={product.title}
              />
              <Link
                className="mt-2 inline-flex text-[10px] font-bold text-muted underline"
                href={`${basePath}/sold/${encodeURIComponent(product.id)}`}
              >
                판매 완료 기록 보기
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid min-h-40 place-items-center border border-dashed border-line px-6 text-center">
          <p className="text-xs font-bold text-muted">
            아직 판매 완료 상품이 없습니다. 다음 경매 오픈을 기다려 주세요.
          </p>
        </div>
      )}
    </section>
  );
}
