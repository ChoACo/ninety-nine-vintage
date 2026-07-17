"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import {
  syncProductPayment,
  type ProductPaymentResult,
} from "@/src/lib/portone/payment";

type CompletionState =
  | { status: "checking" }
  | { status: "complete"; result: ProductPaymentResult }
  | { status: "error"; message: string };

function paymentResultCopy(result: ProductPaymentResult): {
  title: string;
  description: string;
} {
  switch (result.paymentStatus) {
    case "결제완료":
      return {
        title: "결제가 완료되었습니다",
        description:
          "서버에서 결제 금액과 상태를 확인했습니다. 내 정보에서 택배 접수를 진행해 주세요.",
      };
    case "가상계좌발급":
      return {
        title: "가상계좌가 발급되었습니다",
        description:
          "내 정보의 낙찰 상품에서 계좌번호와 입금 기한을 확인할 수 있습니다. 입금이 확인되면 결제 완료로 자동 변경됩니다.",
      };
    default:
      return {
        title: "결제 확인을 접수했습니다",
        description:
          "결제 처리 중일 수 있습니다. 잠시 뒤 내 정보에서 최신 결제 상태를 확인해 주세요.",
      };
  }
}

export default function PaymentCompletePage() {
  const [state, setState] = useState<CompletionState>({ status: "checking" });

  useEffect(() => {
    let active = true;

    const complete = async () => {
      const query = new URLSearchParams(window.location.search);
      const paymentId = query.get("paymentId") ?? "";
      const portOneError = query.get("code");

      if (portOneError) {
        setState({
          status: "error",
          message: "결제가 취소되었거나 승인되지 않았습니다.",
        });
        return;
      }

      try {
        const result = await syncProductPayment(paymentId);
        if (active) setState({ status: "complete", result });
      } catch (error) {
        if (!active) return;
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "결제 결과를 확인하지 못했습니다.",
        });
      }
    };

    void complete();
    return () => {
      active = false;
    };
  }, []);

  const copy =
    state.status === "complete" ? paymentResultCopy(state.result) : null;

  return (
    <main className="theme-app-shell grid min-h-dvh place-items-center px-5 py-12">
      <section className="theme-panel w-full max-w-lg rounded-[2rem] border p-7 text-center shadow-sm sm:p-10">
        <div
          aria-hidden="true"
          className="mx-auto grid size-16 place-items-center rounded-[1.4rem] bg-[#f7ded4] text-3xl text-[#b85e4f]"
        >
          {state.status === "checking"
            ? "…"
            : state.status === "complete"
              ? "✓"
              : "!"}
        </div>
        <p className="mt-5 text-xs font-black tracking-[0.2em] text-[var(--accent-text)]">
          PORTONE V2 · DAMINE VINTAGE
        </p>

        {state.status === "checking" ? (
          <div role="status" aria-live="polite">
            <h1 className="mt-2 text-2xl font-black tracking-[-0.04em] text-[var(--text-strong)]">
              결제 결과 확인 중
            </h1>
            <span
              aria-hidden="true"
              className="mx-auto mt-6 block size-7 animate-spin rounded-full border-3 border-[#e4c8b8] border-r-[#d66e5b]"
            />
            <p className="mt-4 break-keep font-bold leading-7 text-[var(--text-muted)]">
              창을 닫지 말고 잠시만 기다려 주세요.
            </p>
          </div>
        ) : state.status === "complete" && copy ? (
          <div aria-live="polite">
            <h1 className="mt-2 text-2xl font-black tracking-[-0.04em] text-[var(--text-strong)]">
              {copy.title}
            </h1>
            <p className="mt-4 break-keep font-bold leading-7 text-[var(--text-muted)]">
              {copy.description}
            </p>
            <p className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 text-xs font-bold text-[var(--text-muted)]">
              결제번호 {state.result.paymentId}
            </p>
          </div>
        ) : (
          <div role="alert">
            <h1 className="mt-2 text-2xl font-black tracking-[-0.04em] text-[var(--text-strong)]">
              결제를 완료하지 못했습니다
            </h1>
            <p className="mt-4 break-keep font-bold leading-7 text-[#9f4c41]">
              {state.status === "error"
                ? state.message
                : "결제 결과를 확인하지 못했습니다."}
            </p>
            <p className="mt-2 break-keep text-sm font-bold leading-6 text-[var(--text-muted)]">
              이미 승인 또는 입금된 결제라면 웹훅으로 자동 반영되므로 내 정보에서
              다시 확인해 주세요.
            </p>
          </div>
        )}

        {state.status !== "checking" ? (
          <Link
            href="/"
            className="mt-7 inline-flex min-h-12 items-center justify-center rounded-2xl bg-[var(--accent)] px-6 font-black text-white shadow-sm transition hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
          >
            쇼핑몰로 돌아가기
          </Link>
        ) : null}
      </section>
    </main>
  );
}
