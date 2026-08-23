"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

export type StoreMallTab = "main" | "new" | "auction" | "buy" | "about";

const TABS: { key: StoreMallTab; label: string; path: string }[] = [
  { key: "main", label: "📌 센터 홈", path: "" },
  { key: "auction", label: "🔨 실시간 경매", path: "/auction" },
  { key: "buy", label: "🛍️ 즉시 구매", path: "/buy" },
  { key: "new", label: "📦 보관·배송 정책", path: "/new" },
  { key: "about", label: "⭐ 구매 후기", path: "/about" },
];

export function StoreMallTabs({ active, basePath = "", chatHref, routeSegment = "stores", slug, storeName, surface = "desktop" }: { active: StoreMallTab; basePath?: "" | "/m"; chatHref: string; routeSegment?: "stores" | "centers"; slug: string; storeName?: string; surface?: "desktop" | "mobile" }) {
  const isDesktop = surface === "desktop";
  const router = useRouter();
  const searchParams = useSearchParams();
  const fallbackHref = `${basePath}/${routeSegment}`;
  const goBack = () => {
    const referrer = document.referrer;
    if (window.history.length > 1 && referrer) {
      try {
        const previousUrl = new URL(referrer);
        if (
          previousUrl.origin === window.location.origin &&
          previousUrl.href !== window.location.href
        ) {
          router.back();
          return;
        }
      } catch {
        // An invalid or external referrer must never navigate shoppers away.
      }
    }
    router.push(fallbackHref);
  };
  const backButton = <button aria-label="이전 페이지" className="grid min-h-[44px] min-w-[44px] shrink-0 place-items-center rounded-full border border-line bg-paper shadow-sm transition-colors hover:border-ink active:scale-95" onClick={goBack} title="이전 페이지" type="button"><ChevronLeft aria-hidden="true" size={19} /></button>;
  const tabLinks = TABS.map((tab) => {
      const href = routeSegment === "centers" ? `${basePath}/centers/${encodeURIComponent(slug)}${tab.key === "main" ? "" : `?tab=${tab.key}`}` : `${basePath}/stores/${encodeURIComponent(slug)}${tab.path}`;
      const isActive = routeSegment === "centers" ? (searchParams.get("tab") ?? "main") === tab.key : active === tab.key;
      return <Link aria-current={isActive ? "page" : undefined} className={isActive ? "border-b-2 border-ink pb-0.5" : "text-muted hover:text-ink"} href={href} key={tab.key} prefetch={false}>{tab.label}</Link>;
    });
  if (!isDesktop) {
    return <nav aria-label="센터몰 메뉴" className="sticky top-[var(--mobile-sticky-header-offset,3.5rem)] z-30 -mx-4 border-b border-line bg-paper/95 px-4 py-2 text-xs font-bold backdrop-blur">
      <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">{backButton}<span className="min-w-0 truncate px-2 text-center text-sm font-black">{storeName ?? "센터몰"}</span><span aria-hidden="true" /></div>
      <div className="mt-2 flex items-center gap-5 overflow-x-auto pb-2 [scrollbar-width:none]">{tabLinks}<Link className="ml-auto shrink-0 rounded-full bg-ink px-4 py-2 text-paper" href={chatHref}>문의하기</Link></div>
    </nav>;
  }
  return <nav aria-label="센터몰 메뉴" className="sticky top-0 z-30 -mx-8 flex items-center gap-5 overflow-x-auto border-b border-line bg-paper/95 px-8 py-4 text-xs font-bold backdrop-blur [scrollbar-width:none]">
    {backButton}{tabLinks}<Link className="ml-auto shrink-0 rounded-full bg-ink px-4 py-2 text-paper" href={chatHref}>문의하기</Link>
  </nav>;
}
