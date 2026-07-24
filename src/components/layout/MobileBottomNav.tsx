"use client";

import { Gavel, Home, ShieldCheck, ShoppingBag, TrendingUp, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCommerceStore } from "@/store/useCommerceStore";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";
import { useAdminNavigationAccess } from "@/hooks/useAdminNavigationAccess";

export function MobileBottomNav() {
  const pathname = usePathname();
  const access = useAdminNavigationAccess();
  const likedCount = useCommerceStore((state) => state.likedIds.length);
  const cartCount = useCommerceStore((state) => state.cartIds.length);
  const staffTab =
    access.roleCode === "operator"
      ? (["출고·보관", "/admin/operator/fulfillment", ShieldCheck] as const)
      : access.roleCode === "employee"
        ? (["직원센터", "/admin/employee", ShieldCheck] as const)
        : access.roleCode === "owner"
          ? (["소유자 센터", "/admin/owner", ShieldCheck] as const)
          : null;
  const tabs = [
    ["홈", "/home", Home],
    ...(LIVE_AUCTION_ENABLED ? [["입찰 중", "/bidding", TrendingUp] as const] : []),
    ...(LIVE_AUCTION_ENABLED ? [["실시간 경매", "/feed", Gavel] as const] : []),
    ["즉시 구매", "/shop", ShoppingBag] as const,
    ["내 정보", "/account", UserRound] as const,
    ...(staffTab ? [staffTab] : []),
  ] as const;
  return <nav aria-label="모바일 하단 메뉴" className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"><div className="mx-auto grid h-16 max-w-lg" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}><span className="sr-only">모바일 주요 메뉴</span>{tabs.map(([label, href, Icon]) => { const active = pathname === href || (href !== "/home" && pathname.startsWith(href.split("#")[0])); const count = href === "/account" ? likedCount + cartCount : 0; const live = href === "/feed"; return <Link className={`relative flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-center text-[9px] font-bold ${live ? "text-rose-600" : active ? "text-ink" : "text-muted"}`} href={href} key={href}><span className={live ? "relative grid size-7 place-items-center rounded-full bg-rose-50 before:absolute before:inset-0 before:animate-ping before:rounded-full before:bg-rose-400/25" : "relative grid size-7 place-items-center"}><Icon className="relative" size={17} strokeWidth={active ? 2.5 : 1.7} /></span>{count > 0 && <span className="absolute right-[20%] top-1 grid size-4 place-items-center rounded-full bg-ink text-[8px] text-paper">{count}</span>}<span className="truncate">{label}</span></Link>; })}</div></nav>;
}
