"use client";

import { Gavel, Home, ShoppingBag, Store, TrendingUp, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCommerceStore } from "@/store/useCommerceStore";
import { useActiveBidNavigation } from "@/components/features/auction/ActiveBidNavigationProvider";

export function MobileSiteBottomNav() {
  const pathname = usePathname();
  const cartCount = useCommerceStore((state) => state.cartIds.length);
  const { hasActiveBid } = useActiveBidNavigation();
  const tabs = [
    ["홈", "/m/home", Home],
    ...(hasActiveBid ? [["입찰 중", "/m/bidding", TrendingUp] as const] : []),
    ["경매", "/m/feed", Gavel],
    ["구매", "/m/shop", Store],
    ["장바구니", "/m/cart", ShoppingBag],
    ["내 정보", "/m/account", UserRound],
  ] as const;
  return (
    <nav aria-label="모바일 주요 메뉴" className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
      <div className="grid h-16" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map(([label, href, Icon]) => {
          const active = pathname === href || (href !== "/m/home" && pathname.startsWith(`${href}/`));
          return <Link aria-current={active ? "page" : undefined} className={`relative flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-[9px] font-bold ${active ? "text-ink" : "text-muted"}`} href={href} key={href}><span className="relative grid size-7 place-items-center"><Icon size={18} strokeWidth={active ? 2.5 : 1.7} />{href === "/m/cart" && cartCount > 0 && <span className="absolute -right-2 -top-1 grid size-4 place-items-center rounded-full bg-ink text-[8px] text-paper">{Math.min(cartCount, 9)}</span>}</span><span className="truncate">{label}</span></Link>;
        })}
      </div>
    </nav>
  );
}
