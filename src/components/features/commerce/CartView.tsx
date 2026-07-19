"use client";

import Link from "next/link";
import { ArrowRight, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { persistCart } from "@/lib/commerce/client";
import { useCommerceStore } from "@/store/useCommerceStore";
import { CatalogImage } from "@/components/ui/CatalogImage";

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
  id: string;
  title: string;
  category: string;
  size: string;
  condition: "NEW" | "EXCELLENT" | "GOOD" | "FAIR";
  saleType: "fixed";
  price: number;
  closesAt: string;
  store: { name: string };
  imageUrls: string[];
}

type CartAccess = "loading" | "member" | "guest";

function toCartProduct(product: PublishedFixedProduct): CartProduct {
  const grade = product.conditionGrade ?? "A";
  return {
    id: product.id,
    title: product.title,
    category: product.category,
    size: product.sizeLabel || "사이즈 미등록",
    condition: grade === "S" ? "NEW" : grade === "A+" ? "EXCELLENT" : grade === "B" ? "FAIR" : "GOOD",
    saleType: "fixed",
    price: product.fixedPrice ?? product.currentPrice,
    closesAt: product.closesAt,
    store: { name: "NINETY-NINE VINTAGE" },
    imageUrls: product.imageUrls,
  };
}

export function CartView() {
  const hydrate = useCommerceStore((state) => state.hydrate);
  const cartIds = useCommerceStore((state) => state.cartIds);
  const removeFromCart = useCommerceStore((state) => state.removeFromCart);
  const clearCart = useCommerceStore((state) => state.clearCart);
  const replaceCart = useCommerceStore((state) => state.replaceCart);
  const [liveProducts, setLiveProducts] = useState<CartProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [cartLoading, setCartLoading] = useState(true);
  const [access, setAccess] = useState<CartAccess>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [staleCount, setStaleCount] = useState(0);
  const checkoutKey = useRef<string | null>(null);

  useEffect(() => { hydrate(); }, [hydrate]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/products?saleType=fixed&limit=100", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<{ products?: PublishedFixedProduct[] }> : Promise.reject(new Error("상품 목록을 불러오지 못했습니다.")))
      .then((payload) => setLiveProducts((payload.products ?? []).map(toCartProduct)))
      .catch((reason: unknown) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setLiveProducts([]); })
      .finally(() => { if (!controller.signal.aborted) setProductsLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        if (!data.session?.access_token) {
          setAccess("guest");
          return;
        }
        setAccess("member");
        const response = await fetch("/api/cart", { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) setAccess("guest");
          return;
        }
        const payload = await response.json() as { productIds?: string[]; staleProductIds?: string[]; items?: Array<{ id?: string; product_id?: string }> };
        const ids = payload.productIds ?? (payload.items ?? []).map((item) => item.product_id ?? item.id).filter((id): id is string => Boolean(id));
        replaceCart(ids);
        setStaleCount(payload.staleProductIds?.length ?? 0);
      } catch {
        // Keep the local guest presentation cart when auth refresh is unavailable.
      } finally {
        setCartLoading(false);
      }
    })();
  }, [replaceCart]);

  const products = useMemo(() => liveProducts.filter((product) => cartIds.includes(product.id)), [cartIds, liveProducts]);
  const total = products.reduce((sum, product) => sum + product.price, 0);

  const checkout = async () => {
    if (busy || products.length === 0) return;
    setBusy(true);
    setMessage("");
    setMessageKind("success");
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("카카오 로그인 후 주문할 수 있습니다.");
      const idempotencyKey = checkoutKey.current ?? (checkoutKey.current = crypto.randomUUID());
      const response = await fetch("/api/orders/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ productIds: products.map((product) => product.id), idempotencyKey }),
      });
      const payload = await response.json() as { order?: { id: string; total: number }; transfer?: { bank_name_snapshot: string; account_number_snapshot: string; expected_amount: number } | null; error?: string };
      if (!response.ok || !payload.order) throw new Error(payload.error ?? "주문을 만들지 못했습니다.");
      products.forEach((product) => void persistCart(product.id, false));
      clearCart();
      checkoutKey.current = null;
      setMessage(payload.transfer
        ? `주문 ${payload.order.id} 생성 완료 · ${payload.transfer.expected_amount.toLocaleString("ko-KR")}원 · ${payload.transfer.bank_name_snapshot} ${payload.transfer.account_number_snapshot}로 입금해 주세요.`
        : `주문 ${payload.order.id} 생성 완료 · ${payload.order.total.toLocaleString("ko-KR")}원. 내 정보에서 입금 상태를 확인해 주세요.`);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "주문을 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    products.forEach((product) => void persistCart(product.id, false));
    clearCart();
  };

  return <div className="space-y-10">
    <div className="flex items-end justify-between border-b border-ink pb-6"><div><p className="eyebrow text-muted">BAG / BUY NOW</p><h1 className="mt-3 text-4xl font-black tracking-[-0.08em]">장바구니</h1></div><span className="font-mono text-xs text-muted">{productsLoading || cartLoading ? "—" : `${products.length} ITEMS`}</span></div>
    {staleCount > 0 && <div aria-live="polite" className="border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">판매가 완료되었거나 공개가 종료된 상품 {staleCount}개를 장바구니에서 제외했습니다.</div>}
    {message && <div aria-live="polite" className={messageKind === "error" ? "border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-900" : "border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-900"}>{message} {messageKind === "success" && <Link className="ml-2 font-bold underline" href="/account#orders">내 주문 확인</Link>}</div>}
    {access === "loading" || productsLoading || cartLoading ? <div className="border border-dashed border-line py-24 text-center"><p className="text-sm font-bold">장바구니를 불러오는 중입니다.</p><p className="mt-2 text-[11px] text-muted">잠시만 기다려 주세요.</p></div> : access !== "member" ? <div className="border border-dashed border-line bg-surface py-24 text-center"><p className="text-sm font-bold">카카오 로그인 후 장바구니를 이용할 수 있습니다.</p><a className="mt-5 inline-flex border border-ink px-5 py-3 text-xs font-bold" href="/api/auth/kakao/start?returnTo=%2Fcart">카카오 로그인</a></div> : products.length === 0 ? <div className="border border-dashed border-line py-24 text-center"><p className="text-sm font-bold">장바구니가 비어 있습니다.</p><Link className="mt-5 inline-flex items-center gap-2 text-xs font-bold underline" href="/shop">SHOP 둘러보기 <ArrowRight size={14} /></Link></div> : <div className="grid gap-10 lg:grid-cols-[1fr_360px]"><div className="divide-y divide-line border-y border-line">{products.map((product) => <div className="flex gap-5 py-5" key={product.id}><CatalogImage alt={product.title} className="size-28 object-cover" src={product.imageUrls[0]} /><div className="min-w-0 flex-1"><div className="flex justify-between gap-4"><div><p className="text-xs font-bold text-muted">{product.store.name}</p><h2 className="mt-2 truncate text-base font-bold">{product.title}</h2><p className="mt-2 text-xs text-muted">{product.size} · {product.condition}</p></div><button aria-label="장바구니에서 삭제" className="text-muted hover:text-ink" onClick={() => { removeFromCart(product.id); void persistCart(product.id, false); }} type="button"><Trash2 size={16} /></button></div><div className="mt-6 flex items-center justify-between"><div className="border border-line px-3 py-2 text-xs text-muted"><span aria-label="수량">단일 상품 · 1점</span></div><span className="font-mono text-sm font-bold">{product.price.toLocaleString("ko-KR")}원</span></div></div></div>)}</div><aside className="h-fit border-t-2 border-ink bg-surface p-6"><div className="flex justify-between text-xs"><span>상품 금액</span><strong className="font-mono">{total.toLocaleString("ko-KR")}원</strong></div><div className="mt-4 flex justify-between text-xs"><span>배송비</span><span className="text-muted">배송 요청 시 계산</span></div><div className="mt-6 flex justify-between border-t border-line pt-5"><span className="text-sm font-bold">예상 결제 금액</span><strong className="font-mono text-xl">{total.toLocaleString("ko-KR")}원</strong></div><button className="mt-6 h-13 w-full bg-ink text-xs font-bold text-paper disabled:opacity-50" disabled={busy} onClick={() => void checkout()} type="button">{busy ? "주문 준비 중..." : "통합 주문하기"}</button><button className="mt-3 w-full text-[11px] text-muted underline" onClick={clear} type="button">장바구니 비우기</button></aside></div>}
  </div>;
}
