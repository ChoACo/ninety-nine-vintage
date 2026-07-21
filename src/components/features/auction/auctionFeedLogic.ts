export const AUCTION_FEED_PAGE_SIZE = 24;

export type AuctionFeedPhase = "OPEN" | "CLOSING_SOON" | "CLOSED" | "UPCOMING";
export type AccountAuctionBidState = "leading" | "final" | "outbid" | "closed";
export type AuctionBidCapability =
  | "checking"
  | "eligible_member"
  | "guest"
  | "non_member"
  | "unavailable";

export function canStartAuctionBid(capability: AuctionBidCapability): boolean {
  return capability === "guest" || capability === "eligible_member";
}

export interface PublicAuctionBid {
  id: string;
  bidAt: string;
  bidderName: string;
  amount: number;
  outcome: "active" | "cancelled" | "unpaid_cancelled";
}

export interface AuctionProductRealtimeSnapshot {
  antiSnipingBaseClosesAt: string | null;
  antiSnipingExtendedAt: string | null;
  antiSnipingExtensionCount: number;
  bidLockedAt: string | null;
  closesAt: string;
  currentPrice: number;
  finalBidAmount: number | null;
  id: string;
  participantCount: number;
  publishAt: string;
  status: "pending" | "active" | "closed";
}

export function getAuctionFeedPhase(
  product: Pick<AuctionProductRealtimeSnapshot, "bidLockedAt" | "closesAt" | "publishAt" | "status"> & Partial<Pick<AuctionProductRealtimeSnapshot, "antiSnipingBaseClosesAt" | "antiSnipingExtendedAt" | "antiSnipingExtensionCount">>,
  nowMs: number,
  dailyPhase: "open" | "existing-participants-only" | "closed",
): AuctionFeedPhase {
  if (!Number.isFinite(nowMs) || nowMs <= 0) return "OPEN";
  if (product.bidLockedAt || product.status === "closed") return "CLOSED";
  const publishTime = Date.parse(product.publishAt);
  if (Number.isFinite(publishTime) && publishTime > nowMs) return "UPCOMING";
  const closeTime = Date.parse(product.closesAt);
  if (!Number.isFinite(closeTime) || closeTime <= nowMs) return "CLOSED";
  const baseCloseTime = product.antiSnipingBaseClosesAt
    ? Date.parse(product.antiSnipingBaseClosesAt)
    : Number.NaN;
  const isOvertime = (product.antiSnipingExtensionCount ?? 0) > 0
    && Number.isFinite(baseCloseTime)
    && baseCloseTime <= nowMs
    && nowMs < closeTime;
  if (isOvertime) return "CLOSING_SOON";
  if (dailyPhase === "closed") return "CLOSED";
  if (dailyPhase === "existing-participants-only") return "CLOSING_SOON";
  if (closeTime - nowMs <= 4 * 60_000) return "CLOSING_SOON";
  return "OPEN";
}

export function getAuctionRemainingLabel(closesAt: string, nowMs: number): string {
  if (!Number.isFinite(nowMs) || nowMs <= 0) return "--:--:--";
  const closeTime = Date.parse(closesAt);
  if (!Number.isFinite(closeTime)) return "마감";
  const remaining = Math.max(0, closeTime - nowMs);
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return remaining > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : "마감";
}

/**
 * Realtime product rows contain more data than the storefront needs. Keep a
 * strict allow-list here so bid-history identity data is never copied into UI
 * state from an unmasked websocket payload.
 */
