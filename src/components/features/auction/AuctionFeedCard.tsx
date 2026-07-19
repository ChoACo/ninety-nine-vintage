"use client";

import { Gavel, Heart } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { Item } from "@/types/auction";
import { BidModal } from "@/components/features/auction/detail/BidModal";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { persistWishlist } from "@/lib/commerce/client";
import { useCommerceStore } from "@/store/useCommerceStore";

export type AuctionFeedPhase = "OPEN" | "CLOSING_SOON" | "CLOSED" | "UPCOMING";

type AuctionFeedItem = Item & {
  auctionPhase?: AuctionFeedPhase;
  participantCount?: number;
  timeLeft?: string;
};

interface AuctionFeedCardProps {
  item: AuctionFeedItem;
}

function bidErrorMessage(message: string) {
  if (message.includes("카카오 회원 로그인")) {
    return "현재 계정은 운영자 계정이거나 회원 프로필이 완성되지 않았습니다. 입찰은 카카오 회원 계정으로 이용해 주세요.";
  }
  return message;
}

export function AuctionFeedCard({ item }: AuctionFeedCardProps) {
  const liked = useCommerceStore((state) => state.likedIds.includes(item.id));
  const toggleLike = useCommerceStore((state) => state.toggleLike);
  const [bidOpen, setBidOpen] = useState(false);
  const [optimisticBid, setOptimisticBid] = useState<{ amount: number; bidCount: number; participantCount: number } | null>(null);
  const [actionMessage, setActionMessage] = useState("");

  const currentPrice = Math.max(item.currentBid, optimisticBid?.amount ?? 0);
  const bidCount = Math.max(item.bidCount, optimisticBid?.bidCount ?? 0);
  const participantCount = Math.max(item.participantCount ?? item.bidCount, optimisticBid?.participantCount ?? 0);

  const phase = item.auctionPhase ?? "OPEN";
  const canBid = phase === "OPEN" || phase === "CLOSING_SOON";
  const bidLabel = phase === "CLOSING_SOON" ? "기존 참여자 입찰" : phase === "CLOSED" ? "경매 마감" : phase === "UPCOMING" ? "오픈 예정" : "간편 입찰";

  const submitBid = async (amount: number) => {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    if (!data.session?.access_token) throw new Error("카카오 로그인 후 입찰할 수 있습니다.");
    const response = await fetch("/api/auction/bids", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ productId: item.id, amount }),
    });
    const payload = await response.json() as { bid?: { amount: number; participantCount: number }; error?: string };
    if (!response.ok || !payload.bid) throw new Error(bidErrorMessage(payload.error ?? "입찰을 저장하지 못했습니다."));
    setOptimisticBid({ amount: payload.bid.amount, bidCount: bidCount + 1, participantCount: payload.bid.participantCount });
    setActionMessage("입찰이 완료되었습니다. 현재 입찰가를 갱신했습니다.");
  };

  return (
    <article className="group min-w-0 border-b border-line pb-5">
      <div className="relative aspect-[4/5] overflow-hidden bg-surface">
        <Link className="block h-full" href={`/auction/${item.id}`}>
          {item.imageUrl ? <CatalogImage alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" loading="lazy" src={item.imageUrl} /> : <div className="grid h-full place-items-center text-xs text-muted">이미지 준비 중</div>}
          <span className="absolute left-2 top-2 bg-paper px-2 py-1 font-mono text-[9px] font-bold tracking-[0.1em]">LIVE BID</span>
          <div className="absolute inset-x-0 bottom-0 translate-y-full bg-ink/95 px-3 py-3 text-paper opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
            <p className="text-[10px] text-zinc-400">경매 참여</p>
            <p className="mt-1 text-xs font-bold">현재가와 입찰 현황을 확인하세요.</p>
          </div>
        </Link>
        <button aria-label={liked ? "찜 해제" : "찜하기"} className={`absolute right-2 top-2 grid size-8 place-items-center bg-paper/90 transition-colors ${liked ? "text-red-700" : "text-ink"}`} onClick={() => { const nextLiked = !liked; toggleLike(item.id); void persistWishlist(item.id, nextLiked); }} type="button"><Heart fill={liked ? "currentColor" : "none"} size={15} strokeWidth={1.6} /></button>
      </div>
      <div className="pt-3">
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted"><span className="truncate">{item.brand}</span><span className={`shrink-0 font-mono tabular-nums ${phase === "CLOSING_SOON" ? "text-amber-700" : phase === "CLOSED" ? "text-red-700" : ""}`}>{item.timeLeft ?? "LIVE"}</span></div>
        <Link className="mt-1 block truncate text-sm font-medium hover:underline" href={`/auction/${item.id}`}>{item.name}</Link>
        <div className="mt-3 border-y border-line py-3">
          <div className="flex items-end justify-between gap-2"><div><p className="text-[10px] text-muted">현재 최고 입찰가</p><p className="font-mono text-base font-bold tabular-nums">{currentPrice.toLocaleString("ko-KR")}원</p></div><span className="text-right text-[10px] text-muted">입찰 {bidCount}건<br />참여 {participantCount}명</span></div>
        </div>
        <div className="mt-4 grid grid-cols-[1fr_auto] gap-2"><button className="flex h-9 items-center justify-center gap-1 bg-ink text-[10px] font-bold text-paper disabled:cursor-not-allowed disabled:bg-zinc-300" disabled={!canBid} onClick={() => setBidOpen(true)} type="button"><Gavel size={13} /> {bidLabel}</button><Link className="flex h-9 items-center justify-center border border-line px-3 text-[10px] font-bold" href={`/auction/${item.id}`}>상세</Link></div>
        {phase === "CLOSING_SOON" && <p className="mt-2 text-[10px] text-amber-700">20:56 이후 신규 참여가 제한되고 기존 참여자만 입찰할 수 있습니다.</p>}
        {actionMessage && <p aria-live="polite" className="mt-2 text-[10px] font-bold text-emerald-700">{actionMessage}</p>}
      </div>
      <BidModal currentPrice={currentPrice} key={`${item.id}-${currentPrice}-${bidOpen}`} onClose={() => setBidOpen(false)} onSubmit={submitBid} open={bidOpen} />
    </article>
  );
}
