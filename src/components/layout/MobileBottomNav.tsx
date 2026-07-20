"use client";

import { Gavel, Heart, Home, ShoppingBag, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCommerceStore } from "@/store/useCommerceStore";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";

const tabs = [
  ["홈", "/home", Home],
  ...(LIVE_AUCTION_ENABLED ? [["LIVE AUCTION", "/feed", Gavel] as const] : []),
  ["BUY NOW", "/shop", ShoppingBag],
  ["찜·장바구니", "/account#likes", Heart],
  ["내 정보", "/account", UserRound],
] as const;

export function MobileBottomNav() {
  const pathname = usePathname();
  const likedCount = useCommerceStore((state) => state.likedIds.length);
  const cartCount = useCommerceStore((state) => state.cartIds.length);
  return <nav aria-label="모바일 하단 메뉴" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)]  hidden"><div className={`mx-auto grid h-16 max-w-lg ${LIVE_AUCTION_ENABLED ? "grid-cols-5" : "grid-cols-4"}`}><span className="sr-only">모바일 주요 메뉴</span>{tabs.map(([label, href, Icon]) => { const active = pathname === href || (href !== "/home" && pathname.startsWith(href.split("#")[0])); const count = href.includes("likes") ? likedCount + cartCount : 0; return <Link className={`relative flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-center text-[9px] font-bold ${active ? "text-ink" : "text-muted"}`} href={href} key={href}><Icon size={16} strokeWidth={active ? 2.5 : 1.7} />{count > 0 && <span className="absolute right-[20%] top-2 grid size-4 place-items-center rounded-full bg-ink text-[8px] text-paper">{count}</span>}<span className="truncate">{label}</span></Link>; })}</div></nav>;
}
