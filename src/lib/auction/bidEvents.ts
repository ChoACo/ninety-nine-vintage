export const AUCTION_BID_SUCCEEDED_EVENT =
  "ninety-nine:auction-bid-succeeded";
export const AUCTION_BID_OPTIMISTIC_EVENT =
  "ninety-nine:auction-bid-optimistic";

export interface AuctionBidSucceededDetail {
  productId: string;
}

export interface AuctionBidOptimisticDetail {
  amount: number;
  productId: string;
  state: "pending" | "confirmed" | "rollback";
}

export function announceAuctionBidOptimistic(
  productId: string,
  amount: number,
  state: AuctionBidOptimisticDetail["state"],
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AuctionBidOptimisticDetail>(AUCTION_BID_OPTIMISTIC_EVENT, {
      detail: { amount, productId, state },
    }),
  );
}

export function announceAuctionBidSucceeded(productId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AuctionBidSucceededDetail>(AUCTION_BID_SUCCEEDED_EVENT, {
      detail: { productId },
    }),
  );
}
