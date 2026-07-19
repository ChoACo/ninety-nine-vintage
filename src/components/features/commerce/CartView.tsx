"use client";

import Link from "next/link";
import { ArrowRight, Minus, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCommerceStore } from "@/store/useCommerceStore";

interface PublishedFixedProduct {
  id: string;
  title: string;
  description: string;
  category: string;
  publishAt: string;
  closesAt: string;
  startingPrice: number;
  currentPrice: number;
  fixedPrice: number | null;
  imageUrls: string[];
  storageClass?: "small" | "large";
  sizeLabel?: string;
  conditionGrade?: "S" | "A+" | "A" | "B";
}

interface CartProduct {
  id: string; title: string; description: string; category: string; size: string;
  condition: "NEW" | "EXCELLENT" | "GOOD" | "FAIR"; conditionGrade: "S" | "A+" | "A" | "B";
  saleType: "fixed"; price: number; startingPrice: number; bidCount: number; closesAt: string;
  store: { id: string; slug: string; name: string; operator: string; description: string; accent: string };
  imageUrls: string[]; storageClass: "small" | "large";
  measurements: { shoulder: number; chest: number; sleeve: number; length: number }; inspectionNotes: string[];
}

function toCartProduct(product: PublishedFixedProduct): CartProduct {
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    category: product.category,
    size: product.sizeLabel || "—",
    condition: product.conditionGrade === "S" ? "NEW" : product.conditionGrade === "B" ? "FAIR" : product.conditionGrade === "A+" ? "EXCELLENT" : "GOOD",
    conditionGrade: product.conditionGrade ?? "A",
    saleType: "fixed",
    price: product.fixedPrice ?? product.currentPrice,
    startingPrice: product.startingPrice,
    bidCount: 0,
    closesAt: product.closesAt,
    store: { id: "live-store", slug: "live", name: "NINETY-NINE VINTAGE", operator: "TEAM", description: "", accent: "#c7b9a5" },
    imageUrls: product.imageUrls,
    storageClass: product.storageClass ?? "small",
    measurements: { shoulder: 0, chest: 0, sleeve: 0, length: 0 },
    inspectionNotes: [],
  };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function CartView() {
  const hydrate = useCommerceStore((state) => state.hydrate);
  const cartIds = useCommerceStore((state) => state.cartIds);
  const removeFromCart = useCommerceStore((state) => state.removeFromCart);
  const clearCart = useCommerceStore((state) => state.clearCart);
  const [liveProducts, setLiveProducts] = useState<CartProduct[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => { hydrate(); }, [hydrate]);
  useEffect(() => {
    fetch("/api/products?saleType=fixed&limit=100", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ products?: PublishedFixedProduct[] }> : Promise.reject(new Error("상품 목록을 불러오지 못했습니다.")))
      .then((payload) => setLiveProducts((payload.products ?? []).map(toCartProduct)))
      .catch(() => setLiveProducts([]));
  }, []);

  const catalog = useMemo(() => liveProducts, [liveProducts]);
  const products = catalog.filter((product) => cartIds.includes(product.id) && product.saleType === "fixed");
  const total = products.reduce((sum, product) => sum + product.price, 0);
  const containsDemo = products.some((product) => !isUuid(product.id));

  const checkout = async () => {
    if (containsDemo) {
      setMessage("예시 상품은 화면 확인용입니다. 운영 상품을 등록한 뒤 주문할 수 있습니다.");
      return;
    }
    setBusy(true); setMessage("");
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("카카오 로그인 후 주문할 수 있습니다.");
      const response = await fetch("/api/orders/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ productIds: products.map((product) => product.id), applyShippingCredit: true, idempotencyKey: crypto.randomUUID() }),
      });
      const payload = await response.json() as { order?: { id: string; total: number }; error?: string };
      if (!response.ok || !payload.order) throw new Error(payload.error ?? "주문을 만들지 못했습니다.");
      setMessage(`주문 ${payload.order.id} 생성 완료 · ${payload.order.total.toLocaleString("ko-KR")}원 계좌이체 안내를 준비 중입니다.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "주문을 만들지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <div className="space-y-10"><div className="flex items-end justify-between border-b border-ink pb-6"><div><p className="eyebrow text-muted">BAG / BUY NOW</p><h1 className="mt-3 text-4xl font-black tracking-[-0.08em]">장바구니</h1></div><span className="font-mono text-xs text-muted">{products.length} ITEMS</span></div>{products.length === 0 ? <div className="border border-dashed border-line py-24 text-center"><p className="text-sm font-bold">장바구니가 비어 있습니다.</p><Link className="mt-5 inline-flex items-center gap-2 text-xs font-bold underline" href="/shop">SHOP 둘러보기 <ArrowRight size={14} /></Link></div> : <div className="grid gap-10 lg:grid-cols-[1fr_360px]"><div className="divide-y divide-line border-y border-line">{products.map((product) => <div className="flex gap-5 py-5" key={product.id}><img alt="" className="size-28 object-cover" src={product.imageUrls[0]} /><div className="min-w-0 flex-1"><div className="flex justify-between gap-4"><div><p className="text-xs font-bold text-muted">{product.store.name}</p><h2 className="mt-2 truncate text-base font-bold">{product.title}</h2><p className="mt-2 text-xs text-muted">{product.size} · {product.condition}</p></div><button aria-label="장바구니에서 삭제" className="text-muted hover:text-ink" onClick={() => removeFromCart(product.id)} type="button"><Trash2 size={16} /></button></div><div className="mt-6 flex items-center justify-between"><div className="flex items-center gap-3 border border-line px-3 py-2 text-xs"><Minus size={12} /><span>1</span><Plus size={12} /></div><span className="font-mono text-sm font-bold">{product.price.toLocaleString("ko-KR")}원</span></div></div></div>)}</div><aside className="h-fit border-t-2 border-ink bg-surface p-6"><div className="flex justify-between text-xs"><span>상품 금액</span><strong className="font-mono">{total.toLocaleString("ko-KR")}원</strong></div><div className="mt-4 flex justify-between text-xs"><span>배송비</span><span className="text-muted">배송 요청 시 계산</span></div><div className="mt-6 flex justify-between border-t border-line pt-5"><span className="text-sm font-bold">예상 결제 금액</span><strong className="font-mono text-xl">{total.toLocaleString("ko-KR")}원</strong></div><button className="mt-6 h-13 w-full bg-ink text-xs font-bold text-paper disabled:opacity-50" disabled={busy} onClick={checkout} type="button">{busy ? "주문 준비 중..." : "통합 주문하기"}</button>{message && <p className="mt-4 text-[11px] leading-5 text-muted">{message}</p>}<button className="mt-3 w-full text-[11px] text-muted underline" onClick={clearCart} type="button">장바구니 비우기</button></aside></div>}</div>;
}
