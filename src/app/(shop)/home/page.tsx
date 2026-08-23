import Link from "next/link";
import type { Metadata } from "next";
import { Gavel, Package, PackageCheck, Radio, ShoppingBag, Sparkles, Truck } from "lucide-react";
import { ProductRail } from "@/components/features/catalog/ProductRail";
import {
  HomeFeaturedAuction,
  type HomeFeaturedAuctionItem,
} from "@/components/features/home/HomeFeaturedAuction";
import {
  selectFeaturedAuctionCandidates,
  shuffleFeaturedAuctionCandidates,
} from "@/components/features/home/featuredAuction";
import { StatusNotice } from "@/components/ui/StatusNotice";
import { fetchPublishedProducts } from "@/services/products";
import { StoreMallGrid } from "@/components/features/catalog/StoreMallGrid";
import { fetchStoreMallCards, type StoreMallCard } from "@/services/stores";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";
import { LoginReturnScrollRestorer } from "@/components/layout/LoginReturnScrollRestorer";
import { HomeCategoryFilters } from "@/components/features/home/HomeCategoryFilters";
import { DEFAULT_PLATFORM_CONFIG, type PlatformConfig } from "@/lib/platform/config";
import { fetchPlatformConfig } from "@/services/platformConfig";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "오늘의 빈티지 | NINETY-NINE VINTAGE",
  description: "오늘 공개된 빈티지 상품과 실시간 경매를 한눈에 확인하세요.",
  alternates: { canonical: "/home", media: { "only screen and (max-width: 1279px)": "/m/home" } },
};

async function loadHomeData() {
  const [auctionResult, fixedResult, storeMallsResult, configResult] = await Promise.allSettled([
    LIVE_AUCTION_ENABLED
      ? fetchPublishedProducts({ limit: 100, saleType: "auction" })
      : Promise.resolve([]),
    fetchPublishedProducts({ limit: 6, saleType: "fixed" }),
    fetchStoreMallCards(),
    fetchPlatformConfig(),
  ]);
  return {
    auctions: auctionResult.status === "fulfilled" ? auctionResult.value : [],
    fixed: fixedResult.status === "fulfilled" ? fixedResult.value : [],
    storeMalls: storeMallsResult.status === "fulfilled" ? storeMallsResult.value : [],
    catalogUnavailable: fixedResult.status === "rejected",
    config: configResult.status === "fulfilled" ? configResult.value : null,
  };
}

type HomeProducts = Awaited<ReturnType<typeof fetchPublishedProducts>>;

interface HomePresentationProps {
  auctions: HomeProducts;
  fixed: HomeProducts;
  featuredAuctions: HomeFeaturedAuctionItem[];
  storeMalls: StoreMallCard[];
  config: PlatformConfig;
}

