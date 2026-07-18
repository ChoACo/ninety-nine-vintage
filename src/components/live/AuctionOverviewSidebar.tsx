"use client";

/* eslint-disable @next/next/no-img-element -- Supabase Storage의 공개 상품 썸네일을 표시합니다. */
import { useMemo } from "react";

import type { AuctionPost } from "@/src/types/auction";
import { formatKRW } from "@/src/utils/formatters";

export interface AuctionOverviewSidebarProps {
  posts: readonly AuctionPost[];
  className?: string;
}

function getAuctionState(post: AuctionPost) {
  if (post.bidLockedAt) {
    return {
      label: "입찰 확정",
      classes: "bg-[var(--warning-surface)] text-[var(--warning-text)]",
    };
  }
  if (post.participantCount > 0) {
    return {
      label: "입찰 진행",
      classes: "bg-[var(--success-surface)] text-[var(--success-text)]",
    };
  }
  return {
    label: "첫 입찰 대기",
    classes: "bg-[var(--surface-muted)] text-[var(--text-muted)]",
  };
}

export default function AuctionOverviewSidebar({
  posts,
  className = "",
}: AuctionOverviewSidebarProps) {
  const inProgressPosts = useMemo(
    () =>
      posts
        .filter((post) => post.status === "active")
        .toSorted((left, right) => {
          const lockedOrder = Number(Boolean(right.bidLockedAt)) - Number(Boolean(left.bidLockedAt));
          if (lockedOrder !== 0) return lockedOrder;
          const participantOrder = right.participantCount - left.participantCount;
          if (participantOrder !== 0) return participantOrder;
          return (
            Date.parse(right.publish_at ?? right.createdAt) -
            Date.parse(left.publish_at ?? left.createdAt)
          );
        }),
    [posts],
  );

  return (
    <aside
      aria-labelledby="auction-overview-title"
      className={`theme-panel sticky top-24 max-h-[calc(100dvh-7rem)] self-start overflow-y-auto overscroll-contain rounded-[1.6rem] border p-4 shadow-[0_16px_40px_rgba(93,69,54,0.12)] backdrop-blur motion-safe:transition-[top,box-shadow] motion-safe:duration-300 motion-safe:ease-out ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-extrabold tracking-[0.12em] text-[var(--accent-text)]">
            LIVE AUCTION OVERVIEW
          </p>
          <h2
            id="auction-overview-title"
            className="mt-1 break-keep text-[17px] font-black leading-6 text-[var(--text-strong)]"
          >
            전체 경매 진행 현황
          </h2>
        </div>
        <span
          className="shrink-0 rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-[14px] font-black text-[var(--text-strong)]"
          aria-label={`현재 진행 상품 ${inProgressPosts.length}개`}
        >
          {inProgressPosts.length}개
        </span>
      </div>

      {inProgressPosts.length > 0 ? (
        <ul className="mt-4 space-y-2" aria-label="전체 진행 상품 목록">
          {inProgressPosts.map((post) => {
            const state = getAuctionState(post);
            const thumbnail = post.thumbnailUrls[0] || post.imageUrls[0];

            return (
              <li
                key={post.id}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-2.5"
              >
                <div className="flex gap-2.5">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-[var(--surface-muted)]">
                    {thumbnail ? (
                      <img
                        src={thumbnail}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span
                        className="grid h-full w-full place-items-center text-xl text-[var(--text-muted)]"
                        aria-hidden="true"
                      >
                        ◇
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 break-keep text-[15px] font-extrabold leading-5 text-[var(--text-strong)]">
                      {post.title}
                    </p>
                    <p className="mt-1 text-[17px] font-black text-[var(--accent-text)]">
                      {formatKRW(post.currentPrice)}
                    </p>
                  </div>
                </div>

                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-black ${state.classes}`}>
                    {state.label}
                  </span>
                  <span className="text-xs font-black text-[var(--text-muted)]">
                    참여 {post.participantCount.toLocaleString("ko-KR")}명
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-3 py-5 text-center text-[15px] font-bold leading-6 text-[var(--text-muted)]">
          현재 공개되어 진행 중인 상품이 없습니다.
        </p>
      )}

      <p className="mt-3 break-keep text-center text-[13px] font-bold leading-5 text-[var(--text-muted)]">
        진행 상품과 입찰 참여 수가 실시간으로 갱신됩니다.
      </p>
    </aside>
  );
}
