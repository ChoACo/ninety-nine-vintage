import EditorialAuctionDetail from "@/src/components/features/auction/EditorialAuctionDetail";

export default async function AuctionDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EditorialAuctionDetail productId={id} />;
}
