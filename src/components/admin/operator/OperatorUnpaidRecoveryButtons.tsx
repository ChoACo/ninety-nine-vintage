"use client";

import { Gavel, Tag } from "lucide-react";
import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { PremiumDialog } from "@/components/ui/PremiumDialog";

type RecoveryMode = "fixed" | "reauction";

interface OperatorUnpaidRecoveryButtonsProps {
  amount: number | null;
  disabled?: boolean;
  onNotice: (message: string) => void;
  productId: string;
  productTitle: string;
}

interface RecoveryResponse {
  error?: string;
  result?: {
    closesAt: string | null;
    mode: string;
    price: number | null;
    publishAt: string | null;
    status: string;
  };
}

function successMessage(
  productTitle: string,
  result: NonNullable<RecoveryResponse["result"]>,
) {
  if (result.mode === "reauction") {
    const publishLabel = result.publishAt
      ? new Date(result.publishAt).toLocaleString("ko-KR")
      : "다음 10:00(KST)";
    return `${productTitle}: 미결제 낙찰을 종료하고 ${publishLabel} 경매로 자동 편성했습니다.`;
  }
  const price = Number(result.price);
  const priceLabel = Number.isSafeInteger(price) && price > 0
    ? `${price.toLocaleString("ko-KR")}원`
    : "낙찰가";
  return `${productTitle}: ${priceLabel} 즉시구매 상품으로 전환하여 바로 판매합니다.`;
}

export function OperatorUnpaidRecoveryButtons({
  amount,
  disabled = false,
  onNotice,
  productId,
  productTitle,
}: OperatorUnpaidRecoveryButtonsProps) {
  const [processing, setProcessing] = useState<RecoveryMode | null>(null);
  const [confirmationMode, setConfirmationMode] = useState<RecoveryMode | null>(
    null,
  );

  const recover = async (mode: RecoveryMode) => {
    if (processing) return;
    setConfirmationMode(null);
    setProcessing(mode);
    onNotice("");
    try {
      const session = (
        await getSupabaseBrowserClient().auth.getSession()
      ).data.session;
      if (!session?.access_token) {
        throw new Error("운영자 로그인 세션을 다시 확인해 주세요.");
      }
      const response = await fetch(
        `/api/admin/operator/auctions/${encodeURIComponent(productId)}/recover`,
        {
          body: JSON.stringify({ mode }),
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      const payload = await response.json().catch(() => null) as
        | RecoveryResponse
        | null;
      if (!response.ok || !payload?.result) {
        throw new Error(payload?.error || "미결제 경매 복구를 처리하지 못했습니다.");
      }
      onNotice(successMessage(productTitle, payload.result));
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "미결제 경매 복구를 처리하지 못했습니다.",
      );
    } finally {
      setProcessing(null);
    }
  };

  const amountLabel = amount !== null && Number.isSafeInteger(amount)
    ? `${amount.toLocaleString("ko-KR")}원`
    : "저장된 낙찰가";

  return (
    <>
      <span className="flex shrink-0 flex-wrap gap-1">
      <button
        className="flex items-center gap-1 border border-ink px-2 py-1 text-[10px] font-bold disabled:cursor-wait disabled:opacity-50"
        disabled={disabled || processing !== null}
        onClick={() => setConfirmationMode("reauction")}
        type="button"
      >
        <Gavel aria-hidden="true" size={11} />
        {processing === "reauction" ? "편성 중" : "재경매 등록"}
      </button>
      <button
        className="flex items-center gap-1 border border-ink bg-paper px-2 py-1 text-[10px] font-bold disabled:cursor-wait disabled:opacity-50"
        disabled={disabled || processing !== null}
        onClick={() => setConfirmationMode("fixed")}
        type="button"
      >
        <Tag aria-hidden="true" size={11} />
        {processing === "fixed" ? "전환 중" : "즉시구매 전환"}
      </button>
      </span>
      <PremiumDialog
        closeDisabled={processing !== null}
        labelledBy="unpaid-auction-recovery-title"
        onClose={() => setConfirmationMode(null)}
        open={confirmationMode !== null}
        panelClassName="max-w-md"
      >
        {confirmationMode && (
          <div className="p-6">
            <h2 className="text-xl font-black" id="unpaid-auction-recovery-title">
              {confirmationMode === "reauction"
                ? "미결제 상품 재경매 편성"
                : "미결제 상품 즉시구매 전환"}
            </h2>
            <p className="mt-3 break-keep text-xs leading-5 text-muted">
              {confirmationMode === "reauction"
                ? "기존 미결제 낙찰을 종료하고 다음 10:00(KST) 경매로 자동 편성합니다."
                : `기존 미결제 낙찰을 종료하고 낙찰가 ${amountLabel}을 즉시구매가로 전환해 바로 판매합니다.`}
            </p>
            <dl className="mt-4 space-y-2 border border-line bg-surface p-4 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">상품</dt>
                <dd className="text-right font-bold">{productTitle}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">처리 후 상태</dt>
                <dd className="text-right font-bold">
                  {confirmationMode === "reauction"
                    ? "다음 경매 공개 예약"
                    : `즉시구매 · ${amountLabel}`}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] leading-5 text-red-700">
              처리 결과는 보안 감사 로그에 기록됩니다. 상품과 판매 방식을 다시 확인해 주세요.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                className="border border-line px-4 py-3 text-xs font-bold"
                disabled={processing !== null}
                onClick={() => setConfirmationMode(null)}
                type="button"
              >
                취소
              </button>
              <button
                className="bg-rose-700 px-4 py-3 text-xs font-bold text-white disabled:opacity-40"
                disabled={processing !== null}
                onClick={() => void recover(confirmationMode)}
                type="button"
              >
                {processing
                  ? "처리 중..."
                  : confirmationMode === "reauction"
                    ? "재경매 편성 확정"
                    : "즉시구매 전환 확정"}
              </button>
            </div>
          </div>
        )}
      </PremiumDialog>
    </>
  );
}
