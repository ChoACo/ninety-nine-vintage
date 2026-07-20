import Link from "next/link";
import { Suspense } from "react";
import { AuctionFeedGrid } from "@/components/features/auction/AuctionFeedGrid";
import { AuctionFilterSidebar } from "@/components/features/auction/AuctionFilterSidebar";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";

export default function FeedPage() {
  if (!LIVE_AUCTION_ENABLED) {
    return <div className="grid min-h-[60vh] place-items-center border border-dashed border-line bg-surface px-6 text-center"><div><p className="eyebrow text-muted">LIVE AUCTION / PAUSED</p><h1 className="mt-4 text-3xl font-black tracking-[-0.06em]">라이브 경매 점검 중</h1><p className="mt-4 text-sm text-muted">일반 바로 구매 상품은 정상적으로 이용할 수 있습니다.</p><Link className="mt-6 inline-flex border border-ink px-5 py-3 text-xs font-bold" href="/shop">BUY NOW 상품 보기</Link></div></div>;
  }
  return <div className="flex flex-col items-stretch gap-8 flex-row items-start gap-10"><AuctionFilterSidebar saleType="auction" /><Suspense fallback={<div className="min-w-0 flex-1" />}><AuctionFeedGrid className="min-w-0 flex-1" saleType="auction" title="LIVE DROP" /></Suspense></div>;
}
