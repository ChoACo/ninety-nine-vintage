"use client";

import { Headphones, Menu, Search, ShoppingBag, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthStatus } from "@/components/layout/AuthStatus";
import { ChatNotificationLink } from "@/components/features/chat/ChatNotificationProvider";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
import { useActiveBidNavigation } from "@/components/features/auction/ActiveBidNavigationProvider";

export function MobileSiteHeader({ hasLiveTicker = false }: { hasLiveTicker?: boolean }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { hasActiveBid } = useActiveBidNavigation();
  const links = [
    ["홈", "/m/home"],
    ...(hasActiveBid ? [["입찰 중인 상품", "/m/bidding"] as const] : []),
    ["실시간 경매", "/m/feed"],
    ["즉시 구매", "/m/shop"],
    ["상담·채팅", "/m/chat"],
  ] as const;

  const submitSearch = () => {
    const value = query.trim();
    setSearchOpen(false);
    router.push(value ? `/m/shop?q=${encodeURIComponent(value)}` : "/m/shop");
  };

  return (
    <>
      <header className={`sticky ${hasLiveTicker ? "top-9" : "top-0"} z-[60] border-b border-line bg-paper/95 backdrop-blur-md`}>
        <div className="flex h-14 items-center justify-between px-3">
          <button aria-expanded={menuOpen} aria-label="전체 메뉴 열기" className="grid size-11 place-items-center" onClick={() => setMenuOpen(true)} type="button"><Menu size={21} /></button>
          <Link className="text-sm font-black tracking-[-0.05em]" href="/m/home">NINETY-NINE</Link>
          <div className="flex items-center">
            <ChatNotificationLink ariaLabel="상담·채팅" basePath="/m" className="grid size-11 place-items-center" fallbackHref="/m/chat"><Headphones size={19} /></ChatNotificationLink>
            <button aria-expanded={searchOpen} aria-label="상품 검색 열기" className="grid size-11 place-items-center" onClick={() => setSearchOpen((value) => !value)} type="button"><Search size={19} /></button>
            <Link aria-label="장바구니" className="grid size-11 place-items-center" href="/m/cart"><ShoppingBag size={19} /></Link>
          </div>
        </div>
        {searchOpen && (
          <form className="flex gap-2 border-t border-line px-3 py-3" onSubmit={(event) => { event.preventDefault(); submitSearch(); }}>
            <input autoFocus aria-label="상품 검색어" className="h-11 min-w-0 flex-1 border border-line bg-surface px-4 text-sm outline-none focus:border-ink" onChange={(event) => setQuery(event.target.value)} placeholder="상품명·브랜드 검색" value={query} />
            <button className="h-11 bg-ink px-5 text-xs font-bold text-paper" type="submit">검색</button>
          </form>
        )}
      </header>
      <PremiumDialog ariaLabel="모바일 전체 메뉴" onClose={() => setMenuOpen(false)} open={menuOpen} panelClassName="px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))]" placement="drawer-left" zIndexClassName="z-[100]">
        <div className="flex items-center justify-between border-b border-line pb-5"><span className="text-xs font-black tracking-[0.08em]">NINETY-NINE VINTAGE</span><button aria-label="전체 메뉴 닫기" className="grid size-11 place-items-center" onClick={() => setMenuOpen(false)} type="button"><X size={20} /></button></div>
        <nav aria-label="모바일 전체 메뉴" className="mt-4 grid">{links.map(([label, href]) => <Link className="border-b border-line py-4 text-base font-bold" href={href} key={href} onClick={() => setMenuOpen(false)}>{label}</Link>)}</nav>
        <div className="mt-6 grid gap-3"><ThemeToggle className="w-full" showLabel /><AuthStatus basePath="/m" /></div>
      </PremiumDialog>
    </>
  );
}
