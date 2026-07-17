import type {
  AuctionPost,
  BidHistoryRecord,
} from "@/src/types/auction";

export type UserBidStatus =
  | "no-bids"
  | "other-leading"
  | "user-leading"
  | "user-outbid";

export interface UserBidState {
  status: UserBidStatus;
  leadingBid: BidHistoryRecord | null;
  userHighestBid: BidHistoryRecord | null;
}

function bidTimeValue(bid: BidHistoryRecord): number {
  const time = Date.parse(bid.bidAt);
  return Number.isNaN(time) ? 0 : time;
}

/**
 * 금액이 가장 높은 입찰을 찾고, 같은 금액이면 더 최근 입찰을 우선합니다.
 * 배열 정렬 상태에 기대지 않아 API 응답 순서가 달라져도 같은 결과를 냅니다.
 */
export function getHighestBid(
  history: readonly BidHistoryRecord[],
): BidHistoryRecord | null {
  return history.reduce<BidHistoryRecord | null>((highest, bid) => {
    if (highest === null) return bid;
    if (bid.amount > highest.amount) return bid;
    if (bid.amount < highest.amount) return highest;
    return bidTimeValue(bid) > bidTimeValue(highest) ? bid : highest;
  }, null);
}

/** 로그인 사용자의 참여 여부와 현재 최고가 여부를 한 번에 판정합니다. */
export function getUserBidState(
  post: Pick<AuctionPost, "bidHistory">,
  currentUserName: string,
): UserBidState {
  const leadingBid = getHighestBid(post.bidHistory);

  if (leadingBid === null) {
    return { status: "no-bids", leadingBid: null, userHighestBid: null };
  }

  const normalizedUserName = currentUserName.trim();
  const userHighestBid = getHighestBid(
    post.bidHistory.filter(
      (bid) => bid.bidderName.trim() === normalizedUserName,
    ),
  );

  if (userHighestBid === null) {
    return { status: "other-leading", leadingBid, userHighestBid: null };
  }

  return {
    status:
      leadingBid.id === userHighestBid.id ? "user-leading" : "user-outbid",
    leadingBid,
    userHighestBid,
  };
}

export function getUserBidStatus(
  post: Pick<AuctionPost, "bidHistory">,
  currentUserName: string,
): UserBidStatus {
  return getUserBidState(post, currentUserName).status;
}
