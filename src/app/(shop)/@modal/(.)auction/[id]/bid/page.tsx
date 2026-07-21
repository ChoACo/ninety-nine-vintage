import { AuctionBidRoute } from "@/components/features/auction/detail/AuctionBidRoute";
import { ModalShell } from "@/components/layout/ModalShell";

export default async function InterceptedAuctionBidPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ModalShell label="실시간 경매 입찰"><AuctionBidRoute productId={id} /></ModalShell>;
}
