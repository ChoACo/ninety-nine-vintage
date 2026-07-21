"use client";

import Link from "next/link";
import { Gavel, Heart, ShoppingBag } from "lucide-react";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { resolveVisibleCommerceCount } from "@/lib/commerce/cacheOwnership";
import { useCommerceStore } from "@/store/useCommerceStore";

export function CommerceToolbar() {
  const pathname = usePathname();
  const auctionContext = LIVE_AUCTION_ENABLED && (pathname === "/feed" || pathname.startsWith("/auction/"));
  const { loading: sessionLoading, revision, session } = useSupabaseSession();
  const hydrate = useCommerceStore((state) => state.hydrate);
  const refreshLocal = useCommerceStore((state) => state.refreshLocal);
  const resetForSession = useCommerceStore((state) => state.resetForSession);
  const syncWithServer = useCommerceStore((state) => state.syncWithServer);
  const ownerMode = useCommerceStore((state) => state.ownerMode);
  const ownerUserId = useCommerceStore((state) => state.ownerUserId);
  const likedCount = useCommerceStore((state) => state.likedIds.length);
  const cartCount = useCommerceStore((state) => state.cartIds.length);
  const sessionUserId = session?.user.id ?? null;
  const visibleLikedCount = resolveVisibleCommerceCount({
    count: likedCount,
    sessionLoading,
    sessionUserId,
    ownerMode,
    ownerUserId,
  });
  const visibleCartCount = resolveVisibleCommerceCount({
    count: cartCount,
    sessionLoading,
    sessionUserId,
    ownerMode,
    ownerUserId,
  });

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (sessionLoading) return undefined;
    resetForSession(sessionUserId);
    void syncWithServer();
    const interval = window.setInterval(() => void syncWithServer(), 15_000);
    const onStorage = (event: StorageEvent) => { if (event.key === "ninetynine-commerce-cache") refreshLocal(); };
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", onStorage);
    };
  }, [refreshLocal, resetForSession, revision, sessionLoading, sessionUserId, syncWithServer]);
  return <div className="flex shrink-0 items-center gap-2"><Link aria-busy={visibleLikedCount === null} aria-label="찜한 상품" className="relative grid size-10 shrink-0 place-items-center border border-line" href="/account#likes"><Heart size={16} />{visibleLikedCount !== null && <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-ink text-[9px] text-paper">{visibleLikedCount}</span>}</Link>{auctionContext ? <Link aria-label="입찰 현황" className="relative grid size-10 shrink-0 place-items-center border border-line" href="/account#bids"><Gavel size={16} /><span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-ink px-1 text-[8px] text-paper">입찰</span></Link> : <Link aria-busy={visibleCartCount === null} aria-label="장바구니" className="relative grid size-10 shrink-0 place-items-center border border-line" href="/cart"><ShoppingBag size={16} />{visibleCartCount !== null && <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-ink text-[9px] text-paper">{visibleCartCount}</span>}</Link>}</div>;
}
