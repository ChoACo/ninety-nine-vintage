"use client";

import { useAuctionClock } from "@/src/hooks/useAuctionClock";
import { getDailyAuctionPhase } from "@/src/utils/auctionBidPolicy";
import {
  formatCountdown,
  formatKoreanDate,
  formatKoreanTime,
} from "@/src/utils/formatters";

export interface AuctionClockProps {
  className?: string;
}

export default function AuctionClock({ className = "" }: AuctionClockProps) {
  const { currentTime, deadline, countdown } = useAuctionClock({ rollover: true });
  const auctionPhase = getDailyAuctionPhase(currentTime);
  const isClosed = auctionPhase === "closed";
  const isRestricted = auctionPhase === "existing-participants-only";

  return (
    <section
      aria-label="오늘 등록 상품의 오후 9시 정산 시간"
      className={`overflow-hidden rounded-[2rem] border border-[var(--info-border)] bg-[var(--info-surface)] shadow-[0_16px_38px_rgba(80,125,136,0.11)] ${className}`}
    >
      <div className="grid gap-px bg-[var(--info-border)] md:grid-cols-[0.9fr_1.1fr]">
        <div className="bg-[var(--info-surface)] p-5 sm:p-6">
          <p className="flex items-center gap-2 text-sm font-black tracking-[0.1em] text-[var(--info-text)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#6aa6b6]" />
            CURRENT TIME
          </p>
          <p
            suppressHydrationWarning
            className="mt-3 text-4xl font-black tabular-nums tracking-[-0.04em] text-[var(--text-strong)] sm:text-5xl"
          >
            {formatKoreanTime(currentTime, true)}
          </p>
          <p suppressHydrationWarning className="mt-2 text-base font-semibold text-[var(--info-text)]">
            {formatKoreanDate(currentTime)}
          </p>
        </div>

        <div className="relative bg-[var(--accent-surface)] p-5 sm:p-6">
          <div
            aria-hidden="true"
            className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-[#ffd8c8]/60"
          />
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-black tracking-[0.1em] text-[#ad6557]">
                {isClosed
                  ? "AUCTION SETTLEMENT PAUSE"
                  : isRestricted
                    ? "EXISTING BIDDERS ONLY"
                    : "UNTIL 9:00 PM"}
              </p>
              <span className="rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)]/70 px-3 py-1.5 text-sm font-bold text-[var(--text-muted)]">
                오후 8:56 신규 제한 · 오후 9:00 정산 · 오후 10:00 재개
              </span>
            </div>
            <p
              aria-live="polite"
              suppressHydrationWarning
              className="mt-3 text-4xl font-black tabular-nums tracking-[-0.04em] text-[var(--accent-text)] sm:text-5xl"
            >
              {isClosed ? "오후 10시 재개" : formatCountdown(countdown)}
            </p>
            <p suppressHydrationWarning className="mt-2 break-keep text-[17px] font-bold leading-7 text-[var(--text-muted)]">
              {isClosed
                ? "낙찰 상품을 판매 완료로 옮기는 정산 시간입니다. 미판매 상품은 오후 10시부터 다시 입찰할 수 있습니다."
                : isRestricted
                  ? "기존 참여자는 오후 9시까지 입찰할 수 있습니다. 입찰 0건 상품의 첫 입찰은 즉시 낙찰 확정됩니다."
                  : `오후 8시 56분부터 신규 참여가 제한되며 ${formatKoreanTime(deadline)}에 마감됩니다.`}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
