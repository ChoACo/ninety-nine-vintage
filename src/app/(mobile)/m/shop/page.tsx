import type { Metadata } from "next";
import { Suspense } from "react";
import { AuctionFeedGrid, type ProductPayload } from "@/components/features/auction/AuctionFeedGrid";
import { AuctionFilterSidebar } from "@/components/features/auction/AuctionFilterSidebar";
import { ArchiveShopHeader } from "@/components/features/shop/ArchiveShopHeader";
import { ShopCatalogSkeleton } from "@/components/skeletons/ShopSkeletons";
import { toFixedProductPayload } from "@/lib/catalog/fixedProductPayload";
import { fetchPublishedProducts } from "@/services/products";
export const dynamic="force-dynamic";export const metadata:Metadata={title:"아카이브 숍",alternates:{canonical:"/shop"}};
function toPayload(products:Awaited<ReturnType<typeof fetchPublishedProducts>>):ProductPayload[]{return toFixedProductPayload(products)}
export default async function Page({searchParams}:{searchParams:Promise<{q?:string|string[];category?:string|string[]}>}){const params=await searchParams;const query=typeof params.q==="string"?params.q:"";const category=typeof params.category==="string"?params.category:"";const products=await fetchPublishedProducts({limit:100,saleType:"fixed",search:query});return <div className="space-y-7"><ArchiveShopHeader basePath="/m/shop" category={category}/><AuctionFilterSidebar saleType="fixed" surface="mobile"/><Suspense fallback={<ShopCatalogSkeleton/>}><AuctionFeedGrid basePath="/m" initialProducts={toPayload(products)} saleType="fixed" surface="mobile" title="엄선된 1점 한정 아카이브"/></Suspense></div>}
