"use client";

import Button from "@/src/components/common/Button";
import Modal from "@/src/components/common/Modal";
import type { ShippingAddress } from "@/src/types/auction";

interface ShippingAddressSelectModalProps {
  open: boolean;
  addresses: readonly ShippingAddress[];
  selectedAddressId: string | null;
  selectedItemCount: number;
  isSubmitting?: boolean;
  onSelect: (addressId: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function ShippingAddressSelectModal({
  open,
  addresses,
  selectedAddressId,
  selectedItemCount,
  isSubmitting = false,
  onSelect,
  onConfirm,
  onClose,
}: ShippingAddressSelectModalProps) {
  return (
    <Modal
      open={open}
      title="📦 발송 받으실 배송지 선택"
      size="md"
      closeOnBackdrop={!isSubmitting}
      onClose={isSubmitting ? () => undefined : onClose}
    >
      <div className="space-y-5 p-5 sm:p-6">
        <p className="rounded-2xl bg-[#fff2e4] p-4 text-[17px] font-extrabold leading-7 text-[#76533f]">
          선택한 {selectedItemCount}벌을 받을 주소를 확인해 주세요. 접수 후에는 주소를 변경할 수 없습니다.
        </p>
        {addresses.length === 0 ? (
          <p
            role="alert"
            className="rounded-2xl border-2 border-[#efb1a5] bg-[#fff0ec] p-5 text-[17px] font-extrabold leading-7 text-[#a34c40]"
          >
            등록된 배송지가 없습니다. 기본 배송 정보에서 배송지를 먼저 추가해 주세요.
          </p>
        ) : (
          <fieldset className="space-y-3">
            <legend className="sr-only">발송 받을 배송지</legend>
            {addresses.map((address) => {
              const selected = selectedAddressId === address.id;

              return (
                <label
                  key={address.id}
                  className={`flex cursor-pointer items-start gap-4 rounded-[1.4rem] border-2 p-4 transition sm:p-5 ${
                    selected
                      ? "border-[#65a98f] bg-[#e8f6ef] ring-4 ring-[#cae7db]/70"
                      : "border-[#e5d9cb] bg-white hover:border-[#c9b8a5] hover:bg-[#fffaf3]"
                  }`}
                >
                  <input
                    type="radio"
                    name="shipping-address"
                    value={address.id}
                    checked={selected}
                    onChange={() => onSelect(address.id)}
                    className="mt-1 size-6 shrink-0 accent-[#4d947b]"
                  />
                  <span className="min-w-0 flex-1 text-[17px] leading-7 text-[#59483b]">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="text-[18px] font-black text-[#44372f]">
                        {address.label}
                      </strong>
                      {address.isDefault ? (
                        <span className="rounded-full bg-[#dceef4] px-3 py-1 text-[17px] font-black text-[#3d7180]">
                          기본 배송지
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-2 block font-extrabold">
                      {address.recipientName} · {address.phone}
                    </span>
                    <span className="mt-1 block break-keep font-semibold text-[#75675d]">
                      {address.address}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button
            variant="ghost"
            size="lg"
            disabled={isSubmitting}
            onClick={onClose}
          >
            다시 확인하기
          </Button>
          <Button
            size="lg"
            isLoading={isSubmitting}
            disabled={!selectedAddressId || addresses.length === 0}
            onClick={onConfirm}
          >
            이 주소로 발송 신청
          </Button>
        </div>
      </div>
    </Modal>
  );
}
