export const AUCTION_TIME_ZONE = "Asia/Seoul";
export const NEW_BID_CUTOFF_SECONDS = 20 * 60 * 60 + 56 * 60;
export const AUCTION_CLOSE_SECONDS = 21 * 60 * 60;
export const AUCTION_REOPEN_SECONDS = 22 * 60 * 60;

export type DailyAuctionPhase = "open" | "existing-participants-only" | "closed";
export type AuctionBidDecisionReason =
  | "open-to-all"
  | "existing-participant"
  | "empty-item-first-bid"
  | "anti-sniping-overtime"
  | "anti-sniping-participants-only"
  | "late-first-bid-finalized"
  | "new-bid-cutoff"
  | "auction-closed"
  | "item-pending"
  | "item-sold";

export interface AuctionPolicyPost {
  status: "pending" | "active" | "closed";
  bidHistory: readonly { bidderName: string }[];
  bidLockedAt?: string | null;
  closesAt: string;
  antiSnipingBaseClosesAt?: string | null;
  antiSnipingExtensionCount?: number;
}

export interface AuctionBidDecision {
  allowed: boolean;
  phase: DailyAuctionPhase;
  reason: AuctionBidDecisionReason;
  userHasBidHistory: boolean;
  hasAnyBidHistory: boolean;
  finalOnAccept: boolean;
  message: string;
}

const koreanClockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: AUCTION_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function getKoreanAuctionTime(now: Date | string | number = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) throw new RangeError("현재 시간이 올바르지 않습니다.");
  const values = Object.fromEntries(koreanClockFormatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  const hour = values.hour ?? 0;
  const minute = values.minute ?? 0;
  const second = values.second ?? 0;
  return { hour, minute, second, secondsSinceMidnight: hour * 3600 + minute * 60 + second };
}

export function getDailyAuctionPhase(now: Date | string | number = new Date()): DailyAuctionPhase {
  const seconds = getKoreanAuctionTime(now).secondsSinceMidnight;
  if (seconds >= AUCTION_REOPEN_SECONDS || seconds < NEW_BID_CUTOFF_SECONDS) return "open";
  if (seconds >= AUCTION_CLOSE_SECONDS) return "closed";
  return "existing-participants-only";
}

export function isAntiSnipingOvertime(post: Pick<AuctionPolicyPost, "closesAt" | "antiSnipingBaseClosesAt" | "antiSnipingExtensionCount">, now: Date | string | number = new Date()): boolean {
  if ((post.antiSnipingExtensionCount ?? 0) <= 0) return false;
  const current = new Date(now).getTime();
  const base = Date.parse(post.antiSnipingBaseClosesAt ?? "");
  const close = Date.parse(post.closesAt);
  return Number.isFinite(base) && Number.isFinite(close) && current >= base && current < close;
}

export function getAuctionBidDecision({ post, currentUserName, now = new Date() }: { post: AuctionPolicyPost; currentUserName: string; now?: Date | string | number }): AuctionBidDecision {
  const overtime = isAntiSnipingOvertime(post, now);
  const phase = overtime ? "existing-participants-only" : getDailyAuctionPhase(now);
  const name = currentUserName.trim();
  const hasAnyBidHistory = post.bidHistory.length > 0;
  const userHasBidHistory = name.length > 0 && post.bidHistory.some((bid) => bid.bidderName.trim() === name);
  const base = { phase, userHasBidHistory, hasAnyBidHistory, finalOnAccept: false };
  if (post.bidLockedAt) return { ...base, allowed: false, reason: "late-first-bid-finalized", message: "오후 8시 56분 이후 첫 입찰로 확정된 상품입니다." };
  if (post.status === "pending") return { ...base, allowed: false, reason: "item-pending", message: "예약 공개 전인 상품입니다." };
  if (post.status === "closed") return { ...base, allowed: false, reason: "item-sold", message: "판매가 완료된 상품입니다." };
  if (overtime) return userHasBidHistory
    ? { ...base, allowed: true, reason: "anti-sniping-overtime", message: "마감 연장 중입니다." }
    : { ...base, allowed: false, reason: "anti-sniping-participants-only", message: "마감 연장 시간에는 기존 참여자만 입찰할 수 있습니다." };
  if (phase === "closed") return { ...base, allowed: false, reason: "auction-closed", message: "오후 9시 정산 중입니다. 미판매 상품은 오후 10시부터 다시 입찰할 수 있습니다." };
  if (phase === "open") return { ...base, allowed: true, reason: "open-to-all", message: "현재 누구나 입찰할 수 있습니다." };
  if (userHasBidHistory) return { ...base, allowed: true, reason: "existing-participant", message: "기존 참여자는 계속 입찰할 수 있습니다." };
  if (!hasAnyBidHistory) return { ...base, allowed: true, reason: "empty-item-first-bid", finalOnAccept: true, message: "무입찰 상품의 첫 입찰입니다." };
  return { ...base, allowed: false, reason: "new-bid-cutoff", message: "신규 입찰 마감 (기존 참여자 전용)" };
}

export class AuctionBidPolicyError extends Error {
  constructor(readonly decision: AuctionBidDecision) { super(decision.message); this.name = "AuctionBidPolicyError"; }
}

export function assertAuctionBidAllowed(input: Parameters<typeof getAuctionBidDecision>[0]) {
  const decision = getAuctionBidDecision(input);
  if (!decision.allowed) throw new AuctionBidPolicyError(decision);
  return decision;
}
