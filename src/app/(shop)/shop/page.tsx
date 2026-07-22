import { Suspense } from "react";
import type { Metadata } from "next";
import { AuctionFeedGrid, type ProductPayload } from "@/components/features/auction/AuctionFeedGrid";
import { AuctionFilterSidebar } from "@/components/features/auction/AuctionFilterSidebar";
import { fetchPublishedProducts } from "@/services/products";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "즉시 구매 | NINETY-NINE VINTAGE", alternates: { canonical: "/shop", media: { "only screen and (max-width: 1023px)": "/m/shop" } } };

function toPayload(products: Awaited<ReturnType<typeof fetchPublishedProducts>>): ProductPayload[] {
  return products.map((product) => ({
    id: product.id,
    title: product.title,
    description: product.description,
    category: product.category,
    brand: product.brand,
    brandSlug: product.brandSlug,
    publishAt: product.publishAt,
    closesAt: product.closesAt,
    status: "active",
    saleType: "fixed",
    startingPrice: product.startingPrice,
    currentPrice: product.currentPrice,
    fixedPrice: product.fixedPrice,
    bidIncrement: product.bidIncrement,
    participantCount: product.participantCount,
    bidHistory: Array.isArray(product.bidHistory) ? product.bidHistory : [],
    imageUrls: product.imageUrls,
    thumbnailUrls: product.thumbnailUrls,
    sizeLabel: product.sizeLabel,
  }));
}

export default async function ShopPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const query = (await searchParams).q;
  const initialProducts = toPayload(await fetchPublishedProducts({
    limit: 100,
    saleType: "fixed",
    sort: "latest",
    search: typeof query === "string" ? query : "",
  }));
  return <div className="flex items-start gap-10"><AuctionFilterSidebar saleType="fixed" surface="desktop" /><Suspense fallback={<div className="min-w-0 flex-1" />}><AuctionFeedGrid className="min-w-0 flex-1" initialProducts={initialProducts} saleType="fixed" surface="desktop" title="상시 즉시 구매" /></Suspense></div>;
}
