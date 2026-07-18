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
import { getProductFeedDetails } from "@/src/utils/productFeedDetails";
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
    frame: "border-[var(--border)] bg-[var(--surface-muted)]",
    labelColor: "text-[var(--text-muted)]",
    priceColor: "text-[var(--text-strong)]",
    historyButton:
      "border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)] hover:border-[var(--text-strong)] hover:text-[var(--text-strong)] focus-visible:ring-[var(--border-strong)]",
  },
  "other-leading": {
    label: "현재 입찰가",
    frame: "border-[var(--info-border)] bg-[var(--info-surface)]",
    labelColor: "text-[var(--info-text)]",
    priceColor: "text-[var(--info-text)]",
    historyButton:
      "border-[var(--info-border)] bg-[var(--surface-raised)] text-[var(--info-text)] hover:brightness-[.98] focus-visible:ring-[var(--info-border)]",
  },
  "user-leading": {
    label: "내 입찰 최고가",
    frame: "border-[var(--success-text)]/35 bg-[var(--success-surface)]",
    labelColor: "text-[var(--success-text)]",
    priceColor: "text-[var(--success-text)]",
    historyButton:
      "border-[var(--success-text)]/35 bg-[var(--surface-raised)] text-[var(--success-text)] hover:brightness-[.98] focus-visible:ring-[var(--success-text)]",
  },
  "user-outbid": {
    label: "재입찰 필요!",
    frame: "border-[var(--danger-text)]/35 bg-[var(--danger-surface)]",
    labelColor: "text-[var(--danger-text)]",
    priceColor: "text-[var(--danger-text)]",
    historyButton:
      "border-[var(--danger-text)]/35 bg-[var(--surface-raised)] text-[var(--danger-text)] hover:brightness-[.98] focus-visible:ring-[var(--danger-text)]",
  },
};

