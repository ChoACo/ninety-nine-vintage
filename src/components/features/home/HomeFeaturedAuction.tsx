"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";

import { CatalogImage } from "@/components/ui/CatalogImage";
import type { PlatformBanner } from "@/lib/platform/config";

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
  banners = [],
  products,
  surface = "desktop",
}: {
  basePath?: "" | "/m";
  banners?: PlatformBanner[];
  products: HomeFeaturedAuctionItem[];
  surface?: "desktop" | "mobile";
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const mobile = surface === "mobile";
  const fallbackBanner = fallbackBanners[mobile ? "mobile" : "desktop"];
  const activeBanners = banners.filter((banner) => banner.enabled && banner.imageUrl);
  const rotationCount = activeBanners.length || products.length;
  const showcaseClass = mobile
    ? "aspect-[4/5] min-h-[480px] w-full sm:aspect-[4/3] sm:min-h-0 sm:w-1/2 lg:w-[55%]"
    : "aspect-[4/3] w-full sm:w-1/2 lg:aspect-auto lg:min-h-[560px] lg:w-[55%]";

  useEffect(() => {
    if (rotationCount < 2) return;
    const interval = window.setInterval(() => {
      setActiveIndex((current) => {
        const nextOffset = Math.floor(Math.random() * (rotationCount - 1))
          + 1;
        return (current + nextOffset) % rotationCount;
      });
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [rotationCount]);

  if (activeBanners.length > 0) {
    return (
      <div aria-label="운영 배너" className={`tablet-hero-showcase relative shrink-0 overflow-hidden rounded-2xl bg-black ${showcaseClass}`} role="region">
        {activeBanners.map((banner, index) => {
          const active = index === activeIndex;
          return <Link aria-hidden={!active} className={`absolute inset-0 transition-opacity duration-700 ${active ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`} href={`${basePath}/feed`} key={banner.id} tabIndex={active ? 0 : -1}><CatalogImage alt={active ? banner.title : ""} className="tablet-hero-media size-full object-cover transition-transform duration-700 ease-out" fetchPriority={active ? "high" : "auto"} loading={active ? "eager" : "lazy"} priority={active} sizes={mobile ? "100vw" : "570px"} src={banner.imageUrl} /><span className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" /><span className="absolute inset-x-0 bottom-0 p-6 text-sm font-black text-white sm:p-8">{banner.title}</span></Link>;
        })}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <Link
        className={`tablet-hero-showcase group relative block shrink-0 overflow-hidden rounded-2xl bg-black ${showcaseClass}`}
        href={`${basePath}/feed`}
        prefetch={false}
      >
        <Image
          alt="나인티 나인 빈티지 배너"
          className="tablet-hero-media h-full w-full object-contain object-center transition-transform duration-700 ease-out"
          blurDataURL="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI1MCI+PHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjUwIiBmaWxsPSIjMDkwOTBiIi8+PC9zdmc+"
          fetchPriority="high"
          height={fallbackBanner.height}
          placeholder="blur"
          priority
          sizes={fallbackBanner.sizes}
          src={fallbackBanner.src}
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
              오늘 밤의 실시간 경매를 준비 중입니다.
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
      className={`tablet-hero-showcase relative shrink-0 overflow-hidden rounded-2xl bg-black ${showcaseClass}`}
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
              className="tablet-hero-media h-full w-full object-cover object-center transition-transform duration-700 ease-out"
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
