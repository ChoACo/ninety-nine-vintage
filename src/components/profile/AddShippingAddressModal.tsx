"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import Button from "@/src/components/common/Button";
import Modal from "@/src/components/common/Modal";

export interface NewShippingAddress {
  label: string;
  recipientName: string;
  phone: string;
  address: string;
}

interface AddShippingAddressModalProps {
  open: boolean;
  nextNumber: number;
  onClose: () => void;
  onAdd: (address: NewShippingAddress) => void | Promise<void>;
}

const EMPTY_FORM: NewShippingAddress = {
  label: "",
  recipientName: "",
  phone: "",
  address: "",
};

export function AddShippingAddressModal({
  open,
  nextNumber,
  onClose,
  onAdd,
}: AddShippingAddressModalProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const handleClose = () => {
    if (isSaving) return;
    setForm(EMPTY_FORM);
    setError("");
    onClose();
  };

  const updateField = (field: keyof NewShippingAddress, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setError("");

    try {
      await onAdd({
        label: form.label.trim() || "추가 배송지 " + nextNumber,
        recipientName: form.recipientName.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
      });
      setForm(EMPTY_FORM);
    } catch {
      setError("배송지를 추가하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="➕ 새 배송지 추가"
      onClose={handleClose}
      size="sm"
      closeOnBackdrop={!isSaving}
    >
      <form className="space-y-5 p-5 sm:p-6" onSubmit={handleSubmit}>
        <p className="rounded-2xl bg-[#edf7fa] px-4 py-3 text-[17px] font-semibold leading-7 text-[#466b76]">
          자주 받으시는 주소를 등록하면 택배 신청 때 바로 선택할 수 있어요.
        </p>

        <div>
          <label
            htmlFor="new-address-label"
            className="mb-2 block text-[17px] font-black text-[#59483b]"
          >
            배송지 이름 <span className="font-semibold text-[#89786c]">(선택)</span>
          </label>
          <input
            id="new-address-label"
            type="text"
            value={form.label}
            onChange={(event) => updateField("label", event.target.value)}
            className="w-full rounded-2xl border border-[#e5d8c8] bg-white px-4 py-3 text-[17px] text-[#493b31] outline-none transition focus:border-[#dc8f7d] focus:ring-4 focus:ring-[#f7d9d1]/70"
            placeholder="예: 딸네 집, 가게"
          />
        </div>

        <div>
          <label
            htmlFor="new-address-name"
            className="mb-2 block text-[17px] font-black text-[#59483b]"
          >
            받는 분 이름
          </label>
          <input
            id="new-address-name"
            name="recipientName"
            type="text"
            autoComplete="name"
            required
            value={form.recipientName}
            onChange={(event) => updateField("recipientName", event.target.value)}
            className="w-full rounded-2xl border border-[#e5d8c8] bg-white px-4 py-3 text-[17px] text-[#493b31] outline-none transition focus:border-[#dc8f7d] focus:ring-4 focus:ring-[#f7d9d1]/70"
            placeholder="받는 분 이름"
          />
        </div>

        <div>
          <label
            htmlFor="new-address-phone"
            className="mb-2 block text-[17px] font-black text-[#59483b]"
          >
            연락처
          </label>
          <input
            id="new-address-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            value={form.phone}
            onChange={(event) => updateField("phone", event.target.value)}
            className="w-full rounded-2xl border border-[#e5d8c8] bg-white px-4 py-3 text-[17px] text-[#493b31] outline-none transition focus:border-[#dc8f7d] focus:ring-4 focus:ring-[#f7d9d1]/70"
            placeholder="010-0000-0000"
          />
        </div>

        <div>
          <label
            htmlFor="new-address-address"
            className="mb-2 block text-[17px] font-black text-[#59483b]"
          >
            배송 주소
          </label>
          <textarea
            id="new-address-address"
            name="address"
            autoComplete="street-address"
            required
            rows={3}
            value={form.address}
            onChange={(event) => updateField("address", event.target.value)}
            className="w-full resize-none rounded-2xl border border-[#e5d8c8] bg-white px-4 py-3 text-[17px] leading-7 text-[#493b31] outline-none transition focus:border-[#dc8f7d] focus:ring-4 focus:ring-[#f7d9d1]/70"
            placeholder="도로명 주소와 상세 주소를 입력해 주세요"
          />
        </div>

        {error ? (
          <p role="alert" className="text-[17px] font-bold text-[#b94f46]">
            {error}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-3 pt-1">
          <Button
            variant="ghost"
            size="lg"
            onClick={handleClose}
            disabled={isSaving}
          >
            취소
          </Button>
          <Button type="submit" size="lg" isLoading={isSaving}>
            배송지 저장
          </Button>
        </div>
      </form>
    </Modal>
  );
}
