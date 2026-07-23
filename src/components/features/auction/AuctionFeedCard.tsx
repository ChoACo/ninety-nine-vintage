"use client";

import { Gavel, Heart, Images, List, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Item } from "@/types/auction";
import { ProductInquiryModal } from "@/components/features/auction/detail/ProductInquiryModal";
import { AuctionBidHistoryModal } from "@/components/features/auction/AuctionBidHistoryModal";
import { AuctionGalleryModal } from "@/components/features/auction/AuctionGalleryModal";
import { canStartAuctionBid, getAuctionFeedBidAccess, isActiveAuctionBid, type AccountAuctionBidState, type AuctionBidCapability, type AuctionFeedPhase, type PublicAuctionBid } from "@/components/features/auction/auctionFeedLogic";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { StatusNotice } from "@/components/ui/StatusNotice";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { persistWishlist } from "@/lib/commerce/client";
import { useCommerceStore } from "@/store/useCommerceStore";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";

export type { AuctionFeedPhase } from "@/components/features/auction/auctionFeedLogic";

export type AuctionFeedItem = Omit<Item, "bidHistory"> & {
  auctionPhase?: AuctionFeedPhase;
  bidHistory: PublicAuctionBid[];
  bidLockedAt?: string | null;
  imageUrls: string[];
  participantCount?: number;
  timeLeft?: string;
};

interface AuctionFeedCardProps {
  basePath?: "" | "/m";
  bidCapability: AuctionBidCapability;
  item: AuctionFeedItem;
  onBidPlaced?: () => void;
  participationState?: AccountAuctionBidState;
  surface?: "desktop" | "mobile";
}

const participationLabels: Record<AccountAuctionBidState, string> = {
  leading: "내가 최고 입찰",
  final: "낙찰 확정",
  outbid: "재입찰 필요",
  closed: "참여 경매 종료",
};

export function AuctionFeedCard(props: AuctionFeedCardProps) {
  if (!LIVE_AUCTION_ENABLED) return null;
  return <EnabledAuctionFeedCard {...props} />;
}

