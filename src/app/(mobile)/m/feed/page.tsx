import type { Metadata } from "next";
import { Suspense } from "react";
import { AuctionFeedGrid } from "@/components/features/auction/AuctionFeedGrid";
import { AuctionFilterSidebar } from "@/components/features/auction/AuctionFilterSidebar";
import { StoreMallNavigator } from "@/components/features/catalog/StoreMallNavigator";
import { fetchActiveStores } from "@/services/stores";

export const metadata: Metadata = { title: "실시간 경매", alternates: { canonical: "/feed" } };

export default async function MobileFeedPage() {
  const stores = await fetchActiveStores();
  return <div><StoreMallNavigator basePath="/m" stores={stores} /><AuctionFilterSidebar saleType="auction" surface="mobile" /><Suspense fallback={<div className="min-h-64" />}><AuctionFeedGrid basePath="/m" saleType="auction" surface="mobile" title="오늘의 실시간 경매" /></Suspense></div>;
}
