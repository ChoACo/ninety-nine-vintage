import type { Metadata } from "next";
import { Suspense } from "react";
import { AuctionFeedGrid, type ProductPayload } from "@/components/features/auction/AuctionFeedGrid";
import { AuctionFilterSidebar } from "@/components/features/auction/AuctionFilterSidebar";
import { ArchiveShopHeader } from "@/components/features/shop/ArchiveShopHeader";
import { ShopCatalogSkeleton } from "@/components/skeletons/ShopSkeletons";
import { toFixedProductPayload } from "@/lib/catalog/fixedProductPayload";
import { fetchPublishedProducts } from "@/services/products";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"아카이브 숍 | NINETY-NINE VINTAGE",description:"기다림 없이 바로 소장하는 엄선된 1점 한정 빈티지 아카이브",alternates:{canonical:"/shop",media:{"only screen and (max-width: 1279px)":"/m/shop"}}};
function toPayload(products:Awaited<ReturnType<typeof fetchPublishedProducts>>):ProductPayload[]{return toFixedProductPayload(products)}
export default async function ShopPage({searchParams}:{searchParams:Promise<{q?:string|string[];category?:string|string[]}>}){const params=await searchParams;const query=typeof params.q==="string"?params.q:"";const category=typeof params.category==="string"?params.category:"";const products=await fetchPublishedProducts({limit:100,saleType:"fixed",search:query});return <div className="space-y-8"><ArchiveShopHeader category={category}/><AuctionFilterSidebar saleType="fixed" surface="desktop"/><Suspense fallback={<ShopCatalogSkeleton/>}><AuctionFeedGrid initialProducts={toPayload(products)} saleType="fixed" surface="desktop" title="엄선된 1점 한정 아카이브"/></Suspense></div>}
