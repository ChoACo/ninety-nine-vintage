"use client";

import { Headphones, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { CommerceToolbar } from "@/components/features/commerce/CommerceToolbar";
import { AuthStatus } from "@/components/layout/AuthStatus";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";
import { useAdminNavigationAccess } from "@/hooks/useAdminNavigationAccess";

const navigation = [
  { label: "홈", href: "/home" },
  ...(LIVE_AUCTION_ENABLED ? [{ label: "실시간 경매", href: "/feed" }] : []),
  { label: "즉시 구매", href: "/shop" },
  { label: "판매 완료", href: "/sold" },
];

export function PcHeader({ hasLiveTicker = false }: { hasLiveTicker?: boolean }) {
  const [query, setQuery] = useState("");
  const pathname = usePathname();
  const router = useRouter();
  const access = useAdminNavigationAccess();
  const authenticating = pathname === "/auth/callback";
  return (
    <header className={`sticky ${hasLiveTicker ? "top-9" : "top-0"} z-[60] hidden border-b border-line bg-paper/95 text-ink backdrop-blur-md md:block`}>
      <div className="mx-auto flex h-16 max-w-[1680px] items-center justify-between gap-3 px-6 lg:h-20 lg:px-10 xl:px-12">
        <Link className="min-w-0 w-[190px] shrink text-base font-black tracking-[-0.06em] lg:w-[230px] lg:text-lg" href="/home">NINETY-NINE VINTAGE</Link>
        <nav className="flex flex-1 items-center justify-center gap-3 lg:gap-6 xl:gap-10" aria-label="주요 메뉴">
          {navigation.map((item) => <Link className="border-b-2 border-transparent py-2 text-sm font-bold tracking-[0.02em] transition-colors hover:border-ink" href={item.href} key={item.href}>{item.label}</Link>)}
          {access.canAccessOperator && <Link className="border-b-2 border-transparent py-2 text-sm font-bold tracking-[0.02em] transition-colors hover:border-ink" href="/admin/operator">운영자 센터</Link>}
          {access.canAccessOwner && <Link className="border-b-2 border-transparent py-2 text-sm font-bold tracking-[0.02em] transition-colors hover:border-ink" href="/admin/owner">소유자 센터</Link>}
        </nav>
        <div className="ml-2 flex shrink-0 items-center justify-end gap-2">
          <ThemeToggle className="size-10 px-0" />
          <Link aria-label="상담" className="hidden size-10 shrink-0 place-items-center border border-line lg:grid" href="/chat"><Headphones size={17} /></Link>
          {authenticating ? <span aria-label="로그인 상태 확인 중" className="inline-flex h-10 w-[193px] shrink-0 border border-line bg-surface" role="status" /> : <><span className="inline-flex"><AuthStatus /></span><CommerceToolbar /></>}
          <form className="hidden h-10 items-center gap-2 border border-line bg-surface px-3 text-muted xl:flex" onSubmit={(event) => { event.preventDefault(); const value = query.trim(); router.push(value ? `/shop?q=${encodeURIComponent(value)}` : "/shop"); }}><Search size={16} /><input aria-label="상품 검색" className="w-32 bg-transparent text-xs text-ink outline-none placeholder:text-muted" onChange={(event) => setQuery(event.target.value)} placeholder="검색 후 Enter" value={query} /></form>
        </div>
      </div>
    </header>
  );
}
