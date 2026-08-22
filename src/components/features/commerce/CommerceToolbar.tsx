"use client";

import Link from "next/link";
import { Heart, Settings, ShoppingBag } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { resolveVisibleCommerceCount } from "@/lib/commerce/cacheOwnership";
import { useCommerceStore } from "@/store/useCommerceStore";

export function CommerceToolbar({
  before,
  after,
  showSettings = true,
}: {
  before?: ReactNode;
  after?: ReactNode;
  showSettings?: boolean;
}) {
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
  if (!sessionLoading && !session) return null;
  return <div className="flex shrink-0 items-center gap-2">{before}<Link aria-busy={visibleLikedCount === null} aria-label="찜한 상품" className="relative inline-flex size-10 shrink-0 items-center justify-center border border-line text-muted transition-colors hover:border-ink hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2" href="/wishlist"><Heart size={17} strokeWidth={1.75} />{visibleLikedCount !== null && visibleLikedCount > 0 && <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-[9px] font-bold text-paper">{Math.min(visibleLikedCount, 99)}</span>}</Link><Link aria-busy={visibleCartCount === null} aria-label="장바구니" className="relative inline-flex size-10 shrink-0 items-center justify-center border border-line text-muted transition-colors hover:border-ink hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2" href="/cart"><ShoppingBag size={17} strokeWidth={1.75} />{visibleCartCount !== null && visibleCartCount > 0 && <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-[9px] font-bold text-paper">{Math.min(visibleCartCount, 99)}</span>}</Link>{showSettings && <Link aria-label="설정" className="grid size-10 shrink-0 place-items-center border border-line text-muted transition-colors hover:border-ink hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2" href="/settings"><Settings size={17} strokeWidth={1.75} /></Link>}{after}</div>;
}
