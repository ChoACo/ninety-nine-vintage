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
      className={`overflow-hidden rounded-[1.4rem] border border-[var(--info-border)] bg-[var(--info-surface)] shadow-[0_10px_28px_rgba(80,125,136,0.09)] sm:rounded-[1.7rem] ${className}`}
    >
      <div className="grid gap-px bg-[var(--info-border)] sm:grid-cols-[0.8fr_1.2fr]">
        <div className="bg-[var(--info-surface)] p-4 sm:p-5">
          <p className="flex items-center gap-2 text-xs font-black tracking-[0.12em] text-[var(--info-text)]">
            <span className="size-2 rounded-full bg-[#6aa6b6]" />
            현재 시각
          </p>
          <p
            suppressHydrationWarning
            className="mt-2 text-[2rem] font-black tabular-nums tracking-[-0.04em] text-[var(--text-strong)] sm:text-[2.5rem]"
          >
            {formatKoreanTime(currentTime, true)}
          </p>
          <p suppressHydrationWarning className="mt-1 text-sm font-semibold text-[var(--info-text)]">
            {formatKoreanDate(currentTime)}
          </p>
        </div>

        <div className="bg-[var(--accent-surface)] p-4 sm:p-5">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-black tracking-[0.1em] text-[var(--accent-text)]">
                {isClosed
                  ? "경매 정산 중"
                  : isRestricted
                    ? "기존 참여자 입찰"
                    : "오후 9시 마감까지"}
              </p>
              <span className="rounded-full border border-[var(--border-strong)] bg-[var(--surface-raised)]/70 px-2.5 py-1 text-xs font-bold text-[var(--text-muted)]">
                20:56 제한 · 21:00 정산 · 22:00 재개
              </span>
            </div>
            <p
              aria-live="polite"
              suppressHydrationWarning
              className="mt-2 text-[2rem] font-black tabular-nums tracking-[-0.04em] text-[var(--accent-text)] sm:text-[2.5rem]"
            >
              {isClosed ? "오후 10시 재개" : formatCountdown(countdown)}
            </p>
            <p suppressHydrationWarning className="mt-1.5 break-keep text-sm font-semibold leading-6 text-[var(--text-muted)] sm:text-[15px]">
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
