"use client";

import { useMemo, useState } from "react";

import Button from "@/src/components/common/Button";
import Modal from "@/src/components/common/Modal";
import type {
  BatchPaymentCompletionPayload,
  PaymentAccount,
  WonAuction,
} from "@/src/types/auction";
import { formatKRW } from "@/src/utils/formatters";
import { SHIPPING_FEE } from "@/src/utils/shipping";

export interface PaymentModalProps {
  open: boolean;
  auctions: readonly WonAuction[];
  account: PaymentAccount;
  includeShippingFee: boolean;
  onIncludeShippingFeeChange: (checked: boolean) => void;
  onClose: () => void;
  onComplete: (
    payload: BatchPaymentCompletionPayload,
  ) => void | Promise<void>;
}

function summarizeAuctionNames(auctions: readonly WonAuction[]): string {
  if (auctions.length === 0) return "";
  if (auctions.length === 1) return auctions[0].title;
  return `${auctions[0].title} 외 ${auctions.length - 1}개`;
}

export function PaymentModal({
  open,
  auctions,
  account,
  includeShippingFee,
  onIncludeShippingFeeChange,
  onClose,
  onComplete,
}: PaymentModalProps) {
  const [isCompleting, setIsCompleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const payableAuctions = useMemo(
    () =>
      auctions.filter(
        (auction) =>
          auction.stage === "payment-pending" &&
          auction.paymentStatus === "pending",
      ),
    [auctions],
  );
  const productAmount = useMemo(
    () =>
      payableAuctions.reduce(
        (total, auction) => total + auction.winningBid,
        0,
      ),
    [payableAuctions],
  );

  // 계좌 정보가 닫힌 화면의 DOM에 남지 않도록 모달이 열렸을 때만 렌더링합니다.
  // TODO: DB 연동 필요 — 실제 운영에서는 account를 번들에 포함하지 말고,
  // 인증된 사용자가 일괄 결제를 누른 뒤 일회성 계좌 조회 API로 받아오세요.
  if (!open || payableAuctions.length === 0) return null;

  const shippingFee = includeShippingFee ? SHIPPING_FEE : 0;
  const totalAmount = productAmount + shippingFee;
  const summary = summarizeAuctionNames(payableAuctions);

  const handleComplete = async () => {
    setIsCompleting(true);
    setErrorMessage("");

    try {
      const completedAt = new Date().toISOString();

      // TODO: DB 연동 필요 — 모든 상품의 입금 확인을 서버 트랜잭션 한 건으로
      // 승인한 경우에만 결제 완료와 Keep 이동을 함께 처리하세요.
      await onComplete({
        auctionIds: payableAuctions.map((auction) => auction.id),
        includeShippingFee,
        productAmount,
        shippingFee,
        totalAmount,
        completedAt,
      });
    } catch {
      setErrorMessage("입금 완료 처리에 실패했습니다. 잠시 후 다시 확인해 주세요.");
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="결제 및 계좌 안내"
      description="입금 대기 상품 전체를 한 번에 결제합니다."
      size="sm"
      onClose={onClose}
    >
      <div className="space-y-4 p-5 text-[17px] text-[#4b4038] sm:p-6">
        <div className="rounded-2xl border border-[#eadfce] bg-[#fffaf3] p-4">
          <div className="flex items-center justify-between gap-4">
            <span className="font-extrabold text-[#76685e]">결제 상품</span>
            <strong className="rounded-full bg-white px-3 py-1 font-black text-[#b86252]">
              {payableAuctions.length}개
            </strong>
          </div>
          <p className="mt-2 line-clamp-2 font-extrabold leading-7 text-[#493b31]">
            {summary}
          </p>
          <div className="mt-3 flex items-center justify-between gap-4 border-t border-[#eadfce] pt-3">
            <span className="font-bold text-[#76685e]">상품 낙찰 총액</span>
            <strong className="text-xl font-black text-[#cb6e5b]">
              {formatKRW(productAmount)}
            </strong>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-[#a9d6c7] bg-[#e7f5ef] p-4 font-extrabold leading-7 text-[#315f51]">
          <input
            type="checkbox"
            checked={includeShippingFee}
            onChange={(event) => onIncludeShippingFeeChange(event.target.checked)}
            className="mt-1 size-6 shrink-0 accent-[#4f9a81]"
          />
          <span>
            ☑️ 택배비 {formatKRW(SHIPPING_FEE)} 함께 결제
            <span className="mt-1 block text-[17px] font-bold text-[#4e796b]">
              입금 완료 시 택배 가능 횟수 1회 추가
            </span>
          </span>
        </label>

        <div className="rounded-[1.5rem] border-2 border-[#b9d4df] bg-[#edf7fa] p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <p className="font-extrabold text-[#466879]">입금할 총 금액</p>
            <p className="text-3xl font-black tracking-tight text-[#be6354]">
              {formatKRW(totalAmount)}
            </p>
          </div>
          <div className="my-4 h-px bg-[#c7dde5]" />
          <p className="font-black text-[#345766]">{account.bankName}</p>
          <p className="mt-1 break-all font-mono text-2xl font-black tracking-wide text-[#263f4a]">
            {account.accountNumber}
          </p>
          <p className="mt-2 font-bold text-[#587482]">
            예금주 {account.accountHolder}
          </p>
        </div>

        <p className="rounded-2xl bg-[#fff0eb] px-4 py-3 font-extrabold leading-7 text-[#a64e42]">
          입금자명은 내 정보에 저장한 이름과 같게 입력해 주세요.
        </p>

        {errorMessage ? (
          <p role="alert" className="font-bold text-[#b64f48]">
            {errorMessage}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Button variant="ghost" size="lg" onClick={onClose} disabled={isCompleting}>
            나중에 하기
          </Button>
          <Button size="lg" onClick={handleComplete} isLoading={isCompleting}>
            입금 완료
          </Button>
        </div>

        <p className="text-[17px] font-semibold leading-7 text-[#7b6d63]">
          데모에서는 ‘입금 완료’를 누르면 전체 상품이 즉시 완료됩니다. 실제 운영에서는
          관리자 입금 확인 API가 승인한 뒤 보관함으로 함께 이동해야 합니다.
        </p>
      </div>
    </Modal>
  );
}
