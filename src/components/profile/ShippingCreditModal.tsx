"use client";

import { useState } from "react";

import Button from "@/src/components/common/Button";
import Modal from "@/src/components/common/Modal";
import type {
  PaymentAccount,
  ShippingCreditCompletionPayload,
} from "@/src/types/auction";
import { formatKRW } from "@/src/utils/formatters";
import { SHIPPING_FEE } from "@/src/utils/shipping";

interface ShippingCreditModalProps {
  open: boolean;
  account: PaymentAccount;
  onClose: () => void;
  onComplete: (
    payload: ShippingCreditCompletionPayload,
  ) => void | Promise<void>;
}

export function ShippingCreditModal({
  open,
  account,
  onClose,
  onComplete,
}: ShippingCreditModalProps) {
  const [isCompleting, setIsCompleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // 보안 원칙: 사용자가 직접 충전 버튼을 눌렀을 때만 계좌 DOM을 만듭니다.
  // TODO: DB 연동 필요 — 실제 운영 계좌는 충전 버튼 클릭 후 인증 API로 조회합니다.
  if (!open) return null;

  const handleComplete = async () => {
    setIsCompleting(true);
    setErrorMessage("");

    try {
      // TODO: DB 연동 필요 — 실제 입금 확인 webhook/API 승인 후 이용권을 지급하세요.
      await onComplete({
        amount: SHIPPING_FEE,
        completedAt: new Date().toISOString(),
      });
    } catch {
      setErrorMessage("택배비 입금 완료 처리에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="택배 가능 횟수 충전"
      description="택배비 4,000원만 선결제하여 이용권 1회를 추가합니다."
      size="sm"
      onClose={onClose}
    >
      <div className="space-y-5 p-5 text-[17px] text-[#493f38] sm:p-6">
        <div className="rounded-[1.5rem] border-2 border-[#a9d6c7] bg-[#e7f5ef] p-5 text-center">
          <p className="font-extrabold text-[#467463]">입금할 택배비</p>
          <strong className="mt-1 block text-4xl font-black text-[#34735e]">
            {formatKRW(SHIPPING_FEE)}
          </strong>
          <p className="mt-2 font-bold text-[#537d6e]">입금 완료 후 +1회 충전</p>
        </div>

        <div className="rounded-[1.5rem] border-2 border-[#b9d4df] bg-[#edf7fa] p-5">
          <p className="font-black text-[#345766]">{account.bankName}</p>
          <p className="mt-1 break-all font-mono text-2xl font-black tracking-wide text-[#263f4a]">
            {account.accountNumber}
          </p>
          <p className="mt-2 font-bold text-[#587482]">예금주 {account.accountHolder}</p>
        </div>

        {errorMessage ? (
          <p role="alert" className="font-bold text-[#b64f48]">
            {errorMessage}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Button variant="ghost" size="lg" onClick={onClose} disabled={isCompleting}>
            취소
          </Button>
          <Button size="lg" onClick={handleComplete} isLoading={isCompleting}>
            입금 완료
          </Button>
        </div>
      </div>
    </Modal>
  );
}
