"use client";

/* eslint-disable @next/next/no-img-element -- Versioned local banner srcsets bypass the disabled deployment image optimizer. */
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { CatalogImage } from "@/components/ui/CatalogImage";

export interface HomeFeaturedAuctionItem {
  brand: string;
  currentPrice: number;
  id: string;
  imageUrl: string;
  title: string;
}

const fallbackBanners = {
  desktop: {
    height: 1080,
    sizes: "570px",
    src: "/banners/v1/brand-banner-wide-1440.webp",
    srcSet:
      "/banners/v1/brand-banner-wide-640.webp 640w, /banners/v1/brand-banner-wide-960.webp 960w, /banners/v1/brand-banner-wide-1440.webp 1440w",
    width: 1440,
  },
  mobile: {
    height: 1136,
    sizes: "100vw",
    src: "/banners/v1/brand-banner-mobile-1080.webp",
    srcSet:
      "/banners/v1/brand-banner-mobile-480.webp 480w, /banners/v1/brand-banner-mobile-768.webp 768w, /banners/v1/brand-banner-mobile-1080.webp 1080w",
    width: 1080,
  },
} as const;

export function HomeFeaturedAuction({
  basePath = "",
  products,
  surface = "desktop",
}: {
  basePath?: "" | "/m";
  products: HomeFeaturedAuctionItem[];
  surface?: "desktop" | "mobile";
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const mobile = surface === "mobile";
  const fallbackBanner = fallbackBanners[mobile ? "mobile" : "desktop"];

  useEffect(() => {
    if (products.length < 2) return;
    const interval = window.setInterval(() => {
      setActiveIndex((current) => {
        const nextOffset = Math.floor(Math.random() * (products.length - 1))
          + 1;
        return (current + nextOffset) % products.length;
      });
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [products.length]);

  if (products.length === 0) {
    return (
      <Link
        className={`group relative overflow-hidden bg-black ${
          mobile ? "block aspect-[4/5] min-h-[480px]" : "min-h-[560px]"
        }`}
        href={`${basePath}/feed`}
        prefetch={false}
      >
        <img
          alt="나인티 나인 빈티지 배너"
          className="h-full w-full object-contain object-center"
          decoding="async"
          fetchPriority="high"
          height={fallbackBanner.height}
          loading="eager"
          sizes={fallbackBanner.sizes}
          src={fallbackBanner.src}
          srcSet={fallbackBanner.srcSet}
          width={fallbackBanner.width}
        />
        <div
          className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent ${
            mobile
              ? "px-5 pb-7 pt-28"
              : "flex items-end justify-between gap-4 p-8 pt-28"
          }`}
        >
          <div>
            <p className="text-[10px] font-bold tracking-[0.14em] text-zinc-400">
              오늘의 대표 경매
            </p>
            <p className="mt-2 text-sm font-bold">
              새로운 실시간 경매를 준비 중입니다.
            </p>
          </div>
          <span
            className={`flex w-fit shrink-0 items-center gap-2 border-b border-white pb-2 text-xs font-bold ${
              mobile ? "mt-5" : ""
            }`}
          >
            실시간 경매 하러 가기 <ArrowUpRight size={14} />
          </span>
        </div>
      </Link>
    );
  }

  return (
    <div
      aria-label="오늘의 대표 실시간 경매"
      className={`relative overflow-hidden bg-black ${
        mobile ? "aspect-[4/5] min-h-[480px]" : "min-h-[560px]"
      }`}
      role="region"
    >
      {products.map((product, index) => {
        const active = index === activeIndex;
        return (
          <Link
            aria-hidden={!active}
            className={`absolute inset-0 transition-opacity duration-700 ease-in-out ${active ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
            href={`${basePath}/auction/${product.id}`}
            key={product.id}
            tabIndex={active ? 0 : -1}
          >
            <CatalogImage
              alt={active ? `${product.title} 대표 이미지` : ""}
              className="h-full w-full object-cover object-center"
              fetchPriority={active ? "high" : "auto"}
              loading={active ? "eager" : "lazy"}
              maxDimension={1600}
              priority={active}
              sizes={mobile ? "100vw" : "570px"}
              src={product.imageUrl}
            />
            <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/5 to-transparent" />
            <span
              className={`absolute inset-x-0 bottom-0 text-paper ${
                mobile
                  ? "px-5 pb-7 pt-28"
                  : "flex items-end justify-between gap-5 p-8 pt-28"
              }`}
            >
              <span className="min-w-0">
                <span className="block text-[10px] font-bold tracking-[0.14em] text-zinc-300">
                  오늘의 대표 경매 · {product.brand}
                </span>
                <span className="mt-2 block truncate text-lg font-black">
                  {product.title}
                </span>
                <span className="mt-2 block font-mono text-sm font-bold">
                  현재가 {product.currentPrice.toLocaleString("ko-KR")}원
                </span>
              </span>
              <span
                className={`flex w-fit shrink-0 items-center gap-2 border-b border-white pb-2 text-xs font-bold ${
                  mobile ? "mt-5" : ""
                }`}
              >
                실시간 경매 하러 가기 <ArrowUpRight size={14} />
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
