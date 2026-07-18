"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Modal } from "@/src/components/common";
import { useAuctionPolicyClock } from "@/src/hooks/useAuctionPolicyClock";
import {
  claimSecondChanceOffer,
  declineSecondChanceOffer,
  fetchMySecondChanceOffers,
  type SecondChanceOffer,
} from "@/src/lib/supabase/secondChanceOffers";
import { formatCountdown, formatKRW, getCountdown } from "@/src/utils/formatters";

export interface SecondChanceOfferGateProps {
  userId: string;
  paymentDeadlineExempt?: boolean;
  onAccepted: (productId: string) => void;
  onNotify?: (message: string) => void;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function SecondChanceOfferGate({
  userId,
  paymentDeadlineExempt = false,
  onAccepted,
  onNotify,
}: SecondChanceOfferGateProps) {
  const [offers, setOffers] = useState<SecondChanceOffer[]>([]);
  const [minimized, setMinimized] = useState(false);
  const [declineConfirmationOfferId, setDeclineConfirmationOfferId] = useState<
    string | null
  >(null);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);
  const now = useAuctionPolicyClock();

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      const nextOffers = await fetchMySecondChanceOffers();
      if (requestId !== requestIdRef.current) return;
      setOffers(nextOffers);
      setError("");
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return;
      setError(messageOf(loadError, "차순위 구매 기회를 확인하지 못했습니다."));
    }
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!active) return;
      await refresh();
    };
    void load();

    const intervalId = window.setInterval(() => void load(), 60_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", handleVisibility);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      active = false;
      requestIdRef.current += 1;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleVisibility);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh, userId]);

  useEffect(() => {
    if (error && offers.length === 0) onNotify?.(error);
  }, [error, offers.length, onNotify]);

  const offer = offers.find(
    (candidate) => Date.parse(candidate.expiresAt) > now.getTime(),
  );
  if (!offer) return null;

  const countdown = getCountdown(offer.expiresAt, now);
  const offerWindowSeconds = Math.max(
    1,
    (Date.parse(offer.expiresAt) - Date.parse(offer.offeredAt)) / 1_000,
  );

  const accept = async () => {
    setIsMutating(true);
    setError("");
    try {
      const accepted = await claimSecondChanceOffer(offer.offerId);
      setOffers((current) =>
        current.filter((candidate) => candidate.offerId !== offer.offerId),
      );
      onNotify?.(
        accepted.paymentDueAt
          ? "차순위 구매 기회를 수락했습니다. 남은 서버 기한 안에 계좌이체를 진행해 주세요."
          : "차순위 구매 기회를 수락했습니다. 결제 화면에서 공용 계좌를 확인해 주세요.",
      );
      onAccepted(accepted.productId);
    } catch (claimError) {
      setError(messageOf(claimError, "차순위 구매 기회를 수락하지 못했습니다."));
      await refresh();
    } finally {
      setIsMutating(false);
    }
  };

  const decline = async () => {
    if (declineConfirmationOfferId !== offer.offerId) {
      setDeclineConfirmationOfferId(offer.offerId);
      return;
    }

    setIsMutating(true);
    setError("");
    try {
      await declineSecondChanceOffer(offer.offerId);
      setOffers((current) =>
        current.filter((candidate) => candidate.offerId !== offer.offerId),
      );
      onNotify?.("차순위 구매 기회를 거절했습니다. 거절에는 경고가 부과되지 않습니다.");
    } catch (declineError) {
      setError(messageOf(declineError, "차순위 구매 기회를 거절하지 못했습니다."));
      await refresh();
    } finally {
      setIsMutating(false);
      setDeclineConfirmationOfferId(null);
    }
  };

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] right-3 z-[90] inline-flex min-h-12 items-center gap-2 rounded-full border border-amber-300/35 bg-zinc-950 px-4 text-xs font-black text-white shadow-[0_18px_50px_rgba(0,0,0,0.38)] transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] sm:bottom-6 sm:right-6"
      >
        <span aria-hidden="true" className="animate-soft-pulse">🎉</span>
        차순위 구매 기회
        <span className="font-mono tabular-nums text-amber-300">
          {formatCountdown(countdown)}
        </span>
      </button>
    );
  }

  return (
    <Modal
      open
      onClose={() => setMinimized(true)}
      title="🎉 차순위 구매 기회가 열렸습니다"
      description="앞선 낙찰자의 미입금으로 구매 권한을 제안드립니다. 수락 전 무응답이나 거절에는 경고가 부과되지 않습니다."
      headerPrefix="SECOND-CHANCE OFFER"
      closeShortcutLabel="ESC"
      tone="dark"
      size="md"
      className="max-sm:absolute max-sm:bottom-0 max-sm:max-h-[92dvh] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 border-amber-300/25 bg-zinc-950 sm:max-w-lg"
    >
        <div className="space-y-4 px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.04] p-3.5">
            {offer.imageUrl ? (
              // Supabase already serves the bounded 360p preview generated by
              // the product upload pipeline, so a second image proxy is wasteful.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={offer.imageUrl} alt="" className="size-20 shrink-0 rounded-lg object-cover" />
            ) : (
              <span aria-hidden="true" className="grid size-20 shrink-0 place-items-center rounded-lg bg-white/5 text-2xl">♻</span>
            )}
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm font-bold leading-5 text-zinc-100">
                {offer.productTitle}
              </p>
              <p className="mt-2 font-mono text-lg font-black tabular-nums tracking-tight text-white">
                {formatKRW(offer.offeredAmount)}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-amber-300/25 bg-amber-400/10 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-amber-200">
                {paymentDeadlineExempt
                  ? "구매 기회 수락 가능 시간"
                  : "수락·계좌이체 가능 시간"}
              </span>
              <strong className="font-mono text-xl font-black tabular-nums tracking-tight text-amber-300">
                {formatCountdown(countdown)}
              </strong>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/30">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-red-500 transition-[width] duration-1000"
                style={{
                  width: `${Math.max(0, Math.min(100, (countdown.totalSeconds / offerWindowSeconds) * 100))}%`,
                }}
              />
            </div>
          </div>

          {error ? (
            <p role="alert" className="rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm font-bold leading-5 text-red-200">
              {error}
            </p>
          ) : null}

          {declineConfirmationOfferId === offer.offerId ? (
            <p role="alert" className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-xs font-semibold leading-5 text-zinc-300">
              정말 거절하시겠습니까? 한 번 더 누르면 구매 기회가 즉시 종료됩니다. 거절에 따른 패널티는 없습니다.
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-[1fr_1.5fr]">
            <Button
              variant="ghost"
              size="lg"
              className="min-h-12 border border-white/15 bg-transparent text-zinc-300 hover:bg-white/5 hover:text-white"
              onClick={() => void decline()}
              disabled={isMutating}
            >
              {declineConfirmationOfferId === offer.offerId
                ? "거절 확정"
                : "이번 기회 거절"}
            </Button>
            <Button
              size="lg"
              className="min-h-12 bg-white text-zinc-950 hover:bg-amber-100"
              onClick={() => void accept()}
              disabled={isMutating || countdown.isExpired}
              isLoading={isMutating}
            >
              수락하고 계좌이체 진행
            </Button>
          </div>
        </div>
    </Modal>
  );
}
