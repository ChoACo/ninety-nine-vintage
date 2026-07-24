"use client";

import { Headphones, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { CommerceToolbar } from "@/components/features/commerce/CommerceToolbar";
import { ChatNotificationLink } from "@/components/features/chat/ChatNotificationProvider";
import { AuthStatus } from "@/components/layout/AuthStatus";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";
import { useActiveBidNavigation } from "@/components/features/auction/ActiveBidNavigationProvider";

export function PcHeader({ hasLiveTicker = false }: { hasLiveTicker?: boolean }) {
  const [query, setQuery] = useState("");
  const pathname = usePathname();
  const router = useRouter();
  const authenticating = pathname === "/auth/callback";
  const { hasActiveBid } = useActiveBidNavigation();
  const navigation = [
    { label: "홈", href: "/home" },
    ...(LIVE_AUCTION_ENABLED && hasActiveBid ? [{ label: "입찰 중인 상품", href: "/bidding" }] : []),
    ...(LIVE_AUCTION_ENABLED ? [{ label: "실시간 경매", href: "/feed" }] : []),
    { label: "즉시 구매", href: "/shop" },
  ];
  return (
    <header className={`sticky ${hasLiveTicker ? "top-9" : "top-0"} z-[60] block border-b border-line bg-paper/95 text-ink backdrop-blur-md`}>
      <div className="mx-auto flex h-20 w-[1200px] items-center gap-5">
        <Link className="w-[210px] shrink-0 whitespace-nowrap text-lg font-black tracking-[-0.06em]" href="/home">NINETY-NINE VINTAGE</Link>
        <nav className="flex min-w-0 flex-1 items-center justify-center gap-5 whitespace-nowrap" aria-label="주요 메뉴">
          {navigation.map((item) => <Link className="border-b-2 border-transparent py-2 text-sm font-bold tracking-[0.02em] transition-colors hover:border-ink" href={item.href} key={item.href}>{item.label}</Link>)}
        </nav>
        <div className="ml-auto flex shrink-0 items-center justify-end gap-2">
          <ThemeToggle className="size-10 px-0" />
          <ChatNotificationLink ariaLabel="상담" className="grid size-10 shrink-0 place-items-center border border-line" fallbackHref="/chat"><Headphones size={17} /></ChatNotificationLink>
          {authenticating ? <span aria-label="로그인 상태 확인 중" className="inline-flex h-10 w-[193px] shrink-0 border border-line bg-surface" role="status" /> : <><span className="inline-flex"><AuthStatus /></span><CommerceToolbar /></>}
          <form className="flex h-10 w-40 shrink-0 items-center gap-2 border border-line bg-surface px-3 text-muted" onSubmit={(event) => { event.preventDefault(); const value = query.trim(); router.push(value ? `/shop?q=${encodeURIComponent(value)}` : "/shop"); }}><Search size={16} /><input aria-label="상품 검색" className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-muted" onChange={(event) => setQuery(event.target.value)} placeholder="검색 후 Enter" value={query} /></form>
        </div>
      </div>
    </header>
  );
}
