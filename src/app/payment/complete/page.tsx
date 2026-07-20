"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  ProductPaymentError,
  syncProductPayment,
} from "@/services/portone/payment";

function PaymentCompletion() {
  const searchParams = useSearchParams();
  const paymentId = searchParams.get("paymentId");
  const [message, setMessage] = useState(
    paymentId
      ? "결제 결과를 확인하고 있습니다."
      : "결제 번호가 없어 결과를 확인할 수 없습니다.",
  );
  const [failed, setFailed] = useState(!paymentId);

  useEffect(() => {
    if (!paymentId) return;
    void syncProductPayment(paymentId)
      .then((result) => {
        setMessage(
          result.paymentStatus === "결제완료"
            ? "결제가 완료되었습니다."
            : "결제 상태가 확인되었습니다.",
        );
      })
      .catch((error: unknown) => {
        setFailed(true);
        setMessage(
          error instanceof ProductPaymentError
            ? error.message
            : "결제 결과를 확인하지 못했습니다.",
        );
      });
  }, [paymentId]);

  return (
    <main className="mx-auto grid min-h-[60vh] max-w-xl place-items-center px-6 py-20 text-center">
      <div>
        <p className="eyebrow text-muted">PAYMENT / COMPLETE</p>
        <h1 className="mt-4 text-3xl font-black tracking-[-.08em]">
          {message}
        </h1>
        <Link
          className="mt-8 inline-flex border border-ink px-5 py-3 text-xs font-bold"
          href={failed ? "/cart" : "/account"}
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
