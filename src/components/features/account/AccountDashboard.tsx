"use client";

import Link from "next/link";
import { Heart, PackageCheck, ReceiptText, Truck, UserRound } from "lucide-react";
import { useEffect } from "react";
import { DEMO_PRODUCTS } from "@/lib/catalog";
import { useCommerceStore } from "@/store/useCommerceStore";

export function AccountDashboard() {
  const hydrate = useCommerceStore((state) => state.hydrate);
  const likedIds = useCommerceStore((state) => state.likedIds);
  useEffect(() => hydrate(), [hydrate]);
  const liked = DEMO_PRODUCTS.filter((product) => likedIds.includes(product.id));
  const cards = [
    ["진행 중인 입찰", "03", "경매 현황을 확인하세요", "/feed", ReceiptText],
    ["보관 중인 상품", "02", "합배송 가능한 상품", "#storage", PackageCheck],
    ["배송 요청 가능", "01", "남은 배송 크레딧", "#shipping", Truck],
    ["찜한 상품", String(liked.length).padStart(2, "0"), "다시 보고 싶은 아이템", "#likes", Heart],
  ] as const;
  return <div className="space-y-14">
    <div className="flex flex-col justify-between gap-5 border-b border-ink pb-8 md:flex-row md:items-end"><div><p className="eyebrow text-muted">MY ACCOUNT / 099</p><h1 className="mt-3 text-4xl font-black tracking-[-0.08em]">안녕하세요, 빈티지 피플.</h1><p className="mt-3 text-sm text-muted">나의 경매와 보관, 배송을 한 곳에서 관리하세요.</p></div><Link className="flex items-center gap-2 border border-line px-4 py-3 text-xs font-bold" href="/api/auth/kakao/start?returnTo=%2Faccount"><UserRound size={15} /> 카카오로 로그인하기</Link></div>
    <div className="grid gap-px border border-line bg-line md:grid-cols-4">{cards.map(([label, value, description, href, Icon]) => <Link className="group bg-paper p-5 transition-colors hover:bg-surface" href={href} key={label}><Icon size={17} /><p className="mt-8 text-xs text-muted">{label}</p><p className="mt-2 font-mono text-3xl font-bold">{value}</p><p className="mt-2 text-[11px] text-muted group-hover:text-ink">{description}</p></Link>)}</div>
    <div className="grid gap-10 lg:grid-cols-[1.4fr_.8fr]">
      <section id="storage"><div className="mb-5 flex items-end justify-between border-b border-ink pb-4"><div><p className="eyebrow text-muted">STORAGE / MERGE SHIPPING</p><h2 className="mt-2 text-xl font-black tracking-[-0.05em]">보관 중인 상품</h2></div><Link className="text-xs font-bold underline" href="/chat">배송 상담</Link></div><div className="divide-y divide-line border-y border-line">{DEMO_PRODUCTS.slice(0, 2).map((product, index) => <div className="flex gap-4 py-4" key={product.id}><img alt="" className="size-20 object-cover" src={product.imageUrls[0]} /><div className="min-w-0 flex-1"><div className="flex justify-between gap-4"><p className="truncate text-sm font-bold">{product.title}</p><span className="shrink-0 text-[10px] font-bold text-emerald-700">보관 {index === 0 ? "D-09" : "D-04"}</span></div><p className="mt-2 text-xs text-muted">{product.store.name} · {product.storageClass === "small" ? "소형 / 14일" : "대형 / 7일"}</p><p className="mt-1 text-[11px] text-muted">결제 완료 · 배송 요청 가능</p></div></div>)}</div><button className="mt-4 h-11 w-full bg-ink text-xs font-bold text-paper">선택 상품 합배송 요청</button></section>
      <section id="shipping" className="border border-line bg-surface p-6"><p className="eyebrow text-muted">SHIPPING CREDIT</p><p className="mt-6 font-mono text-5xl font-bold">01</p><h2 className="mt-2 text-lg font-black">배송 요청 가능 횟수</h2><p className="mt-3 text-xs leading-5 text-muted">택배비를 선결제하면 배송 크레딧으로 전환됩니다. 보관 상품을 묶어서 한 번에 요청할 수 있습니다.</p><button className="mt-6 h-11 w-full border border-ink text-xs font-bold">택배비 선결제 안내</button></section>
    </div>
    <section id="likes"><div className="mb-5 flex items-end justify-between border-b border-ink pb-4"><div><p className="eyebrow text-muted">SAVED / HEARTS</p><h2 className="mt-2 text-xl font-black tracking-[-0.05em]">찜한 상품</h2></div><span className="text-xs text-muted">{liked.length} items</span></div>{liked.length === 0 ? <div className="border border-dashed border-line py-16 text-center text-sm text-muted">아직 찜한 상품이 없습니다.</div> : <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{liked.map((product) => <Link href={`/auction/${product.id}`} key={product.id}><img alt="" className="aspect-[4/5] w-full object-cover" src={product.imageUrls[0]} /><p className="mt-3 truncate text-xs font-bold">{product.title}</p></Link>)}</div>}</section>
  </div>;
}
