"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { formatKRW } from "@/utils/formatters";

interface FinancialEntry {
  id: string;
  entryKind: "item_payment" | "item_refund" | "payment_reversal";
  amount: number;
  occurredAt: string;
  inventoryItemId: string | null;
  manualRefundId: string | null;
  buyerName: string | null;
  productId: string | null;
  productTitle: string | null;
  productImageUrl: string | null;
}

function entryKindLabel(entryKind: FinancialEntry["entryKind"]) {
  if (entryKind === "item_payment") return "상품 결제";
  if (entryKind === "payment_reversal") return "결제 취소";
  return "상품 환불";
}

interface StoreReport {
  storeId: string;
  storeName: string;
  grossSales: number;
  refunds: number;
  netSales: number;
  paidItemCount: number;
  refundedItemCount: number;
  entries: FinancialEntry[];
}

interface ReportPayload {
  stores?: StoreReport[];
  centralShippingFees?: number;
  serverTime?: string;
  settlementSummary?: SettlementSummary;
  error?: string;
  message?: string;
}

interface SettlementSummary {
  totalSettlementSales: number;
  weeklySales: number;
  nextSettlementEstimate: number;
  paidTotal: number;
}

const EMPTY_SETTLEMENT_SUMMARY: SettlementSummary = {
  totalSettlementSales: 0,
  weeklySales: 0,
  nextSettlementEstimate: 0,
  paidTotal: 0,
};

function kstDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Seoul",
    year: "numeric",
  }).format(date);
}

