"use client";

import { Headphones, Menu, Search, ShoppingBag, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthStatus } from "@/components/layout/AuthStatus";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
import { useAdminNavigationAccess } from "@/hooks/useAdminNavigationAccess";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";

const publicNavigation = [
  { label: "홈", href: "/home" },
  ...(LIVE_AUCTION_ENABLED ? [{ label: "입찰 중인 상품", href: "/bidding" }] : []),
  ...(LIVE_AUCTION_ENABLED ? [{ label: "실시간 경매", href: "/feed" }] : []),
  { label: "즉시 구매", href: "/shop" },
  { label: "내 정보", href: "/account" },
];

export function MobileHeader({ hasLiveTicker = false }: { hasLiveTicker?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pathname = usePathname();
  const router = useRouter();
  const access = useAdminNavigationAccess();

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeAtDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    closeAtDesktop();
    desktop.addEventListener("change", closeAtDesktop);
    return () => desktop.removeEventListener("change", closeAtDesktop);
  }, []);

  const close = () => setOpen(false);
  return (
    <>
      <header className={`sticky ${hasLiveTicker ? "top-9" : "top-0"} z-[60] border-b border-line bg-paper/95 backdrop-blur-md md:hidden`}>
        <div className="flex h-14 items-center justify-between px-4">
          <button aria-expanded={open} aria-haspopup="dialog" aria-label="전체 메뉴 열기" className="grid size-10 place-items-center rounded-xl transition-all duration-300 active:scale-95" onClick={() => setOpen(true)} type="button"><Menu size={20} /></button>
          <Link className="text-sm font-black tracking-[-0.05em]" href="/home">NINETY-NINE</Link>
          <Link aria-label="장바구니" className="grid size-10 place-items-center" href="/cart"><ShoppingBag size={19} /></Link>
        </div>
      </header>
      <PremiumDialog
        ariaLabel="모바일 전체 메뉴"
        onClose={close}
        open={open}
        overlayClassName="md:hidden"
        panelClassName="px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))]"
        placement="drawer-left"
        zIndexClassName="z-[100]"
      >
            <div className="flex items-center justify-between border-b border-line pb-5">
              <span className="text-xs font-black tracking-[0.08em]">NINETY-NINE VINTAGE</span>
              <button aria-label="전체 메뉴 닫기" className="grid size-10 place-items-center rounded-xl transition-all duration-300 active:scale-95" onClick={close} type="button"><X size={20} /></button>
            </div>
            <form className="mt-5 flex h-12 items-center gap-3 rounded-2xl border border-line bg-surface px-4 shadow-sm" onSubmit={(event) => { event.preventDefault(); const value = query.trim(); close(); router.push(value ? `/shop?q=${encodeURIComponent(value)}` : "/shop"); }}>
              <Search className="text-muted" size={17} />
              <input aria-label="상품 검색" className="min-w-0 flex-1 bg-transparent text-sm outline-none" onChange={(event) => setQuery(event.target.value)} placeholder="상품명 검색" value={query} />
            </form>
            <nav aria-label="모바일 주요 메뉴" className="mt-5 grid">
              {publicNavigation.map((item) => <Link aria-current={pathname === item.href ? "page" : undefined} className="border-b border-line py-4 text-base font-bold" href={item.href} key={item.href} onClick={close}>{item.label}</Link>)}
              {access.roleCode === "operator" && <Link className="border-b border-line py-4 text-base font-bold" href="/admin/operator/fulfillment" onClick={close}>출고·보관</Link>}
              {access.roleCode === "employee" && <Link className="border-b border-line py-4 text-base font-bold" href="/admin/employee" onClick={close}>직원센터</Link>}
              {access.canAccessOwner && <Link className="border-b border-line py-4 text-base font-bold" href="/admin/owner" onClick={close}>소유자 센터</Link>}
            </nav>
            <div className="mt-6 grid gap-3">
              <ThemeToggle className="w-full" showLabel />
              <AuthStatus />
              <Link className="flex h-11 items-center justify-center gap-2 border border-line text-xs font-bold" href="/chat" onClick={close}><Headphones size={16} /> 상담·채팅</Link>
            </div>
      </PremiumDialog>
    </>
  );
}
