"use client";

import * as PortOne from "@portone/browser-sdk/v2";
import { getSupabaseBrowserClient } from "@/src/lib/supabase/client";
import type { ProductPaymentStatus } from "@/src/lib/supabase/memberAccount";
import { createPortOnePaymentId } from "./paymentId";

export { createPortOnePaymentId } from "./paymentId";

export type ProductPaymentMethod = "CARD" | "EASY_PAY" | "VIRTUAL_ACCOUNT";

export interface ProductPaymentResult {
  paymentId: string;
  paymentStatus: ProductPaymentStatus;
  portoneStatus: string | null;
}

interface PreparedPayment {
  storeId: string;
  channelKey: string;
  paymentId: string;
  orderName: string;
  totalAmount: number;
  currency: "KRW";
  customer?: {
    customerId?: string;
    fullName?: string;
    phoneNumber?: string;
    email?: string;
  };
}

interface SyncedPayment {
  paymentStatus: ProductPaymentStatus;
  portoneStatus?: string | null;
}

export class ProductPaymentError extends Error {
  readonly code?: string;

  constructor(message: string, options?: { code?: string; cause?: unknown }) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ProductPaymentError";
    this.code = options?.code;
  }
}

const configuredStoreId = process.env.VITE_PORTONE_STORE_ID?.trim();
const fallbackChannelKey = process.env.VITE_PORTONE_CHANNEL_KEY?.trim();
const configuredWebhookUrl = process.env.VITE_PORTONE_WEBHOOK_URL?.trim();

function configuredChannelKey(payMethod: ProductPaymentMethod): string | undefined {
  const cardChannelKey =
    process.env.VITE_PORTONE_CARD_CHANNEL_KEY?.trim() || fallbackChannelKey;
  if (payMethod === "EASY_PAY") {
    return (
      process.env.VITE_PORTONE_KAKAOPAY_CHANNEL_KEY?.trim() ||
      fallbackChannelKey
    );
  }
  if (payMethod === "VIRTUAL_ACCOUNT") {
    return (
      process.env.VITE_PORTONE_VIRTUAL_ACCOUNT_CHANNEL_KEY?.trim() ||
      cardChannelKey
    );
  }
  return cardChannelKey;
}

const publicApiErrorMessages: Record<string, string> = {
  forbidden: "안전한 결제 요청을 확인하지 못했습니다. 페이지를 새로고침해 주세요.",
  unauthorized: "로그인이 만료되었습니다. 카카오로 다시 로그인해 주세요.",
  payment_not_available:
    "현재 이 낙찰 상품은 결제할 수 없습니다. 낙찰 상태를 다시 확인해 주세요.",
  portone_store_id_invalid:
    "PortOne V2 상점 설정을 확인 중입니다. 운영팀에 문의해 주세요.",
  portone_configuration_missing:
    "결제 서버 설정이 아직 완료되지 않았습니다. 운영팀에 문의해 주세요.",
  portone_preregister_failed:
    "결제 금액 사전 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  portone_payment_lookup_failed:
    "결제사 응답을 확인하지 못했습니다. 결제 내역은 자동으로 다시 확인됩니다.",
  payment_verification_failed:
    "결제 금액 검증에 실패했습니다. 추가 결제를 시도하지 말고 운영팀에 문의해 주세요.",
};

function isValidPaymentId(value: string): boolean {
  return (
    value.length >= 6 &&
    value.length <= 40 &&
    /^[A-Za-z0-9]+$/.test(value)
  );
}

function isPaymentStatus(value: unknown): value is ProductPaymentStatus {
  return (
    value === "대기중" || value === "가상계좌발급" || value === "결제완료"
  );
}

function readApiError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message;
  }
  if (typeof record.error === "string" && record.error.trim()) {
    return publicApiErrorMessages[record.error] ?? fallback;
  }
  if (record.error && typeof record.error === "object") {
    const nestedMessage = (record.error as Record<string, unknown>).message;
    if (typeof nestedMessage === "string" && nestedMessage.trim()) {
      return nestedMessage;
    }
  }
  return fallback;
}

async function getAccessToken(): Promise<string> {
  const { data, error } = await getSupabaseBrowserClient().auth.getSession();
  if (error || !data.session?.access_token) {
    throw new ProductPaymentError("로그인 정보를 확인하지 못했습니다.");
  }
  return data.session.access_token;
}

async function postAuthenticated<T>(
  path: string,
  accessToken: string,
  body: Record<string, unknown>,
  fallbackMessage: string,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify(body),
  });

  let responseBody: unknown = null;
  try {
    responseBody = await response.json();
  } catch {
    // HTML and empty error responses are normalized to the public fallback.
  }

  if (!response.ok) {
    throw new ProductPaymentError(readApiError(responseBody, fallbackMessage));
  }
  return responseBody as T;
}

