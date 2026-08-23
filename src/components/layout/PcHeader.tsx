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

export function PcHeader() {
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
    { label: "보관함 안내", href: "/my/vault", icon: Package },
  ];
  const isActiveRoute = (href: string) =>
    pathname === href ||
    pathname.startsWith(`${href}/`) ||
    (href === "/live" && pathname === "/feed");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const editing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      const commandSearch =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      const slashSearch =
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !editing;
      if (!commandSearch && !slashSearch) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const navigation = simpleMode.enabled
    ? [
        { label: "홈", href: "/home" },
        { label: "입찰", href: "/live" },
        { label: "구매", href: "/shop" },
        { label: "결제·배송", href: "/my/orders" },
        { label: "내 정보", href: "/my" },
      ]
    : standardNavigation;
  return (
    <header className="relative z-0 block bg-paper/90 text-ink backdrop-blur-md">
      <div className="mx-auto flex h-20 w-full max-w-[1400px] items-center gap-2 px-4 lg:gap-4 lg:px-6 xl:px-10">
        <Link className="shrink-0 whitespace-nowrap text-base font-black tracking-[-0.06em] xl:text-lg" href="/home" prefetch={false}>NINETY-NINE <span className="hidden xl:inline">VINTAGE</span></Link>
        <ThemeToggle className="shrink-0 size-10 px-0 xl:ml-2" />
        {simpleMode.enabled && <nav className="flex min-w-0 flex-1 items-center justify-center gap-5 whitespace-nowrap" aria-label="주요 메뉴">
          {navigation.map((item) => { const active = isActiveRoute(item.href); return <Link aria-current={active ? "page" : undefined} className={`border-b-2 py-2 text-sm font-bold tracking-[0.02em] transition-colors ${active ? "border-amber-500 text-ink" : "border-transparent text-muted hover:border-ink hover:text-ink"}`} href={item.href} key={item.href}>{item.label}</Link>; })}
        </nav>}
        <div className="ml-auto flex shrink-0 items-center justify-end gap-2">
          {!simpleMode.enabled && <nav aria-label="주요 메뉴" className="flex shrink-0 items-center gap-0.5 xl:mr-2 xl:gap-1">
            {standardNavigation.map((item) => {
              const Icon = item.icon;
              const active = isActiveRoute(item.href);
              return <Link aria-current={active ? "page" : undefined} aria-label={item.label} className={`relative inline-flex h-10 shrink-0 items-center gap-1 whitespace-nowrap border px-1.5 text-[10px] font-bold transition-colors after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:transition-colors lg:px-2 xl:px-2.5 ${active ? "border-ink bg-surface text-ink after:bg-amber-500" : "border-line text-muted after:bg-transparent hover:border-ink hover:text-ink"}`} href={item.href} key={item.href}>{<Icon size={14} strokeWidth={1.75} />}<span className="hidden min-[1100px]:inline">{item.label}</span>{item.href === "/live" && <span className="absolute -right-1 -top-2 rounded-full bg-rose-600 px-1.5 py-0.5 text-[7px] font-black text-white before:absolute before:inset-0 before:-z-10 before:animate-ping before:rounded-full before:bg-rose-500/50 dark:text-zinc-950">LIVE</span>}</Link>;
            })}
          </nav>}
          {!simpleMode.enabled && <>
          {authenticating ? <span aria-label="로그인 상태 확인 중" className="inline-flex h-10 w-[193px] shrink-0 border border-line bg-surface" role="status" /> : session ? <CommerceToolbar before={<AuthStatus className="mr-2" showMyLink={false} />} showSettings={false} after={<><span className="inline-flex"><AuthStatus showWorkLink={false} /></span><ChatNotificationLink ariaLabel="상담" className="grid size-10 shrink-0 place-items-center border border-line text-muted transition-colors hover:border-ink hover:text-ink" fallbackHref="/chat"><Headphones size={17} /></ChatNotificationLink><NotificationCenterButton /></>} /> : <span className="inline-flex"><AuthStatus /></span>}
          <form className="hidden h-10 w-32 shrink-0 items-center gap-1.5 border border-line bg-surface px-2 text-muted focus-within:border-amber-500 min-[900px]:flex lg:w-36 xl:w-44 xl:px-3 2xl:w-52" onSubmit={(event) => { event.preventDefault(); const value = query.trim(); router.push(value ? `/shop?q=${encodeURIComponent(value)}` : "/shop"); }}><Search size={15} strokeWidth={1.75} /><input id="global-product-search" name="q" ref={searchRef} aria-keyshortcuts="/ Meta+K Control+K" aria-label="상품 검색, 슬래시 또는 Command K" className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-muted" onChange={(event) => setQuery(event.target.value)} placeholder="상품 검색" value={query} /><kbd aria-hidden="true" className="hidden rounded border border-line bg-paper px-1.5 py-0.5 font-mono text-[9px] font-bold text-muted xl:inline">[/]</kbd></form>
          </>}
          {simpleMode.enabled && (authenticating
            ? <span aria-label="로그인 상태 확인 중" className="inline-flex h-10 w-32 shrink-0 border border-line bg-surface" role="status" />
            : <AuthStatus />)}
        </div>
      </div>
    </header>
  );
}
