"use client";

import { RefreshCcw } from "lucide-react";
import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface OperatorSecondChanceButtonProps {
  onNotice: (message: string) => void;
  productId: string;
  productTitle: string;
}

interface SecondChanceResponse {
  error?: string;
  result?: {
    bidderDisplayName: string | null;
    offeredAmount: number | null;
    responseDueAt: string | null;
    status: string;
  };
}

function successMessage(
  productTitle: string,
  result: NonNullable<SecondChanceResponse["result"]>,
) {
  if (result.status === "no_successor") {
    return `${productTitle}: 제안할 수 있는 차순위 입찰자가 없습니다.`;
  }
  const amount = Number(result.offeredAmount);
  const amountLabel = Number.isSafeInteger(amount) && amount > 0
    ? `${amount.toLocaleString("ko-KR")}원`
    : "저장된 입찰가";
  const dueLabel = result.responseDueAt
    ? new Date(result.responseDueAt).toLocaleString("ko-KR")
    : "서버 지정 기한";
  return `${productTitle}: ${result.bidderDisplayName ?? "차순위 회원"}에게 ${amountLabel} 차순위 낙찰을 제안했습니다. 응답 기한 ${dueLabel}`;
}

export function OperatorSecondChanceButton({
  onNotice,
  productId,
  productTitle,
}: OperatorSecondChanceButtonProps) {
  const [processing, setProcessing] = useState(false);

  const processSecondChance = async () => {
    if (processing) return;
    setProcessing(true);
    onNotice("");
    try {
      const session = (
        await getSupabaseBrowserClient().auth.getSession()
      ).data.session;
      if (!session?.access_token) {
        throw new Error("운영자 로그인 세션을 다시 확인해 주세요.");
      }

      const response = await fetch(
        `/api/admin/operator/auctions/${encodeURIComponent(productId)}/second-chance`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      const payload = await response.json().catch(() => null) as
        | SecondChanceResponse
        | null;
      if (!response.ok || !payload?.result) {
        throw new Error(payload?.error || "차순위 낙찰 제안을 처리하지 못했습니다.");
      }
      onNotice(successMessage(productTitle, payload.result));
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "차순위 낙찰 제안을 처리하지 못했습니다.",
      );
    } finally {
      setProcessing(false);
    }
  };

  return (
    <button
      className="flex shrink-0 items-center gap-1 border border-ink px-2 py-1 text-[10px] font-bold disabled:cursor-wait disabled:opacity-50"
      disabled={processing}
      onClick={() => void processSecondChance()}
      type="button"
    >
      <RefreshCcw aria-hidden="true" size={11} />
      {processing ? "처리 중" : "차순위 낙찰 제안"}
    </button>
  );
}
