"use client";

import * as PortOne from "@portone/browser-sdk/v2";
import { getSupabaseBrowserClient } from "@/src/lib/supabase/client";
import type {
  PortOnePaymentStatus,
  ProductPaymentStatus,
} from "@/src/lib/supabase/memberAccount";
import { createPortOnePaymentId } from "./paymentId";
import {
  invokePortOneProductPayment,
  preparedPaymentAction,
  type ProductPaymentMethod,
} from "./paymentInvocation";

export { createPortOnePaymentId } from "./paymentId";
export type {
  PortOnePaymentStatus,
  ProductPaymentStatus,
} from "@/src/lib/supabase/memberAccount";
export type { ProductPaymentMethod } from "./paymentInvocation";
export { COMMERCE_CHECKOUT_STORAGE_KEY } from "@/lib/commerce/checkoutStorage";

export interface ProductPaymentResult {
  paymentId: string;
  paymentStatus: ProductPaymentStatus;
  portoneStatus: PortOnePaymentStatus | null;
  canRetryPayment: boolean;
}

export interface PreparedProductPayment {
  storeId: string;
  channelKey: string;
  paymentId: string;
  orderName: string;
  totalAmount: number;
  currency: "KRW";
  payMethod?: ProductPaymentMethod;
  paymentStatus?: ProductPaymentStatus;
  portoneStatus?: PortOnePaymentStatus | null;
  canRetryPayment?: boolean;
  customer?: {
    customerId?: string;
    fullName?: string;
    phoneNumber?: string;
    email?: string;
  };
}

