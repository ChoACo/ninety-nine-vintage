"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export type StoreMallTab = "main" | "new" | "auction" | "buy" | "about";

const TABS: { key: StoreMallTab; label: string; path: string }[] = [
  { key: "main", label: "📌 센터 홈", path: "" },
  { key: "auction", label: "🔨 실시간 경매", path: "/auction" },
  { key: "buy", label: "🛍️ 즉시 구매", path: "/buy" },
  { key: "new", label: "📦 보관·배송 정책", path: "/new" },
  { key: "about", label: "⭐ 구매 후기", path: "/about" },
];

export function StoreMallTabs({ active, basePath = "", chatHref, routeSegment = "stores", slug, surface = "desktop" }: { active: StoreMallTab; basePath?: "" | "/m"; chatHref: string; routeSegment?: "stores" | "centers"; slug: string; surface?: "desktop" | "mobile" }) {
  const isDesktop = surface === "desktop";
  const searchParams = useSearchParams();
  return <nav aria-label="센터몰 메뉴" className={`sticky z-30 flex items-center gap-5 overflow-x-auto border-b border-line bg-paper/95 text-xs font-bold backdrop-blur [scrollbar-width:none] ${isDesktop ? "top-0 -mx-8 px-8 py-4" : "top-0 -mx-4 px-4 py-4"}`}>
    {TABS.map((tab) => {
      const href = routeSegment === "centers" ? `${basePath}/centers/${encodeURIComponent(slug)}${tab.key === "main" ? "" : `?tab=${tab.key}`}` : `${basePath}/stores/${encodeURIComponent(slug)}${tab.path}`;
      const isActive = routeSegment === "centers" ? (searchParams.get("tab") ?? "main") === tab.key : active === tab.key;
      return <Link aria-current={isActive ? "page" : undefined} className={isActive ? "border-b-2 border-ink pb-0.5" : "text-muted hover:text-ink"} href={href} key={tab.key} prefetch={false}>{tab.label}</Link>;
    })}
    <Link className="ml-auto shrink-0 rounded-full bg-ink px-4 py-2 text-paper" href={chatHref}>문의하기</Link>
  </nav>;
}
