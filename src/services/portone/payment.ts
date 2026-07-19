"use client";

import * as PortOne from "@portone/browser-sdk/v2";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { createPortOnePaymentId } from "@/services/portone/paymentId";

export type ProductPaymentMethod = "CARD" | "EASY_PAY" | "VIRTUAL_ACCOUNT";
export type ProductPaymentStatus = "대기중" | "가상계좌발급" | "결제완료";

export interface ProductPaymentResult {
  paymentId: string;
  paymentStatus: ProductPaymentStatus;
  portoneStatus: string | null;
}

export class ProductPaymentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ProductPaymentError";
  }
}

async function accessToken(): Promise<string> {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ProductPaymentError("로그인 후 결제를 진행해 주세요.");
  return token;
}

async function postApi<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = await accessToken();
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as T & { error?: string } | null;
  if (!response.ok || !payload) throw new ProductPaymentError(payload?.error || "결제 서버 요청에 실패했습니다.");
  return payload;
}

export async function syncProductPayment(paymentId: string): Promise<ProductPaymentResult> {
  return postApi<ProductPaymentResult>("/api/payments/sync", { paymentId });
}

export async function requestProductPayment(input: { productId: string; payMethod: ProductPaymentMethod; paymentId?: string }): Promise<ProductPaymentResult> {
  const paymentId = input.paymentId || createPortOnePaymentId(input.productId);
  const prepared = await postApi<{ storeId: string; channelKey: string; paymentId: string; orderName: string; totalAmount: number; currency: "KRW" }>("/api/payments/prepare", { ...input, paymentId });
  let response: Awaited<ReturnType<typeof PortOne.requestPayment>>;
  try {
    response = await PortOne.requestPayment({
      storeId: prepared.storeId,
      channelKey: prepared.channelKey,
      paymentId: prepared.paymentId,
      orderName: prepared.orderName,
      totalAmount: prepared.totalAmount,
      currency: prepared.currency,
      payMethod: input.payMethod,
      ...(input.payMethod === "EASY_PAY" ? { easyPayProvider: "KAKAOPAY" as const } : {}),
      redirectUrl: `${window.location.origin}/payment/complete?paymentId=${encodeURIComponent(prepared.paymentId)}`,
      ...(process.env.NEXT_PUBLIC_PORTONE_WEBHOOK_URL ? { noticeUrls: [process.env.NEXT_PUBLIC_PORTONE_WEBHOOK_URL] } : {}),
    });
  } catch (error) {
    throw new ProductPaymentError("결제창을 열지 못했습니다.", { cause: error });
  }
  if (!response) return syncProductPayment(prepared.paymentId);
  if (response.code) throw new ProductPaymentError(response.message || "결제를 완료하지 못했습니다.");
  if (response.paymentId !== prepared.paymentId) throw new ProductPaymentError("결제 결과의 고유 번호가 일치하지 않습니다.");
  return syncProductPayment(prepared.paymentId);
}
