"use client";

import Link from "next/link";
import { PackageCheck, Truck, X } from "lucide-react";
import type { ReactNode } from "react";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
import { CatalogImage } from "@/components/ui/CatalogImage";
import type { OperatorOrderTransfer } from "./types";
import { orderShippingMode, orderWorkflowStatus } from "./types";

const won = (value: number) => `₩${value.toLocaleString("ko-KR")}`;

export function OrderDetailDrawer({ children, onClose, order }: Readonly<{ children?: ReactNode; onClose: () => void; order: OperatorOrderTransfer | null }>) {
  const mode = order ? orderShippingMode(order) : "vault";
  const status = order ? orderWorkflowStatus(order) : "all";
  return <PremiumDialog ariaLabel="주문 상세" labelledBy="operator-order-detail-title" onClose={onClose} open={Boolean(order)} panelClassName="ml-auto h-full max-h-none w-full max-w-xl rounded-none border-l border-zinc-800 bg-zinc-900 text-zinc-100">
    {order && <div className="min-h-full p-6"><header className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-5"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-zinc-500">Order detail</p><h2 className="mt-2 text-xl font-black" id="operator-order-detail-title">주문 상세</h2><p className="mt-2 font-mono text-xs text-zinc-400">{order.order_id} · {new Date(order.requested_at).toLocaleString("ko-KR")}</p></div><button aria-label="주문 상세 닫기" className="grid size-10 place-items-center rounded-lg border border-zinc-700" onClick={onClose} type="button"><X size={17} /></button></header>
      <section className="grid gap-4 border-b border-zinc-800 py-5 sm:grid-cols-2"><div><p className="text-[10px] text-zinc-500">구매자</p><p className="mt-1 text-sm font-bold">{order.buyerMasked}</p><p className="mt-1 break-all font-mono text-[10px] text-zinc-500">{order.member_id}</p></div><div><p className="text-[10px] text-zinc-500">배송지·연락처</p><p className="mt-1 text-sm font-bold">{mode === "immediate" ? "즉시 발송 신청" : "결제 후 보관함 적재"}</p><p className="mt-1 text-xs leading-5 text-zinc-400">주소 원문은 배송 신청 이후 출고 관리에서 열람 사유를 남기고 확인할 수 있습니다.</p></div></section>
      <section className="border-b border-zinc-800 py-5"><p className="text-xs font-black">결제 상세</p><dl className="mt-3 space-y-2 text-xs"><div className="flex justify-between"><dt className="text-zinc-500">상품 금액</dt><dd className="font-mono">{won(order.orderMeta?.subtotal ?? Math.max(0, order.expected_amount - (order.orderMeta?.shipping_fee ?? 0)))}</dd></div><div className="flex justify-between"><dt className="text-zinc-500">배송비</dt><dd className="font-mono">{won(order.orderMeta?.shipping_fee ?? 0)}</dd></div><div className="flex justify-between border-t border-zinc-800 pt-3 text-sm font-black"><dt>총 결제금액</dt><dd className="font-mono">{won(order.expected_amount)}</dd></div></dl></section>
      <section className="py-5"><p className="text-xs font-black">상품 정보</p><div className="mt-3 divide-y divide-zinc-800 border-y border-zinc-800">{order.items.map((item) => <div className="flex items-center gap-3 py-3" key={item.product_id}><CatalogImage alt="" className="size-12 rounded-lg object-cover" sizes="48px" src={item.products?.image_urls?.[0] ?? ""} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.products?.title ?? item.product_id}</p><p className="mt-1 text-[10px] text-zinc-500">{item.saleType === "auction" ? "라이브 옥션" : "아카이브 숍"} · {item.conditionGrade ? `Grade ${item.conditionGrade}` : "등급 미입력"} · {won(item.unit_price)}</p></div></div>)}</div></section>
      <div className="flex flex-col gap-2 border-t border-zinc-800 pt-5 sm:flex-row">{status === "vault_pending" && <Link className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 text-xs font-black text-zinc-950" href="/admin/operator/storage"><PackageCheck size={15} />보관함 확인</Link>}{status === "ready_to_ship" && <Link className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 text-xs font-black text-white" href="/admin/operator/shipping"><Truck size={15} />송장 번호 등록 및 배송 시작</Link>}</div>
      {children}
    </div>}
  </PremiumDialog>;
}
