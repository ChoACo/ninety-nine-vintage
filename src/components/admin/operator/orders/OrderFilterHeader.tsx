"use client";

import { Download, Search } from "lucide-react";
import type { OperatorOrderTransfer, OrderSaleFilter, OrderStatusFilter } from "./types";
import { orderWorkflowStatus } from "./types";

const FILTERS: Array<{ value: OrderStatusFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "vault_pending", label: "📦 보관함 적재 대기" },
  { value: "ready_to_ship", label: "🚚 즉시 출고 준비" },
  { value: "shipping", label: "배송 중" },
  { value: "completed", label: "배송 완료" },
  { value: "cancelled", label: "취소/반품" },
];

function downloadOrders(orders: OperatorOrderTransfer[]) {
  const rows = [["주문일시", "주문번호", "구매자", "상품명", "판매유형", "배송비", "결제금액", "상태"], ...orders.map((order) => [
    new Date(order.requested_at).toLocaleString("ko-KR"), order.order_id, order.buyerMasked,
    order.items.map((item) => item.products?.title ?? item.product_id).join(" / "),
    [...new Set(order.items.map((item) => item.saleType === "auction" ? "라이브 옥션" : "아카이브 숍"))].join(" / "),
    String(order.orderMeta?.shipping_fee ?? 0), String(order.expected_amount), orderWorkflowStatus(order),
  ])];
  const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `operator-orders-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click();
  URL.revokeObjectURL(url);
}

export function OrderFilterHeader({ allOrders, filteredOrders, query, saleType, status, onQueryChange, onSaleTypeChange, onStatusChange }: Readonly<{
  allOrders: OperatorOrderTransfer[];
  filteredOrders: OperatorOrderTransfer[];
  query: string;
  saleType: OrderSaleFilter;
  status: OrderStatusFilter;
  onQueryChange: (value: string) => void;
  onSaleTypeChange: (value: OrderSaleFilter) => void;
  onStatusChange: (value: OrderStatusFilter) => void;
}>) {
  const counts = Object.fromEntries(FILTERS.map(({ value }) => [value, value === "all" ? allOrders.length : allOrders.filter((order) => orderWorkflowStatus(order) === value).length]));
  return <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3 xl:flex-row xl:items-center xl:justify-between">
    <div className="flex min-w-0 gap-1 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none]" role="tablist" aria-label="주문 상태">
      {FILTERS.map((filter) => <button aria-selected={status === filter.value} className={`min-h-11 shrink-0 rounded-lg border px-3 text-[11px] font-bold transition ${status === filter.value ? "border-amber-500/60 bg-zinc-800 text-zinc-100" : "border-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"}`} key={filter.value} onClick={() => onStatusChange(filter.value)} role="tab" type="button">{filter.label} <span className={`ml-1 font-mono ${filter.value === "vault_pending" ? "text-emerald-400" : filter.value === "ready_to_ship" ? "text-blue-400" : "text-zinc-500"}`}>{counts[filter.value]}</span></button>)}
    </div>
    <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
      <select aria-label="판매 유형" className="h-10 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs text-zinc-200" onChange={(event) => onSaleTypeChange(event.target.value as OrderSaleFilter)} value={saleType}><option value="all">전체 판매 유형</option><option value="auction">라이브 옥션 🔨</option><option value="shop">아카이브 숍 🛍️</option></select>
      <label className="flex h-10 w-full items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 sm:w-64"><Search className="text-zinc-500" size={14} /><span className="sr-only">주문 검색</span><input className="min-w-0 flex-1 bg-transparent text-xs text-zinc-100 outline-none" onChange={(event) => onQueryChange(event.target.value)} placeholder="주문번호·구매자·상품" value={query} /></label>
      <button className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-700 px-3 text-xs font-bold text-zinc-200 hover:bg-zinc-800" onClick={() => downloadOrders(filteredOrders)} type="button"><Download size={14} />엑셀 다운로드</button>
    </div>
  </div>;
}
