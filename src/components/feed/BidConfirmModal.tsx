"use client";

import { useRef, useState } from "react";
import Button from "@/src/components/common/Button";
import Modal from "@/src/components/common/Modal";
import { formatKRW } from "@/src/utils/formatters";

export interface BidConfirmModalProps {
  open: boolean;
  amount: number;
  itemTitle: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

export default function BidConfirmModal({
  open,
  amount,
  itemTitle,
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
      description="금액을 다시 한번 확인해 주세요. ‘예’를 눌러야 입찰이 완료됩니다."
      size="sm"
      showCloseButton={false}
      closeOnBackdrop={false}
    >
      <div className="p-5 sm:p-7">
        <p className="break-keep text-center text-base font-bold leading-7 text-[#6d5c52]">
          {itemTitle}
        </p>
        <p className="mt-4 break-keep text-center text-2xl font-black leading-tight text-[#382f2a] sm:text-3xl">
          <strong className="text-[#b34537]">{formatKRW(amount)}</strong>
          <br />
          입찰을 진행하시겠습니까?
        </p>

        <div className="mt-5 rounded-2xl border-2 border-[#efab92] bg-[#fff0e6] px-4 py-3 text-center text-[17px] font-black leading-7 text-[#9b3f34]">
          ⚠️ 입찰 후 취소 불가 (미입금 시 누적 경고 부여)
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-[#fff0ef] px-3 py-2 text-center text-base font-bold text-[#a33f38]"
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
            className="min-h-16 text-xl font-black"
          >
            아니오
          </Button>
          <Button
            size="lg"
            onClick={handleConfirm}
            isLoading={isSubmitting}
            className="min-h-16 text-xl font-black"
          >
            예
          </Button>
        </div>
      </div>
    </Modal>
  );
}
