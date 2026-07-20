import { Suspense } from "react";
import { AuctionFeedGrid, type ProductPayload } from "@/components/features/auction/AuctionFeedGrid";
import { AuctionFilterSidebar } from "@/components/features/auction/AuctionFilterSidebar";
import { fetchPublishedProducts } from "@/services/products";

export const dynamic = "force-dynamic";

function toPayload(products: Awaited<ReturnType<typeof fetchPublishedProducts>>): ProductPayload[] {
  return products.map((product) => ({
    id: product.id,
    title: product.title,
    description: product.description,
    category: product.category,
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
  return <div className="flex flex-col items-stretch gap-8 flex-row items-start gap-10"><AuctionFilterSidebar saleType="fixed" /><Suspense fallback={<div className="min-w-0 flex-1" />}><AuctionFeedGrid className="min-w-0 flex-1" initialProducts={initialProducts} saleType="fixed" title="상시 바로구매" /></Suspense></div>;
}
