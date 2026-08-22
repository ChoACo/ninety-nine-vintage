import type { Metadata } from "next";
import { Suspense } from "react";
import { AuctionFeedGrid } from "@/components/features/auction/AuctionFeedGrid";
import { AuctionFilterSidebar } from "@/components/features/auction/AuctionFilterSidebar";
import { LiveAuctionIntro } from "@/components/features/auction/live/LiveAuctionIntro";
import { LiveAuctionTimeline } from "@/components/features/auction/live/LiveAuctionTimeline";
import { AuctionGridSkeleton } from "@/components/skeletons/AuctionSkeletons";
import { fetchPublishedProducts } from "@/services/products";

export const metadata: Metadata = { title: "라이브 옥션 | NINETY-NINE VINTAGE", description: "매일 밤 10시, 시간을 다시 입는 단 한 점의 아카이브 빈티지 옥션", alternates: { canonical: "/live" } };

export default async function LiveAuctionPage() {
  const products = await fetchPublishedProducts({ limit: 24, saleType: "auction" }).catch(() => []);
  return <div className="space-y-10"><LiveAuctionIntro products={products} /><LiveAuctionTimeline /><AuctionFilterSidebar saleType="auction" surface="desktop" /><Suspense fallback={<AuctionGridSkeleton />}><AuctionFeedGrid saleType="auction" surface="desktop" title="진행 중인 라이브 옥션" /></Suspense></div>;
}
