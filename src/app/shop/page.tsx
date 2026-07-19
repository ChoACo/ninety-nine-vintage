import { Suspense } from "react";
import { AuctionFeedGrid } from "@/components/features/auction/AuctionFeedGrid";
import { AuctionFilterSidebar } from "@/components/features/auction/AuctionFilterSidebar";

export default function ShopPage() { return <div className="flex items-start gap-10"><AuctionFilterSidebar saleType="fixed" /><Suspense fallback={<div className="flex-1" />}><AuctionFeedGrid className="flex-1" saleType="fixed" title="상시 바로구매" /></Suspense></div>; }
