"use client";

import Link from "next/link";
import { ArrowRight, Minus, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { DEMO_PRODUCTS } from "@/lib/catalog";
import { useCommerceStore } from "@/store/useCommerceStore";

export function CartView() {
  const hydrate = useCommerceStore((state) => state.hydrate);
  const cartIds = useCommerceStore((state) => state.cartIds);
  const removeFromCart = useCommerceStore((state) => state.removeFromCart);
  const clearCart = useCommerceStore((state) => state.clearCart);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => hydrate(), [hydrate]);
  const products = DEMO_PRODUCTS.filter((product) => cartIds.includes(product.id) && product.saleType === "fixed");
  const total = products.reduce((sum, product) => sum + product.price, 0);
  const checkout = async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/orders/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productIds: products.map((product) => product.id), applyShippingCredit: true, idempotencyKey: "demo-checkout" }) });
      const payload = await response.json() as { order?: { id: string; total: number }; error?: string };
      if (!response.ok || !payload.order) throw new Error(payload.error ?? "주문을 만들지 못했습니다.");
      setMessage(`주문 ${payload.order.id} 생성 완료 · ${payload.order.total.toLocaleString("ko-KR")}원 계좌이체 안내를 준비 중입니다.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "주문을 만들지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <div className="space-y-10"><div className="flex items-end justify-between border-b border-ink pb-6"><div><p className="eyebrow text-muted">BAG / BUY NOW</p><h1 className="mt-3 text-4xl font-black tracking-[-0.08em]">장바구니</h1></div><span className="font-mono text-xs text-muted">{products.length} ITEMS</span></div>{products.length === 0 ? <div className="border border-dashed border-line py-24 text-center"><p className="text-sm font-bold">장바구니가 비어 있습니다.</p><Link className="mt-5 inline-flex items-center gap-2 text-xs font-bold underline" href="/shop">SHOP 둘러보기 <ArrowRight size={14} /></Link></div> : <div className="grid gap-10 lg:grid-cols-[1fr_360px]"><div className="divide-y divide-line border-y border-line">{products.map((product) => <div className="flex gap-5 py-5" key={product.id}><img alt="" className="size-28 object-cover" src={product.imageUrls[0]} /><div className="min-w-0 flex-1"><div className="flex justify-between gap-4"><div><p className="text-xs font-bold text-muted">{product.store.name}</p><h2 className="mt-2 truncate text-base font-bold">{product.title}</h2><p className="mt-2 text-xs text-muted">{product.size} · {product.condition}</p></div><button aria-label="장바구니에서 삭제" className="text-muted hover:text-ink" onClick={() => removeFromCart(product.id)} type="button"><Trash2 size={16} /></button></div><div className="mt-6 flex items-center justify-between"><div className="flex items-center gap-3 border border-line px-3 py-2 text-xs"><Minus size={12} /><span>1</span><Plus size={12} /></div><span className="font-mono text-sm font-bold">{product.price.toLocaleString("ko-KR")}원</span></div></div></div>)}</div><aside className="h-fit border-t-2 border-ink bg-surface p-6"><div className="flex justify-between text-xs"><span>상품 금액</span><strong className="font-mono">{total.toLocaleString("ko-KR")}원</strong></div><div className="mt-4 flex justify-between text-xs"><span>배송비</span><span className="text-muted">배송 크레딧 적용 가능</span></div><div className="mt-6 flex justify-between border-t border-line pt-5"><span className="text-sm font-bold">예상 결제 금액</span><strong className="font-mono text-xl">{total.toLocaleString("ko-KR")}원</strong></div><button className="mt-6 h-13 w-full bg-ink text-xs font-bold text-paper disabled:opacity-50" disabled={busy} onClick={checkout} type="button">{busy ? "주문 준비 중..." : "통합 주문하기"}</button>{message && <p className="mt-4 text-[11px] leading-5 text-muted">{message}</p>}<button className="mt-3 w-full text-[11px] text-muted underline" onClick={clearCart} type="button">장바구니 비우기</button></aside></div>}</div>;
}
