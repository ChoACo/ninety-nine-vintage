"use client";

import Link from "next/link";
import { Heart, LogIn, PackageCheck, ReceiptText, Truck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface ProductSummary { id: string; title: string; image_urls?: string[]; imageUrls?: string[]; storage_class?: string; storageClass?: string; }
interface StorageItem { id: string; product_id: string; storage_expires_at: string | null; shippingEligible: boolean; products?: ProductSummary; }
interface StoragePayload { items?: StorageItem[]; auctionWins?: Array<{ product_id: string; title: string; image_urls: string[]; shipping_status: string }> }
interface Address { id: string; label: string; recipient_name: string; phone: string; postal_code: string | null; address: string; is_default: boolean; }

export function AccountDashboard() {
  const [token, setToken] = useState<string | null>(null);
  const [userName, setUserName] = useState("빈티지 피플");
  const [storage, setStorage] = useState<StorageItem[]>([]);
  const [wins, setWins] = useState<StoragePayload["auctionWins"]>([]);
  const [liked, setLiked] = useState<ProductSummary[]>([]);
  const [credits, setCredits] = useState(0);
  const [now, setNow] = useState(0);
  const [notice, setNotice] = useState("");
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [addressForm, setAddressForm] = useState({ label: "집", recipientName: "", phone: "", postalCode: "", address: "" });
  const [shippingMessage, setShippingMessage] = useState("");
  const [applyShippingCredit, setApplyShippingCredit] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
        if (cancelled) return;
        setToken(session?.access_token ?? null);
        setUserName(session?.user.user_metadata?.name ?? session?.user.user_metadata?.full_name ?? "빈티지 피플");
        if (!session?.access_token) return;
        const headers = { Authorization: `Bearer ${session.access_token}` };
        const [storageResponse, creditResponse, wishlistResponse, addressResponse] = await Promise.all([
          fetch("/api/account/storage", { headers, cache: "no-store" }),
          fetch("/api/shipping/credits", { headers, cache: "no-store" }),
          fetch("/api/wishlist", { headers, cache: "no-store" }),
          fetch("/api/account/addresses", { headers, cache: "no-store" }),
        ]);
        const storageData = await storageResponse.json() as StoragePayload;
        const creditData = await creditResponse.json() as { credits?: number };
        const wishlistData = await wishlistResponse.json() as { productIds?: string[] };
        const addressData = await addressResponse.json() as { addresses?: Address[] };
        const ids = wishlistData.productIds ?? [];
        const [auctionResponse, fixedResponse] = await Promise.all([
          fetch("/api/products?saleType=auction&limit=100", { cache: "no-store" }),
          fetch("/api/products?saleType=fixed&limit=100", { cache: "no-store" }),
        ]);
        const auctionData = await auctionResponse.json() as { products?: ProductSummary[] };
        const fixedData = await fixedResponse.json() as { products?: ProductSummary[] };
        const allProducts = [...(auctionData.products ?? []), ...(fixedData.products ?? [])];
        if (!cancelled) {
          setNow(Date.now());
          setStorage(storageData.items ?? []);
          setWins(storageData.auctionWins ?? []);
          setCredits(Number(creditData.credits ?? 0));
          setApplyShippingCredit(Number(creditData.credits ?? 0) > 0);
          setLiked(allProducts.filter((product) => ids.includes(product.id)));
          setAddresses(addressData.addresses ?? []);
          setSelectedAddressId(addressData.addresses?.find((address) => address.is_default)?.id ?? addressData.addresses?.[0]?.id ?? "");
        }
      } catch (error) { if (!cancelled) setNotice(error instanceof Error ? error.message : "계정 정보를 불러오지 못했습니다."); }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const cards = [
    ["진행 중인 입찰", String(wins?.length ?? 0).padStart(2, "0"), "낙찰·결제 현황", "/feed", ReceiptText],
    ["보관 중인 상품", String(storage.length).padStart(2, "0"), "합배송 가능한 상품", "#storage", PackageCheck],
    ["배송 요청 가능", String(credits).padStart(2, "0"), "남은 배송 크레딧", "#shipping", Truck],
    ["찜한 상품", String(liked.length).padStart(2, "0"), "다시 보고 싶은 아이템", "#likes", Heart],
  ] as const;
  const eligible = storage.filter((item) => item.shippingEligible);
  const saveAddress = async () => { if (!token) return; const response = await fetch("/api/account/addresses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...addressForm, isDefault: addresses.length === 0 }) }); const payload = await response.json() as { address?: Address; error?: string }; if (!response.ok || !payload.address) { setShippingMessage(payload.error ?? "배송지를 저장하지 못했습니다."); return; } setAddresses((current) => [...current, payload.address as Address]); setSelectedAddressId(payload.address.id); setAddressForm({ label: "집", recipientName: "", phone: "", postalCode: "", address: "" }); setShippingMessage("배송지를 저장했습니다."); };
  const requestShipping = async () => { if (!token || selectedIds.length === 0 || !selectedAddressId) { setShippingMessage("배송 상품과 배송지를 선택해 주세요."); return; } const response = await fetch("/api/shipping/requests", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ productIds: selectedIds, addressId: selectedAddressId, applyShippingCredit }) }); const payload = await response.json() as { error?: string; request?: { id: string } }; if (!response.ok) { setShippingMessage(payload.error ?? "배송 요청을 만들지 못했습니다."); return; } setSelectedIds([]); setCredits((current) => applyShippingCredit ? Math.max(0, current - 1) : current); setShippingMessage(applyShippingCredit ? `합배송 요청 ${payload.request?.id ?? "완료"}을 접수했습니다. 배송 크레딧 1회를 사용했습니다.` : `합배송 요청 ${payload.request?.id ?? "완료"}을 접수했습니다. 배송비 계좌이체 안내를 준비했습니다.`); };
  const prepareShippingFee = async () => { if (!token) return; const response = await fetch("/api/shipping/credits", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({}) }); const payload = await response.json() as { payment?: { expected_amount: number; bank_name_snapshot: string; account_number_snapshot: string }; error?: string }; if (!response.ok || !payload.payment) { setShippingMessage(payload.error ?? "배송비 안내를 불러오지 못했습니다."); return; } setShippingMessage(`${payload.payment.expected_amount.toLocaleString("ko-KR")}원 · ${payload.payment.bank_name_snapshot} ${payload.payment.account_number_snapshot}로 입금해 주세요.`); };
  return <div className="space-y-14"><div className="flex flex-col justify-between gap-5 border-b border-ink pb-8 md:flex-row md:items-end"><div><p className="eyebrow text-muted">MY ACCOUNT / LIVE DATA</p><h1 className="mt-3 text-4xl font-black tracking-[-0.08em]">안녕하세요, {userName}.</h1><p className="mt-3 text-sm text-muted">나의 경매와 보관, 배송을 한 곳에서 관리하세요.</p></div>{token ? <span className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800"><UserRound size={15} /> 로그인 상태</span> : <Link className="flex items-center gap-2 border border-line px-4 py-3 text-xs font-bold" href="/api/auth/kakao/start?returnTo=%2Faccount"><LogIn size={15} /> 카카오로 로그인하기</Link>}</div>
    {!token && <div className="border border-dashed border-line bg-surface p-6 text-sm">입찰, 장바구니, 보관 상품은 카카오 로그인 후 확인할 수 있습니다.</div>}
    {notice && <div className="border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{notice}</div>}
    <div className="grid gap-px border border-line bg-line md:grid-cols-4">{cards.map(([label, value, description, href, Icon]) => <Link className="group bg-paper p-5 transition-colors hover:bg-surface" href={href} key={label}><Icon size={17} /><p className="mt-8 text-xs text-muted">{label}</p><p className="mt-2 font-mono text-3xl font-bold">{value}</p><p className="mt-2 text-[11px] text-muted group-hover:text-ink">{description}</p></Link>)}</div>
    <div className="grid gap-10 lg:grid-cols-[1.4fr_.8fr]"><section id="storage"><div className="mb-5 flex items-end justify-between border-b border-ink pb-4"><div><p className="eyebrow text-muted">STORAGE / MERGE SHIPPING</p><h2 className="mt-2 text-xl font-black tracking-[-0.05em]">보관 중인 상품</h2></div><Link className="text-xs font-bold underline" href="/chat">배송 상담</Link></div><div className="divide-y divide-line border-y border-line">{storage.length === 0 && <p className="py-12 text-center text-sm text-muted">결제 완료 후 보관 상품이 표시됩니다.</p>}{storage.map((item) => { const product = item.products; const image = product?.image_urls?.[0] ?? product?.imageUrls?.[0] ?? ""; const expires = item.storage_expires_at ? new Date(item.storage_expires_at) : null; return <label className={`flex gap-4 py-4 ${item.shippingEligible ? "cursor-pointer" : "opacity-60"}`} key={item.id}><input checked={selectedIds.includes(item.product_id)} className="mt-2 accent-zinc-950" disabled={!item.shippingEligible} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.product_id] : current.filter((id) => id !== item.product_id))} type="checkbox" /><img alt="" className="size-20 object-cover" src={image} /><div className="min-w-0 flex-1"><div className="flex justify-between gap-4"><p className="truncate text-sm font-bold">{product?.title ?? item.product_id}</p><span className={`shrink-0 text-[10px] font-bold ${item.shippingEligible ? "text-emerald-700" : "text-red-700"}`}>{item.shippingEligible && expires && now ? `D-${Math.max(0, Math.ceil((expires.getTime() - now) / 86400000))}` : "만료"}</span></div><p className="mt-2 text-xs text-muted">{item.shippingEligible ? "합배송 상품으로 선택할 수 있습니다." : "보관 기간이 만료되어 운영자 문의가 필요합니다."}</p></div></label>; })}</div><div className="mt-4 border border-line bg-surface p-4"><p className="text-xs font-bold">배송지 선택</p><select aria-label="배송지" className="mt-3 h-10 w-full border border-line bg-paper px-3 text-xs" disabled={!token} onChange={(event) => setSelectedAddressId(event.target.value)} value={selectedAddressId}><option value="">배송지를 선택하세요</option>{addresses.map((address) => <option key={address.id} value={address.id}>{address.label} · {address.recipient_name} · {address.address}</option>)}</select><div className="mt-3 grid gap-2 md:grid-cols-2"><input aria-label="배송지 이름" className="border border-line bg-paper px-3 py-2 text-xs" onChange={(event) => setAddressForm({ ...addressForm, label: event.target.value })} placeholder="배송지 이름" value={addressForm.label} /><input aria-label="수령인" className="border border-line bg-paper px-3 py-2 text-xs" onChange={(event) => setAddressForm({ ...addressForm, recipientName: event.target.value })} placeholder="수령인" value={addressForm.recipientName} /><input aria-label="연락처" className="border border-line bg-paper px-3 py-2 text-xs" onChange={(event) => setAddressForm({ ...addressForm, phone: event.target.value })} placeholder="연락처" value={addressForm.phone} /><input aria-label="주소" className="border border-line bg-paper px-3 py-2 text-xs md:col-span-2" onChange={(event) => setAddressForm({ ...addressForm, address: event.target.value })} placeholder="주소" value={addressForm.address} /></div><button className="mt-3 border border-ink px-4 py-2 text-xs font-bold" disabled={!token} onClick={() => void saveAddress()} type="button">배송지 저장</button></div><button className="mt-4 h-11 w-full bg-ink text-xs font-bold text-paper disabled:opacity-40" disabled={!token || eligible.length === 0 || selectedIds.length === 0 || !selectedAddressId} onClick={() => void requestShipping()} type="button">선택 상품 합배송 요청</button>{shippingMessage && <p aria-live="polite" className="mt-3 text-xs text-emerald-700">{shippingMessage}</p>}</section><section id="shipping" className="border border-line bg-surface p-6"><p className="eyebrow text-muted">SHIPPING CREDIT</p><p className="mt-6 font-mono text-5xl font-bold">{credits}</p><h2 className="mt-2 text-lg font-black">배송 요청 가능 횟수</h2><p className="mt-3 text-xs leading-5 text-muted">택배비를 선결제하면 배송 크레딧으로 전환됩니다.</p><button className="mt-6 h-11 w-full border border-ink text-xs font-bold" disabled={!token} onClick={() => void prepareShippingFee()} type="button">택배비 선결제 안내</button></section></div>
    <section id="likes"><div className="mb-5 flex items-end justify-between border-b border-ink pb-4"><div><p className="eyebrow text-muted">SAVED / HEARTS</p><h2 className="mt-2 text-xl font-black tracking-[-0.05em]">찜한 상품</h2></div><span className="text-xs text-muted">{liked.length} items</span></div>{liked.length === 0 ? <div className="border border-dashed border-line py-16 text-center text-sm text-muted">로그인 후 찜한 상품이 표시됩니다.</div> : <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{liked.map((product) => <Link href={`/auction/${product.id}`} key={product.id}><img alt="" className="aspect-[4/5] w-full object-cover" src={product.image_urls?.[0] ?? product.imageUrls?.[0] ?? ""} /><p className="mt-3 truncate text-xs font-bold">{product.title}</p></Link>)}</div>}</section>
  </div>;
}
