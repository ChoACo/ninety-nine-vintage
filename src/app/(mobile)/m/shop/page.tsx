import type { Metadata } from "next";
import { Suspense } from "react";
import { AuctionFeedGrid, type ProductPayload } from "@/components/features/auction/AuctionFeedGrid";
import { AuctionFilterSidebar } from "@/components/features/auction/AuctionFilterSidebar";
import { toFixedProductPayload } from "@/lib/catalog/fixedProductPayload";
import { fetchPublishedProducts } from "@/services/products";
import { StoreMallNavigator } from "@/components/features/catalog/StoreMallNavigator";
import { fetchActiveStores } from "@/services/stores";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "즉시 구매", alternates: { canonical: "/shop" } };

function toPayload(products: Awaited<ReturnType<typeof fetchPublishedProducts>>): ProductPayload[] {
  return toFixedProductPayload(products);
}

export default async function MobileShopPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const query = (await searchParams).q;
  const [products, stores] = await Promise.all([fetchPublishedProducts({ limit: 100, saleType: "fixed", search: typeof query === "string" ? query : "" }), fetchActiveStores()]);
  const initialProducts = toPayload(products);
  return <div><StoreMallNavigator basePath="/m" stores={stores} /><AuctionFilterSidebar saleType="fixed" surface="mobile" /><Suspense fallback={<div className="min-h-64" />}><AuctionFeedGrid basePath="/m" initialProducts={initialProducts} saleType="fixed" surface="mobile" title="상시 즉시 구매" /></Suspense></div>;
}
