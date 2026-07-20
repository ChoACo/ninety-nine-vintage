"use client";

import { Heart, LockKeyhole, ShoppingBag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuctionTimer } from "@/hooks/useAuctionTimer";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useBidStore } from "@/store/useBidStore";
import type { ItemDetail } from "@/types/detail";
import { BidModal } from "@/components/features/auction/detail/BidModal";
import { SettlementActions } from "@/components/features/auction/detail/SettlementActions";
import { useCommerceStore } from "@/store/useCommerceStore";
import { persistCart, persistWishlist } from "@/lib/commerce/client";
import { isEntryReadOnly, useEntryReadOnly } from "@/lib/entryMode";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";
import {
  consumeFixedPurchaseIntent,
  rememberFixedPurchaseIntent,
  type FixedPurchaseIntent,
} from "@/lib/commerce/purchaseIntent";

interface StickyBidPanelProps {
  item: ItemDetail;
}

export function StickyBidPanel({ item }: StickyBidPanelProps) {
  const { timeLeft } = useAuctionTimer();
  const router = useRouter();
  const resumedPurchaseIntent = useRef(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [buying, setBuying] = useState(false);
  const [buyNotice, setBuyNotice] = useState("");
  const readOnly = useEntryReadOnly();
  const bids = useBidStore((state) => state.bids);
  const bidStoreItemId = useBidStore((state) => state.itemId);
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
    const requestedIntent = new URLSearchParams(window.location.search).get(
      "purchaseIntent",
    );
    if (
      resumedPurchaseIntent.current ||
      item.saleType !== "fixed" ||
      (requestedIntent !== "cart" && requestedIntent !== "buy")
    ) {
      return;
    }
    resumedPurchaseIntent.current = true;
    router.replace(`/auction/${item.id}`, { scroll: false });
    const intent: FixedPurchaseIntent = requestedIntent;
    if (!consumeFixedPurchaseIntent(item.id, intent)) {
      queueMicrotask(() =>
        setBuyNotice("로그인 후 구매 버튼을 다시 눌러 주세요."),
      );
      return;
    }

    void (async () => {
      setBuying(true);
      setBuyNotice("");
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        const session = data.session;
        if (!session?.access_token) {
          throw new Error("로그인 세션을 확인하지 못했습니다. 다시 로그인해 주세요.");
        }
        addToCart(item.id);
        if (!await persistCart(item.id, true, session.user.id)) {
          removeFromCart(item.id);
          throw new Error("현재 구매할 수 없는 상품입니다.");
        }
        if (intent === "buy") {
          router.push("/cart");
        } else {
          setBuyNotice("로그인 후 장바구니에 담았습니다.");
        }
      } catch (error) {
        setBuyNotice(
          error instanceof Error ? error.message : "구매 준비에 실패했습니다.",
        );
      } finally {
        setBuying(false);
      }
    })();
  }, [addToCart, item.id, item.saleType, removeFromCart, router]);

  useEffect(() => {
    if (!LIVE_AUCTION_ENABLED || item.saleType !== "auction") return;
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
  }, [item.id, item.saleType, receiveBid]);

  const addFixedToCart = async () => {
    if (buying) return;
    if (isEntryReadOnly()) { setBuyNotice("사이트 연결이 복구될 때까지 읽기 전용입니다."); return; }
    setBuying(true);
    setBuyNotice("");
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const session = data.session;
      if (!session?.access_token) {
        rememberFixedPurchaseIntent(item.id, "cart");
        window.location.assign(`/api/auth/kakao/start?returnTo=${encodeURIComponent(`/auction/${item.id}?purchaseIntent=cart`)}`);
        return;
      }
      addToCart(item.id);
      if (!await persistCart(item.id, true, session.user.id)) {
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
      const session = data.session;
      if (!session?.access_token) {
        rememberFixedPurchaseIntent(item.id, "buy");
        window.location.assign(`/api/auth/kakao/start?returnTo=${encodeURIComponent(`/auction/${item.id}?purchaseIntent=buy`)}`);
        return;
      }
      addToCart(item.id);
      if (!await persistCart(item.id, true, session.user.id)) {
        removeFromCart(item.id);
        throw new Error("현재 구매할 수 없는 상품입니다.");
      }
      router.push("/cart");
    } catch (error) {
      setBuyNotice(error instanceof Error ? error.message : "구매 준비에 실패했습니다.");
      setBuying(false);
    }
  };
  const updateWishlist = async () => {
    if (isEntryReadOnly()) {
      setBuyNotice("사이트 연결이 복구될 때까지 읽기 전용입니다.");
      return;
    }
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
        setBuyNotice("로그인 계정이 변경되었거나 찜을 저장하지 못했습니다.");
      }
    } catch {
      setBuyNotice("로그인 상태를 확인하지 못했습니다.");
    }
  };

  const visibleBids = bidStoreItemId === item.id && bids.length > 0
    ? bids
    : item.bidHistory;
  const displayPrice = item.saleType === "fixed"
    ? item.fixedPrice ?? item.currentBid
    : bidStoreItemId === item.id && currentPrice > 0
      ? currentPrice
      : item.currentBid;
  const submitBid = async (amount: number) => {
    if (isEntryReadOnly()) throw new Error("현재 사이트 연결이 불안정해 읽기 전용 모드입니다.");
    return addBid(amount);
  };
  const measurementChips = [
    ["어깨", item.measurements.shoulder],
    ["가슴", item.measurements.chest],
    ["총장", item.measurements.length],
  ].filter((measurement): measurement is [string, number] => typeof measurement[1] === "number" && measurement[1] > 0);

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
        {measurementChips.length > 0 && <div className="mt-5 flex flex-wrap gap-2 text-[11px] text-zinc-600">{measurementChips.map(([label, value]) => <span className="border border-zinc-200 px-3 py-2" key={label}>{label} {value} cm</span>)}</div>}
      </div>

      {LIVE_AUCTION_ENABLED && item.saleType === "auction" && <div className="my-6 border border-zinc-950 bg-zinc-950 px-5 py-5 text-white">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">LIVE DROP COUNTDOWN</span>
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
        </div>
        <p className="mt-3 font-mono text-3xl font-bold tracking-[0.06em]">{timeLeft}</p>
        <p className="mt-2 text-[11px] text-zinc-400">21:00–22:00 정산 점검 · 20:56 이후 신규 참여 제한</p>
      </div>}

      {LIVE_AUCTION_ENABLED && item.saleType === "auction" && <div className="border-b border-zinc-200 pb-5">
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

      {item.saleType === "auction" ? LIVE_AUCTION_ENABLED ? <><button aria-describedby="auction-settlement-summary" className="mobile-detail-cta mt-6 flex h-14 w-full items-center justify-center gap-2 bg-zinc-950 text-sm font-bold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300" disabled={readOnly} onClick={() => setModalOpen(true)} type="button"><LockKeyhole size={15} /> {readOnly ? "읽기 전용" : "실시간 경매 입찰하기"}</button><p className="mt-3 text-[11px] leading-5 text-zinc-500" id="auction-settlement-summary">낙찰 후 다음 날 11:59까지 결제 · 미결제 시 낙찰 취소·경고 및 차순위 전환</p></> : <div className="mt-6 border border-zinc-200 bg-zinc-50 p-4 text-xs leading-5 text-zinc-600">라이브 경매는 현재 점검 중입니다. 바로 구매 상품은 정상적으로 이용할 수 있습니다.</div> : <div className="mobile-detail-cta mt-6 grid grid-cols-2 gap-2"><button className="flex h-14 items-center justify-center gap-2 border border-zinc-950 text-sm font-bold text-zinc-950 disabled:opacity-50" disabled={buying || readOnly} onClick={() => void addFixedToCart()} type="button"><ShoppingBag size={15} /> {readOnly ? "읽기 전용" : "장바구니"}</button><button className="flex h-14 items-center justify-center bg-zinc-950 text-sm font-bold text-white disabled:opacity-50" disabled={buying || readOnly} onClick={() => void buyNow()} type="button">{readOnly ? "읽기 전용" : buying ? "장바구니 준비 중..." : "바로 구매"}</button></div>}
      {buyNotice && <p aria-live="polite" className="mt-3 text-xs font-bold text-emerald-700">{buyNotice}</p>}
      <button className="mt-2 flex h-12 w-full items-center justify-center gap-2 border border-zinc-200 text-xs font-bold text-zinc-950 transition-colors hover:border-zinc-950 disabled:opacity-50" disabled={readOnly} onClick={() => void updateWishlist()} type="button"><Heart fill={liked ? "currentColor" : "none"} size={15} /> {readOnly ? "읽기 전용" : liked ? "찜 해제" : "관심 상품 담기"}</button>
      {LIVE_AUCTION_ENABLED && item.saleType === "auction" && <SettlementActions productId={item.id} readOnly={readOnly} />}
      {LIVE_AUCTION_ENABLED && item.saleType === "auction" && <BidModal currentPrice={displayPrice} key={`${modalOpen}-${displayPrice}`} onClose={() => setModalOpen(false)} onSubmit={submitBid} open={modalOpen} />}
    </aside>
  );
}
