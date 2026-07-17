"use client";

import { useId, useMemo, useState } from "react";
import type { FormEvent } from "react";

import type {
  ShippingAddress,
  UserProfile,
} from "@/src/types/auction";

import {
  AddShippingAddressModal,
  type NewShippingAddress,
} from "./AddShippingAddressModal";

interface UserInfoFormProps {
  user: UserProfile;
  onSave?: (profile: UserProfile) => void | Promise<void>;
}

type Feedback =
  | { type: "success"; message: string }
  | { type: "error"; message: string }
  | null;

type EditableProfile = Pick<UserProfile, "name" | "phone" | "address">;

function createDefaultAddress(user: UserProfile): ShippingAddress {
  return {
    id: "address-default-" + user.id,
    label: "기본 배송지",
    recipientName: user.name,
    phone: user.phone,
    address: user.address,
    isDefault: true,
  };
}

function normalizeAddresses(user: UserProfile): ShippingAddress[] {
  const addresses = user.shippingAddresses.map((address) => ({ ...address }));
  const defaultIndex = addresses.findIndex((address) => address.isDefault);

  if (defaultIndex < 0) return [createDefaultAddress(user), ...addresses];

  return addresses.map((address, index) => ({
    ...address,
    isDefault: index === defaultIndex,
  }));
}

function getDefaultAddress(
  addresses: readonly ShippingAddress[],
  user: UserProfile,
) {
  return addresses.find((address) => address.isDefault) ?? createDefaultAddress(user);
}

function createAddressId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return "address-" + crypto.randomUUID();
  }

  return (
    "address-" +
    Date.now() +
    "-" +
    Math.random().toString(36).slice(2, 9)
  );
}

