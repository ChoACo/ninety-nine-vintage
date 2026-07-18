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
      <div className="grid grid-cols-2 divide-x divide-[var(--info-border)] border-y border-[var(--info-border)] bg-[var(--info-surface)] py-3">
        <div>
          <p className="px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--info-text)]">현재 가격</p>
          <p className="mt-1 px-3 font-mono text-base font-black tabular-nums tracking-tight text-[var(--info-text)]">
            {formatKRW(currentPrice)}
          </p>
        </div>
        <div>
          <p className="px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--info-text)]">최소 입찰가</p>
          <p className="mt-1 px-3 font-mono text-base font-black tabular-nums tracking-tight text-[var(--info-text)]">
            {formatKRW(minimumBid)}
          </p>
        </div>
      </div>

      <div>
        <label
          htmlFor={amountId}
          className="mb-2 block text-sm font-black text-[var(--text-strong)]"
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
            className="h-14 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--input-surface)] px-4 pr-12 text-right font-mono text-xl font-black tabular-nums tracking-tight text-[var(--text-strong)] outline-none transition-all duration-200 placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15"
            autoComplete="off"
            autoFocus
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-[var(--text-muted)]">
            원
          </span>
        </div>
        {error ? (
          <p
            id={errorId}
            role="alert"
            className="mt-2 border-l-2 border-[var(--danger-text)] pl-2 text-sm font-bold text-[var(--danger-text)]"
          >
            {error}
          </p>
        ) : (
          <p className="mt-2 text-xs font-medium leading-5 text-[var(--text-muted)]">
            {minimumBid === currentPrice
              ? `첫 입찰은 시작가 ${formatKRW(minimumBid)}부터 참여할 수 있어요.`
              : `최소 ${formatKRW(minimumBid)}부터 ${formatKRW(bidIncrement)} 단위로 입찰할 수 있어요.`}
          </p>
        )}
      </div>

      <fieldset>
        <legend className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
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
                className="min-h-10 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 font-mono text-xs font-black tabular-nums tracking-tight text-[var(--text-strong)] transition-all duration-200 ease-out hover:scale-[1.02] hover:border-[var(--text-strong)] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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
          className="min-h-12 rounded-lg text-sm font-bold transition-all duration-200 ease-out hover:scale-[1.02]"
        >
          취소
        </Button>
        <Button
          type="submit"
          isLoading={isSubmitting}
          className="min-h-12 rounded-lg text-sm font-black transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-lg"
        >
          {isSubmitting
            ? "확인 중…"
            : "입찰 금액 확인"}
        </Button>
      </div>
    </form>
  );
}
