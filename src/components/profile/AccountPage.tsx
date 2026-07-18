"use client";

/* eslint-disable @next/next/no-img-element -- Supabase Storage/Kakao 이미지 URL을 표시합니다. */
import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";
import type { Role } from "@/src/types/auction";
import { Button, Modal } from "@/src/components/common";
import { MemberSecurityLogPanel } from "@/src/components/security/MemberSecurityLogPanel";
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
import {
  beginManualBankTransfer,
  type BegunManualTransfer,
} from "@/src/lib/supabase/manualPayments";
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

interface RuntimePaymentProjection {
  activePaymentMode: "manual_transfer" | "portone";
  manualTransferRequestedAt: string | null;
  isPaymentSettled: boolean;
}

function getRuntimePaymentProjection(
  product: MemberWonProduct,
): RuntimePaymentProjection {
  const projected = product as MemberWonProduct &
    Partial<RuntimePaymentProjection>;
  return {
    // The production migration supplies all three fields. Defaults keep an
    // in-flight client fail-closed on the manual screen during rolling deploys.
    activePaymentMode: projected.activePaymentMode ?? "manual_transfer",
    manualTransferRequestedAt:
      projected.manualTransferRequestedAt ?? null,
    isPaymentSettled:
      typeof projected.isPaymentSettled === "boolean"
        ? projected.isPaymentSettled
        : product.paymentStatus === "결제완료" &&
          product.portoneStatus === "PAID",
  };
}

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
      <form onSubmit={handleDelete} className="space-y-4 p-5 sm:p-6">
        <div className="flex gap-3 rounded-xl border border-[var(--danger-text)]/25 bg-[var(--danger-surface)] px-4 py-3 text-sm font-medium leading-6 text-[var(--danger-text)]">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            className="mt-0.5 size-5 shrink-0"
          >
            <path d="M12 8v5m0 3.25v.05M10.3 4.4 2.8 17.2A1.2 1.2 0 0 0 3.84 19h16.32a1.2 1.2 0 0 0 1.04-1.8L13.7 4.4a1.98 1.98 0 0 0-3.4 0Z" />
          </svg>
          <p>
          관계 법령상 보관 의무가 있는 거래 기록을 제외한 회원 정보는 탈퇴 처리와 함께
          삭제됩니다. 계속하려면 아래에 <strong>탈퇴</strong>를 입력하세요.
          </p>
        </div>
        <label className="block text-xs font-semibold tracking-wide text-[var(--text-strong)]">
          확인 문구
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="탈퇴"
            className="mt-2 min-h-11 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--input-surface)] px-3 text-sm font-medium text-[var(--text-strong)] outline-none transition-all duration-200 ease-out placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus-ring)]/20"
            disabled={isDeleting}
          />
        </label>
        {error ? (
          <p role="alert" className="rounded-lg bg-[var(--danger-surface)] px-3 py-2 text-sm font-semibold text-[var(--danger-text)]">
            {error}
          </p>
        ) : null}
        <div className="sticky bottom-0 -mx-5 flex flex-col-reverse gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-5 pb-[max(0px,env(safe-area-inset-bottom))] pt-4 sm:static sm:mx-0 sm:flex-row sm:justify-end sm:bg-transparent sm:px-0 sm:pb-0">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isDeleting}>
            취소
          </Button>
          <Button type="submit" variant="danger" disabled={confirmation !== "탈퇴"} isLoading={isDeleting}>
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
    <details className="theme-panel group mt-5 rounded-2xl border px-5 py-4 shadow-sm transition-all duration-200 ease-out open:shadow-md sm:px-7">
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent-surface)] [&::-webkit-details-marker]:hidden">
        <div>
          <p className="text-[10px] font-bold tracking-[0.2em] text-[var(--accent-text)]">
            KAKAO VERIFIED PROFILE
          </p>
          <h3 className="mt-1.5 text-lg font-semibold tracking-tight text-[var(--text-strong)]">
            카카오 회원 정보
          </h3>
          <p className="mt-1.5 break-keep text-sm font-medium leading-6 text-[var(--text-muted)]">
            회원 식별·고객 지원과 연령·성별 기반 서비스 운영에 사용되는 본인 정보입니다.
          </p>
        </div>
        <span className="flex items-center gap-2">
          <span
            className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold ${
              profile?.profileComplete
                ? "border-[var(--success-text)]/20 bg-[var(--success-surface)] text-[var(--success-text)]"
                : "border-[var(--warning-text)]/20 bg-[var(--warning-surface)] text-[var(--warning-text)]"
            }`}
          >
            {profile?.profileComplete ? "필수 정보 확인 완료" : "정보 확인 대기"}
          </span>
          <span aria-hidden="true" className="text-lg font-semibold text-[var(--text-muted)] transition-transform duration-200 group-open:rotate-180">⌄</span>
        </span>
      </summary>

      {status === "loading" ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-3" role="status" aria-label="카카오 회원 정보를 확인하고 있어요">
          {Array.from({ length: 3 }, (_, index) => (
            <span key={index} className="commerce-skeleton h-[4.5rem] rounded-xl" />
          ))}
        </div>
      ) : status === "error" ? (
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-[var(--danger-text)]/20 bg-[var(--danger-surface)] px-4 py-3" role="alert">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="mt-0.5 size-5 shrink-0 text-[var(--danger-text)]"><path d="M12 8v4m0 4h.01M10.3 4.4 2.8 17.2A1.2 1.2 0 0 0 3.84 19h16.32a1.2 1.2 0 0 0 1.04-1.8L13.7 4.4a1.98 1.98 0 0 0-3.4 0Z" /></svg>
          <p className="text-sm font-medium leading-6 text-[var(--danger-text)]">회원 정보를 불러오지 못했습니다. 잠시 후 다시 로그인해 주세요.</p>
        </div>
      ) : (
        <dl className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
            <dt className="text-[10px] font-semibold tracking-wide text-[var(--text-muted)]">이름</dt>
            <dd className="mt-1 text-sm font-semibold text-[var(--text-strong)]">
              {profile?.fullName || "심사 승인 후 제공"}
            </dd>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
            <dt className="text-[10px] font-semibold tracking-wide text-[var(--text-muted)]">성별</dt>
            <dd className="mt-1 text-sm font-semibold text-[var(--text-strong)]">
              {profile?.gender ? genderLabel[profile.gender] : "심사 승인 후 제공"}
            </dd>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3">
            <dt className="text-[10px] font-semibold tracking-wide text-[var(--text-muted)]">출생연도</dt>
            <dd className="mt-1 font-mono text-sm font-semibold tabular-nums tracking-tight text-[var(--text-strong)]">
              {profile?.birthYear ? `${profile.birthYear}년` : "심사 승인 후 제공"}
            </dd>
          </div>
        </dl>
      )}

      <p className="mt-4 text-xs font-medium leading-5 text-[var(--text-muted)]">
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
  const [postalCode, setPostalCode] = useState(address?.postalCode ?? "");
  const [streetAddress, setStreetAddress] = useState(address?.address ?? "");
  const [isDefault, setIsDefault] = useState(
    forceDefault || Boolean(address?.isDefault),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const normalizedPostalCode = postalCode.trim();
    if (!/^\d{5}$/.test(normalizedPostalCode)) {
      setError("우편번호는 숫자 5자리로 입력해 주세요.");
      return;
    }

    setIsSubmitting(true);

    try {
      await onSave({
        id: address?.id ?? null,
        label,
        recipientName,
        phone,
        postalCode: normalizedPostalCode,
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
    "mt-2 min-h-11 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--input-surface)] px-3 py-2.5 text-sm font-medium text-[var(--text-strong)] outline-none transition-all duration-200 ease-out placeholder:font-normal placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus-ring)]/20 disabled:cursor-not-allowed disabled:opacity-60";

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
        <label className="block text-xs font-semibold tracking-wide text-[var(--text-strong)]">
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
        <label className="block text-xs font-semibold tracking-wide text-[var(--text-strong)]">
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
        <label className="block text-xs font-semibold tracking-wide text-[var(--text-strong)]">
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
        <label className="block text-xs font-semibold tracking-wide text-[var(--text-strong)]">
          우편번호 <span className="text-[var(--accent-text)]">(필수)</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{5}"
            value={postalCode}
            onChange={(event) =>
              setPostalCode(event.target.value.replace(/\D/g, "").slice(0, 5))
            }
            autoComplete="postal-code"
            minLength={5}
            maxLength={5}
            placeholder="5자리 우편번호"
            aria-describedby="shipping-postal-code-help"
            required
            disabled={isSubmitting}
            className={inputClasses}
          />
          <span
            id="shipping-postal-code-help"
            className="mt-1.5 block text-[11px] font-medium normal-case tracking-normal text-[var(--text-muted)]"
          >
            택배 접수에 필요한 숫자 5자리 우편번호를 입력해 주세요.
          </span>
        </label>
        <label className="block text-xs font-semibold tracking-wide text-[var(--text-strong)]">
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
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2.5 text-sm font-medium text-[var(--text-strong)] transition-all duration-200 ease-out hover:border-[var(--border-strong)]">
          <input
            type="checkbox"
            checked={forceDefault || isDefault}
            onChange={(event) => setIsDefault(event.target.checked)}
            disabled={forceDefault || isSubmitting}
            className="size-4 accent-[var(--accent)]"
          />
          기본 배송지로 사용
        </label>

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-[var(--danger-text)]/20 bg-[var(--danger-surface)] px-4 py-3 text-sm font-semibold leading-6 text-[var(--danger-text)]"
          >
            {error}
          </p>
        ) : null}

        <div className="sticky bottom-0 -mx-5 flex flex-col-reverse gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-5 pb-[max(0px,env(safe-area-inset-bottom))] pt-4 sm:static sm:mx-0 sm:flex-row sm:justify-end sm:bg-transparent sm:px-0 sm:pb-0">
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

/**
 * PG 계약 후 active_payment_mode를 portone으로 변경하면 다시 사용할
 * 기존 PortOne V2 결제창입니다. manual_transfer 모드에서는 절대 호출하지
 * 않고 서버 라우트도 동일한 전역 스위치로 차단됩니다.
 */
function PortOnePaymentModal({
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
        <div className="flex gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3">
          {product.imageUrls[0] ? (
            <img
              src={product.imageUrls[0]}
              alt=""
              className="size-20 shrink-0 rounded-lg bg-[var(--surface-raised)] object-cover"
            />
          ) : (
            <span className="grid size-20 shrink-0 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)]">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-6"><path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11Z" /><path d="m5 16 4.2-4.2 3.1 3.1 2.2-2.2L19 17M15.7 8.5h.01" /></svg>
            </span>
          )}
          <div className="min-w-0">
            <strong className="line-clamp-2 block text-sm font-semibold leading-5 text-[var(--text-strong)]">
              {product.title}
            </strong>
            <span className="mt-2 block font-mono text-xl font-semibold tabular-nums tracking-tight text-[var(--accent-text)]">
              {formatKRW(product.finalBidAmount)}
            </span>
            <span className="mt-1 block text-[11px] font-medium text-[var(--text-muted)]">
              최종 낙찰 금액
            </span>
          </div>
        </div>

        <fieldset disabled={isSubmitting}>
          <legend className="text-xs font-semibold tracking-wide text-[var(--text-strong)]">
            결제 수단 선택
          </legend>
          <div className="mt-3 grid gap-2">
            {paymentMethodOptions.map((option) => {
              const selected = option.value === payMethod;
              return (
                <label
                  key={option.value}
                  className={
                    "flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition-all duration-200 ease-out hover:scale-[1.01] " +
                    (selected
                      ? "border-[var(--accent)] bg-[var(--accent-surface)] shadow-sm"
                      : "border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--border-strong)]")
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
                    className="size-4 shrink-0 accent-[var(--accent)]"
                  />
                  <span
                    aria-hidden="true"
                    className={
                      "grid size-9 shrink-0 place-items-center rounded-lg text-sm font-semibold " +
                      (selected
                        ? "bg-[var(--accent)] text-white"
                        : "bg-[var(--surface-muted)] text-[var(--text-muted)]")
                    }
                  >
                    {option.icon}
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-sm font-semibold text-[var(--text-strong)]">
                      {option.label}
                    </strong>
                    <span className="mt-0.5 block break-keep text-xs font-medium leading-5 text-[var(--text-muted)]">
                      {option.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <p className="rounded-xl border border-[var(--info-border)] bg-[var(--info-surface)] px-4 py-3 text-xs font-medium leading-5 text-[var(--info-text)]">
          현재 포트원 V2 테스트 환경입니다. 실제 청구 전환은 PG 심사와 운영 채널
          설정을 마친 뒤 진행합니다.
        </p>

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-[var(--danger-text)]/20 bg-[var(--danger-surface)] px-4 py-3 text-sm font-semibold leading-6 text-[var(--danger-text)]"
          >
            {error}
          </p>
        ) : null}

        <div className="sticky bottom-0 -mx-5 flex flex-col-reverse gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-5 pb-[max(0px,env(safe-area-inset-bottom))] pt-4 sm:static sm:mx-0 sm:flex-row sm:justify-end sm:bg-transparent sm:px-0 sm:pb-0">
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

function ManualTransferPaymentModal({
  product,
  onClose,
  onStarted,
}: {
  product: MemberWonProduct;
  onClose: () => void;
  onStarted: () => Promise<void>;
}) {
  const [transfer, setTransfer] = useState<BegunManualTransfer | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState("");
  const [error, setError] = useState("");

  const revealAccount = async () => {
    if (isRevealing) return;
    setIsRevealing(true);
    setError("");
    setCopyFeedback("");
    try {
      const result = await beginManualBankTransfer(product.productId);
      setTransfer(result);
      try {
        await onStarted();
      } catch {
        // The server already created the transfer and returned the account.
        // Keep it visible even if the background account refresh is delayed.
      }
    } catch (transferError) {
      setError(
        getErrorMessage(transferError, "입금 계좌를 확인하지 못했습니다."),
      );
    } finally {
      setIsRevealing(false);
    }
  };

  const copyAccount = async () => {
    if (!transfer) return;
    try {
      await navigator.clipboard.writeText(transfer.accountNumber);
      setCopyFeedback("계좌번호를 복사했습니다.");
    } catch {
      setCopyFeedback("자동 복사가 어렵습니다. 계좌번호를 길게 눌러 복사해 주세요.");
    }
  };

  const amount = transfer?.expectedAmount ?? product.finalBidAmount;

  return (
    <Modal
      open
      onClose={() => {
        if (!isRevealing) onClose();
      }}
      closeOnBackdrop={!isRevealing}
      title="낙찰 상품 결제"
      description="계좌를 확인한 후 입금하면 운영자가 실제 통장 내역을 대조합니다."
      size="sm"
    >
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
          {product.imageUrls[0] ? (
            <img
              src={product.imageUrls[0]}
              alt=""
              className="size-20 shrink-0 rounded-xl bg-[var(--surface-raised)] object-cover"
            />
          ) : (
            <span className="grid size-20 shrink-0 place-items-center rounded-xl bg-[var(--surface-raised)] text-xs font-bold text-[var(--text-muted)]">
              사진 없음
            </span>
          )}
          <div className="min-w-0">
            <strong className="line-clamp-2 block text-sm font-semibold leading-5 text-[var(--text-strong)]">
              {product.title}
            </strong>
            <span className="mt-2 block font-mono text-2xl font-semibold tabular-nums tracking-tight text-[var(--accent-text)]">
              {formatKRW(amount)}
            </span>
            <span className="mt-1 block text-xs font-bold text-[var(--text-muted)]">
              입금할 최종 낙찰 금액
            </span>
          </div>
        </div>

        {!transfer ? (
          <div className="rounded-2xl border border-[var(--info-border)] bg-[var(--info-surface)] px-4 py-4">
            <p className="text-sm font-semibold text-[var(--info-text)]">
              계좌번호는 아래 버튼을 누른 후에 표시됩니다.
            </p>
            <p className="mt-1 break-keep text-xs font-bold leading-5 text-[var(--text-muted)]">
              버튼을 누르면 입금 진행 중으로 접수되고 운영자 확인 목록에
              즉시 표시됩니다.
            </p>
          </div>
        ) : (
          <section className="rounded-2xl border-2 border-[var(--accent)] bg-[var(--accent-surface)] p-5 text-center" aria-label="입금 계좌">
            <p className="text-xs font-semibold tracking-wide text-[var(--accent-text)]">
              {transfer.bankName}
            </p>
            <p className="mt-2 select-all break-all font-mono text-2xl font-semibold tabular-nums tracking-tight text-[var(--text-strong)] sm:text-3xl">
              {transfer.accountNumber}
            </p>
            <Button size="sm" variant="ghost" className="mt-3" onClick={() => void copyAccount()}>
              계좌번호 복사
            </Button>
            <p className="mt-3 font-mono text-sm font-semibold tabular-nums tracking-tight text-[var(--warning-text)]">
              정확히 {formatKRW(transfer.expectedAmount)}을 입금해 주세요.
            </p>
            <p className="mt-1 text-xs font-bold leading-5 text-[var(--text-muted)]">
              입금 후 운영자가 확정하면 결제 완료 보관함으로 자동 이동합니다.
            </p>
          </section>
        )}

        {copyFeedback ? (
          <p role="status" className="rounded-xl bg-[var(--success-surface)] px-3 py-2 text-sm font-bold text-[var(--success-text)]">
            {copyFeedback}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-2xl border border-[var(--danger-text)]/25 bg-[var(--danger-surface)] px-4 py-3 text-sm font-bold leading-6 text-[var(--danger-text)]">
            {error}
          </p>
        ) : null}

        <div className="sticky bottom-0 -mx-5 flex flex-col-reverse gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-5 pb-[max(0px,env(safe-area-inset-bottom))] pt-4 sm:static sm:mx-0 sm:flex-row sm:justify-end sm:bg-transparent sm:px-0 sm:pb-0">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isRevealing}>
            닫기
          </Button>
          {!transfer ? (
            <Button onClick={() => void revealAccount()} isLoading={isRevealing}>
              {isRevealing ? "입금 계좌 확인 중..." : "계좌번호 보기"}
            </Button>
          ) : null}
        </div>
      </div>
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
  const paymentProjection = getRuntimePaymentProjection(product);
  const paid = paymentProjection.isPaymentSettled;
  const isManualMode = paymentProjection.activePaymentMode === "manual_transfer";
  const manualTransferStarted = Boolean(
    paymentProjection.manualTransferRequestedAt,
  );
  const ready = section === "storage" && product.shippingStatus === "ready" && paid;
  const paymentMethod = isManualMode
    ? null
    : formatPaymentMethod(product.paymentMethod);
  const paymentLabel = paid
    ? "결제 완료"
    : isManualMode
      ? manualTransferStarted
        ? "입금 진행 중"
        : "결제 대기"
      : product.portoneStatus === "FAILED"
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
    !paid &&
    (isManualMode || product.portoneStatus !== "CANCELLED");

  return (
    <li>
      <div
        className={`flex h-full gap-3 rounded-xl border p-3 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-sm ${
          selected
            ? "border-[var(--accent)] bg-[var(--accent-surface)] ring-2 ring-[var(--accent)]/15"
            : ready
              ? "border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--border-strong)]"
              : "border-[var(--border)] bg-[var(--surface-muted)]"
        }`}
      >
        {section === "storage" ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            disabled={!ready || isMutating}
            className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
            aria-label={`${product.title} 택배 접수 선택`}
          />
        ) : null}
        {product.imageUrls[0] ? (
          <img
            src={product.imageUrls[0]}
            alt=""
            className="size-20 shrink-0 rounded-lg bg-[var(--surface-muted)] object-cover"
          />
        ) : (
          <span className="grid size-20 shrink-0 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)]">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-6"><path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11Z" /><path d="m5 16 4.2-4.2 3.1 3.1 2.2-2.2L19 17M15.7 8.5h.01" /></svg>
          </span>
        )}
        <span className="min-w-0">
          <strong className="line-clamp-2 block text-sm font-semibold leading-5 text-[var(--text-strong)]">
            {product.title}
          </strong>
          <span className="mt-1 block font-mono text-sm font-semibold tabular-nums tracking-tight text-[var(--accent-text)]">
            {formatKRW(product.finalBidAmount)}
          </span>
          <span className="mt-1 block font-mono text-[11px] font-medium tabular-nums tracking-tight text-[var(--text-muted)]">
            {formatClosedAt(product.closedAt)}
          </span>
          {section === "storage" ? (
            <span className="mt-1 block text-xs font-semibold text-[var(--success-text)]">
              {shippingStatusLabel[product.shippingStatus]}
            </span>
          ) : null}
          <span
            className={
              "mt-2 inline-flex rounded-md border px-2 py-1 text-[10px] font-semibold tracking-wide " +
              (paid
                ? "border-[var(--success-text)]/20 bg-[var(--success-surface)] text-[var(--success-text)]"
                : (isManualMode
                    ? manualTransferStarted
                    : product.paymentStatus === "가상계좌발급")
                  ? "border-[var(--info-text)]/20 bg-[var(--info-surface)] text-[var(--info-text)]"
                  : "border-[var(--warning-text)]/20 bg-[var(--warning-surface)] text-[var(--warning-text)]")
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

      {paymentProjection.activePaymentMode === "portone" &&
      product.paymentStatus === "가상계좌발급" ? (
        <div className="mt-2 rounded-xl border border-[var(--info-border)] bg-[var(--info-surface)] px-4 py-3 text-sm font-medium leading-6 text-[var(--info-text)]">
          <p className="font-mono font-semibold tabular-nums tracking-tight">
            {formatVbankBank(product.vbankBank)} {product.vbankNum || "계좌번호 확인 중"}
          </p>
          <p className="mt-0.5 font-mono text-xs tabular-nums tracking-tight">
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
          {isManualMode && manualTransferStarted ? "계좌번호 보기" : "결제하기"}
        </Button>
      ) : null}

      {paymentProjection.activePaymentMode === "portone" &&
      (product.portoneStatus === "CANCELLED" ||
        product.portoneStatus === "PARTIAL_CANCELLED") ? (
        <p className="mt-2 rounded-lg border border-[var(--danger-text)]/20 bg-[var(--danger-surface)] px-3 py-2 text-xs font-medium leading-5 text-[var(--danger-text)]">
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
        className="theme-panel mt-5 rounded-2xl border p-5 shadow-sm"
        role="status"
        aria-label="실제 배송 정보와 낙찰 상품을 불러오고 있어요"
      >
        <div className="commerce-skeleton h-16 rounded-xl" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="commerce-skeleton h-44 rounded-xl" />
          <div className="commerce-skeleton h-44 rounded-xl" />
        </div>
      </section>
    );
  }

  if (!member.account) {
    return (
      <section className="theme-panel mt-5 rounded-2xl border px-6 py-8 text-center shadow-sm">
        <span aria-hidden="true" className="commerce-empty-icon mx-auto text-[var(--danger-text)]"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-5"><path d="M12 8v4m0 4h.01M10.3 4.4 2.8 17.2A1.2 1.2 0 0 0 3.84 19h16.32a1.2 1.2 0 0 0 1.04-1.8L13.7 4.4a1.98 1.98 0 0 0-3.4 0Z" /></svg></span>
        <p role="alert" className="mt-3 text-sm font-semibold leading-6 text-[var(--danger-text)]">
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
  const effectiveAddress =
    member.addresses.find((address) => address.id === effectiveAddressId) ?? null;
  const readyProductIds = new Set(
    member.wonProducts
      .filter(
        (product) =>
          product.shippingStatus === "ready" &&
          getRuntimePaymentProjection(product).isPaymentSettled,
      )
      .map((product) => product.productId),
  );
  const storedProducts = member.wonProducts.filter(
    (product) => getRuntimePaymentProjection(product).isPaymentSettled,
  );
  const paymentPendingProducts = member.wonProducts.filter(
    (product) => !getRuntimePaymentProjection(product).isPaymentSettled,
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
    Boolean(effectiveAddress?.postalCode) &&
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
        postalCode: address.postalCode ?? "",
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

  const markManualTransferStarted = async () => {
    await member.refresh();
    setFeedback({
      type: "success",
      message:
        "입금 계좌를 확인했습니다. 입금 후 운영자가 확정하면 결제 완료 보관함으로 이동합니다.",
    });
  };

  return (
    <div className="mt-5 space-y-5">
      {member.error ? (
        <p
          role="alert"
          className="rounded-xl border border-[var(--danger-text)]/20 bg-[var(--danger-surface)] px-4 py-3 text-sm font-semibold text-[var(--danger-text)]"
        >
          {member.error}
        </p>
      ) : null}

      <section className="theme-panel overflow-hidden rounded-2xl border shadow-sm">
        <button
          type="button"
          aria-expanded={isAddressOpen}
          aria-controls={accordionId}
          onClick={() => setIsAddressOpen((current) => !current)}
          className="flex min-h-20 w-full items-center justify-between gap-4 px-5 py-4 text-left transition-all duration-200 ease-out hover:bg-[var(--surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] sm:px-7"
        >
          <span>
            <span className="block text-[10px] font-bold tracking-[0.2em] text-[var(--accent-text)]">
              DELIVERY ADDRESS
            </span>
            <strong className="mt-1 block text-lg font-semibold tracking-tight text-[var(--text-strong)]">
              배송지 관리
            </strong>
            <span className="mt-1 block text-xs font-medium text-[var(--text-muted)]">
              실제 등록 배송지 <span className="font-mono tabular-nums tracking-tight">{member.addresses.length}</span>곳
              {defaultAddress ? ` · 기본 ${defaultAddress.label}` : " · 기본 배송지 없음"}
            </span>
          </span>
          <span
            aria-hidden="true"
            className={`grid size-9 shrink-0 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] text-base font-semibold text-[var(--text-muted)] transition-transform duration-200 ${
              isAddressOpen ? "rotate-180" : "rotate-0"
            }`}
          >
            ⌄
          </span>
        </button>

        <div id={accordionId} hidden={!isAddressOpen}>
          <div className="border-t border-[var(--border)] px-5 py-5 sm:px-7 sm:py-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium leading-6 text-[var(--text-muted)]">
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
              <div className="mt-5 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)] px-5 py-8 text-center">
                <span aria-hidden="true" className="commerce-empty-icon mx-auto">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-5"><path d="m3.5 10.5 8.5-7 8.5 7M5.5 9v10h13V9M9.5 19v-5.5h5V19" /></svg>
                </span>
                <p className="mt-3 text-sm font-medium text-[var(--text-muted)]">등록된 배송지가 없습니다.</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">택배 접수 전에 실제 주소를 추가해 주세요.</p>
              </div>
            ) : (
              <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                {member.addresses.map((address) => (
                  <li
                    key={address.id}
                    className={`rounded-xl border p-4 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-sm ${
                      address.isDefault
                        ? "border-[var(--accent-text)]/30 bg-[var(--accent-surface)]"
                        : "border-[var(--border)] bg-[var(--surface-raised)] hover:border-[var(--border-strong)]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <strong className="text-sm font-semibold text-[var(--text-strong)]">
                        {address.label}
                      </strong>
                      {address.isDefault ? (
                        <span className="rounded-md bg-[var(--accent)] px-2 py-1 text-[10px] font-semibold tracking-wide text-[var(--accent-contrast)]">
                          기본
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3 text-sm font-medium text-[var(--text-strong)]">
                      {address.recipientName} · <span className="font-mono tabular-nums tracking-tight">{address.phone}</span>
                    </p>
                    <p className="mt-1 break-words text-sm font-normal leading-6 text-[var(--text-muted)]">
                      {address.postalCode ? <span className="font-mono tabular-nums tracking-tight">[{address.postalCode}] </span> : ""}
                      {address.address}
                    </p>
                    {!address.postalCode ? (
                      <p className="mt-2 text-xs font-semibold text-[var(--danger-text)]">
                        택배 접수 전에 수정 버튼에서 5자리 우편번호를 입력해 주세요.
                      </p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
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

      <section className="theme-panel rounded-2xl border p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-bold tracking-[0.2em] text-[var(--info-text)]">
              WON &amp; KEEP
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-[var(--text-strong)] sm:text-2xl">
              낙찰 상품 결제·택배 접수
            </h2>
          </div>
          <span className="text-xs font-medium text-[var(--text-muted)]">
            낙찰 원장 <span className="font-mono tabular-nums tracking-tight">{member.wonProducts.length}</span>건
          </span>
        </div>

        {!accountActive ? (
          <p role="alert" className="mt-4 rounded-xl border border-[var(--danger-text)]/20 bg-[var(--danger-surface)] px-4 py-3 text-sm font-semibold text-[var(--danger-text)]">
            현재 회원 상태에서는 결제와 택배 접수를 진행할 수 없습니다.
          </p>
        ) : null}

        <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold tracking-[0.18em] text-[var(--accent-text)]">PAYMENT</p>
              <h3 className="mt-1 text-lg font-semibold tracking-tight text-[var(--text-strong)]">결제할 낙찰품</h3>
            </div>
            <span className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1 font-mono text-xs font-semibold tabular-nums tracking-tight text-[var(--accent-text)]">
              {paymentPendingProducts.length}건
            </span>
          </div>
          {paymentPendingProducts.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)] px-4 py-6 text-center">
              <span aria-hidden="true" className="commerce-empty-icon mx-auto">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-5"><path d="M4 7.5h16v11H4zM7 7.5V5.8h10v1.7M4 11h16M8 15h3" /></svg>
              </span>
              <p className="mt-2 text-sm font-medium text-[var(--text-muted)]">현재 결제할 낙찰품이 없습니다.</p>
            </div>
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
          <p className="mt-4 text-xs font-medium leading-5 text-[var(--text-muted)]">
            계좌이체 입금은 운영자가 실제 통장 내역을 확인한 뒤 결제 완료로
            처리되어 보관함으로 이동합니다.
          </p>
        </section>

        <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold tracking-[0.18em] text-[var(--success-text)]">ARCHIVE</p>
              <h3 className="mt-1 text-lg font-semibold tracking-tight text-[var(--text-strong)]">결제 완료 보관함</h3>
            </div>
            <span className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1 font-mono text-xs font-semibold tabular-nums tracking-tight text-[var(--success-text)]">
              {storedProducts.length}건
            </span>
          </div>
          {storedProducts.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)] px-4 py-6 text-center">
              <span aria-hidden="true" className="commerce-empty-icon mx-auto">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-5"><path d="M4.5 7.5h15v12h-15zM3.5 4.5h17v3h-17zM9 11.5h6" /></svg>
              </span>
              <p className="mt-2 text-sm font-medium text-[var(--text-muted)]">결제 완료 후 보관 중인 상품이 없습니다.</p>
            </div>
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

        <label className="mt-5 block text-xs font-semibold text-[var(--text-strong)]">
          택배를 받을 배송지
          <select
            value={effectiveAddressId}
            onChange={(event) => setSelectedAddressId(event.target.value)}
            disabled={member.addresses.length === 0 || member.isMutating}
            className="mt-2 min-h-11 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 text-sm font-medium text-[var(--text-strong)] outline-none transition-all duration-200 focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 disabled:opacity-60"
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

        {effectiveAddressId && !effectiveAddress?.postalCode ? (
          <p role="alert" className="mt-3 rounded-xl border border-[var(--danger-text)]/20 bg-[var(--danger-surface)] px-4 py-3 text-sm font-semibold text-[var(--danger-text)]">
            선택한 기존 배송지에 우편번호가 없습니다. 배송지를 수정한 뒤 택배를 접수해 주세요.
          </p>
        ) : null}

        <div className="mt-5 rounded-xl border border-[var(--info-border)] bg-[var(--info-surface)] px-4 py-3">
          <p className="text-sm font-semibold text-[var(--info-text)]">
            택배 가능 횟수 {" "}
            <strong className="font-mono tabular-nums tracking-tight text-[var(--accent-text)]">
              {member.account.shippingCreditCount}회
            </strong>
          </p>
          <p className="mt-1 text-xs font-medium leading-5 text-[var(--text-muted)]">
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
          {member.isMutating ? (
            "택배 접수 중..."
          ) : (
            <>
              선택 상품 택배 접수하기
              <span className="font-mono tabular-nums tracking-tight">({effectiveSelectedIds.length}개)</span>
            </>
          )}
        </Button>

        {feedback ? (
          <p
            role={feedback.type === "error" ? "alert" : "status"}
            className={`mt-4 rounded-xl border px-4 py-3 text-sm font-semibold ${
              feedback.type === "error"
                ? "border-[var(--danger-text)]/20 bg-[var(--danger-surface)] text-[var(--danger-text)]"
                : "border-[var(--success-text)]/20 bg-[var(--success-surface)] text-[var(--success-text)]"
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
        getRuntimePaymentProjection(currentPaymentProduct).activePaymentMode ===
        "portone" ? (
          <PortOnePaymentModal
            key={`${currentPaymentProduct.productId}:${currentPaymentProduct.paymentId ?? "new"}:${currentPaymentProduct.portoneStatus ?? "none"}`}
            product={currentPaymentProduct}
            onClose={() => setPaymentProduct(null)}
            onCompleted={completePayment}
            onRefresh={member.refresh}
          />
        ) : (
          <ManualTransferPaymentModal
            key={currentPaymentProduct.productId}
            product={currentPaymentProduct}
            onClose={() => setPaymentProduct(null)}
            onStarted={markManualTransferStarted}
          />
        )
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
        <section className="theme-panel rounded-2xl border px-6 py-14 text-center shadow-[0_22px_60px_rgba(15,23,42,0.08)] sm:px-10">
          <span className="mx-auto grid size-12 place-items-center rounded-xl bg-[#fee500] text-lg font-semibold text-[#191919] shadow-sm" aria-hidden="true">
            K
          </span>
          <p className="mt-5 text-[10px] font-bold tracking-[0.2em] text-[var(--text-muted)]">MEMBER ACCESS</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--text-strong)]">
            내 정보를 보려면 로그인해 주세요
          </h2>
          <p className="mx-auto mt-3 max-w-lg break-keep text-sm font-medium leading-6 text-[var(--text-muted)]">
            카카오 계정으로 가입과 로그인을 한 번에 진행할 수 있습니다.
          </p>
          <Button size="lg" className="mt-6" onClick={onSignIn}>
            카카오로 시작하기
          </Button>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:pb-12">
      <section className="theme-panel overflow-hidden rounded-2xl border shadow-[0_22px_60px_rgba(15,23,42,0.07)]">
        <div className="border-b border-[var(--border)] bg-[var(--surface-raised)] px-5 py-6 sm:px-8 sm:py-7">
          <p className="text-[10px] font-bold tracking-[0.2em] text-[var(--accent-text)]">
            MY ACCOUNT
          </p>
          <div className="mt-4 flex items-center gap-4">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className="size-12 rounded-xl border border-[var(--border)] object-cover shadow-sm"
              />
            ) : (
              <span className="grid size-12 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-lg font-semibold text-[var(--accent-text)] shadow-sm" aria-hidden="true">
                {(displayName || "회").slice(0, 1)}
              </span>
            )}
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-[var(--text-strong)]">
                {displayName || "회원"}
              </h2>
              <span className="mt-1 inline-flex rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] font-semibold text-[var(--success-text)]">본인 인증 완료</span>
            </div>
          </div>
        </div>

        <dl className="grid gap-px bg-[var(--border)] sm:grid-cols-2">
          <div className="bg-[var(--surface)] px-5 py-4 sm:px-8">
            <dt className="text-[10px] font-semibold tracking-wide text-[var(--text-muted)]">로그인 계정</dt>
            <dd className="mt-1 break-all text-sm font-medium text-[var(--text-strong)]">
              {email || "카카오 연결 계정"}
            </dd>
          </div>
          <div className="bg-[var(--surface)] px-5 py-4 sm:px-8">
            <dt className="text-[10px] font-semibold tracking-wide text-[var(--text-muted)]">회원 식별 상태</dt>
            <dd className="mt-1 text-sm font-medium text-[var(--text-strong)]">
              Supabase 인증 완료
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap justify-end gap-2 px-5 py-4 sm:px-8">
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
          <MemberSecurityLogPanel />
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