export function OperatorRevenueConsole() {
  const { session } = useSupabaseSession();
  const token = session?.access_token ?? null;
  const today = kstDateKey();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [stores, setStores] = useState<StoreReport[]>([]);
  const [centralShippingFees, setCentralShippingFees] = useState(0);
  const [settlementSummary, setSettlementSummary] = useState<SettlementSummary>(EMPTY_SETTLEMENT_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setNotice("");
    try {
      const query = new URLSearchParams({ from, to });
      const response = await fetch(`/api/admin/operator/revenue?${query}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json() as ReportPayload;
      if (!response.ok || !Array.isArray(payload.stores)) {
        throw new Error(payload.message ?? "매장별 매출을 불러오지 못했습니다.");
      }
      setStores(payload.stores);
      setCentralShippingFees(payload.centralShippingFees ?? 0);
      setSettlementSummary(payload.settlementSummary ?? EMPTY_SETTLEMENT_SUMMARY);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "매장별 매출을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [from, to, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const totals = useMemo(() => stores.reduce((result, store) => ({
    gross: result.gross + store.grossSales,
    refunds: result.refunds + store.refunds,
    net: result.net + store.netSales,
  }), { gross: 0, refunds: 0, net: 0 }), [stores]);

  return (
    <div className="space-y-8">
      <header className="flex flex-col justify-between gap-5 border-b border-ink pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow text-muted">운영자 / 매장별 재무 원장</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-.06em] sm:text-4xl sm:tracking-[-.08em]">매출 현황</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">결제 확정 상품은 원등록 매장 매출로, 결제 취소와 환불은 같은 매장의 음수 원장으로 기록합니다. 배송비는 사업체 공용 수익으로 분리합니다.</p>
        </div>
        <button className="flex items-center justify-center gap-2 border border-line px-4 py-3 text-xs font-bold disabled:opacity-40" disabled={!token || loading} onClick={() => void load()} type="button"><RefreshCw size={14} /> 새로고침</button>
      </header>

      <div className="grid gap-3 border border-line bg-surface p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="text-xs font-bold">시작일<input className="mt-2 h-10 w-full border border-line bg-paper px-3 font-normal" max={to} onChange={(event) => setFrom(event.target.value)} type="date" value={from} /></label>
        <label className="text-xs font-bold">종료일<input className="mt-2 h-10 w-full border border-line bg-paper px-3 font-normal" max={today} min={from} onChange={(event) => setTo(event.target.value)} type="date" value={to} /></label>
        <button className="h-10 bg-ink px-5 text-xs font-bold text-paper disabled:opacity-40" disabled={!token || loading || !from || !to} onClick={() => void load()} type="button">기간 조회</button>
      </div>

      {notice && <p aria-live="polite" className="border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">{notice}</p>}

      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
        <article className="bg-paper p-5"><p className="text-xs text-muted">선택 기간 총매출</p><p className="mt-3 font-mono text-2xl font-bold">{formatKRW(totals.gross)}</p></article>
        <article className="bg-paper p-5"><p className="text-xs text-muted">이번 주 매출</p><p className="mt-3 font-mono text-2xl font-bold">{formatKRW(settlementSummary.weeklySales)}</p></article>
        <article className="bg-ink p-5 text-paper"><p className="text-xs text-zinc-400">다음 정산 예정</p><p className="mt-3 font-mono text-2xl font-bold">{formatKRW(settlementSummary.nextSettlementEstimate)}</p><p className="mt-2 text-[10px] text-zinc-400">월·목요일 18:00 KST 기준</p></article>
        <article className="bg-paper p-5"><p className="text-xs text-muted">누적 지급 완료</p><p className="mt-3 font-mono text-2xl font-bold">{formatKRW(settlementSummary.paidTotal)}</p></article>
      </div>

      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
        <article className="bg-paper p-4"><p className="text-[10px] text-muted">누적 정산 매출</p><p className="mt-2 font-mono font-bold">{formatKRW(settlementSummary.totalSettlementSales)}</p></article>
        <article className="bg-paper p-4"><p className="text-[10px] text-muted">선택 기간 취소·환불</p><p className="mt-2 font-mono font-bold text-rose-700">-{formatKRW(totals.refunds)}</p></article>
        <article className="bg-paper p-4"><p className="text-[10px] text-muted">선택 기간 순매출</p><p className="mt-2 font-mono font-bold">{formatKRW(totals.net)}</p></article>
        <article className="bg-paper p-4"><p className="text-[10px] text-muted">센터 공용 배송비</p><p className="mt-2 font-mono font-bold">{formatKRW(centralShippingFees)}</p></article>
      </div>

      <section className="space-y-5" aria-busy={loading}>
        {stores.map((store) => (
          <article className="border border-line" key={store.storeId}>
            <div className="grid gap-px border-b border-line bg-line sm:grid-cols-4">
              <div className="bg-surface p-4"><p className="text-sm font-black">{store.storeName}</p><p className="mt-2 text-[10px] text-muted">결제 상품 {store.paidItemCount} · 환불 상품 {store.refundedItemCount}</p></div>
              <div className="bg-paper p-4"><p className="text-[10px] text-muted">결제</p><p className="mt-2 font-mono font-bold">{formatKRW(store.grossSales)}</p></div>
              <div className="bg-paper p-4"><p className="text-[10px] text-muted">취소·환불</p><p className="mt-2 font-mono font-bold">-{formatKRW(store.refunds)}</p></div>
              <div className="bg-paper p-4"><p className="text-[10px] text-muted">순매출</p><p className="mt-2 font-mono font-bold">{formatKRW(store.netSales)}</p></div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-xs">
                <thead className="border-b border-line text-[10px] text-muted"><tr><th className="px-4 py-3">시각</th><th className="px-4 py-3">구분</th><th className="px-4 py-3">상품</th><th className="px-4 py-3">구매자</th><th className="px-4 py-3">금액</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {store.entries.map((entry) => <tr key={entry.id}><td className="px-4 py-3">{new Date(entry.occurredAt).toLocaleString("ko-KR")}</td><td className="px-4 py-3">{entryKindLabel(entry.entryKind)}</td><td className="px-4 py-3">{entry.productId ? <Link className="flex min-w-0 items-center gap-3 hover:underline" href={`/auction/${entry.productId}`}><CatalogImage alt="" className="size-10 shrink-0 rounded-lg object-cover" sizes="40px" src={entry.productImageUrl ?? ""} /><span className="max-w-52 truncate font-bold">{entry.productTitle ?? "상품 정보 확인"}</span></Link> : <span className="text-muted">상품 정보 없음</span>}</td><td className="px-4 py-3 font-bold">{entry.buyerName ?? "-"}</td><td className={`px-4 py-3 font-mono font-bold ${entry.amount < 0 ? "text-rose-700" : ""}`}>{formatKRW(entry.amount)}</td></tr>)}
                  {store.entries.length === 0 && <tr><td className="px-4 py-10 text-center text-muted" colSpan={5}>선택 기간의 원장 항목이 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          </article>
        ))}
        {!loading && stores.length === 0 && <p className="border border-dashed border-line py-14 text-center text-sm text-muted">조회 권한이 있는 매장 또는 원장이 없습니다.</p>}
      </section>
    </div>
  );
}
