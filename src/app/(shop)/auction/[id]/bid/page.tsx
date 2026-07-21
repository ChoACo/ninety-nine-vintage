import type { Metadata } from "next";
import { AuctionBidRoute } from "@/components/features/auction/detail/AuctionBidRoute";

export const metadata: Metadata = { title: "실시간 경매 입찰 | NINETY-NINE VINTAGE", robots: { index: false, follow: false } };

export default async function AuctionBidPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <div className="grid min-h-[65vh] place-items-center"><AuctionBidRoute productId={id} /></div>;
}
