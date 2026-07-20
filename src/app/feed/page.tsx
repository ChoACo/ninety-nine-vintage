import { Suspense } from "react";
import { AuctionFeedGrid } from "@/components/features/auction/AuctionFeedGrid";
import { AuctionFilterSidebar } from "@/components/features/auction/AuctionFilterSidebar";

export default function FeedPage() { return <div className="flex flex-col items-stretch gap-8 lg:flex-row lg:items-start lg:gap-10"><AuctionFilterSidebar saleType="auction" /><Suspense fallback={<div className="min-w-0 flex-1" />}><AuctionFeedGrid className="min-w-0 flex-1" saleType="auction" title="LIVE DROP" /></Suspense></div>; }
