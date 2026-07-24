import type { Metadata } from "next";
import { Clock3, PackageCheck } from "lucide-react";
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

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "오늘의 빈티지",
  description: "모바일에서 빠르게 상품을 보고 입찰하거나 구매하세요.",
  alternates: { canonical: "/home" },
};

export default async function MobileHomePage() {
  const [auctionResult, fixedResult] = await Promise.allSettled([
    LIVE_AUCTION_ENABLED
      ? fetchPublishedProducts({ limit: 100, saleType: "auction", sort: "latest" })
      : Promise.resolve([]),
    fetchPublishedProducts({ limit: 6, saleType: "fixed", sort: "latest" }),
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
    <div className="space-y-10" data-mobile-home>
      {(auctionResult.status === "rejected" || fixedResult.status === "rejected") && <StatusNotice variant="warning">상품 정보를 일시적으로 불러오지 못했습니다.</StatusNotice>}
      <section className="theme-invariant-dark -mx-4 -mt-5 overflow-hidden bg-ink text-paper">
        <HomeFeaturedAuction
          basePath="/m"
          products={featuredAuctions}
          surface="mobile"
        />
      </section>
      <section className="grid grid-cols-2 gap-px overflow-hidden border border-line bg-line"><div className="bg-paper p-4"><Clock3 size={17} /><p className="mt-4 text-xs font-bold">바로 구매</p><p className="mt-1 text-[10px] text-muted">15분 안전 점유 후 결제</p></div><div className="bg-paper p-4"><PackageCheck size={17} /><p className="mt-4 text-xs font-bold">보관·묶음 배송</p><p className="mt-1 text-[10px] text-muted">내 정보에서 간편 신청</p></div></section>
      {LIVE_AUCTION_ENABLED && <ProductRail basePath="/m" eyebrow="실시간 경매" href="/m/feed" products={auctions.slice(0, 6)} surface="mobile" title="오늘 밤의 경매" />}
      <ProductRail basePath="/m" eyebrow="즉시 구매" href="/m/shop" products={fixed} surface="mobile" title="지금 구매 가능한 상품" />
    </div>
  );
}
