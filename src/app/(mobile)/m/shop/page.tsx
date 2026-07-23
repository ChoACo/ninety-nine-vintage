import type { Metadata } from "next";
import { Suspense } from "react";
import { AuctionFeedGrid, type ProductPayload } from "@/components/features/auction/AuctionFeedGrid";
import { AuctionFilterSidebar } from "@/components/features/auction/AuctionFilterSidebar";
import { fetchPublishedProducts } from "@/services/products";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "즉시 구매", alternates: { canonical: "/shop" } };

function toPayload(products: Awaited<ReturnType<typeof fetchPublishedProducts>>): ProductPayload[] {
  return products.map((product) => ({
    id: product.id, title: product.title, description: product.description, category: product.category,
    brand: product.brand, brandSlug: product.brandSlug, publishAt: product.publishAt, closesAt: product.closesAt,
    status: "active", saleType: "fixed", startingPrice: product.startingPrice, currentPrice: product.currentPrice,
    fixedPrice: product.fixedPrice, bidIncrement: product.bidIncrement, participantCount: product.participantCount,
    bidHistory: Array.isArray(product.bidHistory) ? product.bidHistory : [], imageUrls: product.imageUrls,
    thumbnailUrls: product.thumbnailUrls, sizeLabel: product.sizeLabel,
  }));
}

export default async function MobileShopPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const query = (await searchParams).q;
  const initialProducts = toPayload(await fetchPublishedProducts({ limit: 100, saleType: "fixed", sort: "latest", search: typeof query === "string" ? query : "" }));
  return <div><AuctionFilterSidebar saleType="fixed" surface="mobile" /><Suspense fallback={<div className="min-h-64" />}><AuctionFeedGrid basePath="/m" initialProducts={initialProducts} saleType="fixed" surface="mobile" title="상시 즉시 구매" /></Suspense></div>;
}
