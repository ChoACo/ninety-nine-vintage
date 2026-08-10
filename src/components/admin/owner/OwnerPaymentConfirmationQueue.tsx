"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface ConfirmationRequest {
  request_id: string;
  order_id: string;
  buyer_display_name: string;
  expected_amount: number;
  transfer_status: string;
  first_requested_at: string;
  last_requested_at: string;
  reminder_count: number;
  elapsed_seconds: number;
}

export function OwnerPaymentConfirmationQueue() {
  const [requests, setRequests] = useState<ConfirmationRequest[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
      if (!session) return;
      const response = await fetch("/api/admin/owner/payment-confirmation-requests", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        error?: string;
        requests?: ConfirmationRequest[];
      };
      if (!response.ok) throw new Error(payload.error ?? "긴급 확인 요청을 불러오지 못했습니다.");
      setRequests(payload.requests ?? []);
    })().catch((cause) => setError(cause instanceof Error ? cause.message : "긴급 확인 요청을 불러오지 못했습니다."));
  }, []);

  if (!error && requests.length === 0) return null;
  return (
    <section className="mb-8 border border-amber-300 bg-amber-50 p-5 text-amber-950">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em]">긴급 입금 확인</p>
      <h2 className="mt-2 text-xl font-black">12시간 이상 대기 요청 {requests.length}건</h2>
      {error ? <p className="mt-3 text-xs">{error}</p> : (
        <div className="mt-4 divide-y divide-amber-200 border-y border-amber-200">
          {requests.map((request) => (
            <div className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs" key={request.request_id}>
              <span>
                <strong>{request.buyer_display_name}</strong> · 주문 {request.order_id.slice(0, 8)} · 재알림 {request.reminder_count}회
                <small className="mt-1 block">최초 요청 {new Date(request.first_requested_at).toLocaleString("ko-KR")} · {Math.floor(request.elapsed_seconds / 3600)}시간 경과</small>
              </span>
              <strong className="font-mono">{Number(request.expected_amount).toLocaleString("ko-KR")}원</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
