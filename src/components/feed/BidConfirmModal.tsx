"use client";

import { useRef, useState } from "react";
import Button from "@/src/components/common/Button";
import Modal from "@/src/components/common/Modal";
import { formatKRW } from "@/src/utils/formatters";

export interface BidConfirmModalProps {
  open: boolean;
  currentPrice: number;
  latestCurrentPrice?: number;
  amount: number;
  itemTitle: string;
  isFinalBid?: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

export default function BidConfirmModal({
  open,
  currentPrice,
  latestCurrentPrice,
  amount,
  itemTitle,
  isFinalBid = false,
  onClose,
  onConfirm,
}: BidConfirmModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);
  const hasCurrentPriceChanged =
    latestCurrentPrice !== undefined && latestCurrentPrice !== currentPrice;

  const handleClose = () => {
    setError("");
    onClose();
  };

  const handleConfirm = async () => {
    if (submittingRef.current || hasCurrentPriceChanged) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setError("");

    try {
      await onConfirm();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error && caughtError.message
          ? caughtError.message
          : "입찰을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={isSubmitting ? () => undefined : handleClose}
      title="입찰 전 마지막 확인"
      description={
        isFinalBid
          ? "오후 8시 56분 이후 무입찰 상품의 첫 입찰은 즉시 확정됩니다."
          : "현재가와 나의 입찰가를 비교한 뒤 최종 확정해 주세요."
      }
      size="sm"
      showCloseButton={false}
      closeOnBackdrop={false}
      className="max-sm:absolute max-sm:bottom-0 max-sm:max-h-[92dvh] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0"
    >
      <div className="p-5 sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex min-h-7 items-center border border-[var(--border-strong)] bg-[var(--surface-muted)] px-2.5 font-mono text-[10px] font-black uppercase tabular-nums tracking-[0.12em] text-[var(--text-muted)]">
            Step 2 / 2
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[var(--text-muted)]">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-4 w-4">
              <path d="M12 3 5 6v5c0 4.65 2.87 8.4 7 10 4.13-1.6 7-5.35 7-10V6l-7-3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            최종 확인
          </span>
        </div>

        <p className="mt-4 line-clamp-2 break-keep text-sm font-bold leading-6 text-[var(--text-strong)]">
          {itemTitle}
        </p>

        <div
          className="mt-4 grid grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)] items-stretch border-y border-[var(--border-strong)] bg-[var(--surface-muted)]"
          aria-label={`현재가 ${formatKRW(currentPrice)}에서 나의 입찰가 ${formatKRW(amount)}로 입찰`}
        >
          <div className="min-w-0 px-3 py-4 sm:px-4">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">
              현재가
            </p>
            <p className="mt-1 truncate font-mono text-base font-black tabular-nums tracking-tight text-[var(--text-muted)] sm:text-lg">
              {formatKRW(currentPrice)}
            </p>
          </div>
          <div className="grid place-items-center border-x border-[var(--border)] text-[var(--accent-text)]" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
              <path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="min-w-0 bg-[var(--info-surface)] px-3 py-4 sm:px-4">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--accent-text)]">
              나의 입찰가
            </p>
            <p className="mt-1 truncate font-mono text-base font-black tabular-nums tracking-tight text-[var(--accent-text)] sm:text-lg">
              {formatKRW(amount)}
            </p>
          </div>
        </div>

        {hasCurrentPriceChanged ? (
          <p
            role="alert"
            className="mt-4 border-l-2 border-[var(--danger-text)] bg-[var(--danger-surface)] px-3 py-3 text-sm font-bold leading-6 text-[var(--danger-text)]"
          >
            실시간 현재가가
            <strong className="mx-1 font-mono tabular-nums tracking-tight">
              {formatKRW(latestCurrentPrice)}
            </strong>
            으로 변경되었습니다. 닫고 입찰가를 다시 확인해 주세요.
          </p>
        ) : null}

        <p className="mt-5 break-keep text-center text-lg font-black leading-7 tracking-[-0.025em] text-[var(--text-strong)] sm:text-xl">
          이 금액에 입찰하시겠습니까?
        </p>

        <div className="mt-5 border-l-2 border-[var(--warning-text)] bg-[var(--warning-surface)] px-4 py-3 text-sm font-bold leading-6 text-[var(--warning-text)]">
          {isFinalBid
            ? "이 입찰은 즉시 낙찰 확정되며 추가 입찰·취소가 불가능합니다."
            : "입찰 후 취소 불가 (미입금 시 누적 경고 부여)"}
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-4 border-l-2 border-[var(--danger-text)] bg-[var(--danger-surface)] px-3 py-2 text-sm font-bold text-[var(--danger-text)]"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button
            variant="ghost"
            size="lg"
            onClick={handleClose}
            disabled={isSubmitting}
            className="min-h-12 rounded-lg text-sm font-bold transition-all duration-200 ease-out hover:scale-[1.02]"
          >
            금액 다시 확인
          </Button>
          <Button
            size="lg"
            onClick={handleConfirm}
            isLoading={isSubmitting}
            disabled={isSubmitting || hasCurrentPriceChanged}
            className="min-h-12 rounded-lg text-sm font-black transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-lg"
          >
            {hasCurrentPriceChanged ? "현재가 변경됨" : "이 금액으로 입찰"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
