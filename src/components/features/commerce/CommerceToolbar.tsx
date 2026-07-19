"use client";

import Link from "next/link";
import { Heart, ShoppingBag } from "lucide-react";
import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useCommerceStore } from "@/store/useCommerceStore";

export function CommerceToolbar() {
  const hydrate = useCommerceStore((state) => state.hydrate);
  const refreshLocal = useCommerceStore((state) => state.refreshLocal);
  const syncWithServer = useCommerceStore((state) => state.syncWithServer);
  const likedCount = useCommerceStore((state) => state.likedIds.length);
  const cartCount = useCommerceStore((state) => state.cartIds.length);
  useEffect(() => {
    hydrate();
    void syncWithServer();
    const client = getSupabaseBrowserClient();
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
  return <div className="flex shrink-0 items-center gap-2"><Link className="relative grid size-10 shrink-0 place-items-center border border-line" href="/account#likes"><Heart size={16} /><span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-ink text-[9px] text-paper">{likedCount}</span></Link><Link className="relative grid size-10 shrink-0 place-items-center border border-line" href="/cart"><ShoppingBag size={16} /><span className="absolute -right-1 -top-1 grid size-4 shrink-0 place-items-center rounded-full bg-ink text-[9px] text-paper">{cartCount}</span></Link></div>;
}
