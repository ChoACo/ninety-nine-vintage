import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight, Clock3 } from "lucide-react";
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
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "오늘의 빈티지 | NINETY-NINE VINTAGE",
  description: "오늘 공개된 빈티지 상품과 실시간 경매를 한눈에 확인하세요.",
  alternates: { canonical: "/home", media: { "only screen and (max-width: 1279px)": "/m/home" } },
};

async function loadHomeData() {
  const [auctionResult, fixedResult] = await Promise.allSettled([
    LIVE_AUCTION_ENABLED
      ? fetchPublishedProducts({ limit: 100, saleType: "auction", sort: "latest" })
      : Promise.resolve([]),
    fetchPublishedProducts({ limit: 6, saleType: "fixed", sort: "latest" }),
  ]);
  return {
    auctions: auctionResult.status === "fulfilled" ? auctionResult.value : [],
    fixed: fixedResult.status === "fulfilled" ? fixedResult.value : [],
    catalogUnavailable: fixedResult.status === "rejected",
  };
}

type HomeProducts = Awaited<ReturnType<typeof fetchPublishedProducts>>;

interface HomePresentationProps {
  auctions: HomeProducts;
  fixed: HomeProducts;
  featuredAuctions: HomeFeaturedAuctionItem[];
}

function DesktopHome({ auctions, featuredAuctions, fixed }: HomePresentationProps) {
  return (
    <div className="space-y-16" data-home-presentation="desktop">
      <section className="theme-invariant-dark grid min-h-[560px] grid-cols-[1.05fr_.95fr] overflow-hidden bg-ink text-paper">
        <div className="flex flex-col justify-between p-16">
          <div>
            <p className="text-[10px] font-bold tracking-[0.16em] text-zinc-400">오늘의 업데이트</p>
            <h1 className="mt-16 max-w-3xl text-[6.5rem] font-black leading-[.88] tracking-[-.1em]">시간을<br />다시 입는<br /><span className="text-zinc-500">선택.</span></h1>
          </div>
          <div className="mt-14 flex max-w-lg items-end justify-between gap-8">
            <p className="text-sm leading-6 text-zinc-400">선별된 빈티지 한 점을<br />기다림 없이 바로 만나보세요.</p>
            <Link className="flex items-center gap-2 border-b border-paper pb-2 text-xs font-bold" href="/shop">즉시 구매 <ArrowUpRight size={14} /></Link>
          </div>
        </div>
        <HomeFeaturedAuction products={featuredAuctions} />
      </section>

      <section className="grid grid-cols-2 gap-8 border-y border-line py-5">
        <div className="flex items-center gap-3"><Clock3 size={16} /><div><p className="text-[10px] font-bold tracking-[0.14em] text-muted">즉시 구매</p><p className="mt-1 text-sm font-bold">상시 바로 구매</p></div></div>
        <div><p className="text-[10px] font-bold tracking-[0.14em] text-muted">보관·묶음 배송</p><p className="mt-1 text-sm font-bold">소형 14일 · 대형 7일</p></div>
      </section>

      {LIVE_AUCTION_ENABLED && <ProductRail compact eyebrow="실시간 경매" title="오늘 밤의 경매" products={auctions} />}

      <ProductRail compact eyebrow="즉시 구매" title="바로 구매 가능한 상품" products={fixed} href="/shop" />

      <section className="grid grid-cols-2 gap-10 border-t border-ink pt-12">
        <div><p className="text-[10px] font-bold tracking-[0.14em] text-muted">나인티 나인 안내</p><h2 className="mt-4 max-w-2xl text-4xl font-black leading-none tracking-[-.08em]">좋은 빈티지는<br />보관하는 시간까지 포함합니다.</h2></div>
        <p className="self-end text-sm leading-6 text-muted">결제한 상품은 바로 보내지 않아도 됩니다. 다른 날의 낙찰품과 함께 배송을 요청하고, 하나의 박스로 시간을 묶어보세요.</p>
      </section>
    </div>
  );
}

export default async function HomePage() {
  const { auctions, fixed, catalogUnavailable } = await loadHomeData();
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
      <DesktopHome auctions={auctions.slice(0, 6)} featuredAuctions={featuredAuctions} fixed={fixed} />
    </div>
  );
}
