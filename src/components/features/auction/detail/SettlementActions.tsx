"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface SettlementActionsProps {
  productId: string;
}
interface ManualTransfer {
  orderName: string;
  expectedAmount: number;
  bankName: string;
  accountNumber: string;
  status: string;
}

export function SettlementActions({ productId }: SettlementActionsProps) {
  const [busy, setBusy] = useState<"manual" | null>(null);
  const [message, setMessage] = useState("");
  const [transfer, setTransfer] = useState<ManualTransfer | null>(null);

  const getToken = async () => {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("로그인 후 결제할 수 있습니다.");
    return token;
  };

  const startManualTransfer = async () => {
    setBusy("manual");
    setMessage("");
    try {
      const token = await getToken();
      const response = await fetch("/api/payments/manual-transfer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "begin", productId }),
      });
      const payload = (await response.json()) as {
        transfer?: ManualTransfer;
        error?: string;
      };
      if (!response.ok || !payload.transfer)
        throw new Error(payload.error || "계좌이체를 시작하지 못했습니다.");
      setTransfer(payload.transfer);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "계좌이체를 시작하지 못했습니다.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-6 border-t border-zinc-200 pt-5">
      <p className="mb-3 text-[10px] font-bold tracking-[0.12em] text-zinc-500">
        낙찰 결제
      </p>
      <p className="mb-3 text-[11px] leading-5 text-zinc-500">
        현재 신규 결제는 수동 계좌이체로만 진행됩니다. 계좌를 확인해 입금한 뒤
        운영자의 입금 확인을 기다려 주세요.
      </p>
      <button
        className="h-10 w-full border border-zinc-950 text-xs font-bold transition-colors hover:bg-zinc-950 hover:text-white disabled:opacity-50"
        disabled={busy !== null}
        onClick={startManualTransfer}
        type="button"
      >
        {busy === "manual" ? "계좌 확인 중..." : "계좌이체 안내"}
      </button>
      {transfer && (
        <div className="mt-3 border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5">
          <p className="font-bold">{transfer.orderName}</p>
          <p>
            {transfer.bankName} {transfer.accountNumber}
          </p>
          <p>
            {transfer.expectedAmount.toLocaleString("ko-KR")}원 ·{" "}
            {transfer.status === "confirmed" ? "입금 확인 완료" : "입금 대기 중"}
          </p>
        </div>
      )}
      {message && <p className="mt-3 text-xs text-zinc-500">{message}</p>}
    </div>
  );
}
