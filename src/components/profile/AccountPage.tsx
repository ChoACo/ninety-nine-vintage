"use client";

/* eslint-disable @next/next/no-img-element -- Supabase Storage/Kakao 이미지 URL을 표시합니다. */
import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";
import type { Role } from "@/src/types/auction";
import { Button, Modal } from "@/src/components/common";
import { useMemberAccount } from "@/src/hooks/useMemberAccount";
import type {
  MemberShippingAddress,
  MemberWonProduct,
  ProductPaymentStatus,
  SaveShippingAddressInput,
  WonProductShippingStatus,
} from "@/src/lib/supabase/memberAccount";
import {
  fetchMyKakaoProfile,
  type KakaoMemberProfile,
} from "@/src/lib/supabase/kakaoProfile";
import { formatKRW } from "@/src/utils/formatters";
import { deleteMyAccount } from "@/src/lib/supabase/account";
import {
  createPortOnePaymentId,
  requestProductPayment,
  type ProductPaymentMethod,
  type ProductPaymentResult,
} from "@/src/lib/portone/payment";
import { NicknameSettingsPanel } from "./NicknameSettingsPanel";

interface AccountPageProps {
  userId?: string;
  displayName?: string;
  avatarUrl?: string | null;
  email?: string | null;
  role: Role;
  onSignIn: () => void;
  onSignOut: () => void | Promise<void>;
  onProfileRefresh?: () => void | Promise<void>;
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

const paymentStatusLabel: Record<ProductPaymentStatus, string> = {
  대기중: "결제 대기",
  가상계좌발급: "가상계좌 입금 대기",
  결제완료: "결제 완료",
};

const paymentMethodOptions: Array<{
  value: ProductPaymentMethod;
  label: string;
  description: string;
  icon: string;
}> = [
  {
    value: "CARD",
    label: "신용·체크카드",
    description: "카드사를 선택해 안전하게 결제합니다.",
    icon: "▣",
  },
  {
    value: "EASY_PAY",
    label: "카카오페이",
    description: "카카오페이 결제창으로 바로 이동합니다.",
    icon: "K",
  },
  {
    value: "VIRTUAL_ACCOUNT",
    label: "가상계좌",
    description: "전용 입금 계좌와 입금 기한을 발급받습니다.",
    icon: "₩",
  },
];

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
    <details className="theme-panel group mt-6 rounded-[2rem] border px-6 py-5 shadow-sm sm:px-9">
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-surface)] [&::-webkit-details-marker]:hidden">
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
        <span className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-black ${
              profile?.profileComplete
                ? "bg-[#e2f2e8] text-[#3d6b50]"
                : "bg-[#fff0d9] text-[#8a6731]"
            }`}
          >
            {profile?.profileComplete ? "필수 정보 확인 완료" : "정보 확인 대기"}
          </span>
          <span aria-hidden="true" className="text-xl font-black text-[var(--text-muted)] transition-transform group-open:rotate-180">⌄</span>
        </span>
      </summary>

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
    </details>
  );
}

const closedAtFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "long",
  day: "numeric",
});

const paymentDueFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatClosedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "마감일 확인 필요"
    : `${closedAtFormatter.format(date)} 낙찰`;
}

function formatPaymentDue(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "입금 기한 확인 필요"
    : paymentDueFormatter.format(date) + "까지";
}

function formatPaymentMethod(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("CARD")) return "신용·체크카드";
  if (value.startsWith("EASY_PAY")) {
    return value.includes("KAKAOPAY") ? "카카오페이" : "간편결제";
  }
  if (value.startsWith("VIRTUAL_ACCOUNT")) return "가상계좌";
  return "기타 결제수단";
}

const vbankBankLabels: Record<string, string> = {
  KDB: "산업은행",
  IBK: "기업은행",
  KOOKMIN: "국민은행",
  SUHYUP: "수협은행",
  NONGHYUP: "NH농협은행",
  LOCAL_NONGHYUP: "지역농축협",
  WOORI: "우리은행",
  STANDARD_CHARTERED: "SC제일은행",
  CITI: "한국씨티은행",
  DAEGU: "아이엠뱅크",
  BUSAN: "부산은행",
  KWANGJU: "광주은행",
  JEJU: "제주은행",
  JEONBUK: "전북은행",
  KYONGNAM: "경남은행",
  KFCC: "새마을금고",
  SHINHYUP: "신협",
  SAVINGS_BANK: "저축은행",
  POST: "우체국",
  HANA: "하나은행",
  SHINHAN: "신한은행",
  K_BANK: "케이뱅크",
  KAKAO: "카카오뱅크",
  TOSS: "토스뱅크",
};

function formatVbankBank(value: string | null): string {
  if (!value) return "입금 은행";
  return vbankBankLabels[value] ?? value;
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

function ProductPaymentModal({
  product,
  onClose,
  onCompleted,
  onRefresh,
}: {
  product: MemberWonProduct;
  onClose: () => void;
  onCompleted: (result: ProductPaymentResult) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const existingMethod = paymentMethodOptions.some(
    (option) => option.value === product.requestedPaymentMethod,
  )
    ? (product.requestedPaymentMethod as ProductPaymentMethod)
    : null;
  const reuseCurrentAttempt =
    Boolean(product.paymentId) && product.portoneStatus !== "FAILED";
  const [payMethod, setPayMethod] = useState<ProductPaymentMethod>(
    reuseCurrentAttempt && existingMethod ? existingMethod : "CARD",
  );
  const [paymentId] = useState(() =>
    reuseCurrentAttempt && product.paymentId
      ? product.paymentId
      : createPortOnePaymentId(product.productId),
  );
  const [lockedMethod, setLockedMethod] = useState<ProductPaymentMethod | null>(
    reuseCurrentAttempt ? existingMethod : null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const selectedMethod = paymentMethodOptions.find(
    (option) => option.value === payMethod,
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    setLockedMethod(payMethod);

    try {
      const result = await requestProductPayment({
        productId: product.productId,
        payMethod,
        paymentId,
      });
      await onCompleted(result);
    } catch (paymentError) {
      try {
        await onRefresh();
      } catch {
        // The checkout error remains the primary message.
      }
      setError(getErrorMessage(paymentError, "결제를 진행하지 못했습니다."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={() => {
        if (!isSubmitting) onClose();
      }}
      closeOnBackdrop={!isSubmitting}
      title="낙찰 상품 결제"
      description="결제 금액은 서버의 최종 낙찰 원장으로 다시 확인합니다."
      size="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-5 p-5 sm:p-6">
        <div className="flex gap-4 rounded-2xl border border-[#ead8c8] bg-[#fff8ee] p-4">
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
          <div className="min-w-0">
            <strong className="line-clamp-2 block font-black leading-6 text-[#473a32]">
              {product.title}
            </strong>
            <span className="mt-2 block text-xl font-black text-[#b85e4f]">
              {formatKRW(product.finalBidAmount)}
            </span>
            <span className="mt-1 block text-xs font-bold text-[#887568]">
              최종 낙찰 금액
            </span>
          </div>
        </div>

        <fieldset disabled={isSubmitting}>
          <legend className="text-sm font-black text-[#55463c]">
            결제 수단 선택
          </legend>
          <div className="mt-3 grid gap-2">
            {paymentMethodOptions.map((option) => {
              const selected = option.value === payMethod;
              return (
                <label
                  key={option.value}
                  className={
                    "flex min-h-20 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-3 transition " +
                    (selected
                      ? "border-[#dc806d] bg-[#fff0e9] shadow-sm"
                      : "border-[#e4d8ce] bg-white hover:border-[#d8b9ad]")
                  }
                >
                  <input
                    type="radio"
                    name="payment-method"
                    value={option.value}
                    checked={selected}
                    onChange={() => setPayMethod(option.value)}
                    disabled={
                      isSubmitting ||
                      (lockedMethod !== null && option.value !== lockedMethod)
                    }
                    className="size-5 shrink-0 accent-[#d86f5c]"
                  />
                  <span
                    aria-hidden="true"
                    className={
                      "grid size-10 shrink-0 place-items-center rounded-xl text-lg font-black " +
                      (selected
                        ? "bg-[#dd7b68] text-white"
                        : "bg-[#f2ebe5] text-[#7d6b60]")
                    }
                  >
                    {option.icon}
                  </span>
                  <span className="min-w-0">
                    <strong className="block font-black text-[#4a3e36]">
                      {option.label}
                    </strong>
                    <span className="mt-0.5 block break-keep text-xs font-bold leading-5 text-[#807066]">
                      {option.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <p className="rounded-2xl border border-[#d8e2df] bg-[#f4f8f6] px-4 py-3 text-xs font-bold leading-5 text-[#62756f]">
          현재 포트원 V2 테스트 환경입니다. 실제 청구 전환은 PG 심사와 운영 채널
          설정을 마친 뒤 진행합니다.
        </p>

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
            {isSubmitting
              ? "결제 확인 중..."
              : (selectedMethod?.label ?? "선택 수단") + "로 결제하기"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function WonProductCard({
  product,
  section,
  selected,
  accountActive,
  isMutating,
  onToggle,
  onPay,
}: {
  product: MemberWonProduct;
  section: "payment" | "storage";
  selected: boolean;
  accountActive: boolean;
  isMutating: boolean;
  onToggle: () => void;
  onPay: () => void;
}) {
  const paid =
    product.paymentStatus === "결제완료" && product.portoneStatus === "PAID";
  const ready = section === "storage" && product.shippingStatus === "ready" && paid;
  const paymentMethod = formatPaymentMethod(product.paymentMethod);
  const paymentLabel =
    product.portoneStatus === "FAILED"
      ? "결제 실패"
      : product.portoneStatus === "CANCELLED"
        ? "결제 취소"
        : product.portoneStatus === "PARTIAL_CANCELLED"
          ? "부분 취소 확인 필요"
          : product.portoneStatus === "PAY_PENDING"
            ? "결제 승인 대기"
            : paymentStatusLabel[product.paymentStatus];
  const canOpenPayment =
    section === "payment" &&
    product.paymentStatus === "대기중" &&
    product.portoneStatus !== "CANCELLED";

  return (
    <li>
      <div
        className={`flex h-full gap-3 rounded-2xl border p-3 transition ${
          selected
            ? "border-[#de8270] bg-[#fff1eb] ring-2 ring-[#edb3a6]/50"
            : ready
              ? "border-[#d8e1de] bg-white hover:border-[#c2d4d0]"
              : "border-[#e1e3e1] bg-[var(--surface-raised)]"
        }`}
      >
        {section === "storage" ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            disabled={!ready || isMutating}
            className="mt-1 size-5 shrink-0 accent-[#df7966]"
            aria-label={`${product.title} 택배 접수 선택`}
          />
        ) : null}
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
          <strong className="line-clamp-2 block font-black leading-6 text-[var(--text-strong)]">
            {product.title}
          </strong>
          <span className="mt-1 block text-sm font-bold text-[#b05c4e]">
            {formatKRW(product.finalBidAmount)}
          </span>
          <span className="mt-1 block text-xs font-bold text-[var(--text-muted)]">
            {formatClosedAt(product.closedAt)}
          </span>
          {section === "storage" ? (
            <span className="mt-1 block text-xs font-black text-[#53756c]">
              {shippingStatusLabel[product.shippingStatus]}
            </span>
          ) : null}
          <span
            className={
              "mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-black " +
              (paid
                ? "bg-[#dff1e6] text-[#376a50]"
                : product.paymentStatus === "가상계좌발급"
                  ? "bg-[#e3f0f4] text-[#376676]"
                  : "bg-[#fff0e5] text-[#9a5c43]")
            }
          >
            {paymentLabel}
          </span>
          {paymentMethod ? (
            <span className="mt-1 block text-xs font-bold text-[var(--text-muted)]">
              {paymentMethod}
            </span>
          ) : null}
        </span>
      </div>

      {product.paymentStatus === "가상계좌발급" ? (
        <div className="mt-2 rounded-2xl border border-[#c9dce2] bg-[#eff7f8] px-4 py-3 text-sm font-bold leading-6 text-[#496b74]">
          <p className="font-black">
            {formatVbankBank(product.vbankBank)} {product.vbankNum || "계좌번호 확인 중"}
          </p>
          <p className="mt-0.5 text-xs">
            {product.vbankDue
              ? formatPaymentDue(product.vbankDue)
              : "입금 기한은 결제 내역에서 확인해 주세요."}
          </p>
        </div>
      ) : null}

      {canOpenPayment ? (
        <Button
          size="sm"
          fullWidth
          className="mt-2"
          onClick={onPay}
          disabled={!accountActive || isMutating}
        >
          결제하기
        </Button>
      ) : null}

      {product.portoneStatus === "CANCELLED" ||
      product.portoneStatus === "PARTIAL_CANCELLED" ? (
        <p className="mt-2 rounded-xl bg-[#fff0ea] px-3 py-2 text-xs font-bold leading-5 text-[#9a4f43]">
          취소 상태 확인이 필요합니다. 추가 결제나 배송 전에 운영팀에 문의해 주세요.
        </p>
      ) : null}
    </li>
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
  const [paymentProduct, setPaymentProduct] =
    useState<MemberWonProduct | null>(null);

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
  const currentPaymentProduct = paymentProduct
    ? member.wonProducts.find(
        (product) => product.productId === paymentProduct.productId,
      ) ?? paymentProduct
    : null;
  const effectiveAddressId = member.addresses.some(
    (address) => address.id === selectedAddressId,
  )
    ? selectedAddressId
    : (defaultAddress?.id ?? "");
  const readyProductIds = new Set(
    member.wonProducts
      .filter(
        (product) =>
          product.shippingStatus === "ready" &&
          product.paymentStatus === "결제완료" &&
          product.portoneStatus === "PAID",
      )
      .map((product) => product.productId),
  );
  const storedProducts = member.wonProducts.filter(
    (product) =>
      product.paymentStatus === "결제완료" && product.portoneStatus === "PAID",
  );
  const paymentPendingProducts = member.wonProducts.filter(
    (product) =>
      product.paymentStatus !== "결제완료" || product.portoneStatus !== "PAID",
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

  const completePayment = async (result: ProductPaymentResult) => {
    await member.refresh();
    setPaymentProduct(null);
    setFeedback({
      type: "success",
      message:
        result.paymentStatus === "결제완료"
          ? "결제가 완료되었습니다. 이제 택배 접수를 진행할 수 있습니다."
          : result.paymentStatus === "가상계좌발급"
            ? "가상계좌가 발급되었습니다. 기한 안에 입금해 주세요."
            : "결제 요청을 접수했습니다. 결제 상태를 다시 확인해 주세요.",
    });
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
              낙찰 상품 결제·택배 접수
            </h2>
          </div>
          <span className="text-sm font-bold text-[#718083]">
            Supabase 낙찰 원장 기준 {member.wonProducts.length}건
          </span>
        </div>

        {!accountActive ? (
          <p role="alert" className="mt-4 rounded-2xl bg-[#fff0ea] px-4 py-3 font-bold text-[#a64e42]">
            현재 회원 상태에서는 결제와 택배 접수를 진행할 수 없습니다.
          </p>
        ) : null}

        <section className="mt-6 rounded-[1.5rem] border border-[#ead8c8] bg-[#fff9f3] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black tracking-[0.14em] text-[#a76555]">PAYMENT</p>
              <h3 className="mt-1 text-lg font-black text-[#4f4037]">결제할 낙찰품</h3>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-sm font-black text-[#a76555]">
              {paymentPendingProducts.length}건
            </span>
          </div>
          {paymentPendingProducts.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-[#decfc2] bg-white/70 px-4 py-6 text-center font-bold text-[#7d6d63]">
              현재 결제할 낙찰품이 없습니다.
            </p>
          ) : (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {paymentPendingProducts.map((product) => (
                <WonProductCard
                  key={product.productId}
                  product={product}
                  section="payment"
                  selected={false}
                  accountActive={accountActive}
                  isMutating={member.isMutating}
                  onToggle={() => undefined}
                  onPay={() => {
                    setFeedback(null);
                    setPaymentProduct(product);
                  }}
                />
              ))}
            </ul>
          )}
          <p className="mt-4 text-sm font-bold leading-6 text-[#776456]">
            가상계좌 입금은 웹훅 확인 뒤 자동으로 결제 완료 처리되어 보관함으로 이동합니다.
          </p>
        </section>

        <section className="mt-5 rounded-[1.5rem] border border-[#cfe0dc] bg-[#f3faf7] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black tracking-[0.14em] text-[#477265]">KEEP</p>
              <h3 className="mt-1 text-lg font-black text-[#3f504b]">결제 완료 보관함</h3>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-sm font-black text-[#477265]">
              {storedProducts.length}건
            </span>
          </div>
          {storedProducts.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-[#cbdadb] bg-white/70 px-4 py-6 text-center font-bold text-[#718083]">
              결제 완료 후 보관 중인 상품이 없습니다.
            </p>
          ) : (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {storedProducts.map((product) => (
                <WonProductCard
                  key={product.productId}
                  product={product}
                  section="storage"
                  selected={
                    product.shippingStatus === "ready" &&
                    selectedProductIds.has(product.productId)
                  }
                  accountActive={accountActive}
                  isMutating={member.isMutating}
                  onToggle={() => toggleProduct(product.productId)}
                  onPay={() => undefined}
                />
              ))}
            </ul>
          )}
        </section>

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

        <div className="mt-5 rounded-2xl border-2 border-[#b7d7e1] bg-[#eaf6fa] px-5 py-4 shadow-sm">
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

        <Button
          size="lg"
          fullWidth
          className="mt-3"
          onClick={() => void requestShipping()}
          disabled={!canRequestShipping}
          isLoading={member.isMutating}
        >
          {member.isMutating
            ? "택배 접수 중..."
            : `선택 상품 택배 접수하기 (${effectiveSelectedIds.length}개)`}
        </Button>

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
      {currentPaymentProduct ? (
        <ProductPaymentModal
          key={`${currentPaymentProduct.productId}:${currentPaymentProduct.paymentId ?? "new"}:${currentPaymentProduct.portoneStatus ?? "none"}`}
          product={currentPaymentProduct}
          onClose={() => setPaymentProduct(null)}
          onCompleted={completePayment}
          onRefresh={member.refresh}
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
  onProfileRefresh,
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
          <NicknameSettingsPanel
            key={`nickname-${userId}`}
            userId={userId}
            onChanged={onProfileRefresh ?? (() => undefined)}
          />
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
