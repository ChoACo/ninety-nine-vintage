import Link from "next/link";

export type StoreMallTab = "main" | "new" | "auction" | "buy" | "about";

const TABS: { key: StoreMallTab; label: string; path: string }[] = [
  { key: "main", label: "메인", path: "" },
  { key: "new", label: "신상품", path: "/new" },
  { key: "auction", label: "경매", path: "/auction" },
  { key: "buy", label: "구매", path: "/buy" },
  { key: "about", label: "정보", path: "/about" },
];

export function StoreMallTabs({ active, basePath = "", chatHref, slug, surface = "desktop" }: { active: StoreMallTab; basePath?: "" | "/m"; chatHref: string; slug: string; surface?: "desktop" | "mobile" }) {
  const isDesktop = surface === "desktop";
  return <nav aria-label="센터몰 메뉴" className={`sticky z-30 flex items-center gap-5 overflow-x-auto border-b border-line bg-paper/95 text-xs font-bold backdrop-blur [scrollbar-width:none] ${isDesktop ? "top-0 -mx-8 px-8 py-4" : "top-0 -mx-4 px-4 py-4"}`}>
    {TABS.map((tab) => {
      const href = `${basePath}/stores/${encodeURIComponent(slug)}${tab.path}`;
      const isActive = active === tab.key;
      return <Link aria-current={isActive ? "page" : undefined} className={isActive ? "border-b-2 border-ink pb-0.5" : "text-muted hover:text-ink"} href={href} key={tab.key} prefetch={false}>{tab.label}</Link>;
    })}
    <Link className="ml-auto shrink-0 rounded-full bg-ink px-4 py-2 text-paper" href={chatHref}>문의하기</Link>
  </nav>;
}