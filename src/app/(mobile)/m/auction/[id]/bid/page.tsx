import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuctionBidRoute } from "@/components/features/auction/detail/AuctionBidRoute";
import { MobileBidSheet } from "@/components/mobile/MobileBidSheet";
import { fetchPublishedProduct } from "@/services/products";

export const metadata: Metadata = { title: "빠른 입찰", robots: { follow: false, index: false } };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function MobileAuctionBidPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();
  const product = await fetchPublishedProduct(id).catch(() => null);
  if (!product || product.saleType !== "auction") notFound();
  return <MobileBidSheet productId={id}><AuctionBidRoute basePath="/m" productId={id} /></MobileBidSheet>;
}
