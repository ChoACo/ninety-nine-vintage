import type { Metadata } from "next";
import { Clock3, Gavel, PackageCheck, ShieldCheck, Truck } from "lucide-react";
import Link from "next/link";
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
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";
import { fetchPublishedProducts } from "@/services/products";
import { LoginReturnScrollRestorer } from "@/components/layout/LoginReturnScrollRestorer";
import { HomeCategoryFilters } from "@/components/features/home/HomeCategoryFilters";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "오늘의 빈티지",
  description: "모바일에서 빠르게 상품을 보고 입찰하거나 구매하세요.",
  alternates: { canonical: "/home" },
};

export default async function MobileHomePage() {
  const [auctionResult, fixedResult] = await Promise.allSettled([
    LIVE_AUCTION_ENABLED
      ? fetchPublishedProducts({ limit: 100, saleType: "auction" })
      : Promise.resolve([]),
    fetchPublishedProducts({ limit: 6, saleType: "fixed" }),
  ]);
  const auctions = auctionResult.status === "fulfilled" ? auctionResult.value : [];
  const fixed = fixedResult.status === "fulfilled" ? fixedResult.value : [];
  const featuredAuctions: HomeFeaturedAuctionItem[] =
    shuffleFeaturedAuctionCandidates(
      selectFeaturedAuctionCandidates(auctions),
    ).map((product) => ({
      brand: product.brand,
      currentPrice: product.currentPrice,
      id: product.id,
      imageUrl: product.imageUrls[0] ?? "",
      title: product.title,
    }));

  return (
    <div className="space-y-8" data-mobile-home>
      {(auctionResult.status === "rejected" || fixedResult.status === "rejected") && <StatusNotice variant="warning">상품 정보를 일시적으로 불러오지 못했습니다.</StatusNotice>}
      <section className="theme-invariant-dark -mx-4 -mt-5 overflow-hidden bg-ink text-paper">
        <div className="px-5 pb-6 pt-10"><p className="text-[9px] font-black tracking-[.16em] text-amber-400">CURATED ARCHIVE · ONE OF ONE</p><h1 className="mt-5 text-balance text-[clamp(2rem,12vw,3.5rem)] font-black leading-[.98] tracking-[-.07em]">시간을 다시 입는 선택.</h1><p className="mt-4 text-xs leading-5 text-zinc-400">엄선된 단 1점의 빈티지. 실시간 경매와 최대 14일 무료 보관으로 만나는 새로운 쇼핑 경험.</p><div className="mt-6 grid gap-2"><Link className="flex min-h-12 items-center justify-center rounded-xl bg-amber-500 px-4 text-xs font-black text-zinc-950" href="/m/feed">오늘의 실시간 경매 참여하기</Link><Link className="flex min-h-12 items-center justify-center rounded-xl border border-zinc-700 px-4 text-xs font-black" href="/m/shop">즉시 구매 컬렉션 둘러보기</Link></div></div>
        <HomeFeaturedAuction
          basePath="/m"
          products={featuredAuctions}
          surface="mobile"
        />
      </section>
      <section aria-label="빠른 메뉴" className="grid grid-cols-2 gap-3">
        <Link className="min-h-32 rounded-2xl border border-line bg-surface p-4 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ink active:scale-[.98]" href="/m/shop"><span className="grid size-9 place-items-center rounded-xl bg-paper"><Clock3 size={18} strokeWidth={1.75} /></span><p className="mt-5 text-sm font-black">상시 구매</p><p className="mt-1 text-[11px] leading-4 text-muted">지금 바로 살 수 있는 상품</p></Link>
        <Link className="relative min-h-32 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-emerald-800 active:scale-[.98]" href="/m/account/storage"><span className="absolute right-3 top-3 rounded-full bg-emerald-800 px-2 py-1 text-[8px] font-black text-white">배송비 절약</span><span className="grid size-9 place-items-center rounded-xl bg-white/70"><PackageCheck size={18} strokeWidth={1.75} /></span><p className="mt-5 text-sm font-black">보관·묶음 배송</p><p className="mt-1 text-[11px] leading-4">소형 14일 · 대형 7일</p></Link>
      </section>
      {LIVE_AUCTION_ENABLED && <ProductRail basePath="/m" eyebrow="실시간 경매" href="/m/feed" products={auctions.slice(0, 6)} surface="mobile" title="오늘 밤의 경매" />}
      <section><HomeCategoryFilters basePath="/m" /><ProductRail basePath="/m" eyebrow="즉시 구매" href="/m/shop" products={fixed} surface="mobile" title="지금 구매 가능한 단 1점" /></section>
      <section aria-labelledby="mobile-storage-flow" className="rounded-3xl bg-surface p-5"><div className="flex items-center gap-2"><ShieldCheck size={17} strokeWidth={1.75} /><h2 className="text-sm font-black" id="mobile-storage-flow">한 박스로 받는 3단계</h2></div><ol className="mt-5 grid gap-3"><li className="flex items-center gap-3 rounded-2xl bg-paper p-4"><span className="grid size-9 place-items-center rounded-xl bg-ink text-paper"><Gavel size={16} strokeWidth={1.75} /></span><span><strong className="block text-xs">1. 낙찰·구매</strong><span className="mt-1 block text-[10px] text-muted">원하는 빈티지를 선택해요.</span></span></li><li className="flex items-center gap-3 rounded-2xl bg-paper p-4"><span className="grid size-9 place-items-center rounded-xl bg-ink text-paper"><PackageCheck size={16} strokeWidth={1.75} /></span><span><strong className="block text-xs">2. 무료 보관</strong><span className="mt-1 block text-[10px] text-muted">최대 14일 동안 모아두세요.</span></span></li><li className="flex items-center gap-3 rounded-2xl bg-paper p-4"><span className="grid size-9 place-items-center rounded-xl bg-ink text-paper"><Truck size={16} strokeWidth={1.75} /></span><span><strong className="block text-xs">3. 묶음 배송</strong><span className="mt-1 block text-[10px] text-muted">원할 때 한 박스로 요청해요.</span></span></li></ol></section>
      <LoginReturnScrollRestorer />
    </div>
  );
}
