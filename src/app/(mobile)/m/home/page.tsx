import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Clock3, PackageCheck } from "lucide-react";
import { ProductRail } from "@/components/features/catalog/ProductRail";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { StatusNotice } from "@/components/ui/StatusNotice";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";
import { fetchPublishedProducts } from "@/services/products";
import { fetchActiveStores } from "@/services/stores";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "오늘의 빈티지",
  description: "모바일에서 빠르게 상품을 보고 입찰하거나 구매하세요.",
  alternates: { canonical: "/home" },
};

export default async function MobileHomePage() {
  const [auctionResult, fixedResult, storesResult] = await Promise.allSettled([
    LIVE_AUCTION_ENABLED ? fetchPublishedProducts({ limit: 6, saleType: "auction", sort: "ending" }) : Promise.resolve([]),
    fetchPublishedProducts({ limit: 6, saleType: "fixed", sort: "latest" }),
    fetchActiveStores(),
  ]);
  const auctions = auctionResult.status === "fulfilled" ? auctionResult.value : [];
  const fixed = fixedResult.status === "fulfilled" ? fixedResult.value : [];
  const stores = storesResult.status === "fulfilled" ? storesResult.value : [];

  return (
    <div className="space-y-10" data-mobile-home>
      {(auctionResult.status === "rejected" || fixedResult.status === "rejected") && <StatusNotice variant="warning">상품 정보를 일시적으로 불러오지 못했습니다.</StatusNotice>}
      <section className="theme-invariant-dark -mx-4 -mt-5 overflow-hidden bg-ink text-paper">
        <div className="relative aspect-[4/5] max-h-[720px] min-h-[480px]">
          <CatalogImage alt="나인티 나인 빈티지" className="h-full w-full object-cover opacity-90" maxDimension={1200} priority sizes="100vw" src="/banners/brand-banner-mobile.jpg" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent px-5 pb-7 pt-28">
            <p className="text-[10px] font-bold tracking-[0.16em] text-zinc-300">오늘 바로 만나는 빈티지</p>
            <h1 className="mt-3 text-4xl font-black leading-[.94] tracking-[-.08em]">보고, 고르고,<br />바로 참여하세요.</h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-zinc-300">복잡한 메뉴 없이 상품을 확인하고 입찰하거나 구매할 수 있습니다.</p>
            <div className="mt-6 grid grid-cols-2 gap-2"><Link className="flex h-12 items-center justify-center bg-paper text-xs font-bold text-ink" href="/m/shop">즉시 구매</Link><Link className="flex h-12 items-center justify-center border border-white/50 text-xs font-bold" href="/m/feed">실시간 경매</Link></div>
          </div>
        </div>
      </section>
      <section className="grid grid-cols-2 gap-px overflow-hidden border border-line bg-line"><div className="bg-paper p-4"><Clock3 size={17} /><p className="mt-4 text-xs font-bold">바로 구매</p><p className="mt-1 text-[10px] text-muted">15분 안전 점유 후 결제</p></div><div className="bg-paper p-4"><PackageCheck size={17} /><p className="mt-4 text-xs font-bold">보관·묶음 배송</p><p className="mt-1 text-[10px] text-muted">내 정보에서 간편 신청</p></div></section>
      {LIVE_AUCTION_ENABLED && <ProductRail basePath="/m" eyebrow="실시간 경매" href="/m/feed" products={auctions} surface="mobile" title="곧 마감하는 경매" />}
      <ProductRail basePath="/m" eyebrow="즉시 구매" href="/m/shop" products={fixed} surface="mobile" title="지금 구매 가능한 상품" />
      <section><div className="flex items-end justify-between border-b border-ink pb-4"><div><p className="text-[10px] font-bold tracking-[0.14em] text-muted">엄선된 숍</p><h2 className="mt-2 text-2xl font-black tracking-[-.06em]">숍별로 둘러보기</h2></div><Link aria-label="전체 상품 보기" href="/m/shop"><ArrowRight size={19} /></Link></div><div className="-mx-4 mt-4 grid auto-cols-[82%] grid-flow-col gap-3 overflow-x-auto px-4 pb-2 snap-x snap-mandatory">{stores.map((store, index) => <Link className="min-h-48 snap-center p-5" href={`/m/stores/${store.slug}`} key={store.id} style={{ backgroundColor: `var(--store-card-${(index % 3) + 1})` }}><p className="text-[10px] font-bold tracking-[0.14em]">SHOP {String(index + 1).padStart(2, "0")}</p><h3 className="mt-12 text-2xl font-black tracking-[-.06em]">{store.name}</h3><p className="mt-3 line-clamp-2 text-xs leading-5">{store.description}</p></Link>)}</div></section>
    </div>
  );
}
