"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { CatalogImage } from "@/components/ui/CatalogImage";

interface OrderItem { id: string; unit_price: number; payment_status: string; products?: { id: string; title: string; image_urls: string[] } | null; }
interface Transfer { expected_amount: number; bank_name_snapshot: string; account_number_snapshot: string; status: string; }
interface Order { id: string; status: string; total: number; created_at: string; commerce_order_items?: OrderItem[]; transfer?: Transfer | null; }

const statusLabels: Record<string, string> = { awaiting_payment: "입금 대기", paid: "결제 완료·보관 중", partially_paid: "일부 결제", shipped: "배송 완료", cancelled: "취소" };

export function OrderHistory() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        if (!data.session?.access_token) return;
        const response = await fetch("/api/orders", { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
        if (response.ok) setOrders(((await response.json()) as { orders?: Order[] }).orders ?? []);
      } catch { /* Guests and local builds without Supabase do not have order history. */ }
      finally { setLoaded(true); }
    })();
  }, []);
  if (!loaded || orders.length === 0) return null;
  return <section id="orders"><div className="mb-5 flex items-end justify-between border-b border-ink pb-4"><div><p className="eyebrow text-muted">ORDERS / BUY NOW</p><h2 className="mt-2 text-xl font-black tracking-[-0.05em]">즉시구매 주문</h2></div><Link className="text-xs font-bold underline" href="/shop">BUY NOW 계속 보기</Link></div><div className="divide-y divide-line border-y border-line">{orders.map((order) => <article className="py-5" key={order.id}><div className="flex items-center justify-between gap-4"><div><p className="font-mono text-[10px] text-muted">{new Date(order.created_at).toLocaleString("ko-KR")} · {order.id}</p><p className="mt-2 text-sm font-bold">{statusLabels[order.status] ?? order.status}</p></div><strong className="font-mono text-sm">{order.total.toLocaleString("ko-KR")}원</strong></div><div className="mt-4 flex flex-wrap gap-3">{(order.commerce_order_items ?? []).map((item) => <Link className="flex w-[220px] items-center gap-3 border border-line p-2" href={`/auction/${item.products?.id ?? item.id}`} key={item.id}>{item.products?.image_urls?.[0] ? <CatalogImage alt="" className="size-12 object-cover" loading="lazy" src={item.products.image_urls[0]} /> : <div className="size-12 bg-surface" />}<span className="truncate text-xs font-bold">{item.products?.title ?? "상품"}</span></Link>)}</div>{order.status === "awaiting_payment" && order.transfer && <p className="mt-4 border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] leading-5 text-amber-900">{order.transfer.expected_amount.toLocaleString("ko-KR")}원 · {order.transfer.bank_name_snapshot} {order.transfer.account_number_snapshot}로 입금해 주세요. 입금 확인 후 보관 기간이 시작됩니다.</p>}</article>)}</div></section>;
}
