"use client";

import { useState, type FormEvent } from "react";
import Button from "@/src/components/common/Button";
import Modal from "@/src/components/common/Modal";

export interface ProductInquiryModalProps {
  open: boolean;
  productLabel: string;
  onClose: () => void;
  onSubmit: (message: string) => void | Promise<void>;
}

export default function ProductInquiryModal({
  open,
  productLabel,
  onClose,
  onSubmit,
}: ProductInquiryModalProps) {
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");

  const closeModal = () => {
    if (isSending) return;
    setMessage("");
    setError("");
    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      setError("문의 내용을 입력해 주세요.");
      return;
    }

    try {
      setIsSending(true);
      setError("");
      await onSubmit(trimmedMessage);
      setMessage("");
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "문의 전송에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={closeModal}
      title="상품 문의하기"
      description={`‘${productLabel}’의 담당 운영자에게 비공개 문의를 남겨 주세요.`}
      size="sm"
      closeOnBackdrop={!isSending}
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-5 sm:p-6">
        <div>
          <label
            htmlFor="product-inquiry-message"
            className="text-[17px] font-black text-[#443830]"
          >
            문의 내용
          </label>
          <textarea
            id="product-inquiry-message"
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              if (error) setError("");
            }}
            rows={5}
            maxLength={500}
            autoFocus
            placeholder="사이즈, 옷 상태, 배송 등에 대해 적어 주세요."
            className="mt-2 min-h-36 w-full resize-y rounded-2xl border-2 border-[#dfcdbf] bg-white px-4 py-3 text-[17px] font-semibold leading-7 text-[#3e342e] outline-none transition placeholder:text-[#a18e81] focus:border-[#ec7866] focus:ring-4 focus:ring-[#ec7866]/15"
          />
          <div className="mt-1.5 flex items-start justify-between gap-3">
            <p className="min-h-6 text-sm font-bold text-[#a24439]" role="alert">
              {error}
            </p>
            <span className="shrink-0 text-sm font-bold text-[#87766b]">
              {message.length}/500
            </span>
          </div>
        </div>

        <p className="rounded-2xl bg-[#edf7f9] px-4 py-3 text-[15px] font-bold leading-6 text-[#4c7079]">
          문의는 담당 운영자에게만 전달되며, 답변은 상담 페이지의 상품 대화에서 확인할 수 있습니다.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Button
            type="button"
            fullWidth
            size="lg"
            variant="ghost"
            disabled={isSending}
            onClick={closeModal}
            className="min-h-14 text-[17px] font-black"
          >
            취소
          </Button>
          <Button
            type="submit"
            fullWidth
            size="lg"
            isLoading={isSending}
            className="min-h-14 text-[17px] font-black"
          >
            보내기
          </Button>
        </div>
      </form>
    </Modal>
  );
}