export function parseAuctionProductRealtimeSnapshot(
  value: unknown,
): AuctionProductRealtimeSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.sale_type !== "auction" || typeof record.id !== "string") return null;

  const currentPrice = Number(record.current_price);
  const participantCount = Number(record.participant_count);
  const finalBidAmount = record.final_bid_amount === null
    ? null
    : Number(record.final_bid_amount);
  const status = record.status;
  const publishAt = record.publish_at;
  const closesAt = record.closes_at;
  const bidLockedAt = record.bid_locked_at;
  const antiSnipingBaseClosesAt = record.anti_sniping_base_closes_at;
  const antiSnipingExtendedAt = record.anti_sniping_extended_at;
  const antiSnipingExtensionCount = Number(record.anti_sniping_extension_count);
  if (
    !Number.isSafeInteger(currentPrice) || currentPrice < 0 ||
    !Number.isSafeInteger(participantCount) || participantCount < 0 ||
    (finalBidAmount !== null && (!Number.isSafeInteger(finalBidAmount) || finalBidAmount < 0)) ||
    (status !== "pending" && status !== "active" && status !== "closed") ||
    typeof publishAt !== "string" || !Number.isFinite(Date.parse(publishAt)) ||
    typeof closesAt !== "string" || !Number.isFinite(Date.parse(closesAt)) ||
    (bidLockedAt !== null && (typeof bidLockedAt !== "string" || !Number.isFinite(Date.parse(bidLockedAt)))) ||
    (antiSnipingBaseClosesAt !== null && (typeof antiSnipingBaseClosesAt !== "string" || !Number.isFinite(Date.parse(antiSnipingBaseClosesAt)))) ||
    (antiSnipingExtendedAt !== null && (typeof antiSnipingExtendedAt !== "string" || !Number.isFinite(Date.parse(antiSnipingExtendedAt)))) ||
    !Number.isSafeInteger(antiSnipingExtensionCount) || antiSnipingExtensionCount < 0
  ) {
    return null;
  }

  return {
    antiSnipingBaseClosesAt,
    antiSnipingExtendedAt,
    antiSnipingExtensionCount,
    bidLockedAt,
    closesAt,
    currentPrice,
    finalBidAmount,
    id: record.id,
    participantCount,
    publishAt,
    status,
  };
}

export function parsePublicBidHistory(value: readonly unknown[]): PublicAuctionBid[] {
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const amount = Number(record.amount);
    if (typeof record.id !== "string" || !Number.isSafeInteger(amount) || amount <= 0) return [];
    const outcome = record.outcome ?? "active";
    if (outcome !== "active" && outcome !== "cancelled" && outcome !== "unpaid_cancelled") return [];
    const bidderName = typeof record.bidderName === "string" && record.bidderName.trim()
      ? record.bidderName.trim()
      : "member";
    return [{
      amount,
      bidAt: typeof record.bidAt === "string" ? record.bidAt : "",
      bidderName,
      id: record.id,
      outcome,
    }];
  });
}

export function isActiveAuctionBid(
  bid: Pick<PublicAuctionBid, "outcome">,
): boolean {
  return bid.outcome === "active";
}

export function getKoreanFeedDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Seoul",
    year: "numeric",
  }).formatToParts(date);
  const read = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export function paginateAuctionFeed<T>(items: readonly T[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / AUCTION_FEED_PAGE_SIZE));
  const page = Number.isSafeInteger(requestedPage)
    ? Math.min(Math.max(requestedPage, 1), pageCount)
    : 1;
  return {
    items: items.slice((page - 1) * AUCTION_FEED_PAGE_SIZE, page * AUCTION_FEED_PAGE_SIZE),
    page,
    pageCount,
  };
}

export function getAuctionFeedBidAccess(input: {
  bidCount: number;
  bidIncrement?: number;
  currentPrice: number;
  participationState?: AccountAuctionBidState;
  phase: AuctionFeedPhase;
}) {
  const bidCount = Math.max(0, Math.floor(input.bidCount));
  const increment = Number.isSafeInteger(input.bidIncrement) && (input.bidIncrement ?? 0) > 0
    ? input.bidIncrement as number
    : 1000;
  const hasAnyBid = bidCount > 0;
  // Only an active leading/outbid position proves participation in the current
  // auction. Historical final/closed rows must never reopen the cutoff window.
  const hasParticipated = input.participationState === "leading" || input.participationState === "outbid";
  const firstBidFinal = input.phase === "CLOSING_SOON" && !hasAnyBid;
  const canBid = input.phase === "OPEN" || (input.phase === "CLOSING_SOON" && (hasParticipated || firstBidFinal));
  return {
    canBid,
    firstBidFinal,
    hasAnyBid,
    hasParticipated,
    minimumBid: hasAnyBid ? input.currentPrice + increment : input.currentPrice,
  };
}
