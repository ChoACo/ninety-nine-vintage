"use client";

/* eslint-disable @next/next/no-img-element -- Supabase Storage의 공개 상품 이미지를 표시합니다. */
import { useMemo, useState } from "react";
import BidConfirmModal from "@/src/components/feed/BidConfirmModal";
import { useAuctionPolicyMinuteClock } from "@/src/hooks/useAuctionPolicyClock";
import type { AuctionPost } from "@/src/types/auction";
import {
  assertAuctionBidAllowed,
  getAuctionBidDecision,
  type AuctionBidDecision,
} from "@/src/utils/auctionBidPolicy";
import { getUserBidStatus } from "@/src/utils/bidStatus";
import { getQuickBidAmount } from "@/src/utils/bidding";
import { formatKRW } from "@/src/utils/formatters";

export interface LiveBidSidebarProps {
  posts: readonly AuctionPost[];
  currentUserName: string;
  onBid: (postId: string, amount: number) => void | Promise<void>;
  className?: string;
}

function getItemLabel(post: AuctionPost): string {
  return post.description.trim() || post.title;
}

interface BidItemProps {
  post: AuctionPost;
  urgent?: boolean;
  onQuickBid?: () => void;
  bidDecision?: AuctionBidDecision;
}

function BidItem({
  post,
  urgent = false,
  onQuickBid,
  bidDecision,
}: BidItemProps) {
  const label = getItemLabel(post);

  return (
    <li
      className={`border-y p-2.5 transition-all duration-200 ease-out hover:shadow-sm ${
        urgent
          ? "border-[var(--danger-text)]/30 bg-[var(--danger-surface)]"
          : "border-[var(--border)] bg-[var(--surface-raised)]"
      }`}
    >
      <div className="flex gap-2.5">
        <div className="h-14 w-14 shrink-0 overflow-hidden bg-[var(--surface-muted)]">
          {post.thumbnailUrls[0] || post.imageUrls[0] ? (
            <img
              src={post.thumbnailUrls[0] || post.imageUrls[0]}
              alt=""
              className="h-full w-full object-cover transition-transform duration-300 ease-out hover:scale-[1.04]"
              loading="lazy"
            />
          ) : (
            <span
              className="grid h-full w-full place-items-center text-[var(--text-muted)]"
              aria-hidden="true"
            >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5"><path d="m4 16 4.5-4.5 3 3 2-2L20 19M7.5 8.5h.01M4 4h16v16H4V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-keep text-[13px] font-bold leading-5 text-[var(--text-strong)]">
            {label}
          </p>
          <p
            className={`mt-1 font-mono text-sm font-black tabular-nums tracking-tight ${
              urgent ? "text-[var(--danger-text)]" : "text-[var(--success-text)]"
            }`}
          >
            {formatKRW(post.currentPrice)}
          </p>
        </div>
      </div>

      {onQuickBid ? (
        <button
          type="button"
          onClick={onQuickBid}
          disabled={bidDecision ? !bidDecision.allowed : false}
          className="mt-2.5 min-h-10 w-full rounded-md bg-[var(--accent)] px-3 py-2 text-xs font-black text-[var(--accent-contrast)] shadow-sm transition-all duration-200 ease-out hover:scale-[1.02] hover:bg-[var(--accent-hover)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)] disabled:text-[var(--text-muted)] disabled:shadow-none"
          aria-label={`${label}, 1,000원 높여 다시 입찰`}
        >
          {bidDecision?.reason === "auction-closed"
            ? "오늘 경매 마감"
            : bidDecision?.reason === "late-first-bid-finalized"
              ? "확정 입찰 완료"
              : bidDecision?.reason === "new-bid-cutoff"
                ? "신규 입찰 마감"
                : "+1,000원 즉시 재입찰"}
        </button>
      ) : null}
    </li>
  );
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="border border-dashed border-[var(--border)] bg-[var(--surface-raised)] px-3 py-5 text-center text-[var(--text-muted)]">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="mx-auto h-6 w-6"><path d="M5 7h14v12H5V7Zm3-3h8v3" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
      <p className="mt-2 text-xs font-medium leading-5">{children}</p>
    </div>
  );
}

export default function LiveBidSidebar({
  posts,
  currentUserName,
  onBid,
  className = "",
}: LiveBidSidebarProps) {
  const [confirmPostId, setConfirmPostId] = useState<string | null>(null);
  const auctionNow = useAuctionPolicyMinuteClock();

  const { outbidPosts, leadingPosts, confirmedPosts } = useMemo(() => {
    const availablePosts = posts.filter((post) => post.status === "active");
    const userPosts = availablePosts.filter((post) =>
      post.bidHistory.some(
        (bid) => bid.bidderName.trim() === currentUserName.trim(),
      ),
    );

    return {
      outbidPosts: availablePosts.filter(
        (post) =>
          !post.bidLockedAt &&
          getUserBidStatus(post, currentUserName) === "user-outbid",
      ),
      leadingPosts: availablePosts.filter(
        (post) =>
          !post.bidLockedAt &&
          getUserBidStatus(post, currentUserName) === "user-leading",
      ),
      confirmedPosts: userPosts.filter((post) => Boolean(post.bidLockedAt)),
    };
  }, [currentUserName, posts]);

  const confirmPost = confirmPostId
    ? posts.find((post) => post.id === confirmPostId)
    : undefined;
  const confirmAmount = confirmPost ? getQuickBidAmount(confirmPost) : 0;

  const handleConfirm = async () => {
    if (!confirmPost) return;

    assertAuctionBidAllowed({
      post: confirmPost,
      currentUserName,
      now: new Date(),
    });

    await onBid(confirmPost.id, getQuickBidAmount(confirmPost));
    setConfirmPostId(null);
  };

  return (
    <>
      <aside
        aria-labelledby="my-live-bids-title"
        className={`theme-panel sticky top-24 max-h-[calc(100dvh-7rem)] self-start overflow-y-auto overscroll-contain border p-4 shadow-[var(--panel-shadow)] backdrop-blur motion-safe:transition-[top,box-shadow] motion-safe:duration-300 motion-safe:ease-out ${className}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent-text)]">
              My live auction
            </p>
            <h2
              id="my-live-bids-title"
              className="mt-1 break-keep text-base font-black leading-6 tracking-[-0.025em] text-[var(--text-strong)]"
            >
              내 실시간 경매 현황
            </h2>
          </div>
          <span
            className="shrink-0 border-y border-[var(--border)] px-2.5 py-1 font-mono text-xs font-black tabular-nums tracking-tight text-[var(--text-strong)]"
            aria-label={`내가 참여한 상품 ${outbidPosts.length + leadingPosts.length + confirmedPosts.length}개`}
          >
            {outbidPosts.length + leadingPosts.length + confirmedPosts.length}개
          </span>
        </div>

        <section
          aria-labelledby="outbid-products-title"
          className="mt-4 border-l-2 border-[var(--danger-text)] bg-[var(--danger-surface)] p-2.5"
        >
          <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
            <h3
              id="outbid-products-title"
              className="break-keep text-sm font-black text-[var(--danger-text)]"
            >
              재입찰 필요 상품
            </h3>
            <span
              className="font-mono text-xs font-black tabular-nums tracking-tight text-[var(--danger-text)]"
              aria-live="polite"
            >
              {outbidPosts.length}
            </span>
          </div>
          {outbidPosts.length > 0 ? (
            <ul className="space-y-2">
              {outbidPosts.map((post) => (
                <BidItem
                  key={post.id}
                  post={post}
                  urgent
                  bidDecision={getAuctionBidDecision({
                    post,
                    currentUserName,
                    now: auctionNow,
                  })}
                  onQuickBid={() => setConfirmPostId(post.id)}
                />
              ))}
            </ul>
          ) : (
            <EmptyState>지금은 다시 입찰할 상품이 없어요.</EmptyState>
          )}
        </section>

        <section
          aria-labelledby="confirmed-products-title"
          className="mt-3 border-l-2 border-[var(--warning-text)] bg-[var(--warning-surface)] p-2.5"
        >
          <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
            <h3
              id="confirmed-products-title"
              className="break-keep text-sm font-black text-[var(--warning-text)]"
            >
              확정 입찰 상품
            </h3>
            <span className="font-mono text-xs font-black tabular-nums tracking-tight text-[var(--warning-text)]">
              {confirmedPosts.length}
            </span>
          </div>
          {confirmedPosts.length > 0 ? (
            <ul className="space-y-2">
              {confirmedPosts.map((post) => (
                <BidItem key={post.id} post={post} />
              ))}
            </ul>
          ) : (
            <EmptyState>즉시 확정된 상품이 아직 없어요.</EmptyState>
          )}
        </section>

        <section
          aria-labelledby="leading-products-title"
          className="mt-3 border-l-2 border-[var(--success-text)] bg-[var(--success-surface)] p-2.5"
        >
          <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
            <h3
              id="leading-products-title"
              className="break-keep text-sm font-black text-[var(--success-text)]"
            >
              내가 입찰 중인 상품
            </h3>
            <span
              className="font-mono text-xs font-black tabular-nums tracking-tight text-[var(--success-text)]"
              aria-live="polite"
            >
              {leadingPosts.length}
            </span>
          </div>
          {leadingPosts.length > 0 ? (
            <ul className="space-y-2">
              {leadingPosts.map((post) => (
                <BidItem key={post.id} post={post} />
              ))}
            </ul>
          ) : (
            <EmptyState>내가 최고가인 상품이 아직 없어요.</EmptyState>
          )}
        </section>

        <p className="mt-3 break-keep text-center text-[11px] font-medium leading-5 text-[var(--text-muted)]">
          입찰 변화가 생기면 목록이 자동으로 이동합니다.
        </p>
      </aside>

      {confirmPost ? (
        <BidConfirmModal
          open
          amount={confirmAmount}
          itemTitle={getItemLabel(confirmPost)}
          isFinalBid={
            getAuctionBidDecision({
              post: confirmPost,
              currentUserName,
              now: auctionNow,
            }).finalOnAccept
          }
          onClose={() => setConfirmPostId(null)}
          onConfirm={handleConfirm}
        />
      ) : null}
    </>
  );
}
