"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  COMMERCE_CHECKOUT_STORAGE_KEY,
  isConfirmedProductPayment,
  ProductPaymentError,
  syncProductPayment,
} from "@/lib/portone/payment";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCommerceStore } from "@/store/useCommerceStore";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface PaymentSessionIdentity {
  accessToken: string;
  userId: string;
}

async function readPaymentSessionIdentity(): Promise<PaymentSessionIdentity> {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const session = data.session;
  if (!session?.access_token) {
    throw new ProductPaymentError(
      "로그인이 만료되었습니다. 카카오로 다시 로그인해 주세요.",
      { code: "unauthorized" },
    );
  }
  return {
    accessToken: session.access_token,
    userId: session.user.id,
  };
}

async function requireSamePaymentSession(
  expected: PaymentSessionIdentity,
): Promise<PaymentSessionIdentity> {
  const current = await readPaymentSessionIdentity();
  if (
    current.userId !== expected.userId ||
    current.accessToken !== expected.accessToken
  ) {
    throw new ProductPaymentError(
      "결제 확인 중 로그인 계정이 변경되었습니다. 현재 계정의 주문 내역을 확인해 주세요.",
      { code: "payment_session_changed" },
    );
  }
  return current;
}

function readPurchasedProductIds(
  paymentId: string,
  buyerId: string,
): string[] {
  try {
    const stored = JSON.parse(
      window.sessionStorage.getItem(COMMERCE_CHECKOUT_STORAGE_KEY) ?? "null",
    ) as Record<string, unknown> | null;
    if (
      !stored ||
      stored.paymentId !== paymentId ||
      stored.buyerId !== buyerId ||
      !Array.isArray(stored.productIds) ||
      stored.productIds.length === 0 ||
      stored.productIds.length > 50 ||
      !stored.productIds.every(
        (productId): productId is string =>
          typeof productId === "string" && UUID_PATTERN.test(productId),
      )
    ) {
      return [];
    }
    return [...new Set(stored.productIds)];
  } catch {
    return [];
  }
}

function clearCheckoutForPayment(paymentId: string, buyerId: string): void {
  try {
    const stored = JSON.parse(
      window.sessionStorage.getItem(COMMERCE_CHECKOUT_STORAGE_KEY) ?? "null",
    ) as Record<string, unknown> | null;
    // Do not erase a newer or legacy checkout while this payment result is
    // being verified. Current commerce checkout always persists paymentId
    // before opening the provider window.
    if (stored?.paymentId === paymentId && stored.buyerId === buyerId) {
      window.sessionStorage.removeItem(COMMERCE_CHECKOUT_STORAGE_KEY);
    }
  } catch {
    // A restricted storage context does not change the verified result.
  }
}

function PaymentCompletion() {
  const searchParams = useSearchParams();
  const paymentId = searchParams.get("paymentId");
  const redirectErrorCode = searchParams.get("code");
  const syncWithServer = useCommerceStore((state) => state.syncWithServer);
  const removePurchasedFromCart = useCommerceStore(
    (state) => state.removePurchasedFromCart,
  );
  const [message, setMessage] = useState(
    paymentId
      ? "결제 결과를 확인하고 있습니다."
      : "결제 번호가 없어 결과를 확인할 수 없습니다.",
  );
  const [failed, setFailed] = useState(!paymentId);

  useEffect(() => {
    if (!paymentId) return;
    const completePayment = async () => {
      const startingSession = await readPaymentSessionIdentity();
      const result = await syncProductPayment(paymentId);
      const postSyncSession = await requireSamePaymentSession(startingSession);

      if (isConfirmedProductPayment(result)) {
        const purchasedProductIds = readPurchasedProductIds(
          paymentId,
          postSyncSession.userId,
        );
        await requireSamePaymentSession(startingSession);
        removePurchasedFromCart(purchasedProductIds);
        await requireSamePaymentSession(startingSession);
        await syncWithServer();
        await requireSamePaymentSession(startingSession);
        clearCheckoutForPayment(paymentId, postSyncSession.userId);
        setMessage(
          result.portoneStatus === "PAID"
            ? "결제가 완료되었습니다."
            : "가상계좌가 발급되었습니다. 주문 내역에서 입금 정보를 확인해 주세요.",
        );
        return;
      }
      if (result.portoneStatus === "PARTIAL_CANCELLED") {
        setMessage(
          "결제가 일부 취소된 상태입니다. 주문 내역에서 상태를 확인해 주세요.",
        );
        return;
      }
      if (
        result.portoneStatus === "CANCELLED" ||
        result.portoneStatus === "FAILED"
      ) {
        setFailed(true);
        setMessage("결제가 완료되지 않았습니다. 장바구니에서 다시 시도해 주세요.");
        return;
      }
      if (redirectErrorCode) {
        setFailed(true);
        setMessage("결제가 완료되지 않았습니다. 장바구니에서 다시 시도해 주세요.");
        return;
      }
      setMessage(
        "결제 승인을 확인 중입니다. 주문 내역에서 상태를 다시 확인해 주세요.",
      );
    };

    void completePayment().catch((error: unknown) => {
      setFailed(true);
      setMessage(
        error instanceof ProductPaymentError
          ? error.message
          : "결제 결과를 확인하지 못했습니다.",
      );
    });
  }, [paymentId, redirectErrorCode, removePurchasedFromCart, syncWithServer]);

  return (
    <main className="mx-auto grid min-h-[60vh] max-w-xl place-items-center px-6 py-20 text-center">
      <div>
        <p className="eyebrow text-muted">결제 · 결과 확인</p>
        <h1 className="mt-4 text-3xl font-black tracking-[-.08em]">
          {message}
        </h1>
        <Link
          className="mt-8 inline-flex border border-ink px-5 py-3 text-xs font-bold"
          href={failed ? "/cart" : "/account#orders"}
        >
          {failed ? "장바구니로 돌아가기" : "주문 내역 확인"}
        </Link>
      </div>
    </main>
  );
}

export default function PaymentCompletePage() {
  return (
    <Suspense fallback={<main className="min-h-[60vh]" />}>
      <PaymentCompletion />
    </Suspense>
  );
}