function DesktopHome({ auctions, config, featuredAuctions, fixed, storeMalls }: HomePresentationProps) {
  return (
    <div className="space-y-16" data-home-presentation="desktop">
      <section className="flex min-h-0 flex-col items-center justify-between gap-6 overflow-hidden rounded-3xl border border-line/40 bg-gradient-to-br from-card to-muted/40 p-6 text-foreground sm:flex-row sm:p-10 lg:min-h-[560px] lg:gap-0 lg:p-12">
        <div className="flex w-full flex-col justify-between sm:w-1/2 lg:w-[45%] lg:self-stretch lg:p-4">
          <div>
            <p className="inline-flex rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[10px] font-bold tracking-[0.16em] text-amber-700">CURATED ARCHIVE · ONE OF ONE</p>
            <h1 className="mt-10 max-w-2xl text-balance text-[clamp(2rem,5vw,3.5rem)] font-black leading-[1.02] tracking-[-.07em]">시간을 다시 입는 <span className="text-muted">선택.</span></h1>
            <p className="mt-6 max-w-xl text-sm leading-6 text-muted">엄선된 단 1점의 아카이브 빈티지. 매일 밤 실시간 경매와 14일 무료 보관으로 만나는 새로운 쇼핑 경험.</p>
          </div>
          <div className="mt-14 flex flex-wrap gap-3">
            <Link className="flex min-h-12 items-center gap-2 rounded-xl bg-amber-500 px-5 text-xs font-black text-zinc-950 transition-all duration-200 hover:-translate-y-0.5 hover:bg-amber-400 focus-visible:ring-2 focus-visible:ring-amber-300 active:scale-[.98]" href="/feed" prefetch={false}><Radio size={15} /> 오늘의 실시간 경매 참여하기</Link>
            <Link className="flex min-h-12 items-center gap-2 rounded-xl border border-line px-5 text-xs font-black transition-all duration-200 hover:border-ink hover:bg-surface focus-visible:ring-2 focus-visible:ring-ink active:scale-[.98]" href="/shop" prefetch={false}><Sparkles size={15} /> 즉시 구매 컬렉션</Link>
          </div>
        </div>
        {config.homeSections.featuredAuction ? <HomeFeaturedAuction banners={config.banners} products={featuredAuctions} /> : null}
      </section>

      <section aria-label="나인티 나인 이용 특징" className="grid grid-cols-3 gap-4">
        <article className="rounded-3xl border border-line bg-surface p-7"><span className="grid size-11 place-items-center rounded-2xl bg-paper"><Gavel size={20} strokeWidth={1.75} /></span><p className="mt-6 text-base font-black">실시간 하이브리드 경매</p><p className="mt-2 text-xs leading-5 text-muted">매일 밤 펼쳐지는 단 한 점의 빈티지 아카이브 입찰.</p></article>
        <article className="rounded-3xl border border-line bg-surface p-7"><span className="grid size-11 place-items-center rounded-2xl bg-paper"><ShoppingBag size={20} strokeWidth={1.75} /></span><p className="mt-6 text-base font-black">상시 즉시 구매</p><p className="mt-2 text-xs leading-5 text-muted">기다림 없이 바로 소장하는 엄선된 빈티지 피스.</p></article>
        <article className="rounded-3xl border border-emerald-500/40 bg-emerald-950 p-7 text-emerald-50"><div className="flex items-start justify-between gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-emerald-900"><Package size={20} strokeWidth={1.75} /></span><span aria-describedby="combined-shipping-help" className="rounded-full bg-emerald-400 px-3 py-1.5 text-[10px] font-black text-emerald-950">배송비 0원 세이브</span></div><p className="mt-6 text-base font-black">14일 무료 보관 & 묶음 배송</p><p className="mt-2 text-xs leading-5 text-emerald-100/75">상품을 보관함에 모아 한 번에 배송받고 배송비를 절약하세요.</p><p className="sr-only" id="combined-shipping-help">여러 날 구매한 상품을 한 번에 받아 배송비를 줄일 수 있습니다.</p></article>
      </section>

      {LIVE_AUCTION_ENABLED && <ProductRail eyebrow="실시간 경매" title="오늘 밤의 경매" products={auctions} />}

      {config.homeSections.archiveShop ? <section><HomeCategoryFilters /><ProductRail eyebrow="즉시 구매" title="바로 구매 가능한 단 1점" products={fixed} href="/shop" /></section> : null}

      {config.homeSections.centerMall ? <StoreMallGrid cards={storeMalls} /> : null}

      <section className="grid grid-cols-2 items-start gap-10 border-t border-ink pt-12">
        <div><p className="text-[10px] font-bold tracking-[0.14em] text-muted">나인티 나인 안내</p><h2 className="mt-4 max-w-2xl text-4xl font-black leading-none tracking-[-.08em]">좋은 빈티지는<br />보관하는 시간까지 포함합니다.</h2></div>
        <p className="self-start text-sm leading-6 text-muted">결제한 상품은 바로 보내지 않아도 됩니다. 다른 날의 낙찰품과 함께 배송을 요청하고, 하나의 박스로 시간을 묶어보세요.</p>
      </section>
      <section aria-labelledby="storage-flow-title" className="rounded-[2rem] bg-surface p-10"><p className="eyebrow text-muted">STORAGE & COMBINED SHIPPING</p><h2 className="mt-3 text-2xl font-black tracking-[-.06em]" id="storage-flow-title">구매부터 묶음 배송까지, 세 단계면 충분합니다.</h2><ol className="mt-8 grid grid-cols-3 gap-5"><li className="relative rounded-3xl bg-paper p-6"><span className="font-mono text-[10px] font-black text-muted">STEP 01</span><Gavel className="mt-8" size={26} strokeWidth={1.75} /><p className="mt-4 text-sm font-black">원하는 빈티지 낙찰·구매</p><p className="mt-2 text-xs leading-5 text-muted">경매 또는 즉시구매에서 한 점을 선택합니다.</p></li><li className="relative rounded-3xl bg-paper p-6"><span className="font-mono text-[10px] font-black text-muted">STEP 02</span><PackageCheck className="mt-8" size={26} strokeWidth={1.75} /><p className="mt-4 text-sm font-black">최대 14일 무료 보관</p><p className="mt-2 text-xs leading-5 text-muted">MY 보관함에서 남은 기간과 상품을 확인합니다.</p></li><li className="relative rounded-3xl bg-paper p-6"><span className="font-mono text-[10px] font-black text-muted">STEP 03</span><Truck className="mt-8" size={26} strokeWidth={1.75} /><p className="mt-4 text-sm font-black">한 박스로 묶음 배송</p><p className="mt-2 text-xs leading-5 text-muted">원하는 시점에 상품을 선택해 배송을 요청합니다.</p></li></ol></section>
    </div>
  );
}

export default async function HomePage() {
  const { auctions, config, fixed, catalogUnavailable, storeMalls } = await loadHomeData();
  const featuredAuctions = shuffleFeaturedAuctionCandidates(
    selectFeaturedAuctionCandidates(auctions),
  ).map((product) => ({
    brand: product.brand,
    currentPrice: product.currentPrice,
    id: product.id,
    imageUrl: product.imageUrls[0] ?? "",
    title: product.title,
  }));

  return (
    <div>
      {catalogUnavailable && <StatusNotice className="mb-6 px-5 py-4 leading-5" variant="warning">상품 정보를 일시적으로 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</StatusNotice>}
      <DesktopHome auctions={auctions.slice(0, 6)} config={config ?? DEFAULT_PLATFORM_CONFIG} featuredAuctions={featuredAuctions} fixed={fixed} storeMalls={storeMalls} />
      <LoginReturnScrollRestorer />
    </div>
  );
}