function validatePreparedPayment(
  value: PreparedPayment,
  expectedPaymentId: string,
  payMethod: ProductPaymentMethod,
): PreparedPayment {
  const expectedChannelKey = configuredChannelKey(payMethod);
  if (
    !value ||
    typeof value.storeId !== "string" ||
    !value.storeId ||
    typeof value.channelKey !== "string" ||
    !value.channelKey ||
    value.paymentId !== expectedPaymentId ||
    typeof value.orderName !== "string" ||
    !value.orderName ||
    !Number.isSafeInteger(value.totalAmount) ||
    value.totalAmount <= 0 ||
    value.currency !== "KRW" ||
    !configuredStoreId ||
    !expectedChannelKey ||
    value.storeId !== configuredStoreId ||
    value.channelKey !== expectedChannelKey
  ) {
    throw new ProductPaymentError("서버의 결제 준비 정보를 확인하지 못했습니다.");
  }
  return value;
}

/**
 * 모바일 리디렉션 복귀와 데스크톱 결제 완료가 함께 사용하는 서버 검증 단계입니다.
 * 결제 상태는 브라우저 응답이 아니라 PortOne 단건 조회 결과로 확정됩니다.
 */
export async function syncProductPayment(
  paymentId: string,
): Promise<ProductPaymentResult> {
  if (!isValidPaymentId(paymentId)) {
    throw new ProductPaymentError("결제 고유 번호가 올바르지 않습니다.");
  }

  const accessToken = await getAccessToken();
  const synced = await postAuthenticated<SyncedPayment>(
    "/api/payments/sync",
    accessToken,
    { paymentId },
    "결제 결과를 확인하지 못했습니다. 결제 내역은 자동으로 다시 확인됩니다.",
  );
  if (!isPaymentStatus(synced.paymentStatus)) {
    throw new ProductPaymentError("서버의 결제 상태를 확인하지 못했습니다.");
  }

  return {
    paymentId,
    paymentStatus: synced.paymentStatus,
    portoneStatus:
      typeof synced.portoneStatus === "string" ? synced.portoneStatus : null,
  };
}

/**
 * 서버가 낙찰자와 결제 금액을 확정한 뒤 PortOne 결제창을 열고, 결제 결과를
 * 다시 서버에서 단건 조회하여 동기화합니다. 브라우저의 금액은 DB 검증에 쓰지
 * 않습니다.
 */
export async function requestProductPayment(input: {
  productId: string;
  payMethod: ProductPaymentMethod;
  paymentId?: string | null;
  /** Owner-only hidden member used by the isolated service test console. */
  testMemberId?: string | null;
}): Promise<ProductPaymentResult> {
  const accessToken = await getAccessToken();
  const paymentId = input.paymentId || createPortOnePaymentId(input.productId);
  if (!isValidPaymentId(paymentId)) {
    throw new ProductPaymentError("결제 고유 번호가 올바르지 않습니다.");
  }
  const prepared = validatePreparedPayment(
    await postAuthenticated<PreparedPayment>(
      "/api/payments/prepare",
      accessToken,
      {
        productId: input.productId,
        paymentId,
        payMethod: input.payMethod,
        ...(input.testMemberId ? { testMemberId: input.testMemberId } : {}),
      },
      "결제를 준비하지 못했습니다.",
    ),
    paymentId,
    input.payMethod,
  );

  let paymentResponse;
  try {
    const redirectUrl = new URL("/payment/complete", window.location.origin);
    redirectUrl.searchParams.set("paymentId", prepared.paymentId);

    paymentResponse = await PortOne.requestPayment({
      storeId: prepared.storeId,
      channelKey: prepared.channelKey,
      paymentId: prepared.paymentId,
      orderName: prepared.orderName,
      totalAmount: prepared.totalAmount,
      currency: prepared.currency,
      payMethod: input.payMethod,
      customer: prepared.customer,
      ...(configuredWebhookUrl ? { noticeUrls: [configuredWebhookUrl] } : {}),
      redirectUrl: redirectUrl.toString(),
      ...(input.payMethod === "EASY_PAY"
        ? { easyPayProvider: "KAKAOPAY" as const }
        : {}),
    });
  } catch (error) {
    try {
      return await syncProductPayment(prepared.paymentId);
    } catch {
      // A checkout may fail before PortOne creates a queryable transaction.
    }
    throw new ProductPaymentError("결제창을 열지 못했습니다. 잠시 후 다시 시도해 주세요.", {
      cause: error,
    });
  }

  if (!paymentResponse) {
    try {
      return await syncProductPayment(prepared.paymentId);
    } catch {
      // Closing before transaction creation has no provider state to sync.
    }
    throw new ProductPaymentError("결제가 취소되었습니다.");
  }
  if (paymentResponse.code) {
    try {
      return await syncProductPayment(prepared.paymentId);
    } catch {
      // Preserve PortOne's user-facing checkout error when lookup is unavailable.
    }
    throw new ProductPaymentError(
      paymentResponse.message || "결제를 완료하지 못했습니다.",
      { code: paymentResponse.code },
    );
  }
  if (paymentResponse.paymentId !== prepared.paymentId) {
    throw new ProductPaymentError("결제 결과의 고유 번호가 일치하지 않습니다.");
  }

  return syncProductPayment(prepared.paymentId);
}
