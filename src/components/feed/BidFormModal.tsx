"use client";

import Modal from "@/src/components/common/Modal";
import BidForm from "./BidForm";

export interface BidFormModalProps {
  open: boolean;
  title: string;
  currentPrice: number;
  bidIncrement: number;
  minimumBid?: number;
  onClose: () => void;
  onSubmit: (amount: number) => void | Promise<void>;
}

export default function BidFormModal({
  open,
  title,
  currentPrice,
  bidIncrement,
  minimumBid,
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
    >
      {open ? (
        <BidForm
          key={`${currentPrice}-${bidIncrement}-${minimumBid ?? "default"}`}
          currentPrice={currentPrice}
          bidIncrement={bidIncrement}
          minimumBid={minimumBid}
          onCancel={onClose}
          onSubmit={onSubmit}
        />
      ) : null}
    </Modal>
  );
}
