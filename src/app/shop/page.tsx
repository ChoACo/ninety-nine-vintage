import { Suspense } from "react";
import { AuctionFeedGrid } from "@/components/features/auction/AuctionFeedGrid";
import { AuctionFilterSidebar } from "@/components/features/auction/AuctionFilterSidebar";

export default function ShopPage() { return <div className="flex flex-col items-stretch gap-8 flex-row items-start gap-10"><AuctionFilterSidebar saleType="fixed" /><Suspense fallback={<div className="min-w-0 flex-1" />}><AuctionFeedGrid className="min-w-0 flex-1" saleType="fixed" title="상시 바로구매" /></Suspense></div>; }
