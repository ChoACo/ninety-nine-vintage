"use client";

import { Headphones, Menu, Search, ShoppingBag, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthStatus } from "@/components/layout/AuthStatus";
import { useAdminNavigationAccess } from "@/hooks/useAdminNavigationAccess";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";

const publicNavigation = [
  { label: "홈", href: "/home" },
  ...(LIVE_AUCTION_ENABLED ? [{ label: "실시간 경매", href: "/feed" }] : []),
  { label: "즉시 구매", href: "/shop" },
  { label: "판매 완료 아카이브", href: "/sold" },
  { label: "내 정보", href: "/account" },
];

export function MobileHeader({ hasLiveTicker = false }: { hasLiveTicker?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pathname = usePathname();
  const router = useRouter();
  const access = useAdminNavigationAccess();

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <>
      <header className={`sticky ${hasLiveTicker ? "top-9" : "top-0"} z-[60] border-b border-line bg-paper/95 backdrop-blur-md md:hidden`}>
        <div className="flex h-14 items-center justify-between px-4">
          <button aria-label="전체 메뉴 열기" className="grid size-10 place-items-center" onClick={() => setOpen(true)} type="button"><Menu size={20} /></button>
          <Link className="text-sm font-black tracking-[-0.05em]" href="/home">NINETY-NINE</Link>
          <Link aria-label="장바구니" className="grid size-10 place-items-center" href="/cart"><ShoppingBag size={19} /></Link>
        </div>
      </header>
      {open && (
        <div aria-label="모바일 전체 메뉴" aria-modal="true" className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md md:hidden" onClick={close} role="dialog">
          <aside className="h-full w-[min(88vw,380px)] overflow-y-auto bg-paper px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-5 text-ink shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line pb-5">
              <span className="text-xs font-black tracking-[0.08em]">NINETY-NINE VINTAGE</span>
              <button aria-label="전체 메뉴 닫기" className="grid size-10 place-items-center" onClick={close} type="button"><X size={20} /></button>
            </div>
            <form className="mt-5 flex h-12 items-center gap-3 border border-line bg-surface px-4" onSubmit={(event) => { event.preventDefault(); const value = query.trim(); close(); router.push(value ? `/shop?q=${encodeURIComponent(value)}` : "/shop"); }}>
              <Search className="text-muted" size={17} />
              <input aria-label="상품 검색" className="min-w-0 flex-1 bg-transparent text-sm outline-none" onChange={(event) => setQuery(event.target.value)} placeholder="상품명 검색" value={query} />
            </form>
            <nav aria-label="모바일 주요 메뉴" className="mt-5 grid">
              {publicNavigation.map((item) => <Link aria-current={pathname === item.href ? "page" : undefined} className="border-b border-line py-4 text-base font-bold" href={item.href} key={item.href} onClick={close}>{item.label}</Link>)}
              {access.canAccessOperator && <Link className="border-b border-line py-4 text-base font-bold" href="/admin/operator" onClick={close}>운영자 센터</Link>}
              {access.canAccessOwner && <Link className="border-b border-line py-4 text-base font-bold" href="/admin/owner" onClick={close}>소유자 센터</Link>}
            </nav>
            <div className="mt-6 grid gap-3">
              <AuthStatus />
              <Link className="flex h-11 items-center justify-center gap-2 border border-line text-xs font-bold" href="/chat" onClick={close}><Headphones size={16} /> 상담·채팅</Link>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