function getClosingPresentation(closesAt: string, now: Date) {
  const remaining = Math.max(Date.parse(closesAt) - now.getTime(), 0);
  const totalMinutes = Math.floor(remaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (remaining <= 0) {
    return {
      label: "마감",
      classes: "border-white/20 bg-black/72 text-white",
    };
  }

  const timeLabel = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  if (totalMinutes < 10) {
    return {
      label: `마감 ${timeLabel}`,
      classes:
        "border-red-400/60 bg-red-600/90 text-white shadow-[0_0_0_3px_rgba(239,68,68,0.15)]",
    };
  }
  if (totalMinutes < 60) {
    return {
      label: `마감 ${timeLabel}`,
      classes: "border-orange-300/60 bg-orange-500/90 text-white",
    };
  }
  return {
    label: `마감 ${timeLabel}`,
    classes: "border-white/20 bg-black/72 text-white",
  };
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
  const productDetails = getProductFeedDetails(post);
  const productLabel = productDetails.name;
  const publishedAt = post.publish_at ?? post.createdAt;
  const closingPresentation = getClosingPresentation(post.closesAt, auctionNow);

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
      now: new Date(),
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
    <article className="render-lazy group/card flex h-full min-w-0 flex-col overflow-hidden bg-[var(--surface-raised)] transition-all duration-200 ease-out hover:relative hover:z-[1] hover:shadow-[var(--shadow-hover)]">
      <div className="relative overflow-hidden">
        <PhotoGallery
          images={post.imageUrls}
          thumbnailImages={post.thumbnailUrls}
          title={productLabel}
          compact
        />
        <span
          className={`pointer-events-none absolute left-3 top-3 border px-2.5 py-1.5 font-mono text-[11px] font-black tabular-nums tracking-tight shadow-sm backdrop-blur-md ${closingPresentation.classes}`}
        >
          {closingPresentation.label}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <header className="mb-4 flex items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
          <div className="min-w-0 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            <time dateTime={publishedAt}>
              {formatKoreanDate(publishedAt, { includeWeekday: false })}
            </time>
            <span aria-hidden="true" className="mx-1.5 text-[var(--border-strong)]">/</span>
            <span>{getKoreanWeekday(publishedAt)}요일</span>
          </div>
          <button
            type="button"
            onClick={() => setInquiryModalOpen(true)}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] bg-transparent px-2.5 text-xs font-bold text-[var(--text-muted)] transition-all duration-200 ease-out hover:scale-[1.02] hover:border-[var(--text-strong)] hover:text-[var(--text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5"><path d="M7 18.5 3.5 21v-5.2A8.5 8.5 0 1 1 7 18.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
            상품 문의하기
          </button>
        </header>

        <div className="flex min-w-0 flex-1 flex-col">
          {productDetails.isCanonical ? (
            <dl
              aria-label="상품 정보"
              className="break-keep text-sm leading-6 tracking-[-0.015em] text-[var(--text-strong)]"
            >
              <div>
                <dt className="sr-only">Name:</dt>
                <dd className="line-clamp-2 min-w-0 break-words text-lg font-black tracking-[-0.025em]">
                  {productDetails.name}
                </dd>
              </div>
              <div className="mt-2 flex min-w-0 items-start gap-2 text-[13px] font-medium text-[var(--text-muted)]">
                <dt className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.12em]">Size :</dt>
                <dd className="line-clamp-2 min-w-0 break-words">{productDetails.size}</dd>
              </div>
              {productDetails.condition ? (
                <div className="mt-1 flex min-w-0 items-start gap-2 text-[13px] font-medium text-[var(--text-muted)]">
                  <dt className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.12em]">상품상태:</dt>
                  <dd className="line-clamp-2 min-w-0 break-words">
                    {productDetails.condition}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <div className="break-keep text-[var(--text-strong)]">
              <p className="line-clamp-4 whitespace-pre-line text-base font-bold leading-6 tracking-[-0.02em]">
                {productDetails.legacyDescription}
              </p>
            </div>
          )}

          <div
            className={`mt-5 grid grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-lg border transition-colors duration-200 ${bidPresentation.frame}`}
            data-bid-status={bidState.status}
          >
            <div className="flex min-w-0 flex-col justify-center px-3.5 py-3.5 sm:px-4">
              <p
                className={`text-[10px] font-bold uppercase tracking-[0.14em] ${bidPresentation.labelColor}`}
              >
                {bidPresentation.label}
              </p>
              <p
                className={`mt-1 break-keep font-mono text-xl font-black tabular-nums tracking-tight sm:text-[1.4rem] ${bidPresentation.priceColor}`}
              >
                {formatKRW(displayedPrice)}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setHistoryModalOpen(true)}
              className={`flex min-h-[4.75rem] min-w-[6.75rem] items-center justify-center gap-2 border-l px-3 text-left text-xs font-bold leading-snug transition-all duration-200 ease-out hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${bidPresentation.historyButton}`}
              aria-label={`입찰 현황 보기, ${post.bidHistory.length}건`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4"><path d="M8 7h11M8 12h11M8 17h7M4 7h.01M4 12h.01M4 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              <span>
                입찰 현황 보기
                <span className="mt-0.5 block font-mono tabular-nums tracking-tight">
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
                className={`mb-2 border-l-2 px-3 py-2 text-[13px] font-bold leading-5 ${
                  bidDecision.reason === "existing-participant"
                    ? "border-[var(--success-text)] bg-[var(--success-surface)] text-[var(--success-text)]"
                    : "border-[var(--warning-text)] bg-[var(--warning-surface)] text-[var(--warning-text)]"
                }`}
              >
                {bidDecision.reason === "existing-participant"
                  ? "기존 참여자 입찰 가능 · 오후 9시까지"
                  : "무입찰 상품 · 첫 입찰 즉시 확정"}
              </p>
            ) : null}

            {!bidDecision.allowed ? (
              <Button
                fullWidth
                size="lg"
                disabled
                className="min-h-12 rounded-lg break-keep px-3 py-2 text-sm font-bold leading-5 shadow-none"
              >
                {bidDecision.reason === "new-bid-cutoff"
                  ? "신규 입찰 마감 (기존 참여자 전용)"
                  : bidDecision.reason === "late-first-bid-finalized"
                    ? "확정 입찰 완료"
                    : bidDecision.reason === "auction-closed"
                      ? "정산 중 · 오후 10시 재개"
                      : "판매 완료"}
              </Button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  fullWidth
                  size="lg"
                  onClick={() => setBidModalOpen(true)}
                  className="min-h-12 rounded-lg px-2 py-2 text-sm font-black transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-lg"
                >
                  경매하기
                </Button>
                <Button
                  fullWidth
                  size="lg"
                  variant="secondary"
                  onClick={requestQuickBid}
                  className="min-h-12 rounded-lg break-keep px-2 py-2 text-sm font-black transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-md"
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
