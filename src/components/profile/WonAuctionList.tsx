"use client";

/* eslint-disable @next/next/no-img-element -- 낙찰 썸네일은 추후 외부 DB 이미지 URL도 표시합니다. */
import { useMemo } from "react";

import { usePaymentDeadlineCountdown } from "@/src/hooks/usePaymentDeadlineCountdown";
import type { WonAuction } from "@/src/types/auction";
import { formatKoreanDate, formatKRW } from "@/src/utils/formatters";

export interface WonAuctionListProps {
  auctions: readonly WonAuction[];
  onStartBatchPayment: (auctions: readonly WonAuction[]) => void;
  onViewAccount: (auctions: readonly WonAuction[]) => void;
}

function formatTimer(
  countdown: ReturnType<typeof usePaymentDeadlineCountdown>["countdown"],
): string {
  const totalHours = countdown.days * 24 + countdown.hours;
  return [totalHours, countdown.minutes, countdown.seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function formatDeadline(deadline: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(deadline);
}

export function WonAuctionList({
  auctions,
  onStartBatchPayment,
  onViewAccount,
}: WonAuctionListProps) {
  const pendingAuctions = useMemo(
    () =>
      auctions.filter(
        (auction) =>
          auction.stage === "payment-pending" &&
          auction.paymentStatus === "pending",
      ),
    [auctions],
  );
  const hasStartedPayment = pendingAuctions.some(
    (auction) => Boolean(auction.paymentStartedAt),
  );
  const { deadline, countdown, isClockReady } =
    usePaymentDeadlineCountdown(pendingAuctions);

  return (
    <section aria-labelledby="won-auction-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 font-bold tracking-[0.16em] text-[#68859a]">
            PAYMENT WAITING
          </p>
          <h2
            id="won-auction-title"
            className="text-2xl font-extrabold text-[#493b31] sm:text-3xl"
          >
            낙찰 상품 · 입금 대기
          </h2>
        </div>
        <span className="rounded-full bg-[#dcebf2] px-4 py-2 text-[17px] font-black text-[#55758a]">
          {pendingAuctions.length}건
        </span>
      </div>

      {pendingAuctions.length === 0 ? (
        <div className="rounded-[2rem] border border-dashed border-[#d9cbbb] bg-[#fffaf3] px-6 py-12 text-center">
          <p aria-hidden="true" className="mb-3 text-4xl">
            ✓
          </p>
          <p className="text-[17px] font-extrabold text-[#59483b]">
            현재 입금 대기 중인 상품이 없습니다.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-[1.5rem] border-2 border-[#edb4a8] bg-[#fff0eb] p-4 sm:flex sm:items-center sm:justify-between sm:gap-5 sm:px-5">
            <div>
              <p className="text-[17px] font-extrabold text-[#9f4f43]">
                입금 마감까지 남은 시간
              </p>
              {deadline ? (
                <p className="mt-1 text-[17px] font-bold text-[#876259]">
                  {formatDeadline(deadline)} 마감
                </p>
              ) : null}
            </div>
            <p
              role="timer"
              aria-live="off"
              className="mt-2 tabular-nums text-3xl font-black tracking-tight text-[#c65649] sm:mt-0 sm:text-4xl"
            >
              {!isClockReady
                ? "--:--:--"
                : countdown.isExpired
                  ? "입금 마감"
                  : formatTimer(countdown)}
            </p>
          </div>

          <p
            role="alert"
            className="rounded-2xl border border-[#efc4a7] bg-[#fff7df] px-4 py-3 text-[17px] font-black leading-7 text-[#9b522e]"
          >
            ⚠️ 마감 내 미입금 시 자동 취소 및 누적 경고가 부여됩니다
          </p>

          <ul
            className="grid gap-4 lg:grid-cols-2"
            aria-label="입금 대기 상품 목록"
          >
            {pendingAuctions.map((auction) => (
              <li
                key={auction.id}
                className="group overflow-hidden rounded-[1.75rem] border border-[#e8dccd] bg-white shadow-[0_14px_36px_rgba(111,83,54,0.07)]"
              >
                <article className="flex min-h-40">
                  <div className="relative w-28 shrink-0 overflow-hidden bg-[#efe7dc] sm:w-36">
                    <img
                      src={auction.thumbnailUrl}
                      alt={`${auction.title} 상품 사진`}
                      loading="lazy"
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    />
                    <span className="absolute left-2 top-2 rounded-full bg-white/95 px-3 py-1.5 text-[17px] font-extrabold text-[#c46f5c] shadow-sm">
                      낙찰
                    </span>
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col justify-center p-4 sm:p-5">
                    <p className="text-[17px] font-bold text-[#8d8075]">
                      {formatKoreanDate(auction.closedAt)} 마감
                    </p>
                    <h3 className="mt-1 line-clamp-2 text-[18px] font-extrabold leading-7 text-[#493b31]">
                      {auction.title}
                    </h3>
                    <p className="mt-2 text-xl font-black text-[#d27560]">
                      {formatKRW(auction.winningBid)}
                    </p>
                    {auction.paymentStartedAt ? (
                      <p className="mt-2 inline-flex w-fit rounded-full bg-[#fff0d9] px-3 py-1 text-[17px] font-extrabold text-[#996624]">
                        입금 절차 시작됨
                      </p>
                    ) : null}
                  </div>
                </article>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() =>
              hasStartedPayment
                ? onViewAccount(pendingAuctions)
                : onStartBatchPayment(pendingAuctions)
            }
            className="min-h-16 w-full rounded-[1.25rem] bg-[#d97865] px-5 py-4 text-[18px] font-black text-white shadow-[0_12px_28px_rgba(196,100,80,0.24)] transition hover:-translate-y-0.5 hover:bg-[#cc6b58] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f4c9bd] disabled:cursor-not-allowed disabled:bg-[#b9aea7] disabled:shadow-none"
            disabled={isClockReady && countdown.isExpired}
          >
            {isClockReady && countdown.isExpired
              ? "입금 마감"
              : hasStartedPayment
                ? "🔎 계좌번호 보기"
                : "☑️ 전체 상품 일괄 결제 진행하기"}
          </button>
        </>
      )}
    </section>
  );
}
