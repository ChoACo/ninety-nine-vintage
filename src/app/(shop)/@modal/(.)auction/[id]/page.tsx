import { AuctionDetailView } from "@/components/features/auction/detail/AuctionDetailView";
import { ModalShell } from "@/components/layout/ModalShell";

export default async function InterceptedAuctionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ModalShell label="상품 상세"><AuctionDetailView compact id={id} /></ModalShell>;
}
