import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "./client";
import {
  createCompositeCursorPage,
  type PublicSoldAuctionCursor,
} from "./publicSoldAuctionPagination";

export type { PublicSoldAuctionCursor } from "./publicSoldAuctionPagination";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PRICE = 1_000_000_000;
export const PUBLIC_SOLD_AUCTIONS_PAGE_SIZE = 24;

export class AuctionLifecycleError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuctionLifecycleError";
    this.code = code;
  }
}

interface PublicSoldAuctionRow {
  product_id: string;
  title: string;
  description: string;
  image_urls: string[];
  thumbnail_urls: string[];
  sold_at: string;
  winning_amount: number;
  winner_display_name: string;
  participant_count: number;
}

export interface PublicSoldAuction {
  productId: string;
  title: string;
  description: string;
  imageUrls: readonly string[];
  thumbnailUrls: readonly string[];
  soldAt: string;
  winningAmount: number;
  /** 공개 입찰 기록과 동일한 회원 공개 닉네임입니다. */
  winnerDisplayName: string;
  participantCount: number;
}

export interface PublicSoldAuctionsPage {
  auctions: PublicSoldAuction[];
  hasMore: boolean;
  nextCursor: PublicSoldAuctionCursor | null;
}

interface OwnerClosedAuctionRow {
  product_id: string;
  status: string;
  closed_at: string;
  winner_bid_id: string | null;
  winner_id: string | null;
  winner_display_name: string | null;
  winning_amount: number | null;
}

export interface OwnerClosedAuction {
  productId: string;
  status: "closed";
  closedAt: string;
  winnerBidId: string | null;
  winnerId: string | null;
  winnerDisplayName: string | null;
  winningAmount: number | null;
}

export interface OwnerTestBid {
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

interface OwnerTestBidRow {
  bid_id: string;
  product_id: string;
  bidder_id: string;
  bidder_display_name: string;
  amount: number;
  created_at: string;
  is_final: boolean;
  current_price: number;
  participant_count: number;
  bid_locked_at: string | null;
  final_bid_id: string | null;
}

function rpcClient(): SupabaseClient {
  // The migration can precede a regenerated Database snapshot. SQL remains the
  // authorization boundary; this cast only avoids coupling rollout order.
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

function requireProductId(productId: string) {
  if (!UUID_PATTERN.test(productId)) {
    throw new AuctionLifecycleError("상품 정보가 올바르지 않습니다.");
  }
}

function requireMemberId(memberId: string) {
  if (!UUID_PATTERN.test(memberId)) {
    throw new AuctionLifecycleError("테스트 회원 정보가 올바르지 않습니다.");
  }
}

function requireReason(reason: string): string {
  const normalized = reason.trim();
  if (normalized.length < 2 || normalized.length > 500) {
    throw new AuctionLifecycleError("조작 사유를 2~500자로 입력해 주세요.");
  }
  return normalized;
}

function requirePrice(price: number) {
  if (!Number.isSafeInteger(price) || price < 1 || price > MAX_PRICE) {
    throw new AuctionLifecycleError("가격은 1원~10억원의 정수여야 합니다.");
  }
}

function requireOptionalPrice(price: number | null | undefined) {
  if (price != null) requirePrice(price);
}

function validatePublicSoldAuctionLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new AuctionLifecycleError(
      "판매 완료 조회 개수는 1~100개여야 합니다.",
    );
  }
}

function validatePublicSoldAuctionCursor(cursor: PublicSoldAuctionCursor) {
  if (Number.isNaN(Date.parse(cursor.soldAt))) {
    throw new AuctionLifecycleError(
      "판매 완료 조회 기준 시각이 올바르지 않습니다.",
    );
  }
  if (!UUID_PATTERN.test(cursor.productId)) {
    throw new AuctionLifecycleError(
      "판매 완료 조회 기준 상품이 올바르지 않습니다.",
    );
  }
}

function mapPublicSoldAuctionRow(row: PublicSoldAuctionRow): PublicSoldAuction {
  return Object.freeze({
    productId: row.product_id,
    title: row.title,
    description: row.description,
    imageUrls: Object.freeze([...row.image_urls]),
    thumbnailUrls: Object.freeze(
      row.image_urls.map(
        (imageUrl, index) => row.thumbnail_urls[index] || imageUrl,
      ),
    ),
    soldAt: row.sold_at,
    winningAmount: row.winning_amount,
    winnerDisplayName: row.winner_display_name,
    participantCount: row.participant_count,
  });
}

