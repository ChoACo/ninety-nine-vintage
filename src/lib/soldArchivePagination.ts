import type { PublicSoldAuction } from "@/src/lib/supabase/auctionLifecycle";

export function appendUniqueSoldAuctions(
  current: readonly PublicSoldAuction[],
  nextPage: readonly PublicSoldAuction[],
): PublicSoldAuction[] {
  const productIds = new Set(current.map((auction) => auction.productId));
  return [
    ...current,
    ...nextPage.filter((auction) => !productIds.has(auction.productId)),
  ];
}
