"use client";

import { Headphones, Menu, MessageCircle, Search, ShoppingBag, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthStatus } from "@/components/layout/AuthStatus";
import { ChatNotificationLink } from "@/components/features/chat/ChatNotificationProvider";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
import { useActiveBidNavigation } from "@/components/features/auction/ActiveBidNavigationProvider";
import { useAdminNavigationAccess } from "@/hooks/useAdminNavigationAccess";
import { getMobileRoleNavigation } from "@/lib/admin/mobileNavigation";
import { useSimpleMode } from "@/components/features/accessibility/SimpleModeProvider";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

const MEMBER_ONLY_MOBILE_HREFS = new Set([
  "/m/wishlist",
  "/m/chat",
  "/m/cart",
  "/m/account",
  "/m/account/payments",
  "/m/account/shipping",
]);

export function MobileSiteHeader({ hasLiveTicker = false }: { hasLiveTicker?: boolean }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { hasActiveBid } = useActiveBidNavigation();
  const { session } = useSupabaseSession();
  const access = useAdminNavigationAccess();
  const simpleMode = useSimpleMode();
  const roleNavigation = getMobileRoleNavigation(access.roleCode);
  const consumerSimpleMode = simpleMode.enabled && !roleNavigation.isStaff;
  const standardLinks = [
    ["홈", "/m/home"],
    ["센터몰", "/m/centers"],
    ...(hasActiveBid ? [["입찰 중인 상품", "/m/bidding"] as const] : []),
    ["라이브 옥션 · LIVE", "/m/live"],
    ["아카이브 숍", "/m/shop"],
    ["찜", "/m/wishlist"],
    ["상담·채팅", "/m/chat"],
    ["장바구니", "/m/cart"],
    ["MY", "/m/my"],
    ...(roleNavigation.isStaff
      ? [["업무", roleNavigation.centerHref] as const]
      : []),
    ["설정", "/m/settings"],
  ] as const;
  const links = consumerSimpleMode
    ? ([
        ["홈", "/m/home"],
        ["입찰", "/m/live"],
        ["구매", "/m/shop"],
        ["결제", "/m/account/payments"],
        ["배송 신청·현황", "/m/account/shipping"],
        ["내 정보", "/m/account"],
      ] as const)
    : standardLinks;
  const visibleLinks = session
    ? links
    : links.filter(([, href]) => !MEMBER_ONLY_MOBILE_HREFS.has(href) && !href.startsWith("/admin/"));

  const submitSearch = () => {
    const value = query.trim();
    setSearchOpen(false);
    router.push(value ? `/m/shop?q=${encodeURIComponent(value)}` : "/m/shop");
  };

  return (
    <>
      <header className={`sticky ${hasLiveTicker ? "top-10" : "top-0"} z-[60] border-b border-line bg-paper/95 backdrop-blur-md`}>
        <div className="flex h-14 items-center gap-1 px-2">
          <button aria-expanded={menuOpen} aria-label="전체 메뉴 열기" className="grid size-11 shrink-0 place-items-center rounded-full active:bg-surface" onClick={() => setMenuOpen(true)} type="button"><Menu size={21} /></button>
          <Link className="min-w-0 flex-1 truncate px-1 text-sm font-black tracking-[-0.05em]" href="/m/home" prefetch={false}>NINETY-NINE</Link>
<div className="flex items-center">
            {!consumerSimpleMode && <button aria-expanded={searchOpen} aria-label="상품 검색 열기" className="grid size-11 place-items-center rounded-full active:bg-surface" onClick={() => setSearchOpen((value) => !value)} type="button"><Search size={20} /></button>}
            <ThemeToggle className="size-11 rounded-full px-0" />
            {!session ? (
              <Link aria-label="카카오 로그인" className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-[#FEE500] px-4 text-xs font-bold text-[#191919] shadow-sm focus-visible:ring-2 focus-visible:ring-[#191919] focus-visible:ring-offset-2 active:scale-[.98]" href="/m/account/login" onClick={(event) => {
                event.preventDefault();
                const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
                window.location.assign(`/m/account/login?next=${encodeURIComponent(next)}`);
              }} prefetch={false}><MessageCircle fill="currentColor" size={14} strokeWidth={1.75} /> 로그인</Link>
            ) : (
              <>
                {!consumerSimpleMode && <Link aria-label="장바구니" className="grid size-11 place-items-center rounded-full active:bg-surface" href="/m/cart" prefetch={false}><ShoppingBag size={20} /></Link>}
              </>
            )}
          </div>
        </div>
        {searchOpen && (
          <form className="flex gap-2 border-t border-line px-3 py-3" onSubmit={(event) => { event.preventDefault(); submitSearch(); }}>
            <input autoFocus aria-label="상품 검색어" className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 text-sm outline-none focus:border-ink" onChange={(event) => setQuery(event.target.value)} placeholder="상품명·브랜드 검색" value={query} />
            <button className="h-12 rounded-xl bg-ink px-5 text-xs font-bold text-paper" type="submit">검색</button>
          </form>
        )}
      </header>
      <PremiumDialog ariaLabel="모바일 전체 메뉴" onClose={() => setMenuOpen(false)} open={menuOpen} panelClassName="px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))]" placement="drawer-left" zIndexClassName="z-[100]">
        <div className="flex items-center justify-between border-b border-line pb-5"><span className="text-xs font-black tracking-[0.08em]">NINETY-NINE VINTAGE</span><button aria-label="전체 메뉴 닫기" className="grid size-11 place-items-center" onClick={() => setMenuOpen(false)} type="button"><X size={20} /></button></div>
{session && <ChatNotificationLink allowedHrefPrefix="/m/chat" ariaLabel="상담·채팅" basePath="/m" className="mt-4 flex min-h-12 items-center gap-3 rounded-xl bg-surface px-4 text-sm font-black" fallbackHref="/m/chat"><Headphones size={19} /> 상담·채팅</ChatNotificationLink>}
        <nav aria-label="모바일 전체 메뉴" className="mt-4 grid">{visibleLinks.map(([label, href]) => <Link className="border-b border-line py-4 text-base font-bold" href={href} key={href} onClick={() => setMenuOpen(false)} prefetch={false}>{label}</Link>)}</nav>
        <div className="mt-6 grid gap-3">
          <AuthStatus basePath="/m" showWorkLink={false} />
        </div>
      </PremiumDialog>
    </>
  );
}
