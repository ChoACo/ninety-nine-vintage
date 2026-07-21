"use client";

import { Gavel, Heart, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Item } from "@/types/auction";
import { useCommerceStore } from "@/store/useCommerceStore";
import { persistWishlist, reserveCartProduct } from "@/lib/commerce/client";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { rememberFixedPurchaseIntent } from "@/lib/commerce/purchaseIntent";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";

interface AuctionCardProps { item: Omit<Item, "bidHistory"> & { closesAt?: string; timeLeft?: string }; }

export function AuctionCard(props: AuctionCardProps) {
  if (props.item.saleType === "auction" && !LIVE_AUCTION_ENABLED) return null;
  return <EnabledAuctionCard {...props} />;
}

function EnabledAuctionCard({ item }: AuctionCardProps) {
  const router = useRouter();
  const isFixed = item.saleType === "fixed";
  const price = isFixed ? (item.fixedPrice ?? item.currentBid) : item.currentBid;
  const liked = useCommerceStore((state) => state.likedIds.includes(item.id));
  const toggleLike = useCommerceStore((state) => state.toggleLike);
  const hydrate = useCommerceStore((state) => state.hydrate);
  const addToCart = useCommerceStore((state) => state.addToCart);
  const [actionMessage, setActionMessage] = useState("");
  const [cartBusy, setCartBusy] = useState(false);
  useEffect(() => hydrate(), [hydrate]);
  const addFixedToCart = async () => {
    if (cartBusy) return;
    setCartBusy(true);
    setActionMessage("");
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const session = data.session;
      if (!session?.access_token) {
        rememberFixedPurchaseIntent(item.id, "cart");
        router.push(
          `/account/login?next=${encodeURIComponent(`/auction/${item.id}?purchaseIntent=cart`)}`,
        );
        return;
      }
      const reservation = await reserveCartProduct(item.id, session.user.id);
      addToCart(item.id);
      setActionMessage(`장바구니에 담았습니다. ${new Date(reservation.reservedUntil).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}까지 15분간 재고가 점유됩니다.`);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "장바구니에 담지 못했습니다.");
    } finally {
      setCartBusy(false);
    }
  };
  const updateWishlist = async () => {
    try {
      const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
      const nextLiked = !liked;
      if (!session) {
        toggleLike(item.id);
        return;
      }
      if (await persistWishlist(item.id, nextLiked, session.user.id)) {
        toggleLike(item.id);
      } else {
        setActionMessage("로그인 계정이 변경되었거나 찜을 저장하지 못했습니다.");
      }
    } catch {
      setActionMessage("로그인 상태를 확인하지 못했습니다.");
    }
  };
  return (
    <article className="group min-w-0">
      <Link className="block" href={`/auction/${item.id}`}>
        <div className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-lg shadow-black/5 transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-xl">
          {item.imageUrl ? <CatalogImage alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" loading="lazy" src={item.imageUrl} /> : <div className="grid h-full place-items-center text-xs text-muted">이미지 준비 중</div>}
          <span className="absolute left-2 top-2 rounded-lg bg-paper/90 px-2 py-1 font-mono text-[9px] font-bold tracking-[0.1em] shadow-sm backdrop-blur-md">{isFixed ? "즉시 구매" : "실시간 입찰"}</span>
          <button aria-label={liked ? "찜 해제" : "찜하기"} className={`absolute right-2 top-2 grid size-9 place-items-center rounded-xl bg-paper/90 shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95 ${liked ? "text-red-700" : "text-ink"}`} onClick={(event) => { event.preventDefault(); void updateWishlist(); }} type="button"><Heart fill={liked ? "currentColor" : "none"} size={15} strokeWidth={1.6} /></button>
          <div className="absolute inset-x-0 bottom-0 translate-y-full bg-ink/95 px-3 py-3 text-paper opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
            <p className="text-[10px] text-zinc-400">{isFixed ? "정가 바로구매" : "경매 참여"}</p>
            <p className="mt-1 text-xs font-bold">{isFixed ? "상세에서 구매 절차를 확인하세요." : "상세에서 입찰가를 확인하세요."}</p>
          </div>
        </div>
      </Link>
      <div className="pt-3">
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted"><span className="truncate">{item.brand}</span><span className="shrink-0 font-mono tabular-nums">{item.timeLeft ?? "진행 중"}</span></div>
        <Link className="mt-1 block truncate text-sm font-medium hover:underline" href={`/auction/${item.id}`}>{item.name}</Link>
        <div className="mt-3 flex items-end justify-between gap-2">
          <div><p className="text-[10px] text-muted">{isFixed ? "판매 정가" : "현재 입찰가"}</p><p className="font-mono text-sm font-bold tabular-nums">{price.toLocaleString("ko-KR")}원</p></div>
          <p className="text-[10px] text-muted">{isFixed ? "즉시 구매" : `입찰 ${item.bidCount}건`}</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {isFixed ? <><button className="flex h-9 items-center justify-center gap-1 rounded-xl border border-line text-[10px] font-bold shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-ink hover:shadow-lg active:scale-95 disabled:opacity-50" disabled={cartBusy} onClick={(event) => { event.preventDefault(); void addFixedToCart(); }} type="button"><ShoppingBag size={13} /> {cartBusy ? "저장 중" : "장바구니"}</button><Link className="flex h-9 items-center justify-center rounded-xl bg-ink text-[10px] font-bold text-paper shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95" href={`/auction/${item.id}`}>즉시 구매</Link></> : <><Link className="flex h-9 items-center justify-center gap-1 rounded-xl bg-ink text-[10px] font-bold text-paper shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95" href={`/auction/${item.id}/bid`}><Gavel size={13} /> 입찰하기</Link><button className="flex h-9 cursor-not-allowed items-center justify-center gap-1 rounded-xl border border-line text-[10px] font-bold text-muted" disabled title="경매 상품은 장바구니에 담을 수 없습니다." type="button"><ShoppingBag size={13} /> 장바구니</button></>}
        </div>
        {actionMessage && <p aria-live="polite" className="mt-2 text-[10px] font-bold text-emerald-700">{actionMessage}</p>}
      </div>
    </article>
  );
}
