"use client";

import { type FormEvent, useState } from "react";

import Modal from "@/src/components/common/Modal";
import type {
  AdminShipmentBatch,
  ShipmentRegistrationPayload,
} from "@/src/types/auction";

interface ShipmentRegistrationModalProps {
  batch: AdminShipmentBatch | null;
  onRegister: (payload: ShipmentRegistrationPayload) => void | Promise<void>;
  onClose: () => void;
}

function normalizeTrackingNumber(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

export function ShipmentRegistrationModal({
  batch,
  onRegister,
  onClose,
}: ShipmentRegistrationModalProps) {
  const [trackingNumber, setTrackingNumber] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetAndClose = () => {
    setTrackingNumber("");
    setErrorMessage("");
    onClose();
  };

  const handleClose = () => {
    if (isSubmitting) return;
    resetAndClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!batch || isSubmitting) return;

    const normalized = normalizeTrackingNumber(trackingNumber);
    if (normalized.length < 10 || normalized.length > 14) {
      setErrorMessage("한진택배 송장번호 숫자 10~14자리를 확인해 주세요.");
      return;
    }

    setErrorMessage("");
    setIsSubmitting(true);
    try {
      // TODO: DB 연동 필요 - 이 콜백을 송장 등록 API와 구매자 배송 상태 구독에 연결합니다.
      await onRegister({
        batchId: batch.id,
        trackingNumber: normalized,
        courier: "한진택배",
        shippedAt: new Date().toISOString(),
      });
      resetAndClose();
      return;
    } catch {
      setErrorMessage("송장을 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={Boolean(batch)}
      title="🚚 택배 발송 처리 및 송장 등록"
      description="최종 배송지를 다시 확인한 뒤 한진택배 송장번호를 등록해 주세요."
      size="md"
      closeOnBackdrop={!isSubmitting}
      showCloseButton={!isSubmitting}
      onClose={isSubmitting ? () => undefined : handleClose}
    >
      {batch ? (
        <form onSubmit={handleSubmit} className="space-y-5 p-5 sm:p-6">
          <section
            aria-labelledby="shipping-destination-title"
            className="rounded-[1.4rem] border-2 border-[#c6dce4] bg-[#edf7fa] p-5 text-[17px] leading-8"
          >
            <h3
              id="shipping-destination-title"
              className="text-xl font-black text-[#3b6371]"
            >
              ① 최종 배송지 정보
            </h3>
            <dl className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[#4f5f65]">
              <dt className="font-black">받는 분</dt>
              <dd className="font-extrabold">
                {batch.shippingAddress.recipientName}
              </dd>
              <dt className="font-black">연락처</dt>
              <dd className="font-extrabold">{batch.shippingAddress.phone}</dd>
              <dt className="font-black">배송 주소</dt>
              <dd className="break-keep font-extrabold">
                {batch.shippingAddress.address}
              </dd>
            </dl>
          </section>

          <label className="block text-[17px] font-black text-[#4e4037]">
            ② 한진택배 송장번호
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={trackingNumber}
              disabled={isSubmitting}
              onChange={(event) => {
                setTrackingNumber(event.target.value);
                if (errorMessage) setErrorMessage("");
              }}
              placeholder="숫자만 입력해 주세요"
              className="mt-2 min-h-16 w-full rounded-2xl border-2 border-[#d8c6b3] bg-white px-5 py-3 font-mono text-2xl font-black tracking-wide text-[#3f352e] outline-none transition placeholder:font-sans placeholder:text-[17px] placeholder:font-bold placeholder:tracking-normal placeholder:text-[#a99a8d] focus:border-[#dd806c] focus:ring-4 focus:ring-[#f3c7bd]/60 disabled:opacity-60"
            />
          </label>

          {errorMessage ? (
            <p
              role="alert"
              className="rounded-2xl border-2 border-[#efb1a4] bg-[#fff0ec] px-4 py-3 text-[17px] font-black leading-7 text-[#a2493d]"
            >
              {errorMessage}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleClose}
              className="min-h-14 rounded-2xl border-2 border-[#d7c6b5] bg-white px-5 py-3 text-[17px] font-black text-[#6b5849] transition hover:bg-[#fff5e9] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#ead9c8] disabled:opacity-50"
            >
              닫기
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !trackingNumber.trim()}
              className="min-h-14 rounded-2xl bg-[#df7864] px-5 py-3 text-[18px] font-black text-white shadow-[0_10px_24px_rgba(188,88,70,0.22)] transition hover:bg-[#cb6653] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#efb6aa] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "등록 중…" : "송장 등록하기"}
            </button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
