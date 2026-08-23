"use client";

import { Gavel, Heart, Images, List, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { Item } from "@/types/auction";
import { ProductInquiryModal } from "@/components/features/auction/detail/ProductInquiryModal";
import { AuctionBidHistoryModal } from "@/components/features/auction/AuctionBidHistoryModal";
import { AuctionGalleryModal } from "@/components/features/auction/AuctionGalleryModal";
import { ShareProductButton } from "@/components/ui/ShareProductButton";
import { canStartAuctionBid, getAuctionFeedBidAccess, isActiveAuctionBid, type AccountAuctionBidState, type AuctionBidCapability, type AuctionFeedPhase, type PublicAuctionBid } from "@/components/features/auction/auctionFeedLogic";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { StatusNotice } from "@/components/ui/StatusNotice";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { persistWishlist } from "@/lib/commerce/client";
import { useCommerceStore } from "@/store/useCommerceStore";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";
import { ProductFeedTags } from "@/components/features/catalog/ProductFeedTags";
import { isNewlyPublishedProduct } from "@/components/features/auction/auctionFeedLogic";
import { normalizeConditionGrade } from "@/lib/catalog/conditions";
import { measurementEntries } from "@/lib/catalog/measurements";

export type { AuctionFeedPhase } from "@/components/features/auction/auctionFeedLogic";

export type AuctionFeedItem = Omit<Item, "bidHistory"> & {
  auctionPhase?: AuctionFeedPhase;
  bidHistory: PublicAuctionBid[];
  bidLockedAt?: string | null;
  imageUrls: string[];
  participantCount?: number;
  timeLeft?: string;
  enhancedTitle?: string | null;
  hashtags?: string[];
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
  const grade = normalizeConditionGrade(item.conditionGrade);
  const quickSpecs = [
    grade ? `Grade ${grade}` : null,
    ...measurementEntries(item.measurements)
      .slice(0, 3)
      .map(({ label, value }) => `${label} ${value}`),
  ].filter((value): value is string => Boolean(value));
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
  const isNew = isNewlyPublishedProduct(item.publishAt);

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
    <article className="product-card group mx-auto w-full max-w-[260px] min-w-0 border-b border-line pb-4" data-auction-phase={phase} data-bid-capability={bidCapability} data-participation-state={participationState ?? "none"}>
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-line/30 bg-muted/20 shadow-sm transition-all duration-300 group-hover:border-line/80 group-hover:-translate-y-1 group-hover:shadow-xl">
        <Link className="block h-full" href={`${basePath}/auction/${item.id}`}>
          {item.imageUrl ? <CatalogImage alt={`${item.brand} ${item.name}`} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" fill loading="lazy" sizes="(max-width: 639px) 50vw, (max-width: 767px) 33vw, (max-width: 1279px) 25vw, (max-width: 1535px) 20vw, 16vw" src={item.imageUrl} /> : <div className="grid h-full place-items-center text-xs text-muted">이미지 준비 중</div>}
          <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
            {grade && <span className="rounded-md bg-zinc-900/90 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm backdrop-blur-md">GRADE {grade}</span>}
            <span aria-label={phase === "CLOSED" ? "마감됨" : "실시간 입찰"} className={`rounded-md px-2 py-0.5 text-[10px] font-black tracking-tight text-white shadow-sm ${phase === "CLOSED" ? "bg-zinc-700" : "bg-rose-600"}`}>{phase === "CLOSED" ? "마감됨" : "LIVE"}</span>
            {isNew && <span className="rounded-md bg-emerald-600 px-2 py-0.5 text-[10px] font-black tracking-tight text-white shadow-sm">NEW</span>}
          </div>
          {quickSpecs.length > 0 && <div aria-hidden="true" className="product-quick-specs pointer-events-none absolute inset-x-2 bottom-12 z-10 translate-y-2 rounded-lg border border-white/15 bg-ink/90 px-2.5 py-2 text-paper opacity-0 shadow-xl backdrop-blur-md transition-[opacity,transform] duration-200"><p className="line-clamp-2 text-[10px] font-bold leading-4">{quickSpecs.join(" · ")}</p></div>}
          <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-10 flex items-center justify-between rounded-lg bg-black/70 px-2.5 py-1 text-[11px] text-white backdrop-blur-md">
            <span className="flex items-center gap-1 font-mono tabular-nums">⏱ {item.timeLeft ?? "진행 중"}</span>
            <span className="font-semibold text-emerald-400">{bidCount}건 입찰</span>
          </div>
        </Link>
        <div className="absolute right-2 top-2 flex flex-col items-end gap-2"><button aria-label={`${item.name} 상품 문의`} className="flex h-8 items-center gap-1 rounded-xl bg-paper/90 px-2.5 text-[10px] font-bold text-ink shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95" onClick={() => setInquiryOpen(true)} type="button"><MessageCircle size={13} /> 문의</button><button aria-label={liked ? "찜 해제" : "찜하기"} className={`grid size-9 place-items-center rounded-xl bg-paper/90 shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95 ${liked ? "text-red-700" : "text-ink"}`} onClick={() => void updateWishlist()} type="button"><Heart fill={liked ? "currentColor" : "none"} size={15} strokeWidth={1.6} /></button><ShareProductButton ariaLabel={`${item.name} 공유`} className="grid size-9 place-items-center rounded-xl bg-paper/90 text-ink shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95" priceText={`현재 최고 입찰가 ${currentPrice.toLocaleString("ko-KR")}원`} title={`${item.enhancedTitle || item.name} | ${item.brand}`} url={`/auction/${item.id}`} /></div>
        {galleryImages.length > 0 && <button aria-label={`${item.name} 사진 ${galleryImages.length}장 확대 보기`} className="absolute bottom-12 right-2 flex h-8 items-center gap-1 rounded-lg bg-paper/90 px-2 text-[9px] font-bold text-ink shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95" onClick={() => setGalleryOpen(true)} type="button"><Images size={13} /> {galleryImages.length}</button>}
      </div>

      <div className="pt-2">
        <div className="text-[11px] text-muted"><span className="line-clamp-1">{item.brand}</span></div>
        <div className="mt-1 flex items-start justify-between gap-2"><Link className="min-h-[1.25rem] min-w-0 line-clamp-1 break-keep text-xs font-medium text-foreground/90 hover:underline sm:text-sm" href={`${basePath}/auction/${item.id}`}>{item.enhancedTitle || item.name}</Link>{participationState && <span className={`shrink-0 rounded-lg border px-2 py-1 text-[9px] font-bold ${participationState === "leading" || participationState === "final" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-500/10 text-amber-900"}`}>{participationLabels[participationState]}</span>}</div>
        <ProductFeedTags description={item.description} gender={item.gender} hashtags={item.hashtags} size={item.size} />
        <div className="mt-2 border-y border-line py-2.5">
          <div className="flex items-end justify-between gap-2"><div><p className="text-[10px] text-muted">{phase === "CLOSED" ? "최종 낙찰가" : "현재 최고 입찰가"}</p><p className="mt-0.5 font-mono text-sm font-bold text-foreground tabular-nums">{currentPrice.toLocaleString("ko-KR")}원</p></div><button aria-label={`입찰 내역 ${bidCount}건 보기`} className="flex items-center gap-1 text-right text-[10px] text-muted underline" onClick={() => setHistoryOpen(true)} type="button"><List size={12} /> 참여 {participantCount}명</button></div>
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-2">{canStartBid ? <Link className="flex h-11 items-center justify-center gap-1 rounded-lg bg-ink text-xs font-semibold text-paper shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95 sm:h-8" href={`${basePath}/auction/${item.id}/bid`}><Gavel size={13} /> {bidLabel}</Link> : <button className="flex h-11 items-center justify-center gap-1 rounded-lg bg-zinc-300 text-xs font-semibold text-paper sm:h-8" disabled type="button"><Gavel size={13} /> {bidLabel}</button>}<button aria-label={`${item.name} 상품 문의`} className="grid size-11 place-items-center rounded-lg border border-line shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95 sm:size-8" onClick={() => setInquiryOpen(true)} type="button"><MessageCircle size={13} /></button><Link className="flex h-11 items-center justify-center rounded-lg border border-line px-2.5 text-[10px] font-bold shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95 sm:h-8" href={`${basePath}/auction/${item.id}`}>상세</Link></div>
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
