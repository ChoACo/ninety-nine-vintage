"use client";

/* eslint-disable @next/next/no-img-element -- Supabase Storage의 공개 상품 이미지를 표시합니다. */
import { useMemo, useState } from "react";
import BidConfirmModal from "@/src/components/feed/BidConfirmModal";
import { useAuctionPolicyClock } from "@/src/hooks/useAuctionPolicyClock";
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
      className={`rounded-2xl border p-2.5 ${
        urgent
          ? "border-[#f1aaa0] bg-[#fff3f0]"
          : "border-[#cce4d3] bg-[#f3faf5]"
      }`}
    >
      <div className="flex gap-2.5">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-[#eadfd4]">
          {post.imageUrls[0] ? (
            <img
              src={post.imageUrls[0]}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <span
              className="grid h-full w-full place-items-center text-xl text-[#8a776a]"
              aria-hidden="true"
            >
              ◇
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-keep text-[15px] font-extrabold leading-5 text-[#4c4039]">
            {label}
          </p>
          <p
            className={`mt-1 text-[17px] font-black ${
              urgent ? "text-[#bd4d40]" : "text-[#37704b]"
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
          className="mt-2.5 min-h-12 w-full rounded-xl bg-[#df6254] px-3 py-2 text-[17px] font-black text-white shadow-[0_7px_16px_rgba(186,70,58,0.18)] transition hover:bg-[#cf5144] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#df6254] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#c8bcb5] disabled:text-[#6f625c] disabled:shadow-none"
          aria-label={`${label}, 1,000원 높여 다시 입찰`}
        >
          {bidDecision?.reason === "auction-closed"
            ? "⛔ 오늘 경매 마감"
            : bidDecision?.reason === "late-first-bid-finalized"
              ? "✅ 확정 입찰 완료"
            : bidDecision?.reason === "new-bid-cutoff"
              ? "⛔ 신규 입찰 마감"
              : "+1,000원 즉시 재입찰"}
        </button>
      ) : null}
    </li>
  );
}

function EmptyState({ children }: { children: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-[#dfd4cb] bg-white/65 px-3 py-4 text-center text-[15px] font-bold leading-6 text-[#837268]">
      {children}
    </p>
  );
}

export default function LiveBidSidebar({
  posts,
  currentUserName,
  onBid,
  className = "",
}: LiveBidSidebarProps) {
  const [confirmPostId, setConfirmPostId] = useState<string | null>(null);
  const auctionNow = useAuctionPolicyClock();

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
      now: auctionNow,
    });

    await onBid(confirmPost.id, getQuickBidAmount(confirmPost));
    setConfirmPostId(null);
  };

  return (
    <>
      <aside
        aria-labelledby="my-live-bids-title"
        className={`sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto rounded-[1.6rem] border border-[#ead8cc] bg-[#fffaf5]/95 p-4 shadow-[0_16px_40px_rgba(93,69,54,0.12)] backdrop-blur ${className}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[13px] font-extrabold tracking-[0.12em] text-[#aa715d]">
              MY LIVE AUCTION
            </p>
            <h2
              id="my-live-bids-title"
              className="mt-1 break-keep text-[17px] font-black leading-6 text-[#493b34]"
            >
              내 실시간 경매 현황
            </h2>
          </div>
          <span
            className="shrink-0 rounded-full bg-[#f2e9df] px-2.5 py-1 text-[14px] font-black text-[#795f51]"
            aria-label={`내가 참여한 상품 ${outbidPosts.length + leadingPosts.length + confirmedPosts.length}개`}
          >
            {outbidPosts.length + leadingPosts.length + confirmedPosts.length}개
          </span>
        </div>

        <section
          aria-labelledby="outbid-products-title"
          className="mt-4 rounded-[1.25rem] border border-[#f0aaa0] bg-[#ffe7e3] p-2.5"
        >
          <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
            <h3
              id="outbid-products-title"
              className="break-keep text-[17px] font-black text-[#a53d35]"
            >
              <span aria-hidden="true">🔥</span> 재입찰 필요 상품
            </h3>
            <span
              className="rounded-full bg-white/80 px-2 py-0.5 text-[14px] font-black text-[#b7473d]"
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
          className="mt-3 rounded-[1.25rem] border border-[#e8c99e] bg-[#fff6df] p-2.5"
        >
          <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
            <h3
              id="confirmed-products-title"
              className="break-keep text-[17px] font-black text-[#815d2f]"
            >
              <span aria-hidden="true">✓</span> 확정 입찰 상품
            </h3>
            <span className="rounded-full bg-white/80 px-2 py-0.5 text-[14px] font-black text-[#815d2f]">
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
          className="mt-3 rounded-[1.25rem] border border-[#b9dcc4] bg-[#e7f5eb] p-2.5"
        >
          <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
            <h3
              id="leading-products-title"
              className="break-keep text-[17px] font-black text-[#356849]"
            >
              <span aria-hidden="true">🟢</span> 내가 입찰 중인 상품
            </h3>
            <span
              className="rounded-full bg-white/80 px-2 py-0.5 text-[14px] font-black text-[#39724e]"
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

        <p className="mt-3 break-keep text-center text-[13px] font-bold leading-5 text-[#8c786b]">
          입찰 변화가 생기면 목록이 자동으로 이동합니다.
        </p>
      </aside>

      {confirmPost ? (
        <BidConfirmModal
          open
          amount={confirmAmount}
          itemTitle={getItemLabel(confirmPost)}
          isFinalBid={getAuctionBidDecision({
            post: confirmPost,
            currentUserName,
            now: auctionNow,
          }).finalOnAccept}
          onClose={() => setConfirmPostId(null)}
          onConfirm={handleConfirm}
        />
      ) : null}
    </>
  );
}
