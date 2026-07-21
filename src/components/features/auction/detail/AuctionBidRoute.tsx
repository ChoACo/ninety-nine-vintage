import { notFound } from "next/navigation";
import { AuctionBidRoutePanel } from "@/components/features/auction/detail/AuctionBidRoutePanel";
import { fetchPublishedProduct } from "@/services/products";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function AuctionBidRoute({ productId }: { productId: string }) {
  if (!UUID_PATTERN.test(productId)) notFound();
  const product = await fetchPublishedProduct(productId).catch(() => null);
  if (!product || product.saleType !== "auction") notFound();
  const activeBidCount = Array.isArray(product.bidHistory)
    ? product.bidHistory.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && ((entry as Record<string, unknown>).outcome ?? "active") === "active").length
    : 0;
  const safeIncrement = Number.isSafeInteger(product.bidIncrement) && product.bidIncrement > 0 ? product.bidIncrement : 1000;
  const minimumBid = activeBidCount === 0 ? product.currentPrice : product.currentPrice + safeIncrement;
  return <AuctionBidRoutePanel bidIncrement={safeIncrement} currentPrice={product.currentPrice} minimumBid={minimumBid} productId={product.id} productTitle={product.title} />;
}
