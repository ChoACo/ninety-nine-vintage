import type { AuctionPost } from "@/src/types/auction";

/** 퀵 입찰과 직접 입찰의 최소 상승 단위 */
export const QUICK_BID_INCREMENT = 1_000;

export type BidPriceSnapshot = Readonly<
  Pick<AuctionPost, "participantCount" | "startingPrice" | "currentPrice">
>;

/**
 * 첫 입찰은 시작가, 기존 입찰이 있으면 현재가보다 1,000원 높은 금액을
 * 반환합니다. 화면과 확인 모달이 같은 계산 기준을 사용하도록 만든 순수 함수입니다.
 */
export function getQuickBidAmount(post: BidPriceSnapshot): number {
  return post.participantCount === 0
    ? post.startingPrice
    : post.currentPrice + QUICK_BID_INCREMENT;
}

/** 직접 금액 입력 시 허용되는 최소 입찰가 */
export function getMinimumBidAmount(post: BidPriceSnapshot): number {
  return getQuickBidAmount(post);
}
