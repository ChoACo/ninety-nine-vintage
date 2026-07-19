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
import BidParticipationBadge from "./BidParticipationBadge";
import { getProductFeedDetails } from "@/src/utils/productFeedDetails";
import BidFormModal from "./BidFormModal";
import BidHistoryModal from "./BidHistoryModal";
import PhotoGallery from "./PhotoGallery";
import ProductDetailModal from "./ProductDetailModal";
import ProductInquiryModal from "./ProductInquiryModal";
import SizeComparisonScanner from "./SizeComparisonScanner";
import type { FeedProductControlAction } from "./FeedProductControlModal";

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
  currentUserId?: string | null;
  auctionNow: Date;
  onBid?: BidHandler;
  onInquiry: InquiryHandler;
  showOperatorControls?: boolean;
  onRequestProductControl?: (
    post: AuctionPost,
    action: FeedProductControlAction,
  ) => void;
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
  currentUserId,
  auctionNow,
  onBid,
  onInquiry,
  showOperatorControls = false,
  onRequestProductControl,
}: PostCardProps) {
  const [bidModalOpen, setBidModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [inquiryModalOpen, setInquiryModalOpen] = useState(false);
  const [productDetailOpen, setProductDetailOpen] = useState(false);
  const [sizeScannerOpen, setSizeScannerOpen] = useState(false);
  const [pendingBidAmount, setPendingBidAmount] = useState<number | null>(null);
  const [pendingCurrentPrice, setPendingCurrentPrice] = useState<number | null>(
    null,
  );
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
  const galleryProductLabel =
    post.title
      .normalize("NFKC")
      .replace(/^\s*\[[^\]\r\n]*\]\s*/u, "")
      .trim() || productLabel;
  const galleryLotLabel = `LOT ${post.id.slice(0, 8).toUpperCase()}`;
  const publishedAt = post.publish_at ?? post.createdAt;
  const closingPresentation = getClosingPresentation(post.closesAt, auctionNow);
  const antiSnipingActive =
    (post.antiSnipingExtensionCount ?? 0) > 0 &&
    post.status === "active" &&
    Date.parse(post.closesAt) > auctionNow.getTime();
  const unavailableBidLabel =
    bidDecision.reason === "new-bid-cutoff"
      ? "신규 입찰 마감 (기존 참여자 전용)"
      : bidDecision.reason === "anti-sniping-participants-only"
        ? "마감 연장 · 기존 참여자 전용"
        : bidDecision.reason === "late-first-bid-finalized"
          ? "확정 입찰 완료"
          : bidDecision.reason === "auction-closed"
            ? "정산 중 · 오후 10시 재개"
            : "판매 완료";
  const quickBidLabel = isFirstBid ? "입찰하기" : "+1,000원 입찰하기";

  useEffect(() => {
    if (bidDecision.allowed) return;

    // 확인 중 20:56/21:00 경계가 지나거나, 무입찰 상품의 첫 입찰자가
    // 다른 사용자로 확정되면 열려 있던 입찰 흐름도 즉시 닫습니다.
    const closeInvalidBidFlow = window.setTimeout(() => {
      setBidModalOpen(false);
      setPendingBidAmount(null);
      setPendingCurrentPrice(null);
    }, 0);

    return () => window.clearTimeout(closeInvalidBidFlow);
  }, [bidDecision.allowed]);

  const requestManualBid = (amount: number) => {
    if (!bidDecision.allowed) {
      setBidModalOpen(false);
      return;
    }
    setBidModalOpen(false);
    setPendingCurrentPrice(post.currentPrice);
    setPendingBidAmount(amount);
  };

  const requestQuickBid = () => {
    if (isSold || !bidDecision.allowed) return;
    setPendingCurrentPrice(post.currentPrice);
    setPendingBidAmount(quickBidAmount);
  };

  const confirmBid = async () => {
    if (pendingBidAmount === null) return;

    if (
      pendingCurrentPrice !== null &&
      pendingCurrentPrice !== post.currentPrice
    ) {
      throw new Error("현재가가 변경되었습니다. 입찰 금액을 다시 확인해 주세요.");
    }

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
    setPendingCurrentPrice(null);
  };

  const sendInquiry = async (message: string) => {
    // 상품 ID와 본문은 회원 본인의 Supabase 비공개 상담방에 저장됩니다.
    await onInquiry(post.id, message);
  };

  return (
    <article
      data-feed-product-id={post.id}
      className="render-lazy group/card flex h-full min-w-0 flex-col overflow-hidden bg-[var(--surface-raised)] transition-all duration-200 ease-out hover:relative hover:z-[1] hover:shadow-[var(--shadow-hover)]"
    >
      <div className="relative overflow-hidden">
        <PhotoGallery
          images={post.imageUrls}
          thumbnailImages={post.thumbnailUrls}
          title={galleryProductLabel}
          lotLabel={galleryLotLabel}
          compact
        />
        <span
          className={`pointer-events-none absolute left-2 top-2 border px-1.5 py-1 font-mono text-[9px] font-black tabular-nums tracking-tight shadow-sm backdrop-blur-md sm:left-3 sm:top-3 sm:px-2.5 sm:py-1.5 sm:text-[11px] ${closingPresentation.classes}`}
        >
          {closingPresentation.label}
        </span>
        <span className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-md border border-orange-300/30 bg-black/75 px-2 py-1 text-[9px] font-black tracking-[0.1em] text-white backdrop-blur-md sm:bottom-3 sm:left-3 sm:text-[10px]">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-orange-400" />
          LIVE BID
        </span>
        {bidDecision.reason === "auction-closed" &&
        post.participantCount === 0 ? (
          <span
            role="status"
            className="pointer-events-none absolute inset-x-2 bottom-10 z-10 rounded-md border border-amber-300/35 bg-black/82 px-2 py-1.5 text-center font-mono text-[9px] font-black tabular-nums tracking-tight text-amber-100 backdrop-blur-md sm:inset-x-3 sm:bottom-12 sm:text-[10px]"
          >
            ⏳ 22:00 재입찰 오픈 예정
          </span>
        ) : null}
        {antiSnipingActive ? (
          <span
            role="status"
            className="anti-sniping-pulse pointer-events-none absolute left-2 top-10 inline-flex items-center gap-1 rounded-md border border-orange-300/70 bg-gradient-to-r from-orange-600/95 to-red-600/95 px-2 py-1 font-mono text-[9px] font-black tabular-nums tracking-tight text-white shadow-[0_0_20px_rgba(249,115,22,0.45)] backdrop-blur-md sm:left-3 sm:top-12 sm:px-2.5 sm:text-[10px]"
          >
            <span aria-hidden="true">🔥</span>
            마감 연장 · +3 MIN
          </span>
        ) : null}
        {showOperatorControls && onRequestProductControl ? (
          <div
            role="toolbar"
            aria-label={`${galleryLotLabel} 운영자 제어`}
            className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-lg border border-red-400/20 bg-black/75 p-1 text-white shadow-lg backdrop-blur-md sm:right-3 sm:top-3"
          >
            <button
              type="button"
              aria-label={`${galleryLotLabel} 일시정지 및 미공개 전환`}
              title="일시정지 · 서버 보호 정책 확인"
              onClick={() => onRequestProductControl(post, "pause")}
              className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-white/10 bg-white/5 text-sm transition-all duration-200 ease-out hover:scale-105 hover:border-amber-300/45 hover:bg-amber-500/20 active:scale-95 sm:min-h-9 sm:min-w-9"
            >
              <span aria-hidden="true">⏸</span>
            </button>
            <button
              type="button"
              aria-label={`${galleryLotLabel} 즉시 삭제`}
              title="즉시 삭제"
              onClick={() => onRequestProductControl(post, "delete")}
              className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-red-400/25 bg-red-500/15 text-sm text-red-100 transition-all duration-200 ease-out hover:scale-105 hover:border-red-300/60 hover:bg-red-500/35 active:scale-95 sm:min-h-9 sm:min-w-9"
            >
              <span aria-hidden="true">🗑</span>
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-2.5 sm:p-5 lg:p-4">
        <header className="mb-2.5 flex items-center justify-between gap-1.5 border-b border-[var(--border)] pb-2.5 sm:mb-4 sm:gap-3 sm:pb-3">
          <div className="min-w-0 truncate text-[9px] font-bold uppercase tracking-[0.04em] text-[var(--text-muted)] sm:text-[11px] sm:tracking-[0.08em]">
            <time dateTime={publishedAt}>
              {formatKoreanDate(publishedAt, { includeWeekday: false })}
            </time>
            <span aria-hidden="true" className="mx-1 text-[var(--border-strong)] sm:mx-1.5">/</span>
            <span className="max-sm:hidden">{getKoreanWeekday(publishedAt)}요일</span>
          </div>
          <button
            type="button"
            onClick={() => setInquiryModalOpen(true)}
            aria-label="상품 문의하기"
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-md border border-[var(--border)] bg-transparent px-2 text-xs font-bold text-[var(--text-muted)] transition-all duration-200 ease-out hover:scale-[1.02] hover:border-[var(--text-strong)] hover:text-[var(--text-strong)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 sm:min-h-9 sm:min-w-0 sm:justify-start sm:px-2.5"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5"><path d="M7 18.5 3.5 21v-5.2A8.5 8.5 0 1 1 7 18.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
            <span className="hidden sm:inline">상품 문의하기</span>
          </button>
        </header>

        <div className="flex min-w-0 flex-1 flex-col">
          {productDetails.isCanonical ? (
            <dl
              aria-label="상품 정보"
              className="break-keep text-[11px] leading-4 tracking-[-0.015em] text-[var(--text-strong)] sm:text-sm sm:leading-6"
            >
              <div>
                <dt className="sr-only">Name:</dt>
                <dd className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setProductDetailOpen(true)}
                    className="line-clamp-2 w-full break-words text-left text-sm font-black leading-5 tracking-[-0.025em] text-[var(--text-strong)] underline-offset-4 transition-colors hover:text-[var(--accent-text)] hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:text-lg sm:leading-6 lg:text-base"
                    aria-label={`${productDetails.name} 상품 상세 보기`}
                  >
                    {productDetails.name}
                  </button>
                </dd>
              </div>
              <div className="mt-1.5 flex min-w-0 items-start gap-1 text-[11px] font-medium text-[var(--text-muted)] sm:mt-2 sm:gap-2 sm:text-[13px]">
                <dt className="shrink-0 font-mono text-[9px] font-bold uppercase tracking-[0.08em] sm:text-[10px] sm:tracking-[0.12em]">Size :</dt>
                <dd className="line-clamp-2 min-w-0 break-words">{productDetails.size}</dd>
              </div>
              {productDetails.condition ? (
                <div className="mt-1 flex min-w-0 items-start gap-1 text-[11px] font-medium text-[var(--text-muted)] sm:gap-2 sm:text-[13px]">
                  <dt className="shrink-0 font-mono text-[9px] font-bold uppercase tracking-[0.08em] sm:text-[10px] sm:tracking-[0.12em]">상품상태:</dt>
                  <dd className="line-clamp-2 min-w-0 break-words">
                    {productDetails.condition}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <div className="break-keep text-[var(--text-strong)]">
              <button
                type="button"
                onClick={() => setProductDetailOpen(true)}
                className="line-clamp-2 w-full whitespace-pre-line text-left text-xs font-bold leading-5 tracking-[-0.02em] text-[var(--text-strong)] underline-offset-4 transition-colors hover:text-[var(--accent-text)] hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] sm:line-clamp-4 sm:text-base sm:leading-6 lg:text-sm"
                aria-label={`${productLabel} 상품 상세 보기`}
              >
                {productDetails.legacyDescription}
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setSizeScannerOpen(true)}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 text-left text-[11px] font-black text-[var(--text-strong)] transition-all duration-200 ease-out hover:scale-[1.01] hover:border-[var(--accent)] hover:bg-[var(--accent-surface)] active:scale-[0.98] sm:mt-4 sm:text-xs"
          >
            <span className="inline-flex items-center gap-2">
              <span aria-hidden="true">📏</span>
              내 옷과 실측 비교하기
            </span>
            <span aria-hidden="true" className="text-[var(--text-muted)]">→</span>
          </button>

          <div
            className={`mt-3 grid grid-cols-1 overflow-hidden rounded-lg border transition-colors duration-200 sm:mt-5 sm:grid-cols-[minmax(0,1fr)_auto] ${bidPresentation.frame}`}
            data-bid-status={bidState.status}
          >
            <div className="flex min-w-0 flex-col justify-center px-2.5 py-2.5 sm:px-4 sm:py-3.5">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <p
                  className={`text-[10px] font-bold uppercase tracking-[0.14em] ${bidPresentation.labelColor}`}
                >
                  {bidPresentation.label}
                </p>
                <span className="max-sm:hidden"><BidParticipationBadge status={bidState.status} /></span>
              </div>
              <p
                className={`mt-1 break-keep font-mono text-base font-black tabular-nums tracking-tight sm:text-[1.4rem] ${bidPresentation.priceColor}`}
              >
                {formatKRW(displayedPrice)}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setHistoryModalOpen(true)}
              className={`flex min-h-11 min-w-0 items-center justify-center gap-2 border-t px-2 text-center text-[10px] font-bold leading-snug transition-all duration-200 ease-out hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset sm:min-h-[4.75rem] sm:min-w-[6.75rem] sm:border-l sm:border-t-0 sm:px-3 sm:text-left sm:text-xs ${bidPresentation.historyButton}`}
              aria-label={`입찰 현황 보기, ${post.bidHistory.length}건`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4"><path d="M8 7h11M8 12h11M8 17h7M4 7h.01M4 12h.01M4 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              <span className="hidden sm:inline">
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
                  : bidDecision.reason === "anti-sniping-overtime"
                    ? "마감 연장 중 · 기존 참여자 입찰 가능"
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
                {unavailableBidLabel}
              </Button>
            ) : (
              <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                <Button
                  fullWidth
                  size="lg"
                  onClick={() => setBidModalOpen(true)}
                  className="min-h-12 rounded-lg px-1.5 py-2 text-xs font-black transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-lg sm:px-2 sm:text-sm"
                >
                  경매하기
                </Button>
                <Button
                  fullWidth
                  size="lg"
                  variant="secondary"
                  onClick={requestQuickBid}
                  className="min-h-12 rounded-lg break-keep px-1.5 py-2 text-xs font-black transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-md sm:px-2 sm:text-sm"
                >
                  {quickBidLabel}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <ProductDetailModal
        open={productDetailOpen}
        onClose={() => setProductDetailOpen(false)}
        post={post}
        details={productDetails}
        lotLabel={galleryLotLabel}
        galleryTitle={galleryProductLabel}
        closingLabel={closingPresentation.label}
        priceLabel={bidPresentation.label}
        displayedPrice={displayedPrice}
        bidCount={post.bidHistory.length}
        bidAllowed={bidDecision.allowed && !isSold}
        unavailableBidLabel={unavailableBidLabel}
        quickBidLabel={quickBidLabel}
        onOpenInquiry={() => setInquiryModalOpen(true)}
        onOpenSizeScanner={() => setSizeScannerOpen(true)}
        onOpenBidHistory={() => setHistoryModalOpen(true)}
        onOpenManualBid={() => setBidModalOpen(true)}
        onQuickBid={requestQuickBid}
      />

      <BidFormModal
        open={bidModalOpen}
        onClose={() => setBidModalOpen(false)}
        onSubmit={requestManualBid}
        title={productLabel}
        currentPrice={post.currentPrice}
        bidIncrement={post.bidIncrement}
        minimumBid={minimumBidAmount}
        productDescription={post.description}
        productSize={productDetails.size}
        userId={currentUserId}
      />

      <SizeComparisonScanner
        open={sizeScannerOpen}
        onClose={() => setSizeScannerOpen(false)}
        productTitle={productLabel}
        productDescription={post.description}
        productSize={productDetails.size}
        userId={currentUserId}
      />

      <BidConfirmModal
        open={pendingBidAmount !== null}
        currentPrice={pendingCurrentPrice ?? post.currentPrice}
        latestCurrentPrice={post.currentPrice}
        amount={pendingBidAmount ?? 0}
        itemTitle={productLabel}
        isFinalBid={bidDecision.finalOnAccept}
        onClose={() => {
          setPendingBidAmount(null);
          setPendingCurrentPrice(null);
        }}
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
