"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import Button from "@/src/components/common/Button";
import { formatKRW } from "@/src/utils/formatters";

export interface BidFormProps {
  currentPrice: number;
  bidIncrement: number;
  minimumBid?: number;
  onCancel: () => void;
  onSubmit: (amount: number) => void | Promise<void>;
}

export default function BidForm({
  currentPrice,
  bidIncrement,
  minimumBid: minimumBidOverride,
  onCancel,
  onSubmit,
}: BidFormProps) {
  const minimumBid = minimumBidOverride ?? currentPrice + bidIncrement;
  const [amount, setAmount] = useState(String(minimumBid));
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const amountId = useId();
  const errorId = useId();
  const parsedAmount = useMemo(() => Number(amount), [amount]);

  const selectQuickBid = (multiplier: number) => {
    setAmount(String(currentPrice + bidIncrement * multiplier));
    setError("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!amount.trim() || !Number.isFinite(parsedAmount)) {
      setError("입찰할 금액을 입력해 주세요.");
      return;
    }
    if (!Number.isInteger(parsedAmount)) {
      setError("원 단위의 정수 금액을 입력해 주세요.");
      return;
    }
    if (parsedAmount < minimumBid) {
      setError(`최소 ${formatKRW(minimumBid)} 이상을 입력해 주세요.`);
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      // 검증한 금액만 상위 확인 모달로 전달합니다. 실제 입찰 저장은
      // 사용자가 확인 모달에서 ‘예’를 선택한 뒤에만 실행됩니다.
      await onSubmit(parsedAmount);
    } catch {
      setError("입찰을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 p-5 sm:p-6">
      <div className="grid grid-cols-2 gap-3 rounded-2xl bg-[#eef7f8] p-4">
        <div>
          <p className="text-sm font-bold text-[#5b7980]">현재 가격</p>
          <p className="mt-1 text-lg font-black text-[#274f59]">
            {formatKRW(currentPrice)}
          </p>
        </div>
        <div className="border-l border-[#cfe2e6] pl-3">
          <p className="text-sm font-bold text-[#5b7980]">최소 입찰가</p>
          <p className="mt-1 text-lg font-black text-[#274f59]">
            {formatKRW(minimumBid)}
          </p>
        </div>
      </div>

      <div>
        <label
          htmlFor={amountId}
          className="mb-2 block text-base font-black text-[#40352f]"
        >
          희망 경매 가격
        </label>
        <div className="relative">
          <input
            id={amountId}
            type="number"
            inputMode="numeric"
            min={minimumBid}
            step={bidIncrement}
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setError("");
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className="h-16 w-full rounded-2xl border-2 border-[#decdbf] bg-white px-4 pr-14 text-right text-2xl font-black tabular-nums text-[#332a25] outline-none transition placeholder:text-[#b5a69c] focus:border-[#ec7866] focus:ring-4 focus:ring-[#ec7866]/10"
            autoComplete="off"
            autoFocus
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-base font-black text-[#6d5d53]">
            원
          </span>
        </div>
        {error ? (
          <p
            id={errorId}
            role="alert"
            className="mt-2 text-base font-bold text-[#a73f34]"
          >
            {error}
          </p>
        ) : (
          <p className="mt-2 text-sm font-semibold leading-6 text-[#75655b]">
            {minimumBid === currentPrice
              ? `첫 입찰은 시작가 ${formatKRW(minimumBid)}부터 참여할 수 있어요.`
              : `최소 ${formatKRW(minimumBid)}부터 ${formatKRW(bidIncrement)} 단위로 입찰할 수 있어요.`}
          </p>
        )}
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-black text-[#6c5c52]">
          빠른 금액 선택
        </legend>
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 5].map((multiplier) => {
            const quickAmount = currentPrice + bidIncrement * multiplier;
            return (
              <button
                key={multiplier}
                type="button"
                onClick={() => selectQuickBid(multiplier)}
                className="min-h-12 rounded-xl border border-[#ead9cb] bg-[#fff8f0] px-2 text-sm font-black text-[#735245] transition hover:border-[#ecab97] hover:bg-[#ffecdf] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec7866]"
              >
                +{formatKRW(bidIncrement * multiplier)}
                <span className="sr-only">를 더한 {formatKRW(quickAmount)}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={isSubmitting}
          className="min-h-14 text-lg font-black"
        >
          취소
        </Button>
        <Button
          type="submit"
          isLoading={isSubmitting}
          className="min-h-14 text-lg font-black"
        >
          {isSubmitting
            ? "확인 중…"
            : "입찰 금액 확인"}
        </Button>
      </div>
    </form>
  );
}
