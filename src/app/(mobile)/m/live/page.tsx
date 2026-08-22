import type { Metadata } from "next";
import { Suspense } from "react";
import { AuctionFeedGrid } from "@/components/features/auction/AuctionFeedGrid";
import { AuctionFilterSidebar } from "@/components/features/auction/AuctionFilterSidebar";
import { LiveAuctionIntro } from "@/components/features/auction/live/LiveAuctionIntro";
import { LiveAuctionTimeline } from "@/components/features/auction/live/LiveAuctionTimeline";
import { AuctionGridSkeleton } from "@/components/skeletons/AuctionSkeletons";
import { fetchPublishedProducts } from "@/services/products";
export const metadata: Metadata = { title: "라이브 옥션", alternates: { canonical: "/live" } };
export default async function MobileLivePage(){const products=await fetchPublishedProducts({limit:12,saleType:"auction"}).catch(()=>[]);return <div className="space-y-8"><LiveAuctionIntro basePath="/m" products={products}/><LiveAuctionTimeline/><AuctionFilterSidebar saleType="auction" surface="mobile"/><Suspense fallback={<AuctionGridSkeleton/>}><AuctionFeedGrid basePath="/m" saleType="auction" surface="mobile" title="진행 중인 라이브 옥션"/></Suspense></div>}
