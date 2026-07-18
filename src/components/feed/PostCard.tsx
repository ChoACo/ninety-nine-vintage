"use client";

import { useEffect, useState } from "react";
import Button from "@/src/components/common/Button";
import type { AuctionPost } from "@/src/types/auction";
import {
  assertAuctionBidAllowed,
  getAuctionBidDecision,
} from "@/src/utils/auctionBidPolicy";
import {
  formatKRW,
  formatKoreanDate,
  getKoreanWeekday,
} from "@/src/utils/formatters";
import { getMinimumBidAmount, getQuickBidAmount } from "@/src/utils/bidding";
import { getUserBidState, type UserBidStatus } from "@/src/utils/bidStatus";
import BidConfirmModal from "./BidConfirmModal";
import BidFormModal from "./BidFormModal";
import BidHistoryModal from "./BidHistoryModal";
import PhotoGallery from "./PhotoGallery";
import ProductInquiryModal from "./ProductInquiryModal";

export type BidHandler = (
  postId: string,
  amount: number,
) => void | Promise<void>;

export type InquiryHandler = (
  postId: string,
  message: string,
) => void | Promise<void>;

export interface PostCardProps {
  post: AuctionPost;
  currentUserName: string;
  auctionNow: Date;
  onBid?: BidHandler;
  onInquiry: InquiryHandler;
}

const bidStatusStyles: Record<
  UserBidStatus,
  {
    label: string;
    frame: string;
    labelColor: string;
    priceColor: string;
    historyButton: string;
  }
> = {
  "no-bids": {
    label: "시작 가격",
    frame: "border-[#d8cbbb] bg-[#f3eee6]",
    labelColor: "text-[#6c6157]",
    priceColor: "text-[#443c36]",
    historyButton:
      "border-[#d8cbbb] bg-white/55 text-[#65594f] hover:bg-white/85 focus-visible:ring-[#8a796b]",
  },
  "other-leading": {
    label: "현재 입찰가",
    frame: "border-[#acd1df] bg-[#e6f3f7]",
    labelColor: "text-[#3b7183]",
    priceColor: "text-[#24596c]",
    historyButton:
      "border-[#acd1df] bg-white/55 text-[#31687b] hover:bg-white/85 focus-visible:ring-[#4f91a8]",
  },
  "user-leading": {
    label: "내 입찰 최고가",
    frame: "border-[#9dd7bd] bg-[#e3f6ed]",
    labelColor: "text-[#28705a]",
    priceColor: "text-[#1e654f]",
    historyButton:
      "border-[#9dd7bd] bg-white/55 text-[#286a56] hover:bg-white/85 focus-visible:ring-[#3d8e72]",
  },
  "user-outbid": {
    label: "재입찰 필요!",
    frame: "border-[#eea094] bg-[#ffe5df]",
    labelColor: "text-[#ad3b30]",
    priceColor: "text-[#9f2d25]",
    historyButton:
      "border-[#eea094] bg-white/55 text-[#a2342b] hover:bg-white/85 focus-visible:ring-[#d94f43]",
  },
};

function getProductLabel(description: string) {
  return (
    description
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "구제 의류 상품"
  );
}

