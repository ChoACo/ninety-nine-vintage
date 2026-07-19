"use client";

import { Gavel, Heart, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Item } from "@/types/auction";
import { useCommerceStore } from "@/store/useCommerceStore";
import { persistCart, persistWishlist } from "@/lib/commerce/client";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { BidModal } from "@/components/features/auction/detail/BidModal";

interface AuctionCardProps { item: Item & { closesAt?: string; timeLeft?: string }; }

export function AuctionCard({ item }: AuctionCardProps) {
  const isFixed = item.saleType === "fixed";
  const price = isFixed ? (item.fixedPrice ?? item.currentBid) : item.currentBid;
  const liked = useCommerceStore((state) => state.likedIds.includes(item.id));
  const toggleLike = useCommerceStore((state) => state.toggleLike);
  const hydrate = useCommerceStore((state) => state.hydrate);
  const addToCart = useCommerceStore((state) => state.addToCart);
  const [bidOpen, setBidOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  useEffect(() => hydrate(), [hydrate]);
  const quickBid = async (amount: number) => {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    if (!data.session?.access_token) throw new Error("카카오 로그인 후 입찰할 수 있습니다.");
    const response = await fetch("/api/auction/bids", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ productId: item.id, amount }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "입찰을 저장하지 못했습니다.");
    setActionMessage("입찰이 완료되었습니다.");
  };
  const addFixedToCart = () => { addToCart(item.id); void persistCart(item.id, true); setActionMessage("장바구니에 담았습니다."); };
  return (
    <article className="group min-w-0">
      <Link className="block" href={`/auction/${item.id}`}>
        <div className="relative aspect-[4/5] overflow-hidden bg-surface">
          {item.imageUrl ? <img alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" loading="lazy" src={item.imageUrl} /> : <div className="grid h-full place-items-center text-xs text-muted">이미지 준비 중</div>}
          <span className="absolute left-2 top-2 bg-paper px-2 py-1 font-mono text-[9px] font-bold tracking-[0.1em]">{isFixed ? "BUY NOW" : "LIVE BID"}</span>
          <button aria-label={liked ? "찜 해제" : "찜하기"} className={`absolute right-2 top-2 grid size-8 place-items-center bg-paper/90 transition-colors ${liked ? "text-red-700" : "text-ink"}`} onClick={(event) => { event.preventDefault(); const nextLiked = !liked; toggleLike(item.id); void persistWishlist(item.id, nextLiked); }} type="button"><Heart fill={liked ? "currentColor" : "none"} size={15} strokeWidth={1.6} /></button>
          <div className="absolute inset-x-0 bottom-0 translate-y-full bg-ink/95 px-3 py-3 text-paper opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
            <p className="text-[10px] text-zinc-400">{isFixed ? "정가 바로구매" : "경매 참여"}</p>
            <p className="mt-1 text-xs font-bold">{isFixed ? "상세에서 구매 절차를 확인하세요." : "상세에서 입찰가를 확인하세요."}</p>
          </div>
        </div>
      </Link>
      <div className="pt-3">
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted"><span className="truncate">{item.brand}</span><span className="shrink-0 font-mono tabular-nums">{item.timeLeft ?? "LIVE"}</span></div>
        <Link className="mt-1 block truncate text-sm font-medium hover:underline" href={`/auction/${item.id}`}>{item.name}</Link>
        <div className="mt-3 flex items-end justify-between gap-2">
          <div><p className="text-[10px] text-muted">{isFixed ? "판매 정가" : "현재 입찰가"}</p><p className="font-mono text-sm font-bold tabular-nums">{price.toLocaleString("ko-KR")}원</p></div>
          <p className="text-[10px] text-muted">{isFixed ? "즉시 구매" : `입찰 ${item.bidCount}건`}</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {isFixed ? <><button className="flex h-9 items-center justify-center gap-1 border border-line text-[10px] font-bold transition-colors hover:border-ink" onClick={(event) => { event.preventDefault(); addFixedToCart(); }} type="button"><ShoppingBag size={13} /> 장바구니</button><Link className="flex h-9 items-center justify-center bg-ink text-[10px] font-bold text-paper" href={`/auction/${item.id}`}>바로 구매</Link></> : <><button className="flex h-9 items-center justify-center gap-1 bg-ink text-[10px] font-bold text-paper" onClick={(event) => { event.preventDefault(); setBidOpen(true); }} type="button"><Gavel size={13} /> 간편 입찰</button><button className="flex h-9 cursor-not-allowed items-center justify-center gap-1 border border-line text-[10px] font-bold text-muted" disabled title="경매 상품은 장바구니에 담을 수 없습니다." type="button"><ShoppingBag size={13} /> 장바구니</button></>}
        </div>
        {actionMessage && <p aria-live="polite" className="mt-2 text-[10px] font-bold text-emerald-700">{actionMessage}</p>}
      </div>
      {!isFixed && <BidModal currentPrice={price} key={`${item.id}-${price}`} onClose={() => setBidOpen(false)} onSubmit={quickBid} open={bidOpen} />}
    </article>
  );
}
