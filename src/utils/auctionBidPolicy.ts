import type { AuctionPost } from "@/src/types/auction";

export const AUCTION_TIME_ZONE = "Asia/Seoul";
export const NEW_BID_CUTOFF_SECONDS = 20 * 60 * 60 + 56 * 60;
export const AUCTION_CLOSE_SECONDS = 21 * 60 * 60;

export type DailyAuctionPhase =
  | "open"
  | "existing-participants-only"
  | "closed";

export type AuctionBidDecisionReason =
  | "open-to-all"
  | "existing-participant"
  | "empty-item-first-bid"
  | "late-first-bid-finalized"
  | "new-bid-cutoff"
  | "auction-closed"
  | "item-pending"
  | "item-sold";

export interface KoreanAuctionTime {
  hour: number;
  minute: number;
  second: number;
  secondsSinceMidnight: number;
}

export interface AuctionBidDecision {
  allowed: boolean;
  phase: DailyAuctionPhase;
  reason: AuctionBidDecisionReason;
  userHasBidHistory: boolean;
  hasAnyBidHistory: boolean;
  /** 허용된 입찰이 저장과 동시에 최종 확정되어야 하는지 여부 */
  finalOnAccept: boolean;
  message: string;
}

export interface AuctionBidPolicyInput {
  post: Pick<AuctionPost, "status" | "bidHistory" | "bidLockedAt">;
  currentUserName: string;
  now?: Date | string | number;
}

const koreanClockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: AUCTION_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function toValidDate(value: Date | string | number): Date {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new RangeError("입찰 정책을 계산할 현재 시간이 올바르지 않습니다.");
  }

  return date;
}

/** 실행 환경의 로컬 시간대와 무관하게 한국 표준시 시·분·초를 반환합니다. */
export function getKoreanAuctionTime(
  now: Date | string | number = new Date(),
): KoreanAuctionTime {
  const parts = koreanClockFormatter.formatToParts(toValidDate(now));
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const hour = values.hour ?? 0;
  const minute = values.minute ?? 0;
  const second = values.second ?? 0;

  return {
    hour,
    minute,
    second,
    secondsSinceMidnight: hour * 60 * 60 + minute * 60 + second,
  };
}

/** 매일 한국시간 20:56:00부터 신규 참여를 제한하고 21:00:00에 마감합니다. */
export function getDailyAuctionPhase(
  now: Date | string | number = new Date(),
): DailyAuctionPhase {
  const { secondsSinceMidnight } = getKoreanAuctionTime(now);

  if (secondsSinceMidnight >= AUCTION_CLOSE_SECONDS) return "closed";
  if (secondsSinceMidnight >= NEW_BID_CUTOFF_SECONDS) {
    return "existing-participants-only";
  }
  return "open";
}

function normalizeIdentity(name: string): string {
  return name.trim();
}

/**
 * 20:56 규칙의 단일 판정 함수입니다.
 *
 * - 20:56 전: 누구나 입찰 가능
 * - 20:56~21:00: 입찰 원장이 있는 기존 참여자만 가능
 * - 단, 원장이 0건인 상품은 첫 입찰까지 누구나 가능하며 그 입찰이 즉시 확정·잠김
 * - 21:00 이후: 전원 마감
 *
 * 실제 DB 연동 시에도 반드시 서버 트랜잭션 안에서 최신 bidHistory를 다시 읽은 뒤
 * 이 판정을 실행해야 0건 상품에 대한 동시 첫 입찰 경쟁을 안전하게 차단할 수 있습니다.
 */
export function getAuctionBidDecision({
  post,
  currentUserName,
  now = new Date(),
}: AuctionBidPolicyInput): AuctionBidDecision {
  const phase = getDailyAuctionPhase(now);
  const normalizedUserName = normalizeIdentity(currentUserName);
  const hasAnyBidHistory = post.bidHistory.length > 0;
  const userHasBidHistory =
    normalizedUserName.length > 0 &&
    post.bidHistory.some(
      (bid) => normalizeIdentity(bid.bidderName) === normalizedUserName,
    );

  const base = {
    phase,
    userHasBidHistory,
    hasAnyBidHistory,
    finalOnAccept: false,
  };

  if (post.bidLockedAt) {
    return {
      ...base,
      allowed: false,
      reason: "late-first-bid-finalized",
      message: "오후 8시 56분 이후 첫 입찰로 확정된 상품입니다.",
    };
  }

  if (post.status === "pending") {
    return {
      ...base,
      allowed: false,
      reason: "item-pending",
      message: "예약 공개 전인 상품입니다.",
    };
  }

  if (post.status === "closed") {
    return {
      ...base,
      allowed: false,
      reason: "item-sold",
      message: "판매가 완료된 상품입니다.",
    };
  }

  if (phase === "closed") {
    return {
      ...base,
      allowed: false,
      reason: "auction-closed",
      message: "오늘 오후 9시 경매가 마감되었습니다.",
    };
  }

  if (phase === "open") {
    return {
      ...base,
      allowed: true,
      reason: "open-to-all",
      message: "오후 8시 56분 전에는 누구나 입찰할 수 있습니다.",
    };
  }

  if (userHasBidHistory) {
    return {
      ...base,
      allowed: true,
      reason: "existing-participant",
      message: "기존 참여자는 오후 9시까지 계속 입찰할 수 있습니다.",
    };
  }

  if (!hasAnyBidHistory) {
    return {
      ...base,
      allowed: true,
      reason: "empty-item-first-bid",
      finalOnAccept: true,
      message: "현재 무입찰 상품입니다. 이 입찰은 즉시 확정되며 추가 입찰할 수 없습니다.",
    };
  }

  return {
    ...base,
    allowed: false,
    reason: "new-bid-cutoff",
    message: "신규 입찰 마감 (기존 참여자 전용)",
  };
}

export class AuctionBidPolicyError extends Error {
  readonly decision: AuctionBidDecision;

  constructor(decision: AuctionBidDecision) {
    super(decision.message);
    this.name = "AuctionBidPolicyError";
    this.decision = decision;
  }
}

/**
 * 화면 확인 직전과 서버 저장 직전에 재사용할 수 있는 검증 API입니다.
 * 차단 상태면 사용자에게 표시 가능한 정책 오류를 던집니다.
 */
export function assertAuctionBidAllowed(
  input: AuctionBidPolicyInput,
): AuctionBidDecision {
  const decision = getAuctionBidDecision(input);
  if (!decision.allowed) throw new AuctionBidPolicyError(decision);
  return decision;
}
