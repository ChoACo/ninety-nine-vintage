"use client";

import Link from "next/link";
import { Gavel, Heart, ShoppingBag } from "lucide-react";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCommerceStore } from "@/store/useCommerceStore";

export function CommerceToolbar() {
  const pathname = usePathname();
  const auctionContext = pathname === "/feed" || pathname.startsWith("/auction/");
  const hydrate = useCommerceStore((state) => state.hydrate);
  const refreshLocal = useCommerceStore((state) => state.refreshLocal);
  const syncWithServer = useCommerceStore((state) => state.syncWithServer);
  const likedCount = useCommerceStore((state) => state.likedIds.length);
  const cartCount = useCommerceStore((state) => state.cartIds.length);
  useEffect(() => {
    hydrate();
    void syncWithServer();
    let client: ReturnType<typeof getSupabaseBrowserClient>;
    try { client = getSupabaseBrowserClient(); } catch { return undefined; }
    const syncSoon = () => window.setTimeout(() => void syncWithServer(), 0);
    const { data: listener } = client.auth.onAuthStateChange(syncSoon);
    const interval = window.setInterval(() => void syncWithServer(), 15_000);
    const onStorage = (event: StorageEvent) => { if (event.key === "ninetynine-commerce-cache") refreshLocal(); };
    window.addEventListener("storage", onStorage);
    return () => {
      listener.subscription.unsubscribe();
      window.clearInterval(interval);
      window.removeEventListener("storage", onStorage);
    };
  }, [hydrate, refreshLocal, syncWithServer]);
  return <div className="flex shrink-0 items-center gap-2"><Link aria-label="찜한 상품" className="relative grid size-10 shrink-0 place-items-center border border-line" href="/account#likes"><Heart size={16} /><span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-ink text-[9px] text-paper">{likedCount}</span></Link>{auctionContext ? <Link aria-label="입찰 현황" className="relative grid size-10 shrink-0 place-items-center border border-line" href="/account#bids"><Gavel size={16} /><span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-ink px-1 text-[8px] text-paper">BID</span></Link> : <Link aria-label="장바구니" className="relative grid size-10 shrink-0 place-items-center border border-line" href="/cart"><ShoppingBag size={16} /><span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-ink text-[9px] text-paper">{cartCount}</span></Link>}</div>;
}
