"use client";

import { useCallback, useEffect, useState } from "react";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
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

interface AuctionConfirmationRequest {
  request_id: string;
  request_kind: "payment_started" | "buyer" | "system_reconciliation";
  buyer_display_name: string;
  depositor_name: string;
  expected_amount: number;
  order_count: number;
  item_reference: string;
  first_requested_at: string;
  last_requested_at: string;
  reminder_count: number;
  original_due_at: string | null;
  review_due_at: string | null;
  has_cancelled_orders: boolean;
  request_version: number;
}

export function OwnerPaymentConfirmationQueue() {
  const [requests, setRequests] = useState<ConfirmationRequest[]>([]);
  const [auctionRequests, setAuctionRequests] = useState<AuctionConfirmationRequest[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [forceTarget, setForceTarget] = useState<AuctionConfirmationRequest | null>(null);
  const [forceDepositorName, setForceDepositorName] = useState("");
  const [includeInSettlement, setIncludeInSettlement] = useState(true);
  const [forceReason, setForceReason] = useState("");
  const [forceIdempotencyKey, setForceIdempotencyKey] = useState("");

  const loadQueue = useCallback(async () => {
    setError("");
    const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
    if (!session) return;
    const response = await fetch("/api/admin/owner/payment-confirmation-requests", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      error?: string;
      requests?: ConfirmationRequest[];
      auctionRequests?: AuctionConfirmationRequest[];
    };
    if (!response.ok) throw new Error(payload.error ?? "긴급 확인 요청을 불러오지 못했습니다.");
    setRequests(payload.requests ?? []);
    setAuctionRequests(payload.auctionRequests ?? []);
  }, []);

  const dismissAuctionRequest = async (request: AuctionConfirmationRequest) => {
    if (busyId) return;
    const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
    if (!session) return;
    setBusyId(request.request_id);
    setError("");
    try {
      const response = await fetch("/api/admin/owner/payment-confirmation-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          requestId: request.request_id,
          expectedVersion: request.request_version,
          resolution: "not_found",
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "요청을 처리하지 못했습니다.");
      await loadQueue();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "요청을 처리하지 못했습니다.");
    } finally {
      setBusyId(null);
    }
  };

  const openForcedConfirmation = (request: AuctionConfirmationRequest) => {
    setError("");
    setForceTarget(request);
    setForceDepositorName(request.depositor_name);
    setIncludeInSettlement(true);
    setForceReason("");
    setForceIdempotencyKey(crypto.randomUUID());
  };

  const forceConfirm = async () => {
    if (!forceTarget || busyId || !forceIdempotencyKey) return;
    const depositorName = forceDepositorName.trim();
    const reason = forceReason.trim();
    if (!depositorName || reason.length < 3) return;
    const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
    if (!session) return;
    setBusyId(forceTarget.request_id);
    setError("");
    try {
      const response = await fetch("/api/admin/owner/payment-confirmation-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "force_confirm",
          requestId: forceTarget.request_id,
          expectedVersion: forceTarget.request_version,
          depositorName,
          includeInSettlement,
          reason,
          idempotencyKey: forceIdempotencyKey,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        error?: string;
        message?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? payload?.error ?? "강제 결제완료를 처리하지 못했습니다.");
      }
      setForceTarget(null);
      setForceReason("");
      window.dispatchEvent(new Event("owner-payment-updated"));
      await loadQueue();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "강제 결제완료를 처리하지 못했습니다.");
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      void loadQueue().catch((cause) => setError(cause instanceof Error ? cause.message : "긴급 확인 요청을 불러오지 못했습니다."));
    });
  }, [loadQueue]);

  if (!error && requests.length === 0 && auctionRequests.length === 0) return null;
  return (
    <section className="mb-8 border border-amber-300 bg-amber-500/10 p-5 text-amber-950">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em]">긴급 입금 확인</p>
      <h2 className="mt-2 text-xl font-black">
        확인 요청 {requests.length + auctionRequests.length}건
      </h2>
      {error ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <p>{error}</p>
          <button className="border border-amber-700 px-3 py-1 font-bold" onClick={() => void loadQueue().catch((cause) => setError(cause instanceof Error ? cause.message : "긴급 확인 요청을 불러오지 못했습니다."))} type="button">
            다시 시도
          </button>
        </div>
      ) : (
        <div className="mt-4 divide-y divide-amber-200 border-y border-amber-200">
          {auctionRequests.map((request) => (
            <div className="flex flex-wrap items-center justify-between gap-3 py-4 text-xs" key={request.request_id}>
              <span className="min-w-0 flex-1">
                <strong>{request.buyer_display_name}</strong> · 입금자명 {request.depositor_name} · 낙찰품 {request.order_count}개
                <small className="mt-1 block truncate">{request.item_reference}</small>
                <small className="mt-1 block font-bold text-amber-800">
                  {request.request_kind === "system_reconciliation"
                    ? "자동취소 뒤 배송비 결제 행만 남아 시스템이 복구한 대사 요청입니다. 은행 입금내역 확인 전 결제 완료 처리하지 마세요."
                    : request.request_kind === "payment_started"
                      ? `구매자가 계좌이체 절차를 시작했습니다 · ${new Date(request.last_requested_at).toLocaleString("ko-KR")}`
                      : `구매자 입금 확인 요청 ${new Date(request.last_requested_at).toLocaleString("ko-KR")}`}
                  {request.has_cancelled_orders ? " · 일부 주문 자동취소 상태" : ""}
                </small>
              </span>
              <span className="flex flex-wrap items-center justify-end gap-2">
                <strong className="font-mono">{Number(request.expected_amount).toLocaleString("ko-KR")}원</strong>
                <button
                  className="min-h-10 bg-amber-950 px-3 font-black text-amber-50 disabled:opacity-40"
                  disabled={busyId !== null}
                  onClick={() => openForcedConfirmation(request)}
                  type="button"
                >
                  강제 결제완료
                </button>
                <button
                  className="min-h-10 border border-amber-700 px-3 font-bold disabled:opacity-40"
                  disabled={busyId !== null}
                  onClick={() => void dismissAuctionRequest(request)}
                  type="button"
                >
                  {busyId === request.request_id ? "처리 중" : "입금내역 없음"}
                </button>
              </span>
            </div>
          ))}
          {requests.length > 0 && (
            <p className="py-3 text-[10px] font-black uppercase tracking-[0.12em]">
              12시간 이상 대기 요청 {requests.length}건
            </p>
          )}
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
      <PremiumDialog
        ariaLabel="소유자 강제 결제완료"
        closeDisabled={busyId !== null}
        onClose={() => {
          if (!busyId) setForceTarget(null);
        }}
        open={forceTarget !== null}
        panelClassName="max-w-xl"
        zIndexClassName="z-[160]"
      >
        {forceTarget && (
          <div className="p-5 text-ink sm:p-7">
            <p className="eyebrow text-muted">소유자 전용 복구 처리</p>
            <h3 className="mt-2 text-xl font-black">강제로 결제완료 처리</h3>
            <p className="mt-3 text-xs leading-5 text-muted">
              은행 입금을 직접 확인한 경우에만 사용하세요. 만료된 원 낙찰을 복구하고, 미완료 차순위 제안과 잘못 부여된 미결제 제재를 철회한 뒤 구매자의 보관상품 원장을 생성합니다.
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-xs">
              <div className="border border-line p-3"><dt className="text-muted">구매자</dt><dd className="mt-1 font-bold">{forceTarget.buyer_display_name}</dd></div>
              <div className="border border-line p-3"><dt className="text-muted">확인 금액</dt><dd className="mt-1 font-mono font-black">{Number(forceTarget.expected_amount).toLocaleString("ko-KR")}원</dd></div>
            </dl>
            <label className="mt-5 block text-xs font-bold" htmlFor="force-payment-depositor">실제 입금자명</label>
            <input
              className="mt-2 h-11 w-full border border-line bg-paper px-3 text-sm"
              id="force-payment-depositor"
              maxLength={80}
              onChange={(event) => setForceDepositorName(event.target.value)}
              value={forceDepositorName}
            />
            <fieldset className="mt-5 border border-line p-4">
              <legend className="px-2 text-xs font-black">판매센터 정산 반영</legend>
              <label className="flex cursor-pointer items-start gap-2 text-xs">
                <input checked={includeInSettlement} name="settlement-disposition" onChange={() => setIncludeInSettlement(true)} type="radio" />
                <span><strong>정산 포함</strong><small className="mt-1 block text-muted">배송 완료 후 판매대금과 5% 수수료를 정상 정산에 반영합니다.</small></span>
              </label>
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs">
                <input checked={!includeInSettlement} name="settlement-disposition" onChange={() => setIncludeInSettlement(false)} type="radio" />
                <span><strong>정산 미포함</strong><small className="mt-1 block text-muted">구매자 결제·보관·배송은 정상 처리하지만 이 상품의 판매대금과 수수료는 센터 정산에서 제외합니다.</small></span>
              </label>
            </fieldset>
            <label className="mt-5 block text-xs font-bold" htmlFor="force-payment-reason">강제 처리 사유 (감사 기록)</label>
            <textarea
              className="mt-2 min-h-24 w-full resize-y border border-line bg-paper px-3 py-3 text-sm"
              id="force-payment-reason"
              maxLength={500}
              onChange={(event) => setForceReason(event.target.value)}
              placeholder="예: 입금 요청 원장 전달 오류를 확인했고 실제 은행 입금 내역과 일치함"
              value={forceReason}
            />
            <div className="mt-6 flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end">
              <button className="h-11 border border-line px-5 text-xs font-bold" disabled={busyId !== null} onClick={() => setForceTarget(null)} type="button">취소</button>
              <button className="h-11 bg-ink px-5 text-xs font-black text-paper disabled:opacity-40" disabled={busyId !== null || !forceDepositorName.trim() || forceReason.trim().length < 3} onClick={() => void forceConfirm()} type="button">
                {busyId === forceTarget.request_id ? "처리 중..." : includeInSettlement ? "결제완료 · 정산 포함" : "결제완료 · 정산 미포함"}
              </button>
            </div>
          </div>
        )}
      </PremiumDialog>
    </section>
  );
}
