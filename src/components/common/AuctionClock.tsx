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
  const { currentTime, deadline, countdown } = useAuctionClock({ rollover: false });
  const auctionPhase = getDailyAuctionPhase(currentTime);
  const isClosed = auctionPhase === "closed";
  const isRestricted = auctionPhase === "existing-participants-only";

  return (
    <section
      aria-label="오늘 등록 상품의 오후 9시 정산 시간"
      className={`overflow-hidden rounded-[2rem] border border-[#dcebed] bg-[#eef8fa] shadow-[0_16px_38px_rgba(80,125,136,0.11)] ${className}`}
    >
      <div className="grid gap-px bg-[#dcebed] md:grid-cols-[0.9fr_1.1fr]">
        <div className="bg-[#f4fbfc] p-5 sm:p-6">
          <p className="flex items-center gap-2 text-sm font-black tracking-[0.1em] text-[#587e88]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#6aa6b6]" />
            CURRENT TIME
          </p>
          <p
            suppressHydrationWarning
            className="mt-3 text-4xl font-black tabular-nums tracking-[-0.04em] text-[#294b55] sm:text-5xl"
          >
            {formatKoreanTime(currentTime, true)}
          </p>
          <p suppressHydrationWarning className="mt-2 text-base font-semibold text-[#69828a]">
            {formatKoreanDate(currentTime)}
          </p>
        </div>

        <div className="relative bg-[#fff5ea] p-5 sm:p-6">
          <div
            aria-hidden="true"
            className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-[#ffd8c8]/60"
          />
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-black tracking-[0.1em] text-[#ad6557]">
                {isClosed
                  ? "TODAY'S AUCTION CLOSED"
                  : isRestricted
                    ? "EXISTING BIDDERS ONLY"
                    : "UNTIL 9:00 PM"}
              </p>
              <span className="rounded-full border border-[#f2c5b5] bg-white/70 px-3 py-1.5 text-sm font-bold text-[#9d6357]">
                오후 8:56 신규 제한 · 9:00 마감
              </span>
            </div>
            <p
              aria-live="polite"
              suppressHydrationWarning
              className="mt-3 text-4xl font-black tabular-nums tracking-[-0.04em] text-[#a5483d] sm:text-5xl"
            >
              {isClosed ? "오늘 경매 마감" : formatCountdown(countdown)}
            </p>
            <p suppressHydrationWarning className="mt-2 break-keep text-[17px] font-bold leading-7 text-[#8d7168]">
              {isClosed
                ? "오늘 입찰은 종료되었습니다. 미판매 상품은 다음 경매에서 다시 참여할 수 있습니다."
                : isRestricted
                  ? "기존 참여자만 계속 입찰할 수 있습니다. 단, 입찰 0건 상품은 첫 입찰자에게 열려 있습니다."
                  : `오후 8시 56분부터 신규 참여가 제한되며 ${formatKoreanTime(deadline)}에 마감됩니다.`}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
