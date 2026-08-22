"use client";

import { ExternalLink } from "lucide-react";
import { CatalogImage } from "@/components/ui/CatalogImage";
import type { OperatorOrderTransfer } from "./types";
import { orderShippingMode, orderWorkflowStatus } from "./types";

const won = (value: number) => `₩${value.toLocaleString("ko-KR")}`;
const statusLabel = {
  vault_pending: "보관 대기",
  ready_to_ship: "출고 준비",
  shipping: "배송 중",
  completed: "배송 완료",
  cancelled: "취소/반품",
  all: "전체",
} as const;

export function OrderTable({
  orders,
  selectedIds,
  onOpen,
  onSelectionChange,
}: Readonly<{
  orders: OperatorOrderTransfer[];
  selectedIds: Set<string>;
  onOpen: (order: OperatorOrderTransfer) => void;
  onSelectionChange: (ids: Set<string>) => void;
}>) {
  const allSelected =
    orders.length > 0 && orders.every((order) => selectedIds.has(order.id));
  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950 md:overflow-x-visible lg:overflow-x-auto">
      <table className="w-full min-w-[680px] table-fixed border-collapse text-left lg:min-w-[1180px]">
        <thead className="border-b border-zinc-800 bg-zinc-900/80 text-[10px] font-bold uppercase tracking-[.08em] text-zinc-500">
          <tr className="h-10">
            <th className="w-10 text-center">
              <input
                aria-label="현재 주문 전체 선택"
                checked={allSelected}
                onChange={() =>
                  onSelectionChange(
                    allSelected
                      ? new Set()
                      : new Set(orders.map((order) => order.id)),
                  )
                }
                type="checkbox"
              />
            </th>
            <th className="hidden w-32 lg:table-cell">주문일시</th>
            <th className="w-28 lg:w-36">주문번호</th>
            <th className="hidden w-28 lg:table-cell">구매자</th>
            <th className="w-[180px] lg:w-auto lg:min-w-[240px]">상품 정보</th>
            <th className="hidden w-24 text-center lg:table-cell">판매 유형</th>
            <th className="w-28 text-center lg:w-32">배송 방식</th>
            <th className="w-24 text-right lg:w-28">결제 금액</th>
            <th className="w-24 text-center lg:w-28">주문 상태</th>
            <th className="w-24 text-center lg:w-28">관리 작업</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {orders.map((order) => {
            const item = order.items[0];
            const saleTypes = new Set(
              order.items.map((candidate) => candidate.saleType),
            );
            const saleType =
              saleTypes.size > 1 ? "mixed" : (item?.saleType ?? "shop");
            const shipping = orderShippingMode(order);
            const status = orderWorkflowStatus(order);
            return (
              <tr
                className="h-[60px] cursor-pointer text-xs text-zinc-300 transition hover:bg-zinc-900/70 focus-within:bg-zinc-900/70"
                key={order.id}
                onClick={() => onOpen(order)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onOpen(order);
                }}
                tabIndex={0}
              >
                <td className="text-center">
                  <input
                    aria-label={`${order.order_id} 선택`}
                    checked={selectedIds.has(order.id)}
                    onChange={() => toggle(order.id)}
                    onClick={(event) => event.stopPropagation()}
                    type="checkbox"
                  />
                </td>
                <td className="hidden font-mono text-[11px] text-zinc-400 lg:table-cell">
                  {new Date(order.requested_at).toLocaleString("ko-KR", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td>
                  <button
                    className="max-w-32 truncate font-mono text-[11px] font-medium text-zinc-200 hover:underline"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(order);
                    }}
                    type="button"
                  >
                    {order.order_id}
                  </button>
                </td>
                <td className="hidden max-w-28 truncate text-zinc-300 lg:table-cell">
                  {order.buyerMasked}
                </td>
                <td>
                  <div className="flex items-center gap-3">
                    <CatalogImage
                      alt=""
                      className="size-10 shrink-0 rounded-lg object-cover"
                      sizes="40px"
                      src={item?.products?.image_urls?.[0] ?? ""}
                    />
                    <div className="min-w-0">
                      <p className="max-w-[140px] truncate text-sm font-medium text-zinc-100 lg:max-w-[250px]">
                        {item?.products?.title ?? "상품 정보 없음"}
                      </p>
                      <p className="mt-1 text-[10px] text-zinc-500">
                        {item?.conditionGrade
                          ? `Grade ${item.conditionGrade}`
                          : "등급 미입력"}
                        {order.items.length > 1
                          ? ` · 외 ${order.items.length - 1}개`
                          : ""}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="hidden text-center lg:table-cell">
                  <span
                    className={`rounded-md border px-2 py-1 text-[10px] font-bold ${saleType === "auction" ? "border-amber-500/20 bg-amber-500/10 text-amber-400" : saleType === "shop" ? "border-indigo-500/20 bg-indigo-500/10 text-indigo-400" : "border-zinc-700 bg-zinc-800 text-zinc-300"}`}
                  >
                    {saleType === "auction"
                      ? "옥션 🔨"
                      : saleType === "shop"
                        ? "숍 🛍️"
                        : "혼합"}
                  </span>
                </td>
                <td className="text-center">
                  <span
                    className={`rounded-md border px-2 py-1 text-[10px] font-bold ${shipping === "vault" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-blue-500/20 bg-blue-500/10 text-blue-400"}`}
                  >
                    {shipping === "vault" ? "📦 14일 보관함" : "🚚 즉시 발송"}
                  </span>
                </td>
                <td className="text-right font-mono font-bold text-zinc-100">
                  {won(order.expected_amount)}
                </td>
                <td className="text-center">
                  <span className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] font-bold text-zinc-200">
                    {statusLabel[status]}
                  </span>
                </td>
                <td className="text-center">
                  <button
                    className="inline-flex min-h-9 items-center gap-1 rounded-md border border-zinc-700 px-2 text-[10px] font-bold text-zinc-200 hover:bg-zinc-800"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(order);
                    }}
                    type="button"
                  >
                    {status === "ready_to_ship"
                      ? "송장입력"
                      : status === "vault_pending"
                        ? "보관입고"
                        : "상세"}
                    <ExternalLink size={11} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {orders.length === 0 && (
        <p className="py-16 text-center text-sm text-zinc-500">
          조건에 맞는 주문이 없습니다.
        </p>
      )}
    </div>
  );
}
