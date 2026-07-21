"use client";

import Link from "next/link";
import { LockKeyhole, RefreshCw, Truck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ownerSnapshotMatchesSession } from "@/lib/ownerAccess/sessionOwnership";

interface Transfer { status: string; remainingAmount?: number; }
interface Shipping { status: string; }
interface Runtime {
  activeMode: "manual_transfer";
  bankConfigured: boolean;
  portoneArchived: true;
  updatedAt?: string | null;
}
interface AuctionTransfer { id: string; order_name: string; expected_amount: number; receivedAmount: number; remainingAmount: number; status: string; }
interface ShippingFeePayment { id: string; expected_amount: number; receivedAmount: number; remainingAmount: number; status: string; shipping_request_id: string | null; }

function parseRuntime(value: unknown): Runtime | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const runtime = value as Record<string, unknown>;
  if (
    runtime.activeMode !== "manual_transfer" ||
    typeof runtime.bankConfigured !== "boolean" ||
    runtime.portoneArchived !== true ||
    (runtime.updatedAt !== undefined &&
      runtime.updatedAt !== null &&
      typeof runtime.updatedAt !== "string")
  ) {
    return null;
  }
  return runtime as unknown as Runtime;
}

export function OwnerOperationsConsole() {
  const { loading: sessionLoading, revision: sessionRevision, session } =
    useSupabaseSession();
  const token = session?.access_token ?? null;
  const [shipping, setShipping] = useState<Shipping[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loadedAuctionTransfers, setAuctionTransfers] = useState<AuctionTransfer[]>([]);
  const [loadedFeePayments, setFeePayments] = useState<ShippingFeePayment[]>([]);
  const [auctionForms, setAuctionForms] = useState<Record<string, { amount: string; depositorName: string; memo: string }>>({});
  const [feeForms, setFeeForms] = useState<Record<string, { amount: string; depositorName: string; memo: string }>>({});
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"error" | "success">("success");
  const [loadedSessionRevision, setLoadedSessionRevision] = useState<
    number | null
  >(null);
  const loadGeneration = useRef(0);

  const load = useCallback(async (
    accessToken: string | null,
    expectedSessionRevision: number,
  ) => {
    const generation = ++loadGeneration.current;
    if (!accessToken) {
      setShipping([]);
      setTransfers([]);
      setAuctionTransfers([]);
      setFeePayments([]);
      setRuntime(null);
      setLoadedSessionRevision(null);
      setNotice("");
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${accessToken}` };
      const [operationResponse, runtimeResponse] = await Promise.all([
        fetch("/api/admin/owner/operations", { headers, cache: "no-store" }),
        fetch("/api/admin/owner/payment-mode", { headers, cache: "no-store" }),
      ]);
      const operation = await operationResponse.json() as { shipping?: Shipping[]; transfers?: Transfer[]; auctionTransfers?: AuctionTransfer[]; feePayments?: ShippingFeePayment[]; error?: string };
      const paymentPayload = await runtimeResponse.json() as unknown;
      if (generation !== loadGeneration.current) return;
      if (!operationResponse.ok) throw new Error(operation.error ?? "소유자 운영 현황을 불러오지 못했습니다.");
      if (!runtimeResponse.ok) {
        const error =
          paymentPayload && typeof paymentPayload === "object"
            ? (paymentPayload as Record<string, unknown>).error
            : null;
        throw new Error(
          typeof error === "string"
            ? error
            : "결제 운영 모드를 불러오지 못했습니다.",
        );
      }
      const payment = parseRuntime(paymentPayload);
      if (!payment) {
        throw new Error("결제 운영 모드 응답을 확인하지 못했습니다.");
      }
      setShipping(operation.shipping ?? []);
      setTransfers(operation.transfers ?? []);
      setAuctionTransfers(operation.auctionTransfers ?? []);
      setFeePayments(operation.feePayments ?? []);
      setRuntime(payment);
      setLoadedSessionRevision(expectedSessionRevision);
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      throw error;
    }
  }, []);

  useEffect(() => {
    if (sessionLoading) return;
    const timer = window.setTimeout(() => {
      void load(token, sessionRevision).catch((error) => {
        setNoticeKind("error");
        setNotice(error instanceof Error ? error.message : "소유자 운영 현황을 불러오지 못했습니다.");
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      loadGeneration.current += 1;
    };
  }, [load, sessionLoading, sessionRevision, token]);

  const snapshotIsCurrent = ownerSnapshotMatchesSession(
    loadedSessionRevision,
    sessionRevision,
    Boolean(token),
    sessionLoading,
  );
  const visibleShipping = snapshotIsCurrent ? shipping : [];
  const visibleTransfers = snapshotIsCurrent ? transfers : [];
  const visibleAuctionTransfers = snapshotIsCurrent ? loadedAuctionTransfers : [];
  const visibleFeePayments = snapshotIsCurrent ? loadedFeePayments : [];
  const auctionTransfers = visibleAuctionTransfers;
  const feePayments = visibleFeePayments;
  const visibleRuntime = snapshotIsCurrent ? runtime : null;
  const outstanding = visibleTransfers.filter(
    (transfer) => (transfer.remainingAmount ?? 1) > 0,
  ).length;
  const requireCurrentToken = async (): Promise<string> => {
    if (!token) throw new Error("소유자 로그인이 만료되었습니다.");
    const latest = (await getSupabaseBrowserClient().auth.getSession()).data.session;
    if (!latest?.access_token || latest.access_token !== token) {
      throw new Error("로그인 계정이 변경되었습니다. 소유자 권한을 다시 확인해 주세요.");
    }
    return token;
  };
  const recordAuctionReceipt = async (transfer: AuctionTransfer) => {
    const form = auctionForms[transfer.id];
    if (!form?.amount || !form.depositorName) return;
    try {
      const currentToken = await requireCurrentToken();
      const response = await fetch(`/api/admin/operator/transfers/${transfer.id}/ledger`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentToken}` },
        body: JSON.stringify({ action: "record", kind: "auction", amount: Number(form.amount.replaceAll(",", "")), depositorName: form.depositorName, memo: form.memo }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "낙찰 입금 기록에 실패했습니다.");
      setAuctionForms((current) => ({ ...current, [transfer.id]: { amount: "", depositorName: "", memo: "" } }));
      await requireCurrentToken();
      await load(currentToken, sessionRevision);
    } catch (error) {
      setNoticeKind("error");
      setNotice(error instanceof Error ? error.message : "낙찰 입금 기록에 실패했습니다.");
    }
  };
  const recordShippingReceipt = async (payment: ShippingFeePayment) => {
    const form = feeForms[payment.id];
    if (!form?.amount || !form.depositorName) return;
    try {
      const currentToken = await requireCurrentToken();
      const response = await fetch(`/api/admin/operator/transfers/${payment.id}/ledger`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentToken}` },
        body: JSON.stringify({ action: "record", kind: "shipping", amount: Number(form.amount.replaceAll(",", "")), depositorName: form.depositorName, memo: form.memo }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "배송비 입금 기록에 실패했습니다.");
      setFeeForms((current) => ({ ...current, [payment.id]: { amount: "", depositorName: "", memo: "" } }));
      await requireCurrentToken();
      await load(currentToken, sessionRevision);
    } catch (error) {
      setNoticeKind("error");
      setNotice(error instanceof Error ? error.message : "배송비 입금 기록에 실패했습니다.");
    }
  };

  const runtimeStatusText = !visibleRuntime
    ? "결제 운영 모드를 확인 중입니다."
    : visibleRuntime.bankConfigured
      ? "수동 계좌이체만 활성화되어 있습니다. PortOne 코드는 향후 재도입을 위해 보관 중입니다."
      : "수동 계좌이체 계좌 설정을 확인해 주세요.";

  return <div className="space-y-8">
    <div className="flex flex-col items-start gap-5 border-b border-ink pb-6 md:flex-row md:items-end md:justify-between"><div><p className="eyebrow text-muted">소유자 · 배송·결제</p><h1 className="mt-3 text-3xl font-black tracking-[-.07em] md:text-4xl md:tracking-[-.08em]">배송·결제 현황</h1><p className="mt-3 text-sm text-muted">입금 계좌는 배포 환경변수로만 관리하고, 입금 기록은 운영자 원장에서 처리합니다.</p></div><button className="flex shrink-0 items-center gap-2 border border-line px-4 py-3 text-xs font-bold disabled:opacity-40" disabled={!token} onClick={() => void load(token, sessionRevision).catch((error) => { setNoticeKind("error"); setNotice(error instanceof Error ? error.message : "새로고침에 실패했습니다."); })} type="button"><RefreshCw size={13} /> 새로고침</button></div>
    {notice && <div aria-live="polite" className={noticeKind === "error" ? "border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700" : "border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800"}>{notice}</div>}
    <section className="border border-line bg-surface p-5"><div className="flex min-w-0 items-start gap-3"><LockKeyhole className="shrink-0" size={17} /><div><p className="text-xs font-bold">결제 운영 모드 · 수동 계좌이체</p><p className="mt-2 text-[11px] leading-5 text-muted">{runtimeStatusText}</p></div></div></section>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><div className="border border-line p-5"><p className="text-xs text-muted">잔액 입금 대기</p><p className="mt-2 font-mono text-3xl font-bold">{outstanding}</p></div><div className="border border-line p-5"><Truck size={16} /><p className="mt-6 text-xs text-muted">배송 대기</p><p className="mt-2 font-mono text-3xl font-bold">{visibleShipping.filter((row) => row.status !== "shipped").length}</p></div><div className="border border-line bg-ink p-5 text-paper"><p className="text-xs text-zinc-400">결제 설정</p><p className="mt-2 text-sm font-bold">{visibleRuntime ? "수동 계좌이체" : "확인 중"}</p></div></div>
    <section className="border border-line p-5 sm:p-6"><p className="text-xs font-bold">입금 원장 처리</p><p className="mt-2 text-xs leading-5 text-muted">입금자명·입금액·메모를 기록하고, 부분입금과 취소 원장을 주문 단위로 관리합니다.</p><Link className="mt-5 inline-flex bg-ink px-5 py-3 text-xs font-bold text-paper" href="/admin/operator/orders">입금 원장 열기</Link></section>
    <section className="border border-line"><div className="border-b border-line bg-surface px-4 py-4 sm:px-5"><p className="text-xs font-bold">배송비 수동 입금</p><p className="mt-1 text-[11px] text-muted">이용권 구매는 완납 시 배송 이용권 1회가 부여되며, 특정 배송 요청 건은 해당 배송비만 정산합니다.</p></div><div className="divide-y divide-line">{feePayments.map((payment) => { const form = feeForms[payment.id] ?? { amount: "", depositorName: "", memo: "" }; return <div className="px-4 py-5 sm:px-5" key={payment.id}><div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:gap-4"><div className="min-w-0"><p className="text-sm font-bold">{payment.shipping_request_id ? "배송 요청 배송비" : "배송 이용권 구매"}</p><p className="mt-1 text-[11px] text-muted">누적 {payment.receivedAmount.toLocaleString("ko-KR")}원 · 잔액 {payment.remainingAmount.toLocaleString("ko-KR")}원</p></div><strong className="shrink-0 font-mono text-sm">{payment.expected_amount.toLocaleString("ko-KR")}원</strong></div>{payment.remainingAmount > 0 && <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[140px_150px_1fr_auto]"><input className="h-10 min-w-0 border border-line px-3 text-xs" inputMode="numeric" onChange={(event) => setFeeForms((current) => ({ ...current, [payment.id]: { ...form, amount: event.target.value } }))} placeholder="입금액" value={form.amount} /><input className="h-10 min-w-0 border border-line px-3 text-xs" onChange={(event) => setFeeForms((current) => ({ ...current, [payment.id]: { ...form, depositorName: event.target.value } }))} placeholder="입금자명" value={form.depositorName} /><input className="h-10 min-w-0 border border-line px-3 text-xs" onChange={(event) => setFeeForms((current) => ({ ...current, [payment.id]: { ...form, memo: event.target.value } }))} placeholder="메모 (선택)" value={form.memo} /><button className="h-10 border border-ink px-4 text-xs font-bold disabled:opacity-40" disabled={!form.amount || !form.depositorName} onClick={() => void recordShippingReceipt(payment)} type="button">입금 기록</button></div>}</div>; })}{feePayments.length === 0 && <p className="px-5 py-12 text-center text-sm text-muted">배송비 입금 대기 건이 없습니다.</p>}</div></section>
    <section className="border border-line"><div className="border-b border-line bg-surface px-4 py-4 sm:px-5"><p className="text-xs font-bold">경매 낙찰 수동 입금</p><p className="mt-1 text-[11px] text-muted">낙찰 건도 동일한 원장 기준으로 부분입금을 기록합니다.</p></div><div className="divide-y divide-line">{auctionTransfers.map((transfer) => { const form = auctionForms[transfer.id] ?? { amount: "", depositorName: "", memo: "" }; return <div className="px-4 py-5 sm:px-5" key={transfer.id}><div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:gap-4"><div className="min-w-0"><p className="break-words text-sm font-bold">{transfer.order_name}</p><p className="mt-1 text-[11px] text-muted">누적 {transfer.receivedAmount.toLocaleString("ko-KR")}원 · 잔액 {transfer.remainingAmount.toLocaleString("ko-KR")}원</p></div><strong className="shrink-0 font-mono text-sm">{transfer.expected_amount.toLocaleString("ko-KR")}원</strong></div>{transfer.remainingAmount > 0 && <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[140px_150px_1fr_auto]"><input className="h-10 min-w-0 border border-line px-3 text-xs" inputMode="numeric" onChange={(event) => setAuctionForms((current) => ({ ...current, [transfer.id]: { ...form, amount: event.target.value } }))} placeholder="입금액" value={form.amount} /><input className="h-10 min-w-0 border border-line px-3 text-xs" onChange={(event) => setAuctionForms((current) => ({ ...current, [transfer.id]: { ...form, depositorName: event.target.value } }))} placeholder="입금자명" value={form.depositorName} /><input className="h-10 min-w-0 border border-line px-3 text-xs" onChange={(event) => setAuctionForms((current) => ({ ...current, [transfer.id]: { ...form, memo: event.target.value } }))} placeholder="메모 (선택)" value={form.memo} /><button className="h-10 border border-ink px-4 text-xs font-bold disabled:opacity-40" disabled={!form.amount || !form.depositorName} onClick={() => void recordAuctionReceipt(transfer)} type="button">입금 기록</button></div>}</div>; })}{auctionTransfers.length === 0 && <p className="px-5 py-12 text-center text-sm text-muted">수동 입금 대기 낙찰 건이 없습니다.</p>}</div></section>
  </div>;
}
