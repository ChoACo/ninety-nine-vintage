import type { Metadata } from "next";
import { AuctionBidRoute } from "@/components/features/auction/detail/AuctionBidRoute";
import { MobileBidSheet } from "@/components/mobile/MobileBidSheet";

export const metadata: Metadata = { title: "빠른 입찰", robots: { follow: false, index: false } };

export default async function MobileAuctionBidPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MobileBidSheet productId={id}><AuctionBidRoute basePath="/m" productId={id} /></MobileBidSheet>;
}
