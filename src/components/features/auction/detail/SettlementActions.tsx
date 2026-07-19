"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { requestProductPayment, type ProductPaymentMethod } from "@/services/portone/payment";

interface SettlementActionsProps { productId: string; }
interface ManualTransfer { orderName: string; expectedAmount: number; bankName: string; accountNumber: string; status: string; }

export function SettlementActions({ productId }: SettlementActionsProps) {
  const [busy, setBusy] = useState<"portone" | "manual" | null>(null);
  const [message, setMessage] = useState("");
  const [transfer, setTransfer] = useState<ManualTransfer | null>(null);

  const getToken = async () => {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("로그인 후 결제할 수 있습니다.");
    return token;
  };

  const payWithPortOne = async (payMethod: ProductPaymentMethod) => {
    setBusy("portone");
    setMessage("");
    try {
      const result = await requestProductPayment({ productId, payMethod });
      setMessage(`결제 상태: ${result.paymentStatus}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "결제를 시작하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  const startManualTransfer = async () => {
    setBusy("manual");
    setMessage("");
    try {
      const token = await getToken();
      const response = await fetch("/api/payments/manual-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "begin", productId }),
      });
      const payload = await response.json() as { transfer?: ManualTransfer; error?: string };
      if (!response.ok || !payload.transfer) throw new Error(payload.error || "계좌이체를 시작하지 못했습니다.");
      setTransfer(payload.transfer);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "계좌이체를 시작하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-6 border-t border-zinc-200 pt-5">
      <p className="mb-3 text-[10px] font-bold tracking-[0.12em] text-zinc-500">SETTLEMENT</p>
      <div className="flex gap-2">
        <button className="h-10 flex-1 border border-zinc-950 text-xs font-bold transition-colors hover:bg-zinc-950 hover:text-white disabled:opacity-50" disabled={busy !== null} onClick={() => payWithPortOne("CARD")} type="button">{busy === "portone" ? "결제 준비 중..." : "PortOne 카드 결제"}</button>
        <button className="h-10 flex-1 border border-zinc-200 text-xs font-bold transition-colors hover:border-zinc-950 disabled:opacity-50" disabled={busy !== null} onClick={startManualTransfer} type="button">{busy === "manual" ? "계좌 확인 중..." : "계좌이체 안내"}</button>
      </div>
      {transfer && <div className="mt-3 border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5"><p className="font-bold">{transfer.orderName}</p><p>{transfer.bankName} {transfer.accountNumber}</p><p>{transfer.expectedAmount.toLocaleString("ko-KR")} KRW · {transfer.status}</p></div>}
      {message && <p className="mt-3 text-xs text-zinc-500">{message}</p>}
    </div>
  );
}
