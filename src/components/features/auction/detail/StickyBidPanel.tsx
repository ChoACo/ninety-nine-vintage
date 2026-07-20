"use client";

import { Heart, LockKeyhole, ShoppingBag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuctionTimer } from "@/hooks/useAuctionTimer";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useBidStore } from "@/store/useBidStore";
import type { ItemDetail } from "@/types/detail";
import { BidModal } from "@/components/features/auction/detail/BidModal";
import { SettlementActions } from "@/components/features/auction/detail/SettlementActions";
import { useCommerceStore } from "@/store/useCommerceStore";
import { persistCart, persistWishlist } from "@/lib/commerce/client";
import { isEntryReadOnly, useEntryReadOnly } from "@/lib/entryMode";

interface StickyBidPanelProps {
  item: ItemDetail;
}

export function StickyBidPanel({ item }: StickyBidPanelProps) {
  const { timeLeft } = useAuctionTimer();
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [buying, setBuying] = useState(false);
  const [buyNotice, setBuyNotice] = useState("");
  const readOnly = useEntryReadOnly();
  const bids = useBidStore((state) => state.bids);
  const currentPrice = useBidStore((state) => state.currentPrice);
  const hydrate = useBidStore((state) => state.hydrate);
  const addBid = useBidStore((state) => state.addBid);
  const receiveBid = useBidStore((state) => state.receiveBid);
  const addToCart = useCommerceStore((state) => state.addToCart);
  const removeFromCart = useCommerceStore((state) => state.removeFromCart);
  const liked = useCommerceStore((state) => state.likedIds.includes(item.id));
  const toggleLike = useCommerceStore((state) => state.toggleLike);
  const hydrateCommerce = useCommerceStore((state) => state.hydrate);

  useEffect(() => {
    hydrate(item.id, item.bidHistory, item.currentBid);
  }, [hydrate, item.bidHistory, item.id, item.currentBid]);

  useEffect(() => hydrateCommerce(), [hydrateCommerce]);

  useEffect(() => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id)) return;
    let channel: ReturnType<ReturnType<typeof getSupabaseBrowserClient>["channel"]> | null = null;
    try {
      const client = getSupabaseBrowserClient();
      channel = client
        .channel(`auction-bids:${item.id}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "auction_bids", filter: `product_id=eq.${item.id}` }, (payload) => {
          const row = payload.new as Record<string, unknown>;
          const bidder = typeof row.bidder_display_name === "string" ? row.bidder_display_name.trim() : "member";
          const masked = `${bidder.slice(0, 3)}****`;
          if (typeof row.id !== "string" || typeof row.product_id !== "string" || typeof row.amount !== "number") return;
          receiveBid({
            id: row.id,
            itemId: row.product_id,
            bidderId: "masked",
            bidderName: masked,
            bidderMaskedId: masked,
            amount: row.amount,
            createdAt: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
            timeLabel: "방금 전",
          });
        })
        .subscribe();
    } catch {
      channel = null;
    }
    return () => {
      if (channel) void getSupabaseBrowserClient().removeChannel(channel);
    };
  }, [item.id, receiveBid]);

  const addFixedToCart = async () => {
    if (buying) return;
    if (isEntryReadOnly()) { setBuyNotice("사이트 연결이 복구될 때까지 읽기 전용입니다."); return; }
    setBuying(true);
    setBuyNotice("");
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session?.access_token) throw new Error("카카오 로그인 후 장바구니를 이용할 수 있습니다.");
      addToCart(item.id);
      if (!await persistCart(item.id, true)) {
        removeFromCart(item.id);
        throw new Error("현재 구매할 수 없는 상품입니다.");
      }
      setBuyNotice("장바구니에 담았습니다.");
    } catch (error) {
      setBuyNotice(error instanceof Error ? error.message : "장바구니에 담지 못했습니다.");
    } finally {
      setBuying(false);
    }
  };

  const buyNow = async () => {
    if (buying) return;
    if (isEntryReadOnly()) { setBuyNotice("사이트 연결이 복구될 때까지 읽기 전용입니다."); return; }
    setBuying(true);
    setBuyNotice("");
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session?.access_token) throw new Error("카카오 로그인 후 구매할 수 있습니다.");
      addToCart(item.id);
      if (!await persistCart(item.id, true)) {
        removeFromCart(item.id);
        throw new Error("현재 구매할 수 없는 상품입니다.");
      }
      router.push("/cart");
    } catch (error) {
      setBuyNotice(error instanceof Error ? error.message : "구매 준비에 실패했습니다.");
      setBuying(false);
    }
  };

  const visibleBids = bids.length > 0 ? bids : item.bidHistory;
  const displayPrice = currentPrice > 0 ? currentPrice : item.currentBid;
  const submitBid = async (amount: number) => {
    if (isEntryReadOnly()) throw new Error("현재 사이트 연결이 불안정해 읽기 전용 모드입니다.");
    return addBid(amount);
  };

  return (
    <aside className="z-30 self-start border-t-2 border-zinc-950 bg-white pb-28 sticky top-[100px] col-span-5 pb-0">
      <div className="border-b border-zinc-200 py-6">
        <p className="mb-3 text-xs font-medium tracking-[0.1em] text-zinc-500">{item.brand}</p>
        <h1 className="text-3xl font-black leading-tight tracking-[-0.05em] text-zinc-950">{item.name}</h1>
        <div className="mt-8 flex items-end justify-between">
          <div>
            <p className="mb-2 text-xs text-zinc-500">{item.saleType === "fixed" ? "판매 정가" : "현재 최고 입찰가"}</p>
            <p className="font-mono text-3xl font-bold tracking-[-0.04em]">{displayPrice.toLocaleString("ko-KR")} <span className="text-base">KRW</span></p>
          </div>
          <p className="text-xs text-zinc-500">{item.saleType === "fixed" ? "즉시 구매 가능" : `입찰 ${item.bidCount}건`}</p>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 text-[11px] text-zinc-600">
          <span className="border border-zinc-200 px-3 py-2">어깨 {item.measurements.shoulder > 0 ? item.measurements.shoulder : "미등록"}</span>
          <span className="border border-zinc-200 px-3 py-2">가슴 {item.measurements.chest > 0 ? item.measurements.chest : "미등록"}</span>
          <span className="border border-zinc-200 px-3 py-2">총장 {item.measurements.length > 0 ? item.measurements.length : "미등록"}</span>
        </div>
      </div>

      {item.saleType === "auction" && <div className="my-6 border border-zinc-950 bg-zinc-950 px-5 py-5 text-white">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">LIVE DROP COUNTDOWN</span>
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
        </div>
        <p className="mt-3 font-mono text-3xl font-bold tracking-[0.06em]">{timeLeft}</p>
        <p className="mt-2 text-[11px] text-zinc-400">21:00–22:00 정산 점검 · 20:56 이후 신규 참여 제한</p>
      </div>}

      {item.saleType === "auction" && <div className="border-b border-zinc-200 pb-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-bold tracking-[0.08em]">REAL-TIME BIDS</h2>
          <span className="text-[10px] text-zinc-400">최근 5건</span>
        </div>
        <div className="space-y-3">
          {visibleBids.slice(0, 5).map((bid) => (
            <div className="flex items-center justify-between text-xs" key={bid.id}>
              <span className="text-zinc-500">{bid.bidderMaskedId} <span className="ml-2 text-[10px] text-zinc-400">{bid.timeLabel}</span></span>
              <span className="font-mono font-medium">{bid.amount.toLocaleString("ko-KR")} KRW</span>
            </div>
          ))}
        </div>
      </div>}

      {item.saleType === "auction" ? <button className="mobile-detail-cta mt-6 flex h-14 w-full items-center justify-center gap-2 bg-zinc-950 text-sm font-bold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300" disabled={readOnly} onClick={() => setModalOpen(true)} type="button"><LockKeyhole size={15} /> {readOnly ? "읽기 전용" : "실시간 경매 입찰하기"}</button> : <div className="mobile-detail-cta mt-6 grid grid-cols-2 gap-2"><button className="flex h-14 items-center justify-center gap-2 border border-zinc-950 text-sm font-bold text-zinc-950 disabled:opacity-50" disabled={buying || readOnly} onClick={() => void addFixedToCart()} type="button"><ShoppingBag size={15} /> {readOnly ? "읽기 전용" : "장바구니"}</button><button className="flex h-14 items-center justify-center bg-zinc-950 text-sm font-bold text-white disabled:opacity-50" disabled={buying || readOnly} onClick={() => void buyNow()} type="button">{readOnly ? "읽기 전용" : buying ? "장바구니 준비 중..." : "바로 구매"}</button></div>}
      {buyNotice && <p aria-live="polite" className="mt-3 text-xs font-bold text-emerald-700">{buyNotice}</p>}
      <button className="mt-2 flex h-12 w-full items-center justify-center gap-2 border border-zinc-200 text-xs font-bold text-zinc-950 transition-colors hover:border-zinc-950 disabled:opacity-50" disabled={readOnly} onClick={() => { if (isEntryReadOnly()) { setBuyNotice("사이트 연결이 복구될 때까지 읽기 전용입니다."); return; } const nextLiked = !liked; toggleLike(item.id); void persistWishlist(item.id, nextLiked); }} type="button"><Heart fill={liked ? "currentColor" : "none"} size={15} /> {readOnly ? "읽기 전용" : liked ? "찜 해제" : "관심 상품 담기"}</button>
      {item.saleType === "auction" && <SettlementActions productId={item.id} readOnly={readOnly} />}
      {item.saleType === "auction" && <BidModal currentPrice={displayPrice} key={`${modalOpen}-${displayPrice}`} onClose={() => setModalOpen(false)} onSubmit={submitBid} open={modalOpen} />}
    </aside>
  );
}