export function UserInfoForm({ user, onSave }: UserInfoFormProps) {
  const accordionId = useId();
  const [isOpen, setIsOpen] = useState(true);
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [addresses, setAddresses] = useState<ShippingAddress[]>(() =>
    normalizeAddresses(user),
  );
  const [form, setForm] = useState<EditableProfile>(() => {
    const defaultAddress = getDefaultAddress(normalizeAddresses(user), user);

    return {
      name: defaultAddress.recipientName,
      phone: defaultAddress.phone,
      address: defaultAddress.address,
    };
  });
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const sortedAddresses = useMemo(
    () =>
      [...addresses].sort(
        (first, second) => Number(second.isDefault) - Number(first.isDefault),
      ),
    [addresses],
  );

  const updateField = (field: keyof EditableProfile, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFeedback(null);
  };

  const buildProfile = (
    defaultValues: EditableProfile,
    nextAddresses = addresses,
  ): UserProfile => {
    const currentDefault = getDefaultAddress(nextAddresses, user);
    const updatedAddresses = nextAddresses.map((address) =>
      address.id === currentDefault.id
        ? {
            ...address,
            recipientName: defaultValues.name,
            phone: defaultValues.phone,
            address: defaultValues.address,
            isDefault: true,
          }
        : { ...address, isDefault: false },
    );

    return {
      ...user,
      name: defaultValues.name,
      phone: defaultValues.phone,
      address: defaultValues.address,
      shippingAddresses: updatedAddresses,
    };
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setFeedback(null);

    const trimmedForm = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
    };

    try {
      const savedProfile = buildProfile(trimmedForm);

      // TODO: DB 연동 필요 - 기본 배송지와 사용자 대표 정보를 하나의 트랜잭션으로 저장합니다.
      await onSave?.(savedProfile);
      setAddresses(savedProfile.shippingAddresses);
      setForm(trimmedForm);
      setFeedback({
        type: "success",
        message: "기본 배송 정보가 안전하게 저장되었어요.",
      });
    } catch {
      setFeedback({
        type: "error",
        message: "저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddAddress = async (newAddress: NewShippingAddress) => {
    const nextAddresses: ShippingAddress[] = [
      ...addresses,
      {
        id: createAddressId(),
        ...newAddress,
        isDefault: false,
      },
    ];
    const currentDefault = getDefaultAddress(addresses, user);
    const defaultValues = {
      name: currentDefault.recipientName,
      phone: currentDefault.phone,
      address: currentDefault.address,
    };
    const savedProfile = buildProfile(defaultValues, nextAddresses);

    // TODO: DB 연동 필요 - 추가 배송지 생성 API 호출 후 서버가 발급한 ID로 교체합니다.
    await onSave?.(savedProfile);
    setAddresses(savedProfile.shippingAddresses);
    setAddressModalOpen(false);
    setFeedback({
      type: "success",
      message: "‘" + newAddress.label + "’ 배송지가 추가되었어요.",
    });
  };

  const feedbackClassName =
    "text-[17px] font-semibold " +
    (feedback?.type === "error" ? "text-[#bd544a]" : "text-[#557a6c]");
  const accordionClassName =
    "grid transition-[grid-template-rows,opacity] duration-300 ease-out " +
    (isOpen
      ? "grid-rows-[1fr] opacity-100"
      : "pointer-events-none grid-rows-[0fr] opacity-0");
  const accordionIconClassName =
    "grid size-10 shrink-0 place-items-center rounded-full bg-[#f7e5d8] text-xl font-black text-[#9b6558] transition-transform duration-300 " +
    (isOpen ? "rotate-180" : "rotate-0");

  return (
    <section
      aria-labelledby="shipping-address-title"
      className="rounded-[2rem] border border-[#eadfce] bg-[#fffaf3] p-4 shadow-[0_18px_50px_rgba(111,83,54,0.08)] sm:p-6"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-[17px] font-bold tracking-[0.16em] text-[#c87967]">
            DELIVERY ADDRESS
          </p>
          <h2
            id="shipping-address-title"
            className="text-xl font-extrabold text-[#493b31] sm:text-2xl"
          >
            배송지 관리
          </h2>
          <p className="mt-2 text-[17px] font-semibold leading-7 text-[#796b60]">
            상품을 받으실 주소를 확인하고 필요한 배송지를 추가해 주세요.
          </p>
        </div>
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#f8d9d0] text-xl"
        >
          📍
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#e5d8c8] bg-white/90">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={accordionId}
          onClick={() => setIsOpen((current) => !current)}
          className="flex min-h-16 w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-[#fff5e9] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#f4c9bd] sm:px-5"
        >
          <span>
            <strong className="block text-[18px] font-black text-[#493b31]">
              기본 배송 정보
            </strong>
            <span className="mt-0.5 block text-[17px] font-semibold text-[#8a796c]">
              회원 정보와 기본 발송 주소에 함께 사용됩니다.
            </span>
          </span>
          <span aria-hidden="true" className={accordionIconClassName}>
            ⌄
          </span>
        </button>

        <div
          id={accordionId}
          aria-hidden={!isOpen}
          inert={!isOpen}
          className={accordionClassName}
        >
          <div className="overflow-hidden">
            <form
              className="space-y-5 border-t border-[#eee1d6] px-4 py-5 sm:px-5"
              onSubmit={handleSubmit}
            >
              <div>
                <label
                  htmlFor="profile-name"
                  className="mb-2 block text-[17px] font-bold text-[#59483b]"
                >
                  이름
                </label>
                <input
                  id="profile-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  className="w-full rounded-2xl border border-[#e5d8c8] bg-white px-4 py-3 text-[17px] text-[#493b31] outline-none transition placeholder:text-[#b6aa9d] focus:border-[#dc8f7d] focus:ring-4 focus:ring-[#f7d9d1]/70"
                  placeholder="이름을 입력해 주세요"
                />
              </div>

              <div>
                <label
                  htmlFor="profile-phone"
                  className="mb-2 block text-[17px] font-bold text-[#59483b]"
                >
                  연락처
                </label>
                <input
                  id="profile-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                  value={form.phone}
                  onChange={(event) => updateField("phone", event.target.value)}
                  className="w-full rounded-2xl border border-[#e5d8c8] bg-white px-4 py-3 text-[17px] text-[#493b31] outline-none transition placeholder:text-[#b6aa9d] focus:border-[#dc8f7d] focus:ring-4 focus:ring-[#f7d9d1]/70"
                  placeholder="010-0000-0000"
                />
              </div>

              <div>
                <label
                  htmlFor="profile-address"
                  className="mb-2 block text-[17px] font-bold text-[#59483b]"
                >
                  배송 주소
                </label>
                <textarea
                  id="profile-address"
                  name="address"
                  autoComplete="street-address"
                  required
                  rows={3}
                  value={form.address}
                  onChange={(event) => updateField("address", event.target.value)}
                  className="w-full resize-none rounded-2xl border border-[#e5d8c8] bg-white px-4 py-3 text-[17px] leading-7 text-[#493b31] outline-none transition placeholder:text-[#b6aa9d] focus:border-[#dc8f7d] focus:ring-4 focus:ring-[#f7d9d1]/70"
                  placeholder="상품을 받을 주소를 입력해 주세요"
                />
              </div>

              <div className="flex min-h-11 flex-col-reverse gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
                <p
                  role="status"
                  aria-live="polite"
                  className={feedbackClassName}
                >
                  {feedback?.message ??
                    "기본 주소 수정 시 회원 대표 정보도 함께 변경됩니다."}
                </p>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="min-h-12 shrink-0 rounded-2xl bg-[#df8d79] px-6 py-3 text-[17px] font-extrabold text-white shadow-[0_8px_20px_rgba(197,112,91,0.24)] transition hover:-translate-y-0.5 hover:bg-[#d77f6a] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f4c9bd] disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  {isSaving ? "저장 중…" : "기본 정보 저장하기"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-[19px] font-black text-[#493b31]">
              등록된 배송지 {sortedAddresses.length}곳
            </h3>
            <p className="mt-1 text-[17px] font-semibold text-[#847468]">
              택배 접수 단계에서 원하는 주소를 선택할 수 있어요.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAddressModalOpen(true)}
            className="min-h-12 shrink-0 rounded-2xl border border-[#abd0c3] bg-[#e7f5ef] px-5 py-3 text-[17px] font-black text-[#356c5a] transition hover:bg-[#d9eee6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#bfe2d6]"
          >
            ➕ 새 배송지 추가
          </button>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2">
          {sortedAddresses.map((shippingAddress) => {
            const cardClassName =
              "rounded-2xl border p-4 " +
              (shippingAddress.isDefault
                ? "border-[#e2b3a7] bg-[#fff0ea]"
                : "border-[#dfd8ce] bg-white/80");

            return (
              <li key={shippingAddress.id} className={cardClassName}>
                <div className="flex items-start justify-between gap-3">
                  <strong className="text-[17px] font-black text-[#493b31]">
                    {shippingAddress.label}
                  </strong>
                  {shippingAddress.isDefault ? (
                    <span className="shrink-0 rounded-full bg-[#df8d79] px-3 py-1 text-[17px] font-black text-white">
                      기본
                    </span>
                  ) : null}
                </div>
                <p className="mt-3 text-[17px] font-bold text-[#59483b]">
                  {shippingAddress.recipientName} · {shippingAddress.phone}
                </p>
                <p className="mt-1 text-[17px] font-semibold leading-7 text-[#76685d]">
                  {shippingAddress.address}
                </p>
              </li>
            );
          })}
        </ul>
      </div>

      <AddShippingAddressModal
        open={addressModalOpen}
        nextNumber={addresses.length + 1}
        onClose={() => setAddressModalOpen(false)}
        onAdd={handleAddAddress}
      />
    </section>
  );
}