export default function PostCard({
  post,
  currentUserName,
  auctionNow,
  onBid,
  onInquiry,
}: PostCardProps) {
  const [bidModalOpen, setBidModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [inquiryModalOpen, setInquiryModalOpen] = useState(false);
  const [pendingBidAmount, setPendingBidAmount] = useState<number | null>(null);
  const isSold = post.status === "closed" || Boolean(post.bidLockedAt);
  const isFirstBid = post.participantCount === 0;
  const quickBidAmount = getQuickBidAmount(post);
  const minimumBidAmount = getMinimumBidAmount(post);
  const bidState = getUserBidState(post, currentUserName);
  const bidDecision = getAuctionBidDecision({
    post,
    currentUserName,
    now: auctionNow,
  });
  const bidPresentation = bidStatusStyles[bidState.status];
  const displayedPrice = bidState.leadingBid?.amount ?? post.startingPrice;
  const productLabel = getProductLabel(post.description);
  const publishedAt = post.publish_at ?? post.createdAt;

  useEffect(() => {
    if (bidDecision.allowed) return;

    // 확인 중 20:56/21:00 경계가 지나거나, 무입찰 상품의 첫 입찰자가
    // 다른 사용자로 확정되면 열려 있던 입찰 흐름도 즉시 닫습니다.
    const closeInvalidBidFlow = window.setTimeout(() => {
      setBidModalOpen(false);
      setPendingBidAmount(null);
    }, 0);

    return () => window.clearTimeout(closeInvalidBidFlow);
  }, [bidDecision.allowed]);

  const requestManualBid = (amount: number) => {
    if (!bidDecision.allowed) {
      setBidModalOpen(false);
      return;
    }
    setBidModalOpen(false);
    setPendingBidAmount(amount);
  };

  const requestQuickBid = () => {
    if (isSold || !bidDecision.allowed) return;
    setPendingBidAmount(quickBidAmount);
  };

  const confirmBid = async () => {
    if (pendingBidAmount === null) return;

    // 화면을 연 뒤 20:56 또는 21:00 경계가 지난 경우를 한 번 더 차단합니다.
    assertAuctionBidAllowed({
      post,
      currentUserName,
      now: auctionNow,
    });

    // onBid는 Supabase place_bid RPC를 호출하며 서버 시각과 최신 원장을
    // 행 잠금 트랜잭션 안에서 다시 검증합니다.
    await onBid?.(post.id, pendingBidAmount);
    setPendingBidAmount(null);
  };

  const sendInquiry = async (message: string) => {
    // 상품 ID와 본문은 회원 본인의 Supabase 비공개 상담방에 저장됩니다.
    await onInquiry(post.id, message);
  };

  return (
    <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-[1.5rem] border border-[#eadacd] bg-[#fffaf4] shadow-[0_12px_36px_rgba(91,67,50,0.09)]">
      <header className="flex items-center justify-between gap-2 border-b border-[#eee0d5] bg-white/45 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <time
            dateTime={publishedAt}
            className="text-[15px] font-black text-[#4b3f38]"
          >
            {formatKoreanDate(publishedAt, { includeWeekday: false })}
          </time>
          <span className="rounded-full bg-[#e7f3f5] px-2 py-1 text-sm font-bold text-[#4c7781]">
            {getKoreanWeekday(publishedAt)}요일
          </span>
        </div>
        <button
          type="button"
          onClick={() => setInquiryModalOpen(true)}
          className="min-h-11 shrink-0 rounded-full border border-[#efb9aa] bg-[#fff0e9] px-3 text-[15px] font-black text-[#9d4639] transition hover:bg-[#ffe3d8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec7866] focus-visible:ring-offset-2"
        >
          상품 문의하기
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-3 p-3 sm:p-3.5">
        <PhotoGallery
          images={post.imageUrls}
          thumbnailImages={post.thumbnailUrls}
          title={productLabel}
          compact
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="break-keep text-[#332a25]">
            <p className="line-clamp-5 whitespace-pre-line text-[17px] font-extrabold leading-[1.6] tracking-[-0.015em] sm:text-[18px]">
              {post.description.trim()}
            </p>
          </div>

          <div
            className={`mt-3 grid grid-cols-2 overflow-hidden rounded-2xl border-2 transition-colors ${bidPresentation.frame}`}
            data-bid-status={bidState.status}
          >
            <div className="flex min-w-0 flex-col justify-center px-3.5 py-3 sm:px-4">
              <p
                className={`text-[15px] font-black tracking-[0.04em] ${bidPresentation.labelColor}`}
              >
                {bidPresentation.label}
              </p>
              <p
                className={`mt-0.5 break-keep text-[1.55rem] font-black tabular-nums tracking-[-0.04em] sm:text-[1.7rem] ${bidPresentation.priceColor}`}
              >
                {formatKRW(displayedPrice)}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setHistoryModalOpen(true)}
              className={`flex min-h-[5.25rem] items-center justify-center gap-1.5 border-l-2 px-2 text-center text-[15px] font-black leading-snug transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset sm:text-base ${bidPresentation.historyButton}`}
              aria-label={`입찰 현황 보기, ${post.bidHistory.length}건`}
            >
              <span aria-hidden="true">▤</span>
              <span>
                입찰 현황 보기
                <span className="mt-0.5 block tabular-nums">
                  ({post.bidHistory.length.toLocaleString("ko-KR")}건)
                </span>
              </span>
            </button>
          </div>

          <div className="mt-auto pt-3">
            {bidDecision.phase === "existing-participants-only" &&
            bidDecision.allowed ? (
              <p
                role="status"
                className={`mb-2 rounded-xl border px-3 py-2 text-center text-[15px] font-black leading-6 sm:text-[16px] ${
                  bidDecision.reason === "existing-participant"
                    ? "border-[#a9d9bf] bg-[#e9f8ef] text-[#286a50]"
                    : "border-[#dfcdbb] bg-[#f6efe6] text-[#725d4f]"
                }`}
              >
                {bidDecision.reason === "existing-participant"
                  ? "✅ 기존 참여자 입찰 가능 · 오후 9시까지"
                  : "⚠️ 무입찰 상품 · 첫 입찰 즉시 확정"}
              </p>
            ) : null}

            {!bidDecision.allowed ? (
              <Button
                fullWidth
                size="lg"
                disabled
                className="min-h-16 break-keep px-3 py-2 text-[17px] font-black leading-6 shadow-none"
              >
                {bidDecision.reason === "new-bid-cutoff"
                  ? "⛔ 신규 입찰 마감 (기존 참여자 전용)"
                  : bidDecision.reason === "late-first-bid-finalized"
                    ? "✅ 확정 입찰 완료"
                    : bidDecision.reason === "auction-closed"
                      ? "⏸ 정산 중 · 오후 10시 재개"
                      : "판매 완료"}
              </Button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  fullWidth
                  size="lg"
                  onClick={() => setBidModalOpen(true)}
                  className="min-h-14 px-2 py-2 text-[17px] font-black"
                >
                  경매하기
                </Button>
                <Button
                  fullWidth
                  size="lg"
                  variant="secondary"
                  onClick={requestQuickBid}
                  className="min-h-14 break-keep px-2 py-2 text-[17px] font-black"
                >
                  {isFirstBid ? "입찰하기" : "+1,000원 입찰하기"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <BidFormModal
        open={bidModalOpen}
        onClose={() => setBidModalOpen(false)}
        onSubmit={requestManualBid}
        title={productLabel}
        currentPrice={post.currentPrice}
        bidIncrement={post.bidIncrement}
        minimumBid={minimumBidAmount}
      />

      <BidConfirmModal
        open={pendingBidAmount !== null}
        amount={pendingBidAmount ?? 0}
        itemTitle={productLabel}
        isFinalBid={bidDecision.finalOnAccept}
        onClose={() => setPendingBidAmount(null)}
        onConfirm={confirmBid}
      />

      <BidHistoryModal
        open={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        itemTitle={productLabel}
        history={post.bidHistory}
      />

      <ProductInquiryModal
        open={inquiryModalOpen}
        productLabel={productLabel}
        onClose={() => setInquiryModalOpen(false)}
        onSubmit={sendInquiry}
      />
    </article>
  );
}