function EnabledAuctionFeedCard({ basePath = "", bidCapability, item, participationState, surface = basePath === "/m" ? "mobile" : "desktop" }: AuctionFeedCardProps) {
  const liked = useCommerceStore((state) => state.likedIds.includes(item.id));
  const toggleLike = useCommerceStore((state) => state.toggleLike);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const history = item.bidHistory;
  const activeHistory = useMemo(() => history.filter(isActiveAuctionBid), [history]);
  const currentPrice = item.currentBid;
  const bidCount = Math.max(item.bidCount, activeHistory.length);
  const participantCount = item.participantCount ?? 0;
  const phase = item.bidLockedAt ? "CLOSED" : item.auctionPhase ?? "OPEN";
  const { canBid, firstBidFinal, hasParticipated } = getAuctionFeedBidAccess({ bidCount, bidIncrement: item.bidIncrement, currentPrice, participationState, phase });
  const policyBidLabel = phase === "CLOSING_SOON"
    ? firstBidFinal ? "첫 입찰 즉시 확정" : hasParticipated ? "기존 참여자 입찰" : "기존 참여자 전용"
    : phase === "CLOSED" ? "경매 마감"
      : phase === "UPCOMING" ? "오픈 예정"
        : participationState === "outbid" ? "재입찰하기" : "경매 참여";
  const bidLabel = !canBid
    ? policyBidLabel
    : bidCapability === "checking"
      ? "입찰 자격 확인 중"
      : bidCapability === "non_member"
        ? "카카오 회원 전용"
        : bidCapability === "unavailable"
          ? "입찰 자격 확인 불가"
          : bidCapability === "guest"
            ? "로그인 후 입찰"
            : policyBidLabel;
  const canStartBid = canBid && canStartAuctionBid(bidCapability);
  const galleryImages = item.imageUrls.length > 0 ? item.imageUrls : item.imageUrl ? [item.imageUrl] : [];

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
        setActionMessage({ kind: "error", text: "로그인 계정이 변경되었거나 찜을 저장하지 못했습니다." });
      }
    } catch {
      setActionMessage({ kind: "error", text: "로그인 상태를 확인하지 못했습니다." });
    }
  };

  return (
    <article className="group min-w-0 border-b border-line pb-5" data-auction-phase={phase} data-bid-capability={bidCapability} data-participation-state={participationState ?? "none"}>
      <div className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-lg shadow-black/5 transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-xl">
        <Link className="block h-full" href={`${basePath}/auction/${item.id}`}>
          {item.imageUrl ? <CatalogImage alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" loading="lazy" sizes={surface === "desktop" ? "220px" : "(max-width: 699px) 50vw, 33vw"} src={item.imageUrl} /> : <div className="grid h-full place-items-center text-xs text-muted">이미지 준비 중</div>}
          <span className="absolute left-2 top-2 rounded-lg bg-paper/90 px-2 py-1 font-mono text-[9px] font-bold tracking-[0.1em] shadow-sm backdrop-blur-md">실시간 입찰</span>
          <div className="absolute inset-x-0 bottom-0 translate-y-full bg-ink/95 px-3 py-3 text-paper opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100"><p className="text-[10px] text-zinc-400">경매 상품 상세</p><p className="mt-1 text-xs font-bold">상태·실측·현재가를 확인하세요.</p></div>
        </Link>
        <button aria-label={liked ? "찜 해제" : "찜하기"} className={`absolute right-2 top-2 grid size-9 place-items-center rounded-xl bg-paper/90 shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95 ${liked ? "text-red-700" : "text-ink"}`} onClick={() => void updateWishlist()} type="button"><Heart fill={liked ? "currentColor" : "none"} size={15} strokeWidth={1.6} /></button>
        {galleryImages.length > 0 && <button aria-label={`${item.name} 사진 ${galleryImages.length}장 확대 보기`} className="absolute bottom-2 right-2 flex h-8 items-center gap-1 rounded-xl bg-paper/90 px-2 text-[9px] font-bold text-ink shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95" onClick={() => setGalleryOpen(true)} type="button"><Images size={13} /> {galleryImages.length}</button>}
      </div>

      <div className="pt-3">
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted"><span className="truncate">{item.brand}</span><span className={`shrink-0 font-mono tabular-nums ${phase === "CLOSING_SOON" ? "text-amber-700" : phase === "CLOSED" ? "text-red-700" : ""}`}>{item.timeLeft ?? "진행 중"}</span></div>
        <div className="mt-1 flex items-start justify-between gap-2"><Link className="min-w-0 truncate text-sm font-medium hover:underline" href={`${basePath}/auction/${item.id}`}>{item.name}</Link>{participationState && <span className={`shrink-0 rounded-lg border px-2 py-1 text-[9px] font-bold ${participationState === "leading" || participationState === "final" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900"}`}>{participationLabels[participationState]}</span>}</div>
        <div className="mt-3 border-y border-line py-3">
          <div className="flex items-end justify-between gap-2"><div><p className="text-[10px] text-muted">현재 최고 입찰가</p><p className="font-mono text-base font-bold tabular-nums">{currentPrice.toLocaleString("ko-KR")}원</p></div><button aria-label={`입찰 내역 ${bidCount}건 보기`} className="flex items-center gap-1 text-right text-[10px] text-muted underline" onClick={() => setHistoryOpen(true)} type="button"><List size={12} /> 입찰 {bidCount}건 · 참여 {participantCount}명</button></div>
        </div>
        <div className="mt-4 grid grid-cols-[1fr_auto_auto] gap-2">{canStartBid ? <Link className="flex h-9 items-center justify-center gap-1 rounded-xl bg-ink text-[10px] font-bold text-paper shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95" href={`${basePath}/auction/${item.id}/bid`}><Gavel size={13} /> {bidLabel}</Link> : <button className="flex h-9 items-center justify-center gap-1 rounded-xl bg-zinc-300 text-[10px] font-bold text-paper" disabled type="button"><Gavel size={13} /> {bidLabel}</button>}<button aria-label={`${item.name} 상품 문의`} className="grid size-9 place-items-center rounded-xl border border-line shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95" onClick={() => setInquiryOpen(true)} type="button"><MessageCircle size={13} /></button><Link className="flex h-9 items-center justify-center rounded-xl border border-line px-3 text-[10px] font-bold shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95" href={`${basePath}/auction/${item.id}`}>상세</Link></div>
        {phase === "CLOSING_SOON" && <p className="mt-2 text-[10px] text-amber-700">{firstBidFinal ? "무입찰 상품의 첫 입찰은 즉시 확정됩니다." : hasParticipated ? "마감 직전에는 기존 참여자만 추가 입찰할 수 있습니다." : "신규 참여가 마감되었습니다. 기존 참여자만 입찰할 수 있습니다."}</p>}
        {bidCapability === "non_member" && <p className="mt-2 text-[10px] text-amber-700">현재 로그인한 계정은 경매 입찰용 회원 계정이 아닙니다.</p>}
        {actionMessage && <StatusNotice className="mt-3" variant={actionMessage.kind}>{actionMessage.text}</StatusNotice>}
      </div>

      <AuctionBidHistoryModal history={history} itemTitle={item.name} onClose={() => setHistoryOpen(false)} open={historyOpen} />
      <ProductInquiryModal basePath={basePath} onClose={() => setInquiryOpen(false)} open={inquiryOpen} productId={item.id} productTitle={item.name} />
      <AuctionGalleryModal images={galleryImages} key={item.id} onClose={() => setGalleryOpen(false)} open={galleryOpen} surface={surface} title={item.name} />
    </article>
  );
}
