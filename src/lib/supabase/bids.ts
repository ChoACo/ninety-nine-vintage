import { getSupabaseBrowserClient } from "./client";
import { LIVE_AUCTION_ENABLED } from "../featureFlags";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PlacedBid {
  bidId: string;
  productId: string;
  bidderId: string;
  bidderDisplayName: string;
  amount: number;
  createdAt: string;
  isFinal: boolean;
  currentPrice: number;
  participantCount: number;
  bidLockedAt: string | null;
  finalBidId: string | null;
}

export class BidRepositoryError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BidRepositoryError";
    this.code = code;
  }
}

/**
 * Places a bid through the database transaction that owns the auction rules.
 * The RPC takes a row lock, re-reads the ledger, and uses the database clock;
 * callers must not duplicate the 20:56 decision as an authority check.
 */
export async function placeBid(
  productId: string,
  amount: number,
): Promise<PlacedBid> {
  if (!LIVE_AUCTION_ENABLED) {
    throw new BidRepositoryError(
      "라이브 경매는 현재 일시 중지되었습니다.",
      "auction_disabled",
    );
  }

  if (!UUID_PATTERN.test(productId)) {
    throw new BidRepositoryError("입찰 상품 정보가 올바르지 않습니다.");
  }

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new BidRepositoryError("입찰 금액을 원 단위 정수로 입력해 주세요.");
  }

  const { data, error } = await getSupabaseBrowserClient()
    .rpc("place_bid", {
      p_product_id: productId,
      p_amount: amount,
    })
    .single();

  if (error) {
    throw new BidRepositoryError(
      error.message || "입찰을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      error.code,
      { cause: error },
    );
  }

  if (!data) {
    throw new BidRepositoryError(
      "입찰 결과를 확인하지 못했습니다. 상품을 새로고침해 주세요.",
    );
  }

  return Object.freeze({
    bidId: data.bid_id,
    productId: data.product_id,
    bidderId: data.bidder_id,
    bidderDisplayName: data.bidder_display_name,
    amount: data.amount,
    createdAt: data.created_at,
    isFinal: data.is_final,
    currentPrice: data.current_price,
    participantCount: data.participant_count,
    bidLockedAt: data.bid_locked_at,
    finalBidId: data.final_bid_id,
  });
}
