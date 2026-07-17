"use client";

/* eslint-disable @next/next/no-img-element -- Supabase Storage/Kakao 이미지 URL을 표시합니다. */
import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";
import type { Role } from "@/src/types/auction";
import { Button, Modal } from "@/src/components/common";
import { useMemberAccount } from "@/src/hooks/useMemberAccount";
import type {
  MemberShippingAddress,
  SaveShippingAddressInput,
  WonProductShippingStatus,
} from "@/src/lib/supabase/memberAccount";
import {
  fetchMyKakaoProfile,
  type KakaoMemberProfile,
} from "@/src/lib/supabase/kakaoProfile";
import { formatKRW } from "@/src/utils/formatters";
import { deleteMyAccount } from "@/src/lib/supabase/account";

interface AccountPageProps {
  userId?: string;
  displayName?: string;
  avatarUrl?: string | null;
  email?: string | null;
  role: Role;
  onSignIn: () => void;
  onSignOut: () => void | Promise<void>;
}

interface AddressEditorModalProps {
  address: MemberShippingAddress | null;
  forceDefault: boolean;
  onClose: () => void;
  onSave: (input: SaveShippingAddressInput) => Promise<void>;
}

type Feedback = { type: "success" | "error"; message: string } | null;

const roleLabel: Record<Role, string> = {
  user: "일반 회원",
  operator: "운영자",
  admin: "운영자",
};

const shippingStatusLabel: Record<WonProductShippingStatus, string> = {
  ready: "보관 중 · 택배 접수 가능",
  requested: "택배 접수 완료",
  shipped: "발송 완료",
};

const genderLabel = {
  female: "여성",
  male: "남성",
} as const;

