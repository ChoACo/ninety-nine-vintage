"use client";

import { Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import type { SaleType, SalesEntry, SettlementStatus } from "./types";

type TypeFilter = "all" | SaleType;
type StatusFilter = "all" | SettlementStatus;
const money = (value: number) => `₩${Math.round(value).toLocaleString("ko-KR")}`;

function statusOf(entry: SalesEntry): SettlementStatus {
  if (entry.entryKind !== "item_payment" || entry.amount < 0) return "refund";
  return entry.settlementStatus === "paid" ? "paid" : "pending";
}

export function SalesLedgerTable({ entries }: { entries: SalesEntry[] }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const rows = useMemo(() => entries.filter((entry) => {
    const matchesQuery = !deferredQuery || [entry.orderNumber, entry.productTitle ?? "", entry.buyerMasked ?? ""].some((value) => value.toLowerCase().includes(deferredQuery));
    return matchesQuery && (type === "all" || entry.saleType === type) && (status === "all" || statusOf(entry) === status);
  }), [deferredQuery, entries, status, type]);
  return <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
    <div className="flex flex-col gap-3 border-b border-zinc-800 p-4 lg:flex-row lg:items-center"><label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3"><Search className="text-zinc-500" size={16}/><input aria-label="매출 원장 검색" className="min-w-0 flex-1 bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600" onChange={(event) => setQuery(event.target.value)} placeholder="주문번호, 상품명, 구매자 검색" value={query}/></label><div className="flex flex-wrap gap-2"><select aria-label="판매 유형" className="min-h-11 rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-300" onChange={(event) => setType(event.target.value as TypeFilter)} value={type}><option value="all">전체 판매 유형</option><option value="auction">라이브 옥션</option><option value="shop">아카이브 숍</option></select><select aria-label="정산 상태" className="min-h-11 rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-xs text-zinc-300" onChange={(event) => setStatus(event.target.value as StatusFilter)} value={status}><option value="all">전체 정산 상태</option><option value="pending">정산 대기</option><option value="paid">정산 완료</option><option value="refund">환불</option></select></div></div>
    <div className="divide-y divide-zinc-800 md:hidden">
      {rows.map((entry) => {
        const rowStatus = statusOf(entry);
        const refund = rowStatus === "refund";
        const fee = refund ? 0 : entry.commissionAmount;
        const payout = refund ? -Math.abs(entry.amount) : Math.max(0, entry.amount - fee);
        return <article className="min-w-0 space-y-4 p-4" key={entry.id}><div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-black text-zinc-100">{entry.productTitle ?? "상품 정보 확인"}</p><p className="mt-1 break-all font-mono text-[10px] text-zinc-500">{entry.orderNumber} · {entry.buyerMasked ?? "구매자 확인 불가"}</p></div><span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold ${rowStatus === "paid" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : rowStatus === "refund" ? "border-rose-500/30 bg-rose-500/10 text-rose-400" : "border-amber-500/30 bg-amber-500/10 text-amber-400"}`}>{rowStatus === "paid" ? "정산완료" : rowStatus === "refund" ? "환불" : "정산 대기"}</span></div><div className="flex items-center justify-between gap-3 text-[10px]"><span className={`rounded-full px-2.5 py-1 font-bold ${entry.saleType === "auction" ? "bg-amber-500/10 text-amber-400" : "bg-indigo-500/10 text-indigo-400"}`}>{entry.saleType === "auction" ? "옥션" : "아카이브숍"}</span><time className="text-right text-zinc-500">{new Date(entry.occurredAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</time></div><dl className="grid grid-cols-3 gap-2 rounded-xl bg-zinc-950 p-3 text-right"><div><dt className="text-[10px] text-zinc-500">판매가</dt><dd className={`mt-1 break-all font-mono text-xs font-bold ${refund ? "text-rose-400" : "text-zinc-100"}`}>{money(entry.amount)}</dd></div><div><dt className="text-[10px] text-zinc-500">수수료</dt><dd className="mt-1 break-all font-mono text-xs text-zinc-400">{money(fee)}</dd></div><div><dt className="text-[10px] text-zinc-500">실정산</dt><dd className={`mt-1 break-all font-mono text-xs font-bold ${refund ? "text-rose-400" : "text-emerald-400"}`}>{money(payout)}</dd></div></dl></article>;
      })}
      {rows.length === 0 && <p className="px-4 py-16 text-center text-sm text-zinc-500">선택한 기간의 판매 내역이 없습니다.</p>}
    </div>
    <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[1040px] text-sm"><thead className="border-b border-zinc-800 bg-zinc-950/70 text-[11px] text-zinc-500"><tr><th className="px-4 py-3 text-left">주문일시</th><th className="px-4 py-3 text-center">판매 유형</th><th className="px-4 py-3 text-left">상품명</th><th className="px-4 py-3 text-left">주문번호 · 구매자</th><th className="px-4 py-3 text-right">판매가</th><th className="px-4 py-3 text-right">수수료</th><th className="px-4 py-3 text-right">실정산액</th><th className="px-4 py-3 text-center">상태</th></tr></thead><tbody className="divide-y divide-zinc-800">{rows.map((entry) => { const rowStatus = statusOf(entry); const refund = rowStatus === "refund"; const fee = refund ? 0 : entry.commissionAmount; const payout = refund ? -Math.abs(entry.amount) : Math.max(0, entry.amount - fee); return <tr className="transition hover:bg-zinc-800/40" key={entry.id}><td className="whitespace-nowrap px-4 py-4 text-left font-mono text-xs text-zinc-400">{new Date(entry.occurredAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</td><td className="px-4 py-4 text-center"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${entry.saleType === "auction" ? "bg-amber-500/10 text-amber-400" : "bg-indigo-500/10 text-indigo-400"}`}>{entry.saleType === "auction" ? "옥션 🔨" : "숍 🛍️"}</span></td><td className="max-w-[200px] truncate px-4 py-4 text-left font-medium text-zinc-200" title={entry.productTitle ?? "상품 정보 확인"}>{entry.productTitle ?? "상품 정보 확인"}</td><td className="px-4 py-4 text-left"><p className="font-mono text-[11px] text-zinc-300">{entry.orderNumber}</p><p className="mt-1 text-[10px] text-zinc-500">{entry.buyerMasked ?? "구매자 확인 불가"}</p></td><td className={`px-4 py-4 text-right font-mono font-bold ${refund ? "text-rose-400" : "text-zinc-100"}`}>{money(entry.amount)}</td><td className="px-4 py-4 text-right font-mono text-xs text-zinc-400">{money(fee)}</td><td className={`px-4 py-4 text-right font-mono font-bold ${refund ? "text-rose-400" : "text-emerald-400"}`}>{money(payout)}</td><td className="px-4 py-4 text-center"><span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold ${rowStatus === "paid" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : rowStatus === "refund" ? "border-rose-500/30 bg-rose-500/10 text-rose-400" : "border-amber-500/30 bg-amber-500/10 text-amber-400"}`}>{rowStatus === "paid" ? "정산완료" : rowStatus === "refund" ? "환불" : "정산 대기"}</span></td></tr>; })}{rows.length === 0 && <tr><td className="px-4 py-16 text-center text-sm text-zinc-500" colSpan={8}>선택한 기간의 판매 내역이 없습니다.</td></tr>}</tbody></table></div>
  </section>;
}
