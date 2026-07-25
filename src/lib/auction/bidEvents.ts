export const AUCTION_BID_SUCCEEDED_EVENT =
  "ninety-nine:auction-bid-succeeded";

export interface AuctionBidSucceededDetail {
  productId: string;
}

export function announceAuctionBidSucceeded(productId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AuctionBidSucceededDetail>(AUCTION_BID_SUCCEEDED_EVENT, {
      detail: { productId },
    }),
  );
}