async function queryPublicSoldAuctions(input: {
  limit: number;
  before?: string;
  beforeId?: string;
}): Promise<PublicSoldAuction[]> {
  validatePublicSoldAuctionLimit(input.limit);
  if (input.before && Number.isNaN(Date.parse(input.before))) {
    throw new AuctionLifecycleError(
      "판매 완료 조회 기준 시각이 올바르지 않습니다.",
    );
  }
  if (input.beforeId && !UUID_PATTERN.test(input.beforeId)) {
    throw new AuctionLifecycleError(
      "판매 완료 조회 기준 상품이 올바르지 않습니다.",
    );
  }
  if (input.beforeId && !input.before) {
    throw new AuctionLifecycleError(
      "판매 완료 조회 기준 시각이 필요합니다.",
    );
  }

  const { data, error } = await rpcClient().rpc("get_public_sold_auctions", {
    p_limit: input.limit,
    p_before: input.before ?? null,
    p_before_id: input.beforeId ?? null,
  });
  if (error) {
    throw new AuctionLifecycleError(
      error.message || "판매 완료 상품을 불러오지 못했습니다.",
      error.code,
      { cause: error },
    );
  }

  return ((data ?? []) as PublicSoldAuctionRow[]).map(
    mapPublicSoldAuctionRow,
  );
}

export async function fetchPublicSoldAuctions(options?: {
  limit?: number;
  before?: string;
}): Promise<PublicSoldAuction[]> {
  return queryPublicSoldAuctions({
    limit: options?.limit ?? 30,
    before: options?.before,
  });
}

export async function fetchPublicSoldAuctionsPage(options?: {
  cursor?: PublicSoldAuctionCursor | null;
}): Promise<PublicSoldAuctionsPage> {
  const cursor = options?.cursor ?? null;
  if (cursor) validatePublicSoldAuctionCursor(cursor);

  const rows = await queryPublicSoldAuctions({
    limit: PUBLIC_SOLD_AUCTIONS_PAGE_SIZE + 1,
    before: cursor?.soldAt,
    beforeId: cursor?.productId,
  });
  const page = createCompositeCursorPage(
    rows,
    PUBLIC_SOLD_AUCTIONS_PAGE_SIZE,
  );

  return {
    auctions: page.items,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  };
}

export async function ownerCloseAuctionNow(
  productId: string,
  reason = "서비스 테스트 즉시 마감",
): Promise<OwnerClosedAuction> {
  requireProductId(productId);
  const { data, error } = await rpcClient()
    .rpc("owner_close_auction_now", {
      p_product_id: productId,
      p_reason: requireReason(reason),
    })
    .single();
  if (error || !data) {
    throw new AuctionLifecycleError(
      error?.message || "경매를 즉시 마감하지 못했습니다.",
      error?.code,
      error ? { cause: error } : undefined,
    );
  }

  const row = data as OwnerClosedAuctionRow;
  if (row.status !== "closed") {
    throw new AuctionLifecycleError("경매 마감 결과를 확인하지 못했습니다.");
  }
  return Object.freeze({
    productId: row.product_id,
    status: "closed",
    closedAt: row.closed_at,
    winnerBidId: row.winner_bid_id,
    winnerId: row.winner_id,
    winnerDisplayName: row.winner_display_name,
    winningAmount: row.winning_amount,
  });
}

export async function ownerOverrideAuctionPrice(input: {
  productId: string;
  startingPrice?: number | null;
  currentPrice?: number | null;
  reason?: string;
}): Promise<void> {
  requireProductId(input.productId);
  requireOptionalPrice(input.startingPrice);
  requireOptionalPrice(input.currentPrice);
  if (input.startingPrice == null && input.currentPrice == null) {
    throw new AuctionLifecycleError("조정할 가격을 하나 이상 입력해 주세요.");
  }

  const { error } = await rpcClient().rpc("owner_override_auction_price", {
    p_product_id: input.productId,
    p_starting_price: input.startingPrice ?? null,
    p_current_price: input.currentPrice ?? null,
    p_reason: requireReason(input.reason ?? "서비스 테스트 가격 조정"),
  });
  if (error) {
    throw new AuctionLifecycleError(
      error.message || "경매 가격을 조정하지 못했습니다.",
      error.code,
      { cause: error },
    );
  }
}

export async function ownerPlaceTestBid(input: {
  productId: string;
  amount: number;
  testMemberId: string;
  reason?: string;
}): Promise<OwnerTestBid> {
  requireProductId(input.productId);
  requireMemberId(input.testMemberId);
  requirePrice(input.amount);

  const { data, error } = await rpcClient()
    .rpc("owner_place_test_bid", {
      p_product_id: input.productId,
      p_amount: input.amount,
      p_test_member_id: input.testMemberId,
      p_reason: requireReason(input.reason ?? "숨은 테스트 계정 입찰"),
    })
    .single();
  if (error || !data) {
    throw new AuctionLifecycleError(
      error?.message || "테스트 입찰을 처리하지 못했습니다.",
      error?.code,
      error ? { cause: error } : undefined,
    );
  }

  const row = data as OwnerTestBidRow;
  return Object.freeze({
    bidId: row.bid_id,
    productId: row.product_id,
    bidderId: row.bidder_id,
    bidderDisplayName: row.bidder_display_name,
    amount: row.amount,
    createdAt: row.created_at,
    isFinal: row.is_final,
    currentPrice: row.current_price,
    participantCount: row.participant_count,
    bidLockedAt: row.bid_locked_at,
    finalBidId: row.final_bid_id,
  });
}