function DeleteAccountModal({
  open,
  onClose,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");

  const handleDelete = async (event: FormEvent) => {
    event.preventDefault();
    if (confirmation !== "탈퇴") return;
    setIsDeleting(true);
    setError("");
    try {
      await deleteMyAccount();
      onDeleted();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "회원 탈퇴를 완료하지 못했습니다.",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="회원 탈퇴"
      description="회원 프로필과 서비스 이용 정보를 삭제합니다. 되돌릴 수 없습니다."
      size="sm"
    >
      <form onSubmit={handleDelete} className="space-y-4">
        <p className="rounded-2xl border border-[#edc2b8] bg-[#fff0ea] px-4 py-3 text-sm font-bold leading-6 text-[#974a3e]">
          관계 법령상 보관 의무가 있는 거래 기록을 제외한 회원 정보는 탈퇴 처리와 함께
          삭제됩니다. 계속하려면 아래에 <strong>탈퇴</strong>를 입력하세요.
        </p>
        <label className="block text-sm font-black text-[#4c4039]">
          확인 문구
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="탈퇴"
            className="mt-2 h-12 w-full rounded-2xl border-2 border-[#ddcbbb] bg-white px-4 font-bold outline-none focus:border-[#d77b67]"
            disabled={isDeleting}
          />
        </label>
        {error ? <p role="alert" className="text-sm font-bold text-[#a84c3f]">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isDeleting}>
            취소
          </Button>
          <Button type="submit" disabled={confirmation !== "탈퇴"} isLoading={isDeleting}>
            {isDeleting ? "탈퇴 처리 중..." : "회원 탈퇴"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function VerifiedKakaoProfilePanel({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<KakaoMemberProfile | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    let active = true;
    void fetchMyKakaoProfile(userId)
      .then((nextProfile) => {
        if (!active) return;
        setProfile(nextProfile);
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [userId]);

  return (
    <section className="mt-6 rounded-[2rem] border border-[#eadbcd] bg-[#fffaf4] px-6 py-7 shadow-sm sm:px-9">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black tracking-[0.16em] text-[#a85e50]">
            KAKAO VERIFIED PROFILE
          </p>
          <h3 className="mt-2 text-xl font-black text-[#443830]">
            카카오 회원 정보
          </h3>
          <p className="mt-2 break-keep text-sm font-bold leading-6 text-[#7c6b60]">
            회원 식별·고객 지원과 연령·성별 기반 서비스 운영에 사용되는 본인 정보입니다.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-black ${
            profile?.profileComplete
              ? "bg-[#e2f2e8] text-[#3d6b50]"
              : "bg-[#fff0d9] text-[#8a6731]"
          }`}
        >
          {profile?.profileComplete ? "필수 정보 확인 완료" : "정보 확인 대기"}
        </span>
      </div>

      {status === "loading" ? (
        <p className="mt-5 text-sm font-bold text-[#7b6a5f]" role="status">
          카카오 회원 정보를 확인하고 있어요.
        </p>
      ) : status === "error" ? (
        <p className="mt-5 text-sm font-bold text-[#a45145]" role="alert">
          회원 정보를 불러오지 못했습니다. 잠시 후 다시 로그인해 주세요.
        </p>
      ) : (
        <dl className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[#eadfd4] bg-white px-4 py-3">
            <dt className="text-xs font-black text-[#8c796c]">이름</dt>
            <dd className="mt-1 font-black text-[#4a3e36]">
              {profile?.fullName || "심사 승인 후 제공"}
            </dd>
          </div>
          <div className="rounded-2xl border border-[#eadfd4] bg-white px-4 py-3">
            <dt className="text-xs font-black text-[#8c796c]">성별</dt>
            <dd className="mt-1 font-black text-[#4a3e36]">
              {profile?.gender ? genderLabel[profile.gender] : "심사 승인 후 제공"}
            </dd>
          </div>
          <div className="rounded-2xl border border-[#eadfd4] bg-white px-4 py-3">
            <dt className="text-xs font-black text-[#8c796c]">출생연도</dt>
            <dd className="mt-1 font-black text-[#4a3e36]">
              {profile?.birthYear ? `${profile.birthYear}년` : "심사 승인 후 제공"}
            </dd>
          </div>
        </dl>
      )}

      <p className="mt-4 text-xs font-bold leading-5 text-[#89786d]">
        이메일과 카카오계정 전화번호는 요청하거나 저장하지 않습니다. 자세한 내용은{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          개인정보처리방침
        </Link>
        에서 확인할 수 있습니다.
      </p>
    </section>
  );
}

const closedAtFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "long",
  day: "numeric",
});

function formatClosedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "마감일 확인 필요"
    : `${closedAtFormatter.format(date)} 낙찰`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function AddressEditorModal({
  address,
  forceDefault,
  onClose,
  onSave,
}: AddressEditorModalProps) {
  const [label, setLabel] = useState(address?.label ?? "");
  const [recipientName, setRecipientName] = useState(
    address?.recipientName ?? "",
  );
  const [phone, setPhone] = useState(address?.phone ?? "");
  const [streetAddress, setStreetAddress] = useState(address?.address ?? "");
  const [isDefault, setIsDefault] = useState(
    forceDefault || Boolean(address?.isDefault),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      await onSave({
        id: address?.id ?? null,
        label,
        recipientName,
        phone,
        address: streetAddress,
        isDefault: forceDefault || isDefault,
      });
      onClose();
    } catch (saveError) {
      setError(getErrorMessage(saveError, "배송지를 저장하지 못했습니다."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClasses =
    "mt-2 min-h-12 w-full rounded-2xl border-2 border-[#ddcbbb] bg-[#fffdf9] px-4 py-3 text-base font-bold text-[#463a34] outline-none transition placeholder:font-medium placeholder:text-[#ad9d92] focus:border-[#d77b67] focus:ring-4 focus:ring-[#e9a99b]/20 disabled:opacity-60";

  return (
    <Modal
      open
      onClose={() => {
        if (!isSubmitting) onClose();
      }}
      closeOnBackdrop={!isSubmitting}
      title={address ? "배송지 수정" : "새 배송지 추가"}
      description="택배를 받으실 분의 실제 정보를 정확하게 입력해 주세요."
      size="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-5 sm:p-6">
        <label className="block text-sm font-black text-[#4c4039]">
          배송지 이름
          <input
            type="text"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="예: 우리 집"
            maxLength={40}
            required
            disabled={isSubmitting}
            className={inputClasses}
            autoFocus
          />
        </label>
        <label className="block text-sm font-black text-[#4c4039]">
          받는 분
          <input
            type="text"
            value={recipientName}
            onChange={(event) => setRecipientName(event.target.value)}
            autoComplete="name"
            maxLength={80}
            required
            disabled={isSubmitting}
            className={inputClasses}
          />
        </label>
        <label className="block text-sm font-black text-[#4c4039]">
          연락처
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            autoComplete="tel"
            minLength={7}
            maxLength={30}
            required
            disabled={isSubmitting}
            className={inputClasses}
          />
        </label>
        <label className="block text-sm font-black text-[#4c4039]">
          배송 주소
          <textarea
            value={streetAddress}
            onChange={(event) => setStreetAddress(event.target.value)}
            autoComplete="street-address"
            rows={3}
            minLength={5}
            maxLength={500}
            required
            disabled={isSubmitting}
            className={`${inputClasses} resize-none`}
          />
        </label>
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-[#e4d6ca] bg-white px-4 py-3 text-sm font-black text-[#59483f]">
          <input
            type="checkbox"
            checked={forceDefault || isDefault}
            onChange={(event) => setIsDefault(event.target.checked)}
            disabled={forceDefault || isSubmitting}
            className="size-5 accent-[#df7966]"
          />
          기본 배송지로 사용
        </label>

        {error ? (
          <p
            role="alert"
            className="rounded-2xl border border-[#f0c5bb] bg-[#fff0ea] px-4 py-3 text-sm font-bold leading-6 text-[#a9493e]"
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 border-t border-[#eee0d5] pt-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting}
          >
            취소
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            {isSubmitting ? "저장 중..." : "배송지 저장"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function MemberAccountPanel({ userId }: { userId: string }) {
  const accordionId = useId();
  const member = useMemberAccount(userId);
  const [isAddressOpen, setIsAddressOpen] = useState(false);
  const [editorAddress, setEditorAddress] =
    useState<MemberShippingAddress | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);

  if (member.isLoading) {
    return (
      <section
        className="mt-6 rounded-[2rem] border border-[#eadbcd] bg-[#fffaf4] px-6 py-10 text-center shadow-sm"
        role="status"
      >
        <span
          aria-hidden="true"
          className="mx-auto block size-7 animate-spin rounded-full border-3 border-[#e8d8cb] border-r-[#db7865]"
        />
        <p className="mt-3 font-bold text-[#78675d]">
          실제 배송 정보와 낙찰 상품을 불러오고 있어요.
        </p>
      </section>
    );
  }

  if (!member.account) {
    return (
      <section className="mt-6 rounded-[2rem] border border-[#efc4bb] bg-[#fff4ef] px-6 py-8 text-center shadow-sm">
        <p role="alert" className="font-black leading-7 text-[#a64e42]">
          {member.error ?? "회원 배송 정보를 불러오지 못했습니다."}
        </p>
        <Button variant="ghost" className="mt-4" onClick={() => void member.refresh()}>
          다시 불러오기
        </Button>
      </section>
    );
  }

  const defaultAddress =
    member.addresses.find((address) => address.isDefault) ??
    member.addresses[0] ??
    null;
  const effectiveAddressId = member.addresses.some(
    (address) => address.id === selectedAddressId,
  )
    ? selectedAddressId
    : (defaultAddress?.id ?? "");
  const readyProductIds = new Set(
    member.wonProducts
      .filter((product) => product.shippingStatus === "ready")
      .map((product) => product.productId),
  );
  const effectiveSelectedIds = [...selectedProductIds].filter((id) =>
    readyProductIds.has(id),
  );
  const accountActive = member.account.accountStatus === "active";
  const canRequestShipping =
    accountActive &&
    member.account.shippingCreditCount > 0 &&
    effectiveSelectedIds.length > 0 &&
    Boolean(effectiveAddressId) &&
    !member.isMutating;

  const openNewAddress = () => {
    setEditorAddress(null);
    setEditorOpen(true);
  };

  const openEditAddress = (address: MemberShippingAddress) => {
    setEditorAddress(address);
    setEditorOpen(true);
  };

  const saveAddress = async (input: SaveShippingAddressInput) => {
    await member.saveAddress(input);
    setFeedback({
      type: "success",
      message: input.id ? "배송지를 수정했습니다." : "새 배송지를 추가했습니다.",
    });
  };

  const setDefaultAddress = async (address: MemberShippingAddress) => {
    setFeedback(null);
    try {
      await member.saveAddress({
        id: address.id,
        label: address.label,
        recipientName: address.recipientName,
        phone: address.phone,
        address: address.address,
        isDefault: true,
      });
      setFeedback({ type: "success", message: "기본 배송지를 변경했습니다." });
    } catch (error) {
      setFeedback({
        type: "error",
        message: getErrorMessage(error, "기본 배송지를 변경하지 못했습니다."),
      });
    }
  };

  const deleteAddress = async (address: MemberShippingAddress) => {
    const confirmed = window.confirm(
      `‘${address.label}’ 배송지를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`,
    );
    if (!confirmed) return;

    setFeedback(null);
    try {
      await member.deleteAddress(address.id);
      setFeedback({ type: "success", message: "배송지를 삭제했습니다." });
    } catch (error) {
      setFeedback({
        type: "error",
        message: getErrorMessage(error, "배송지를 삭제하지 못했습니다."),
      });
    }
  };

  const toggleProduct = (productId: string) => {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
    setFeedback(null);
  };

  const requestShipping = async () => {
    setFeedback(null);
    try {
      await member.requestShipping(effectiveSelectedIds, effectiveAddressId);
      setSelectedProductIds(new Set());
      setFeedback({
        type: "success",
        message: "선택한 상품의 택배 접수를 완료했습니다.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: getErrorMessage(error, "택배 접수를 완료하지 못했습니다."),
      });
    }
  };

  return (
    <div className="mt-6 space-y-6">
      {member.error ? (
        <p
          role="alert"
          className="rounded-2xl border border-[#efc4bb] bg-[#fff0eb] px-5 py-3 font-bold text-[#a64e42]"
        >
          {member.error}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-[2rem] border border-[#eadbcd] bg-[#fffaf4] shadow-[0_18px_50px_rgba(92,67,51,0.08)]">
        <button
          type="button"
          aria-expanded={isAddressOpen}
          aria-controls={accordionId}
          onClick={() => setIsAddressOpen((current) => !current)}
          className="flex min-h-24 w-full items-center justify-between gap-4 px-6 py-5 text-left transition hover:bg-[#fff5e9] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#f1c7bb] sm:px-8"
        >
          <span>
            <span className="block text-xs font-black tracking-[0.16em] text-[#ba6d5c]">
              DELIVERY ADDRESS
            </span>
            <strong className="mt-1 block text-xl font-black text-[#493b31]">
              배송지 관리
            </strong>
            <span className="mt-1 block text-sm font-bold text-[#817066]">
              실제 등록 배송지 {member.addresses.length}곳
              {defaultAddress ? ` · 기본 ${defaultAddress.label}` : " · 기본 배송지 없음"}
            </span>
          </span>
          <span
            aria-hidden="true"
            className={`grid size-11 shrink-0 place-items-center rounded-full bg-[#f7e5d8] text-xl font-black text-[#9b6558] transition-transform ${
              isAddressOpen ? "rotate-180" : "rotate-0"
            }`}
          >
            ⌄
          </span>
        </button>

        <div id={accordionId} hidden={!isAddressOpen}>
          <div className="border-t border-[#eee1d6] px-5 py-5 sm:px-8 sm:py-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-bold leading-7 text-[#74645b]">
                추가·수정·삭제·기본 지정 결과는 Supabase에서 다시 조회해 반영합니다.
              </p>
              <Button
                size="sm"
                onClick={openNewAddress}
                disabled={member.isMutating}
              >
                + 새 배송지 추가
              </Button>
            </div>

            {member.addresses.length === 0 ? (
              <p className="mt-5 rounded-2xl border border-dashed border-[#ddcbbc] bg-white/70 px-5 py-8 text-center font-bold text-[#806f64]">
                등록된 배송지가 없습니다. 택배 접수 전에 실제 주소를 추가해 주세요.
              </p>
            ) : (
              <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                {member.addresses.map((address) => (
                  <li
                    key={address.id}
                    className={`rounded-2xl border p-4 ${
                      address.isDefault
                        ? "border-[#e1ad9f] bg-[#fff0ea]"
                        : "border-[#e2d7cc] bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <strong className="font-black text-[#493b31]">
                        {address.label}
                      </strong>
                      {address.isDefault ? (
                        <span className="rounded-full bg-[#df806c] px-2.5 py-1 text-xs font-black text-white">
                          기본
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3 font-bold text-[#59483b]">
                      {address.recipientName} · {address.phone}
                    </p>
                    <p className="mt-1 break-words font-medium leading-7 text-[#76685d]">
                      {address.address}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-[#eadfd5] pt-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditAddress(address)}
                        disabled={member.isMutating}
                      >
                        수정
                      </Button>
                      {!address.isDefault ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void setDefaultAddress(address)}
                          disabled={member.isMutating}
                        >
                          기본 지정
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => void deleteAddress(address)}
                        disabled={member.isMutating}
                      >
                        삭제
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-[#d8e3e4] bg-[#f8fbfa] p-5 shadow-[0_18px_50px_rgba(62,91,92,0.07)] sm:p-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black tracking-[0.16em] text-[#61818a]">
              WON &amp; KEEP
            </p>
            <h2 className="mt-1 text-xl font-black text-[#3f4d4f] sm:text-2xl">
              낙찰·보관 상품 택배 접수
            </h2>
          </div>
          <span className="text-sm font-bold text-[#718083]">
            Supabase 낙찰 원장 기준 {member.wonProducts.length}건
          </span>
        </div>

        {!accountActive ? (
          <p role="alert" className="mt-4 rounded-2xl bg-[#fff0ea] px-4 py-3 font-bold text-[#a64e42]">
            현재 회원 상태에서는 택배 접수를 진행할 수 없습니다.
          </p>
        ) : null}

        {member.wonProducts.length === 0 ? (
          <p className="mt-5 rounded-2xl border border-dashed border-[#cbdadb] bg-white px-5 py-9 text-center font-bold text-[#718083]">
            실제 낙찰 또는 보관 중인 상품이 없습니다.
          </p>
        ) : (
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {member.wonProducts.map((product) => {
              const ready = product.shippingStatus === "ready";
              const selected = ready && selectedProductIds.has(product.productId);

              return (
                <li key={product.productId}>
                  <label
                    className={`flex h-full gap-3 rounded-2xl border p-3 transition ${
                      selected
                        ? "border-[#de8270] bg-[#fff1eb] ring-2 ring-[#edb3a6]/50"
                        : ready
                          ? "cursor-pointer border-[#d8e1de] bg-white hover:border-[#c2d4d0]"
                          : "border-[#e1e3e1] bg-[#f1f2f0] opacity-75"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleProduct(product.productId)}
                      disabled={!ready || member.isMutating}
                      className="mt-1 size-5 shrink-0 accent-[#df7966]"
                      aria-label={`${product.title} 택배 접수 선택`}
                    />
                    {product.imageUrls[0] ? (
                      <img
                        src={product.imageUrls[0]}
                        alt=""
                        className="size-20 shrink-0 rounded-xl bg-[#eee7df] object-cover"
                      />
                    ) : (
                      <span className="grid size-20 shrink-0 place-items-center rounded-xl bg-[#eee7df] text-xs font-bold text-[#8c8178]">
                        사진 없음
                      </span>
                    )}
                    <span className="min-w-0">
                      <strong className="line-clamp-2 block font-black leading-6 text-[#43403c]">
                        {product.title}
                      </strong>
                      <span className="mt-1 block text-sm font-bold text-[#b05c4e]">
                        {formatKRW(product.finalBidAmount)}
                      </span>
                      <span className="mt-1 block text-xs font-bold text-[#75807d]">
                        {formatClosedAt(product.closedAt)}
                      </span>
                      <span className="mt-1 block text-xs font-black text-[#53756c]">
                        {shippingStatusLabel[product.shippingStatus]}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <label className="mt-5 block text-sm font-black text-[#4f5e5f]">
          택배를 받을 배송지
          <select
            value={effectiveAddressId}
            onChange={(event) => setSelectedAddressId(event.target.value)}
            disabled={member.addresses.length === 0 || member.isMutating}
            className="mt-2 min-h-12 w-full rounded-2xl border-2 border-[#cfdcda] bg-white px-4 font-bold text-[#3f4d4f] outline-none focus:border-[#75a99d] focus:ring-4 focus:ring-[#bcded6]/40 disabled:opacity-60"
          >
            {member.addresses.length === 0 ? (
              <option value="">배송지를 먼저 등록해 주세요</option>
            ) : null}
            {member.addresses.map((address) => (
              <option key={address.id} value={address.id}>
                {address.label}{address.isDefault ? " (기본)" : ""} · {address.recipientName}
              </option>
            ))}
          </select>
        </label>

        <Button
          size="lg"
          fullWidth
          className="mt-5"
          onClick={() => void requestShipping()}
          disabled={!canRequestShipping}
          isLoading={member.isMutating}
        >
          {member.isMutating
            ? "택배 접수 중..."
            : `선택 상품 택배 접수하기 (${effectiveSelectedIds.length}개)`}
        </Button>

        <div className="mt-3 rounded-2xl border-2 border-[#b7d7e1] bg-[#eaf6fa] px-5 py-4 shadow-sm">
          <p className="text-lg font-black text-[#315f6d]">
            📦 택배 가능 횟수: {" "}
            <strong className="text-[#c86150]">
              {member.account.shippingCreditCount}회
            </strong>
          </p>
          <p className="mt-1 text-sm font-bold leading-6 text-[#5e7a82]">
            한 번 접수할 때 1회가 서버에서 차감됩니다. 잔여 횟수가 없으면 접수할 수 없습니다.
          </p>
        </div>

        {feedback ? (
          <p
            role={feedback.type === "error" ? "alert" : "status"}
            className={`mt-4 rounded-2xl px-4 py-3 font-bold ${
              feedback.type === "error"
                ? "bg-[#fff0ea] text-[#a64e42]"
                : "bg-[#e8f5ee] text-[#376b55]"
            }`}
          >
            {feedback.message}
          </p>
        ) : null}
      </section>

      {editorOpen ? (
        <AddressEditorModal
          address={editorAddress}
          forceDefault={member.addresses.length === 0}
          onClose={() => setEditorOpen(false)}
          onSave={saveAddress}
        />
      ) : null}
    </div>
  );
}

export function AccountPage({
  userId,
  displayName,
  avatarUrl,
  email,
  role,
  onSignIn,
  onSignOut,
}: AccountPageProps) {
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  if (!userId) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-8 sm:px-6 lg:pb-12">
        <section className="rounded-[2rem] border border-[#eadbcd] bg-[#fffaf4] px-6 py-14 text-center shadow-[0_22px_60px_rgba(92,67,51,0.09)] sm:px-10">
          <span className="mx-auto grid size-16 place-items-center rounded-[1.4rem] bg-[#fee500] text-3xl" aria-hidden="true">
            K
          </span>
          <h2 className="mt-5 text-2xl font-black text-[#463a33]">
            내 정보를 보려면 로그인해 주세요
          </h2>
          <p className="mx-auto mt-3 max-w-lg break-keep text-[17px] font-bold leading-8 text-[#7a6b62]">
            일반 회원은 카카오 계정으로 가입과 로그인을 한 번에 진행할 수 있습니다.
          </p>
          <Button size="lg" className="mt-6" onClick={onSignIn}>
            카카오로 시작하기
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-8 sm:px-6 lg:pb-12">
      <section className="overflow-hidden rounded-[2rem] border border-[#eadbcd] bg-[#fffaf4] shadow-[0_22px_60px_rgba(92,67,51,0.09)]">
        <div className="bg-[linear-gradient(135deg,#f8ded3_0%,#e6f1f2_100%)] px-6 py-8 sm:px-9">
          <p className="text-sm font-black tracking-[0.14em] text-[#a85e50]">
            MY ACCOUNT
          </p>
          <div className="mt-4 flex items-center gap-4">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className="size-16 rounded-2xl object-cover shadow-sm"
              />
            ) : (
              <span className="grid size-16 place-items-center rounded-2xl bg-white text-2xl font-black text-[#b45d4f] shadow-sm" aria-hidden="true">
                {(displayName || "회").slice(0, 1)}
              </span>
            )}
            <div>
              <h2 className="text-2xl font-black text-[#40352f]">
                {displayName || "회원"}
              </h2>
              <span className="mt-1 inline-flex rounded-full bg-white/80 px-3 py-1 text-sm font-black text-[#5d7768]">
                {roleLabel[role]}
              </span>
            </div>
          </div>
        </div>

        <dl className="grid gap-px bg-[#eadfd5] sm:grid-cols-2">
          <div className="bg-[#fffdf9] px-6 py-5">
            <dt className="text-sm font-black text-[#8a776b]">로그인 계정</dt>
            <dd className="mt-1 break-all text-[17px] font-bold text-[#4c4039]">
              {email || (role === "user" ? "카카오 연결 계정" : "운영 계정")}
            </dd>
          </div>
          <div className="bg-[#fffdf9] px-6 py-5">
            <dt className="text-sm font-black text-[#8a776b]">회원 식별 상태</dt>
            <dd className="mt-1 text-[17px] font-bold text-[#4c4039]">
              Supabase 인증 완료
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap justify-end gap-2 px-6 py-5 sm:px-9">
          {role === "user" ? (
            <Button variant="ghost" onClick={() => setDeleteModalOpen(true)}>
              회원 탈퇴
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => void onSignOut()}>
            로그아웃
          </Button>
        </div>
      </section>

      {role === "user" ? (
        <>
          <VerifiedKakaoProfilePanel key={`kakao-${userId}`} userId={userId} />
          <MemberAccountPanel key={userId} userId={userId} />
        </>
      ) : null}

      <DeleteAccountModal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onDeleted={() => window.location.replace("/")}
      />
    </main>
  );
}
