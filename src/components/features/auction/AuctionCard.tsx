"use client";

import { Gavel, Heart, MessageCircle, ShoppingBag } from "lucide-react";
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
import { ProductFeedTags } from "@/components/features/catalog/ProductFeedTags";
import { isNewlyPublishedProduct } from "@/components/features/auction/auctionFeedLogic";
import { ProductInquiryModal } from "@/components/features/auction/detail/ProductInquiryModal";
import { ShareProductButton } from "@/components/ui/ShareProductButton";
import { useToastStore } from "@/store/useToastStore";
import { normalizeConditionGrade } from "@/lib/catalog/conditions";
import { measurementEntries } from "@/lib/catalog/measurements";

interface AuctionCardProps { basePath?: "" | "/m"; detailRoute?: "auction" | "shop"; item: Omit<Item, "bidHistory"> & { closesAt?: string; timeLeft?: string; enhancedTitle?: string | null; hashtags?: string[] }; surface?: "desktop" | "mobile"; }

export function AuctionCard(props: AuctionCardProps) {
  if (props.item.saleType === "auction" && !LIVE_AUCTION_ENABLED) return null;
  return <EnabledAuctionCard {...props} />;
}

function EnabledAuctionCard({ basePath = "", detailRoute, item }: AuctionCardProps) {
  const router = useRouter();
  const isFixed = item.saleType === "fixed";
  const resolvedDetailRoute = detailRoute ?? (isFixed ? "shop" : "auction");
  const price = isFixed ? (item.fixedPrice ?? item.currentBid) : item.currentBid;
  const likedInStore = useCommerceStore((state) => state.likedIds.includes(item.id));
  const liked = likedInStore;
  const toggleLike = useCommerceStore((state) => state.toggleLike);
  const hydrate = useCommerceStore((state) => state.hydrate);
  const addToCart = useCommerceStore((state) => state.addToCart);
  const removeFromCart = useCommerceStore((state) => state.removeFromCart);
  const pushToast = useToastStore((state) => state.pushToast);
  const [actionMessage, setActionMessage] = useState("");
  const [cartBusy, setCartBusy] = useState(false);
  const [wishlistBusy, setWishlistBusy] = useState(false);
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const isNew = isNewlyPublishedProduct(item.publishAt);
  const grade = normalizeConditionGrade(item.conditionGrade);
  const quickSpecs = [
    grade ? `Grade ${grade}` : null,
    ...measurementEntries(item.measurements)
      .slice(0, 3)
      .map(({ label, value }) => `${label} ${value}`),
  ].filter((value): value is string => Boolean(value));
  const gradeClass = grade === "S" ? "bg-emerald-700 text-white" : grade === "A" ? "bg-amber-100 text-amber-950" : grade === "C" ? "bg-red-800 text-white" : "bg-zinc-800 text-white";
  const sold = item.status === "closed";
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
          `${basePath}/account/login?next=${encodeURIComponent(`${basePath}/shop/${item.id}?purchaseIntent=cart`)}`,
        );
        return;
      }
      addToCart(item.id);
      await reserveCartProduct(item.id, session.user.id);
      setActionMessage("장바구니에 담았습니다. 구매 가능 여부는 결제 시 다시 확인됩니다.");
      pushToast("success", "장바구니에 상품을 담았습니다.");
    } catch (error) {
      removeFromCart(item.id);
      const message = error instanceof Error ? error.message : "장바구니에 담지 못했습니다.";
      setActionMessage(message);
      pushToast("error", `${message} 장바구니 상태를 되돌렸습니다.`);
    } finally {
      setCartBusy(false);
    }
  };
  const updateWishlist = async () => {
    if (wishlistBusy) return;
    const nextLiked = !liked;
    toggleLike(item.id);
    setWishlistBusy(true);
    try {
      const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
      if (session && !(await persistWishlist(item.id, nextLiked, session.user.id))) {
        toggleLike(item.id);
        setActionMessage("로그인 계정이 변경되었거나 찜을 저장하지 못했습니다.");
        pushToast("error", "찜을 저장하지 못해 이전 상태로 되돌렸습니다.");
      }
    } catch {
      toggleLike(item.id);
      setActionMessage("로그인 상태를 확인하지 못했습니다.");
      pushToast("error", "찜을 저장하지 못해 이전 상태로 되돌렸습니다.");
    } finally {
      setWishlistBusy(false);
    }
  };
  return (
    <article className="product-card group mx-auto w-full max-w-[260px] min-w-0">
      <Link className="block" href={`${basePath}/${resolvedDetailRoute}/${item.id}`} prefetch={false}>
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-line/30 bg-muted/20 shadow-sm transition-all duration-300 group-hover:border-line/80 group-hover:-translate-y-1 group-hover:shadow-xl">
          {item.imageUrl ? <CatalogImage alt={`${item.brand} ${item.name}`} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105" fill loading="lazy" sizes="(max-width: 639px) 50vw, (max-width: 767px) 33vw, (max-width: 1279px) 25vw, (max-width: 1535px) 20vw, 16vw" src={item.imageUrl} /> : <div className="grid h-full place-items-center text-xs text-muted">이미지 준비 중</div>}
          <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
            {grade && <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold shadow-sm ${gradeClass}`}>GRADE {grade}</span>}
            {!isFixed && <span className="rounded-md bg-rose-600 px-2 py-0.5 text-[10px] font-black tracking-tight text-white shadow-sm dark:text-zinc-950">LIVE</span>}
            {isNew && <span className="rounded-md bg-emerald-600 px-2 py-0.5 text-[10px] font-black tracking-tight text-white shadow-sm">NEW</span>}
          </div>
          <div className="absolute right-2 top-2 flex flex-col items-end gap-2">
            <button aria-label={liked ? `${item.name} 찜 해제` : `${item.name} 찜하기`} className={`grid size-9 place-items-center rounded-xl bg-paper/90 shadow-sm backdrop-blur-md transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ink active:scale-95 ${liked ? "text-red-700" : "text-ink"}`} disabled={wishlistBusy} onClick={(event) => { event.preventDefault(); void updateWishlist(); }} type="button"><Heart className={liked ? "scale-110" : "scale-100"} fill={liked ? "currentColor" : "none"} size={16} strokeWidth={1.75} /></button>
            <button aria-label={`${item.name} 상품 문의`} className="flex h-8 items-center gap-1 rounded-xl bg-paper/90 px-2.5 text-[10px] font-bold text-ink shadow-sm backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ink active:scale-95" onClick={(event) => { event.preventDefault(); setInquiryOpen(true); }} type="button"><MessageCircle size={13} strokeWidth={1.75} /> 문의</button>
            <ShareProductButton ariaLabel={`${item.name} 공유`} className="grid size-9 place-items-center rounded-xl bg-paper/90 text-ink shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95" priceText={`${isFixed ? "판매 정가" : "현재 입찰가"} ${price.toLocaleString("ko-KR")}원`} title={`${item.enhancedTitle || item.name} | ${item.brand}`} url={`/${resolvedDetailRoute}/${item.id}`} />
          </div>
          {sold && <div className="absolute inset-0 grid place-items-center bg-black/60 text-center text-white"><span className="border border-white/70 px-5 py-3"><strong className="block text-sm tracking-[.16em]">SOLD OUT</strong><span className="mt-1 block text-[10px]">판매완료</span></span></div>}
          {quickSpecs.length > 0 && (
            <div aria-hidden="true" className="product-quick-specs pointer-events-none absolute inset-x-3 bottom-3 z-10 translate-y-2 rounded-xl border border-white/15 bg-ink/90 px-3 py-2.5 text-paper opacity-0 shadow-xl backdrop-blur-md transition-[opacity,transform] duration-200">
              <p className="line-clamp-2 text-[10px] font-bold leading-4">
                {quickSpecs.join(" · ")}
              </p>
            </div>
          )}
        </div>
      </Link>
      <div className="pt-2">
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted"><span className="line-clamp-1 min-w-0">{item.brand}</span><span className="shrink-0 font-mono text-[10px] tabular-nums">{item.timeLeft ?? "진행 중"}</span></div>
        <Link className="mt-1 block min-h-[1.25rem] line-clamp-1 break-keep text-xs font-medium text-foreground/90 hover:underline focus-visible:ring-2 focus-visible:ring-ink sm:text-sm" href={`${basePath}/${resolvedDetailRoute}/${item.id}`} prefetch={false}>{item.enhancedTitle || item.name}</Link>
        <ProductFeedTags description={item.description} gender={item.gender} hashtags={item.hashtags} size={item.size} />
        <div className="mt-2 flex items-end justify-between gap-2">
          <div><p className="text-[10px] text-muted">{isFixed ? "판매 정가" : "현재 입찰가"}</p><p className="mt-0.5 font-mono text-sm font-bold text-foreground tabular-nums sm:text-base">{price.toLocaleString("ko-KR")}원</p></div>
          <p className="text-[10px] text-muted">{isFixed ? "즉시 구매" : `입찰 ${item.bidCount}건`}</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {isFixed ? <><button className="flex h-9 items-center justify-center gap-1 rounded-xl border border-line text-[10px] font-bold shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-ink hover:shadow-lg active:scale-95 disabled:opacity-50" disabled={cartBusy} onClick={(event) => { event.preventDefault(); void addFixedToCart(); }} type="button"><ShoppingBag size={13} /> {cartBusy ? "저장 중" : "장바구니"}</button><Link className="flex h-9 items-center justify-center rounded-xl bg-ink text-[10px] font-bold text-paper shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95" href={`${basePath}/shop/${item.id}`} prefetch={false}>즉시 구매</Link></> : <Link className="col-span-2 flex h-9 items-center justify-center gap-1 rounded-xl bg-ink text-[10px] font-bold text-paper shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg active:scale-95" href={`${basePath}/auction/${item.id}/bid`} prefetch={false}><Gavel size={13} /> 입찰하기</Link>}
        </div>
        {actionMessage && <p aria-live="polite" className="mt-2 text-[10px] font-bold text-emerald-700">{actionMessage}</p>}
      </div>
      <ProductInquiryModal basePath={basePath} onClose={() => setInquiryOpen(false)} open={inquiryOpen} productId={item.id} productTitle={item.name} />
    </article>
  );
}
