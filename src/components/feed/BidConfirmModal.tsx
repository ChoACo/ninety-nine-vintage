"use client";

import { useRef, useState } from "react";
import Button from "@/src/components/common/Button";
import Modal from "@/src/components/common/Modal";
import { formatKRW } from "@/src/utils/formatters";

export interface BidConfirmModalProps {
  open: boolean;
  amount: number;
  itemTitle: string;
  isFinalBid?: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

export default function BidConfirmModal({
  open,
  amount,
  itemTitle,
  isFinalBid = false,
  onClose,
  onConfirm,
}: BidConfirmModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);

  const handleClose = () => {
    setError("");
    onClose();
  };

  const handleConfirm = async () => {
    if (submittingRef.current) return;
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
          : "금액을 다시 한번 확인해 주세요. ‘예’를 눌러야 입찰이 완료됩니다."
      }
      size="sm"
      showCloseButton={false}
      closeOnBackdrop={false}
      className="max-sm:absolute max-sm:bottom-0 max-sm:max-h-[92dvh] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0"
    >
      <div className="p-5 sm:p-7">
        <p className="line-clamp-2 break-keep text-center text-sm font-semibold leading-6 text-[var(--text-muted)]">
          {itemTitle}
        </p>
        <p className="mt-4 break-keep text-center text-xl font-black leading-tight tracking-[-0.03em] text-[var(--text-strong)] sm:text-2xl">
          <strong className="font-mono text-[1.75rem] tabular-nums tracking-tight text-[var(--accent-text)] sm:text-[2rem]">{formatKRW(amount)}</strong>
          <br />
          <span className="mt-2 inline-block">입찰을 진행하시겠습니까?</span>
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
            아니오
          </Button>
          <Button
            size="lg"
            onClick={handleConfirm}
            isLoading={isSubmitting}
            className="min-h-12 rounded-lg text-sm font-black transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-lg"
          >
            예
          </Button>
        </div>
      </div>
    </Modal>
  );
}
