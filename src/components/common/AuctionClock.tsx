"use client";

import { useAuctionClock } from "@/src/hooks/useAuctionClock";
import { getDailyAuctionPhase } from "@/src/utils/auctionBidPolicy";
import {
  formatCountdown,
  formatKoreanDate,
  formatKoreanTime,
  getCountdown,
} from "@/src/utils/formatters";

export interface AuctionClockProps {
  className?: string;
  /** Realtime products에서 받은 서버 권위 안티 스나이핑 마감 시각들 */
  antiSnipingDeadlines?: readonly string[];
}

export default function AuctionClock({
  className = "",
  antiSnipingDeadlines = [],
}: AuctionClockProps) {
  const { currentTime, deadline, countdown } = useAuctionClock({ rollover: true });
  const auctionPhase = getDailyAuctionPhase(currentTime);
  const activeAntiSnipingDeadlines = antiSnipingDeadlines
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value) && value > currentTime.getTime())
    .sort((left, right) => left - right);
  const nearestAntiSnipingDeadline = activeAntiSnipingDeadlines[0];
  const antiSnipingActive = nearestAntiSnipingDeadline !== undefined;
  const displayCountdown = antiSnipingActive
    ? getCountdown(nearestAntiSnipingDeadline, currentTime)
    : countdown;
  const isClosed = auctionPhase === "closed" && !antiSnipingActive;
  const isRestricted = auctionPhase === "existing-participants-only";
  const isCritical = !isClosed && displayCountdown.totalSeconds <= 10 * 60;
  const isClosingSoon =
    !isClosed && !isCritical && displayCountdown.totalSeconds <= 60 * 60;
  const urgencyClass = isCritical
    ? "auction-urgency-critical"
    : isClosingSoon
      ? "auction-urgency-soon"
      : "text-[var(--live-foreground)]";

  return (
    <section
      aria-label="오늘 등록 상품의 오후 9시 정산 시간"
      className={`overflow-hidden rounded-xl border border-[var(--live-border)] bg-[var(--live-surface)] text-[var(--live-foreground)] shadow-[0_16px_38px_rgba(18,18,17,0.18)] ${className}`}
    >
      <div className="flex flex-col gap-2 px-3 py-2.5 sm:gap-3 sm:px-5 sm:py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--live-border)] px-2 py-1 text-[9px] font-extrabold tracking-[0.2em]">
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${
                    isClosed
                      ? "bg-[var(--live-muted)]"
                      : isCritical
                        ? "bg-[var(--urgency-critical)]"
                        : isClosingSoon
                          ? "bg-[var(--urgency-soon)]"
                          : "bg-[#65c58b]"
                  }`}
                />
                LIVE DROP
              </span>
              <p className="truncate text-xs font-bold tracking-[-0.01em] text-[var(--live-muted)] sm:text-sm">
                {antiSnipingActive
                  ? "마감 연장 · 기존 참여자 LIVE"
                  : isClosed
                  ? "경매 정산 중"
                  : isRestricted
                    ? "기존 참여자 입찰"
                    : "오늘의 빈티지 경매"}
              </p>
              {antiSnipingActive ? (
                <span className="anti-sniping-pulse inline-flex shrink-0 items-center gap-1 rounded-md border border-orange-300/60 bg-gradient-to-r from-orange-600 to-red-600 px-2 py-1 font-mono text-[9px] font-black tabular-nums tracking-tight text-white">
                  🔥 +3 MIN · {activeAntiSnipingDeadlines.length} LOT
                </span>
              ) : null}
            </div>
            <p className="mt-1.5 text-[10px] font-semibold tracking-[0.08em] text-[var(--live-muted)] sm:text-xs">
              21:00 KST CLOSE · 22:00 REOPEN
            </p>
          </div>

          <p
            aria-live="polite"
            suppressHydrationWarning
            className={`shrink-0 text-right font-mono text-lg font-bold tabular-nums tracking-tight sm:text-[1.75rem] ${urgencyClass}`}
          >
            {isClosed ? "22:00 재개" : formatCountdown(displayCountdown)}
          </p>
        </div>

        <div className="hidden gap-2 border-t border-[var(--live-border)] pt-3 sm:grid sm:grid-cols-[auto_1fr] sm:items-center sm:gap-5">
          <div className="flex items-center gap-2 font-mono text-[10px] font-semibold tabular-nums tracking-tight text-[var(--live-muted)] sm:text-xs">
            <p
              suppressHydrationWarning
              className="whitespace-nowrap"
            >
              NOW {formatKoreanTime(currentTime, true)}
            </p>
            <span aria-hidden="true" className="h-3 w-px bg-[var(--live-border)]" />
            <p suppressHydrationWarning className="truncate">
              {formatKoreanDate(currentTime)}
            </p>
          </div>
          <p className="break-keep text-[11px] font-medium leading-5 text-[var(--live-muted)] sm:text-right sm:text-xs">
            {antiSnipingActive
              ? "마감 직전 입찰로 서버 마감 시각이 3분으로 재설정되었습니다. 기존 참여자만 계속 입찰할 수 있습니다."
              : isClosed
              ? "낙찰 상품 정산 중입니다. 미판매 상품은 오후 10시부터 다시 입찰할 수 있습니다."
              : isRestricted
                ? "기존 참여자는 계속 입찰할 수 있으며, 무입찰 상품의 첫 입찰은 즉시 확정됩니다."
                : `오후 8시 56분부터 신규 참여가 제한되며 ${formatKoreanTime(deadline)}에 마감됩니다.`}
          </p>
        </div>
      </div>
    </section>
  );
}