interface SyncedPayment {
  paymentStatus: ProductPaymentStatus;
  portoneStatus?: PortOnePaymentStatus | null;
  canRetryPayment?: boolean;
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

const configuredWebhookUrl = process.env.VITE_PORTONE_WEBHOOK_URL?.trim();

const publicApiErrorMessages: Record<string, string> = {
  forbidden: "안전한 결제 요청을 확인하지 못했습니다. 페이지를 새로고침해 주세요.",
  unauthorized: "로그인이 만료되었습니다. 카카오로 다시 로그인해 주세요.",
  payment_not_available:
    "현재 이 낙찰 상품은 결제할 수 없습니다. 낙찰 상태를 다시 확인해 주세요.",
  portone_store_id_invalid:
    "PortOne V2 상점 설정을 확인 중입니다. 운영팀에 문의해 주세요.",
  portone_channel_key_invalid:
    "PortOne V2 결제 채널 설정을 확인 중입니다. 운영팀에 문의해 주세요.",
  portone_channel_mode_invalid:
    "PortOne V2 결제 채널 모드 설정을 확인 중입니다. 운영팀에 문의해 주세요.",
  portone_configuration_missing:
    "결제 서버 설정이 아직 완료되지 않았습니다. 운영팀에 문의해 주세요.",
  portone_preregister_failed:
    "결제 금액 사전 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  portone_payment_lookup_failed:
    "결제사 응답을 확인하지 못했습니다. 결제 내역은 자동으로 다시 확인됩니다.",
  payment_verification_failed:
    "결제 금액 검증에 실패했습니다. 추가 결제를 시도하지 말고 운영팀에 문의해 주세요.",
  prepare_failed: "결제를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
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

function isPortOnePaymentStatus(value: unknown): value is PortOnePaymentStatus {
  return (
    value === "READY" ||
    value === "PAY_PENDING" ||
    value === "VIRTUAL_ACCOUNT_ISSUED" ||
    value === "PAID" ||
    value === "FAILED" ||
    value === "PARTIAL_CANCELLED" ||
    value === "CANCELLED"
  );
}

function isConsistentPreparedPaymentState(
  paymentStatus: unknown,
  portoneStatus: unknown,
  canRetryPayment: unknown,
): boolean {
  if (
    paymentStatus === undefined &&
    portoneStatus === undefined &&
    canRetryPayment === undefined
  ) {
    // Legacy auction preparation does not return ledger status fields.
    return true;
  }
  if (
    !isPaymentStatus(paymentStatus) ||
    (portoneStatus !== null && !isPortOnePaymentStatus(portoneStatus)) ||
    typeof canRetryPayment !== "boolean"
  ) {
    return false;
  }
  if (portoneStatus === null) {
    return paymentStatus === "대기중" && !canRetryPayment;
  }
  if (portoneStatus === "READY" || portoneStatus === "PAY_PENDING") {
    return paymentStatus === "대기중" && !canRetryPayment;
  }
  if (portoneStatus === "VIRTUAL_ACCOUNT_ISSUED") {
    return paymentStatus === "가상계좌발급" && !canRetryPayment;
  }
  if (portoneStatus === "PAID") {
    return paymentStatus === "결제완료" && !canRetryPayment;
  }
  if (portoneStatus === "FAILED") {
    return paymentStatus === "대기중" && canRetryPayment;
  }
  if (portoneStatus === "PARTIAL_CANCELLED") {
    return paymentStatus === "결제완료" && !canRetryPayment;
  }
  return portoneStatus === "CANCELLED" && paymentStatus === "대기중";
}

function isProductPaymentMethod(
  value: unknown,
): value is ProductPaymentMethod {
  return (
    value === "CARD" ||
    value === "EASY_PAY" ||
    value === "VIRTUAL_ACCOUNT"
  );
}

export function isConfirmedProductPayment(
  result: Pick<ProductPaymentResult, "paymentStatus" | "portoneStatus">,
): boolean {
  return (
    (result.paymentStatus === "결제완료" && result.portoneStatus === "PAID") ||
    (result.paymentStatus === "가상계좌발급" &&
      result.portoneStatus === "VIRTUAL_ACCOUNT_ISSUED")
  );
}

function normalizePreparedCustomer(
  value: unknown,
): PreparedProductPayment["customer"] | null {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const customer = value as Record<string, unknown>;
  const fields = ["customerId", "fullName", "phoneNumber", "email"] as const;
  if (
    fields.some(
      (field) =>
        customer[field] !== undefined && typeof customer[field] !== "string",
    )
  ) {
    return null;
  }
  return {
    ...(typeof customer.customerId === "string"
      ? { customerId: customer.customerId }
      : {}),
    ...(typeof customer.fullName === "string"
      ? { fullName: customer.fullName }
      : {}),
    ...(typeof customer.phoneNumber === "string"
      ? { phoneNumber: customer.phoneNumber }
      : {}),
    ...(typeof customer.email === "string" ? { email: customer.email } : {}),
  };
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
  value: unknown,
  payMethod: ProductPaymentMethod,
  options: { expectedPaymentId?: string } = {},
): PreparedProductPayment {
  if (!isProductPaymentMethod(payMethod)) {
    throw new ProductPaymentError("지원하지 않는 결제 방법입니다.");
  }
  if (!value || typeof value !== "object") {
    throw new ProductPaymentError("서버의 결제 준비 정보를 확인하지 못했습니다.");
  }
  const payment = value as Record<string, unknown>;
  const normalizedCustomer = normalizePreparedCustomer(payment.customer);
  const responsePayMethod = payment.payMethod;
  const responsePaymentStatus = payment.paymentStatus;
  const responsePortOneStatus = payment.portoneStatus;
  const responseCanRetryPayment = payment.canRetryPayment;
  if (
    typeof payment.storeId !== "string" ||
    !/^store-[A-Za-z0-9_-]+$/.test(payment.storeId) ||
    typeof payment.channelKey !== "string" ||
    !/^channel-key-[A-Za-z0-9-]+$/.test(payment.channelKey) ||
    !isValidPaymentId(
      typeof payment.paymentId === "string" ? payment.paymentId : "",
    ) ||
    (options.expectedPaymentId !== undefined &&
      payment.paymentId !== options.expectedPaymentId) ||
    typeof payment.orderName !== "string" ||
    !payment.orderName.trim() ||
    new TextEncoder().encode(payment.orderName).byteLength > 100 ||
    !Number.isSafeInteger(payment.totalAmount) ||
    (payment.totalAmount as number) <= 0 ||
    payment.currency !== "KRW" ||
    (responsePayMethod !== undefined &&
      (!isProductPaymentMethod(responsePayMethod) ||
        responsePayMethod !== payMethod)) ||
    (responsePaymentStatus !== undefined &&
      !isPaymentStatus(responsePaymentStatus)) ||
    (responsePortOneStatus !== undefined &&
      responsePortOneStatus !== null &&
      !isPortOnePaymentStatus(responsePortOneStatus)) ||
    (responseCanRetryPayment !== undefined &&
      typeof responseCanRetryPayment !== "boolean") ||
    !isConsistentPreparedPaymentState(
      responsePaymentStatus,
      responsePortOneStatus,
      responseCanRetryPayment,
    ) ||
    normalizedCustomer === null
  ) {
    throw new ProductPaymentError("서버의 결제 준비 정보를 확인하지 못했습니다.");
  }

  return {
    storeId: payment.storeId,
    channelKey: payment.channelKey,
    paymentId: payment.paymentId as string,
    orderName: payment.orderName,
    totalAmount: payment.totalAmount as number,
    currency: "KRW",
    payMethod,
    ...(isPaymentStatus(responsePaymentStatus)
      ? { paymentStatus: responsePaymentStatus }
      : {}),
    ...(responsePortOneStatus === null ||
    isPortOnePaymentStatus(responsePortOneStatus)
      ? { portoneStatus: responsePortOneStatus }
      : {}),
    ...(typeof responseCanRetryPayment === "boolean"
      ? { canRetryPayment: responseCanRetryPayment }
      : {}),
    ...(normalizedCustomer ? { customer: normalizedCustomer } : {}),
  };
}

async function syncConfirmedPayment(
  paymentId: string,
): Promise<ProductPaymentResult | null> {
  try {
    const result = await syncProductPayment(paymentId);
    return isConfirmedProductPayment(result) ? result : null;
  } catch {
    return null;
  }
}

async function openPreparedProductPayment(
  prepared: PreparedProductPayment,
  payMethod: ProductPaymentMethod,
): Promise<ProductPaymentResult> {
  let paymentResponse: Awaited<ReturnType<typeof PortOne.requestPayment>>;
  try {
    paymentResponse = await invokePortOneProductPayment(
      {
        prepared,
        payMethod,
        origin: window.location.origin,
        webhookUrl: configuredWebhookUrl,
      },
      (request) => PortOne.requestPayment(request),
    );
  } catch (error) {
    const confirmed = await syncConfirmedPayment(prepared.paymentId);
    if (confirmed) return confirmed;
    throw new ProductPaymentError(
      "결제창을 열지 못했습니다. 잠시 후 다시 시도해 주세요.",
      { cause: error },
    );
  }

  if (!paymentResponse) {
    const confirmed = await syncConfirmedPayment(prepared.paymentId);
    if (confirmed) return confirmed;
    throw new ProductPaymentError("결제가 취소되었습니다.");
  }
  if (paymentResponse.code) {
    const confirmed = await syncConfirmedPayment(prepared.paymentId);
    if (confirmed) return confirmed;
    throw new ProductPaymentError(
      paymentResponse.message || "결제를 완료하지 못했습니다.",
      { code: paymentResponse.code },
    );
  }
  if (paymentResponse.paymentId !== prepared.paymentId) {
    const confirmed = await syncConfirmedPayment(prepared.paymentId);
    if (confirmed) return confirmed;
    throw new ProductPaymentError("결제 결과의 고유 번호가 일치하지 않습니다.");
  }

  return syncProductPayment(prepared.paymentId);
}

/**
 * Opens PortOne with the authenticated checkout response. Callers never pass a
 * cart total into this function; the server-prepared amount is the only amount
 * sent to the SDK.
 */
export async function requestPreparedProductPayment(input: {
  payment: unknown;
  payMethod: ProductPaymentMethod;
}): Promise<ProductPaymentResult> {
  const prepared = validatePreparedPayment(input.payment, input.payMethod);
  const action = preparedPaymentAction(prepared);
  if (action === "sync_pending") {
    const synced = await syncProductPayment(prepared.paymentId);
    if (isConfirmedProductPayment(synced)) return synced;
    throw new ProductPaymentError(
      "결제 승인을 처리 중입니다. 새 결제창을 열지 말고 주문 내역에서 상태를 다시 확인해 주세요.",
      { code: "payment_pending" },
    );
  }
  if (action === "sync_terminal") {
    const synced = await syncProductPayment(prepared.paymentId);
    if (isConfirmedProductPayment(synced)) return synced;
    if (synced.canRetryPayment) {
      throw new ProductPaymentError(
        "이전 결제 시도가 완료되지 않았습니다. 동일한 결제 번호로 다시 시도해 주세요.",
        { code: "payment_retryable" },
      );
    }
    throw new ProductPaymentError(
      "결제 상태가 완료로 확인되지 않았습니다. 결제창을 다시 열지 말고 주문 내역을 확인해 주세요.",
      { code: "payment_terminal" },
    );
  }
  return openPreparedProductPayment(prepared, input.payMethod);
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
  if (
    synced.portoneStatus !== undefined &&
    synced.portoneStatus !== null &&
    !isPortOnePaymentStatus(synced.portoneStatus)
  ) {
    throw new ProductPaymentError("서버의 PortOne 결제 상태를 확인하지 못했습니다.");
  }
  if (typeof synced.canRetryPayment !== "boolean") {
    throw new ProductPaymentError("서버의 결제 재시도 상태를 확인하지 못했습니다.");
  }

  return {
    paymentId,
    paymentStatus: synced.paymentStatus,
    portoneStatus: synced.portoneStatus ?? null,
    canRetryPayment: synced.canRetryPayment,
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
  // The authenticated server response is the source of truth for public
  // PortOne identifiers; Cloudflare runtime values are not baked into clients.
  const prepared = validatePreparedPayment(
    await postAuthenticated<unknown>(
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
    input.payMethod,
    { expectedPaymentId: paymentId },
  );
  return openPreparedProductPayment(prepared, input.payMethod);
}
