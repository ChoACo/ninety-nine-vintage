"use client";

import Modal from "@/src/components/common/Modal";
import BidForm from "./BidForm";
import { SizeComparisonPanel } from "./SizeComparisonScanner";

export interface BidFormModalProps {
  open: boolean;
  title: string;
  currentPrice: number;
  bidIncrement: number;
  minimumBid?: number;
  productDescription: string;
  productSize?: string;
  userId?: string | null;
  onClose: () => void;
  onSubmit: (amount: number) => void | Promise<void>;
}

export default function BidFormModal({
  open,
  title,
  currentPrice,
  bidIncrement,
  minimumBid,
  productDescription,
  productSize,
  userId,
  onClose,
  onSubmit,
}: BidFormModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="경매 참여하기"
      description={`‘${title}’의 희망 입찰가를 입력해 주세요.`}
      size="sm"
      className="max-sm:absolute max-sm:bottom-0 max-sm:max-h-[92dvh] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0"
    >
      {open ? (
        <div>
          <details className="mx-5 mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] sm:mx-6 sm:mt-6">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-xs font-black text-[var(--text-strong)] marker:content-none">
              <span>📏 입찰 전 내 옷과 실측 비교</span>
              <span aria-hidden="true" className="text-[var(--text-muted)]">＋</span>
            </summary>
            <div className="border-t border-[var(--border)] p-4">
              <SizeComparisonPanel
                productDescription={productDescription}
                productSize={productSize}
                userId={userId}
                compact
              />
            </div>
          </details>
          <BidForm
            key={`${currentPrice}-${bidIncrement}-${minimumBid ?? "default"}`}
            currentPrice={currentPrice}
            bidIncrement={bidIncrement}
            minimumBid={minimumBid}
            onCancel={onClose}
            onSubmit={onSubmit}
          />
        </div>
      ) : null}
    </Modal>
  );
}
