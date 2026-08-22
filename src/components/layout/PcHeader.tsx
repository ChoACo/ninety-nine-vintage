"use client";

import { Clock, Gavel, Headphones, Home, Package, Search, Store } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CommerceToolbar } from "@/components/features/commerce/CommerceToolbar";
import { ChatNotificationLink } from "@/components/features/chat/ChatNotificationProvider";
import { NotificationCenterButton } from "@/components/features/notifications/NotificationCenterButton";
import { AuthStatus } from "@/components/layout/AuthStatus";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";
import { useActiveBidNavigation } from "@/components/features/auction/ActiveBidNavigationProvider";
import { useSimpleMode } from "@/components/features/accessibility/SimpleModeProvider";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

export function PcHeader({ hasLiveTicker = false }: { hasLiveTicker?: boolean }) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const { session } = useSupabaseSession();
  const authenticating = pathname === "/auth/callback";
  const { hasActiveBid } = useActiveBidNavigation();
  const simpleMode = useSimpleMode();
  const standardNavigation: ReadonlyArray<{ label: string; href: string; icon: LucideIcon }> = [
    { label: "홈", href: "/home", icon: Home },
    { label: "센터몰", href: "/centers", icon: Store },
    ...(LIVE_AUCTION_ENABLED && hasActiveBid ? [{ label: "입찰 중인 상품", href: "/bidding", icon: Clock }] : []),
    ...(LIVE_AUCTION_ENABLED ? [{ label: "라이브 옥션", href: "/live", icon: Gavel }] : []),
    { label: "아카이브 숍", href: "/shop", icon: Store },
    { label: "보관함 안내", href: "/account/storage", icon: Package },
  ];
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchRef.current?.focus(); } }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, []);
  const navigation = simpleMode.enabled
    ? [
        { label: "홈", href: "/home" },
        { label: "입찰", href: "/live" },
        { label: "구매", href: "/shop" },
        { label: "결제·배송", href: "/account#auction-payments" },
        { label: "내 정보", href: "/account" },
      ]
    : standardNavigation;
  return (
    <header className={`sticky ${hasLiveTicker ? "top-9" : "top-0"} z-[60] block border-b border-line bg-paper/95 text-ink backdrop-blur-md`}>
      <div className="mx-auto flex h-20 w-full max-w-[1440px] items-center gap-5 px-5 sm:px-8 xl:px-10">
        <Link className="shrink-0 whitespace-nowrap text-lg font-black tracking-[-0.06em]" href="/home" prefetch={false}>NINETY-NINE <span className="hidden lg:inline">VINTAGE</span></Link>
        <ThemeToggle className="ml-1 shrink-0 size-10 px-0 xl:ml-4" />
        {simpleMode.enabled && <nav className="flex min-w-0 flex-1 items-center justify-center gap-5 whitespace-nowrap" aria-label="주요 메뉴">
          {navigation.map((item) => <Link className="border-b-2 border-transparent py-2 text-sm font-bold tracking-[0.02em] transition-colors hover:border-ink" href={item.href} key={item.href}>{item.label}</Link>)}
        </nav>}
        <div className="ml-auto flex shrink-0 items-center justify-end gap-2">
          {!simpleMode.enabled && <nav aria-label="주요 메뉴" className="mr-1 flex shrink-0 items-center gap-1 xl:mr-4 xl:gap-1.5">
            {standardNavigation.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || (item.href === "/live" && pathname === "/feed");
              return <Link aria-current={active ? "page" : undefined} aria-label={item.label} className={`relative inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap border px-2 text-[11px] font-bold transition-colors min-[1180px]:px-3 ${active ? "border-ink bg-surface text-ink" : "border-line text-muted hover:border-ink hover:text-ink"}`} href={item.href} key={item.href}>{<Icon size={15} strokeWidth={1.75} />}<span className="hidden min-[1180px]:inline">{item.label}</span>{item.href === "/live" && <span className="absolute -right-1 -top-2 rounded-full bg-rose-600 px-1.5 py-0.5 text-[7px] font-black text-white before:absolute before:inset-0 before:-z-10 before:animate-ping before:rounded-full before:bg-rose-500/50">LIVE</span>}</Link>;
            })}
          </nav>}
          {!simpleMode.enabled && <>
          {authenticating ? <span aria-label="로그인 상태 확인 중" className="inline-flex h-10 w-[193px] shrink-0 border border-line bg-surface" role="status" /> : session ? <CommerceToolbar before={<AuthStatus className="mr-2" showMyLink={false} />} showSettings={false} after={<><span className="inline-flex"><AuthStatus showWorkLink={false} /></span><ChatNotificationLink ariaLabel="상담" className="grid size-10 shrink-0 place-items-center border border-line text-muted transition-colors hover:border-ink hover:text-ink" fallbackHref="/chat"><Headphones size={17} /></ChatNotificationLink><NotificationCenterButton /></>} /> : <span className="inline-flex"><AuthStatus /></span>}
          <form className="flex h-10 w-40 shrink-0 items-center gap-2 border border-line bg-surface px-3 text-muted max-xl:hidden focus-within:border-amber-500" onSubmit={(event) => { event.preventDefault(); const value = query.trim(); router.push(value ? `/shop?q=${encodeURIComponent(value)}` : "/shop"); }}><Search size={16} strokeWidth={1.75} /><input ref={searchRef} aria-label="상품 검색, Command K" className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-muted" onChange={(event) => setQuery(event.target.value)} placeholder="검색  Cmd+K" value={query} /></form>
          </>}
          {simpleMode.enabled && (authenticating
            ? <span aria-label="로그인 상태 확인 중" className="inline-flex h-10 w-32 shrink-0 border border-line bg-surface" role="status" />
            : <AuthStatus />)}
        </div>
      </div>
    </header>
  );
}
