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
  return {
    label: "입찰 진행",
    classes: "bg-[var(--success-surface)] text-[var(--success-text)]",
  };
}

export default function AuctionOverviewSidebar({
  posts,
  className = "",
}: AuctionOverviewSidebarProps) {
  const inProgressPosts = useMemo(
    () =>
      posts
        .filter(
          (post) =>
            post.status === "active" &&
            post.participantCount > 0 &&
            post.bidHistory.length > 0,
        )
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
      className={`theme-panel sticky top-24 max-h-[calc(100dvh-7rem)] self-start overflow-y-auto overscroll-contain border p-4 shadow-[var(--panel-shadow)] backdrop-blur motion-safe:transition-[top,box-shadow] motion-safe:duration-300 motion-safe:ease-out ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--accent-text)]">
            Live auction overview
          </p>
          <h2
            id="auction-overview-title"
            className="mt-1 break-keep text-base font-black leading-6 tracking-[-0.025em] text-[var(--text-strong)]"
          >
            전체 경매 진행 현황
          </h2>
        </div>
        <span
          className="shrink-0 border-y border-[var(--border)] px-2.5 py-1 font-mono text-xs font-black tabular-nums tracking-tight text-[var(--text-strong)]"
          aria-label={`현재 진행 상품 ${inProgressPosts.length}개`}
        >
          {inProgressPosts.length}개
        </span>
      </div>

      {inProgressPosts.length > 0 ? (
        <ul className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)]" aria-label="전체 진행 상품 목록">
          {inProgressPosts.map((post) => {
            const state = getAuctionState(post);
            const thumbnail = post.thumbnailUrls[0] || post.imageUrls[0];

            return (
              <li
                key={post.id}
                className="bg-[var(--surface-raised)] py-3 transition-all duration-200 ease-out hover:bg-[var(--surface-muted)]"
              >
                <div className="flex gap-2.5">
                  <div className="h-14 w-14 shrink-0 overflow-hidden bg-[var(--surface-muted)]">
                    {thumbnail ? (
                      <img
                        src={thumbnail}
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
                      {post.title}
                    </p>
                    <p className="mt-1 font-mono text-sm font-black tabular-nums tracking-tight text-[var(--accent-text)]">
                      {formatKRW(post.currentPrice)}
                    </p>
                  </div>
                </div>

                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <span className={`border border-current/15 px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${state.classes}`}>
                    {state.label}
                  </span>
                  <span className="font-mono text-[10px] font-black tabular-nums tracking-tight text-[var(--text-muted)]">
                    참여 {post.participantCount.toLocaleString("ko-KR")}명
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-4 border border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-3 py-8 text-center text-[var(--text-muted)]">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="mx-auto h-7 w-7"><path d="M4 18V9m5 9V5m5 13v-7m5 7V8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          <p className="mt-2 text-xs font-bold leading-5">현재 입찰자가 있는 진행 상품이 없습니다.</p>
        </div>
      )}

      <p className="mt-3 break-keep text-center text-[11px] font-medium leading-5 text-[var(--text-muted)]">
        입찰자가 있는 진행 상품과 참여 수가 실시간으로 갱신됩니다.
      </p>
    </aside>
  );
}
