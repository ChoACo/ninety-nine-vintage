"use client";

import Link from "next/link";
import { LockKeyhole, RefreshCw, Truck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface Transfer { status: string; remainingAmount?: number; }
interface Shipping { status: string; }
interface Runtime { activeMode: string; bankConfigured: boolean; configurationSource?: string; portoneLocked: boolean; }
interface AuctionTransfer { id: string; order_name: string; expected_amount: number; receivedAmount: number; remainingAmount: number; status: string; }
interface ShippingFeePayment { id: string; expected_amount: number; receivedAmount: number; remainingAmount: number; status: string; shipping_request_id: string | null; }

export function OwnerOperationsConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [shipping, setShipping] = useState<Shipping[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [auctionTransfers, setAuctionTransfers] = useState<AuctionTransfer[]>([]);
  const [feePayments, setFeePayments] = useState<ShippingFeePayment[]>([]);
  const [auctionForms, setAuctionForms] = useState<Record<string, { amount: string; depositorName: string; memo: string }>>({});
  const [feeForms, setFeeForms] = useState<Record<string, { amount: string; depositorName: string; memo: string }>>({});
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (accessToken: string | null) => {
    if (!accessToken) return;
    const headers = { Authorization: `Bearer ${accessToken}` };
    const [operationResponse, runtimeResponse] = await Promise.all([
      fetch("/api/owner/operations", { headers, cache: "no-store" }),
      fetch("/api/owner/payment-mode", { headers, cache: "no-store" }),
    ]);
    const operation = await operationResponse.json() as { shipping?: Shipping[]; transfers?: Transfer[]; auctionTransfers?: AuctionTransfer[]; feePayments?: ShippingFeePayment[]; error?: string };
    const payment = await runtimeResponse.json() as Runtime & { error?: string };
    if (!operationResponse.ok) throw new Error(operation.error ?? "Owner 운영 현황을 불러오지 못했습니다.");
    setShipping(operation.shipping ?? []);
    setTransfers(operation.transfers ?? []);
    setAuctionTransfers(operation.auctionTransfers ?? []);
    setFeePayments(operation.feePayments ?? []);
    if (runtimeResponse.ok) setRuntime(payment);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
        setToken(session?.access_token ?? null);
        if (session) await load(session.access_token);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Owner 운영 현황을 불러오지 못했습니다.");
      }
    })();
  }, [load]);

  const outstanding = transfers.filter((transfer) => (transfer.remainingAmount ?? 1) > 0).length;
  const recordAuctionReceipt = async (transfer: AuctionTransfer) => {
    const form = auctionForms[transfer.id];
    if (!token || !form?.amount || !form.depositorName) return;
    try {
      const response = await fetch(`/api/operator/transfers/${transfer.id}/ledger`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "record", kind: "auction", amount: Number(form.amount.replaceAll(",", "")), depositorName: form.depositorName, memo: form.memo }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "낙찰 입금 기록에 실패했습니다.");
      setAuctionForms((current) => ({ ...current, [transfer.id]: { amount: "", depositorName: "", memo: "" } }));
      await load(token);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "낙찰 입금 기록에 실패했습니다.");
    }
  };
  const recordShippingReceipt = async (payment: ShippingFeePayment) => {
    const form = feeForms[payment.id];
    if (!token || !form?.amount || !form.depositorName) return;
    try {
      const response = await fetch(`/api/operator/transfers/${payment.id}/ledger`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "record", kind: "shipping", amount: Number(form.amount.replaceAll(",", "")), depositorName: form.depositorName, memo: form.memo }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "배송비 입금 기록에 실패했습니다.");
      setFeeForms((current) => ({ ...current, [payment.id]: { amount: "", depositorName: "", memo: "" } }));
      await load(token);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "배송비 입금 기록에 실패했습니다.");
    }
  };
  return <div className="space-y-8">
    <div className="flex items-end justify-between border-b border-ink pb-6"><div><p className="eyebrow text-muted">OWNER / OPERATIONS</p><h1 className="mt-3 text-4xl font-black tracking-[-.08em]">배송·결제 현황</h1><p className="mt-3 text-sm text-muted">입금 계좌는 배포 환경변수로만 관리하고, 입금 기록은 운영자 원장에서 처리합니다.</p></div><button className="flex items-center gap-2 border border-line px-4 py-3 text-xs font-bold" onClick={() => void load(token).catch((error) => setNotice(error instanceof Error ? error.message : "새로고침에 실패했습니다."))} type="button"><RefreshCw size={13} /> 새로고침</button></div>
    {notice && <div aria-live="polite" className="border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{notice}</div>}
    <section className="border border-line bg-surface p-5"><div className="flex items-start gap-3"><LockKeyhole size={17} /><div><p className="text-xs font-bold">수동 계좌이체 고정</p><p className="mt-2 text-[11px] text-muted">{runtime?.bankConfigured ? "계좌 설정이 서버 환경변수에서 확인되었습니다." : "서버 환경변수에 계좌 설정이 필요합니다."} PG 결제는 이 운영 모드에서 사용하지 않습니다.</p></div></div></section>
    <div className="grid grid-cols-3 gap-4"><div className="border border-line p-5"><p className="text-xs text-muted">잔액 입금 대기</p><p className="mt-2 font-mono text-3xl font-bold">{outstanding}</p></div><div className="border border-line p-5"><Truck size={16} /><p className="mt-6 text-xs text-muted">배송 대기</p><p className="mt-2 font-mono text-3xl font-bold">{shipping.filter((row) => row.status !== "shipped").length}</p></div><div className="border border-line bg-ink p-5 text-paper"><p className="text-xs text-zinc-400">결제 설정</p><p className="mt-2 text-sm font-bold">{runtime?.activeMode === "manual_transfer" ? "수동 계좌이체" : "확인 중"}</p></div></div>
    <section className="border border-line p-6"><p className="text-xs font-bold">입금 원장 처리</p><p className="mt-2 text-xs leading-5 text-muted">입금자명·입금액·메모를 기록하고, 부분입금과 취소 원장을 주문 단위로 관리합니다.</p><Link className="mt-5 inline-flex bg-ink px-5 py-3 text-xs font-bold text-paper" href="/operator/orders">입금 원장 열기</Link></section>
    <section className="border border-line"><div className="border-b border-line bg-surface px-5 py-4"><p className="text-xs font-bold">배송비 수동 입금</p><p className="mt-1 text-[11px] text-muted">이용권 구매는 완납 시 배송 이용권 1회가 부여되며, 특정 배송 요청 건은 해당 배송비만 정산합니다.</p></div><div className="divide-y divide-line">{feePayments.map((payment) => { const form = feeForms[payment.id] ?? { amount: "", depositorName: "", memo: "" }; return <div className="px-5 py-5" key={payment.id}><div className="flex justify-between gap-4"><div><p className="text-sm font-bold">{payment.shipping_request_id ? "배송 요청 배송비" : "배송 이용권 구매"}</p><p className="mt-1 text-[11px] text-muted">누적 {payment.receivedAmount.toLocaleString("ko-KR")}원 · 잔액 {payment.remainingAmount.toLocaleString("ko-KR")}원</p></div><strong className="font-mono text-sm">{payment.expected_amount.toLocaleString("ko-KR")}원</strong></div>{payment.remainingAmount > 0 && <div className="mt-4 grid grid-cols-[140px_150px_1fr_auto] gap-2"><input className="h-10 border border-line px-3 text-xs" inputMode="numeric" onChange={(event) => setFeeForms((current) => ({ ...current, [payment.id]: { ...form, amount: event.target.value } }))} placeholder="입금액" value={form.amount} /><input className="h-10 border border-line px-3 text-xs" onChange={(event) => setFeeForms((current) => ({ ...current, [payment.id]: { ...form, depositorName: event.target.value } }))} placeholder="입금자명" value={form.depositorName} /><input className="h-10 border border-line px-3 text-xs" onChange={(event) => setFeeForms((current) => ({ ...current, [payment.id]: { ...form, memo: event.target.value } }))} placeholder="메모 (선택)" value={form.memo} /><button className="border border-ink px-4 text-xs font-bold disabled:opacity-40" disabled={!form.amount || !form.depositorName} onClick={() => void recordShippingReceipt(payment)} type="button">입금 기록</button></div>}</div>; })}{feePayments.length === 0 && <p className="px-5 py-12 text-center text-sm text-muted">배송비 입금 대기 건이 없습니다.</p>}</div></section>
    <section className="border border-line"><div className="border-b border-line bg-surface px-5 py-4"><p className="text-xs font-bold">경매 낙찰 수동 입금</p><p className="mt-1 text-[11px] text-muted">낙찰 건도 동일한 원장 기준으로 부분입금을 기록합니다.</p></div><div className="divide-y divide-line">{auctionTransfers.map((transfer) => { const form = auctionForms[transfer.id] ?? { amount: "", depositorName: "", memo: "" }; return <div className="px-5 py-5" key={transfer.id}><div className="flex justify-between gap-4"><div><p className="text-sm font-bold">{transfer.order_name}</p><p className="mt-1 text-[11px] text-muted">누적 {transfer.receivedAmount.toLocaleString("ko-KR")}원 · 잔액 {transfer.remainingAmount.toLocaleString("ko-KR")}원</p></div><strong className="font-mono text-sm">{transfer.expected_amount.toLocaleString("ko-KR")}원</strong></div>{transfer.remainingAmount > 0 && <div className="mt-4 grid grid-cols-[140px_150px_1fr_auto] gap-2"><input className="h-10 border border-line px-3 text-xs" inputMode="numeric" onChange={(event) => setAuctionForms((current) => ({ ...current, [transfer.id]: { ...form, amount: event.target.value } }))} placeholder="입금액" value={form.amount} /><input className="h-10 border border-line px-3 text-xs" onChange={(event) => setAuctionForms((current) => ({ ...current, [transfer.id]: { ...form, depositorName: event.target.value } }))} placeholder="입금자명" value={form.depositorName} /><input className="h-10 border border-line px-3 text-xs" onChange={(event) => setAuctionForms((current) => ({ ...current, [transfer.id]: { ...form, memo: event.target.value } }))} placeholder="메모 (선택)" value={form.memo} /><button className="border border-ink px-4 text-xs font-bold disabled:opacity-40" disabled={!form.amount || !form.depositorName} onClick={() => void recordAuctionReceipt(transfer)} type="button">입금 기록</button></div>}</div>; })}{auctionTransfers.length === 0 && <p className="px-5 py-12 text-center text-sm text-muted">수동 입금 대기 낙찰 건이 없습니다.</p>}</div></section>
  </div>;
}
