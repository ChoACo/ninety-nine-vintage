"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

const sortLinks = [
  ["closing", "마감 임박순"],
  ["latest", "최신 등록순"],
  ["price-desc", "현재가 높은순"],
  ["price-asc", "현재가 낮은순"],
] as const;
const sizes = ["S", "M", "L", "XL"] as const;

const noSearchSubscription = () => () => undefined;
const readSearch = () => (typeof window === "undefined" ? "" : window.location.search);

export function EditorialCatalogSidebar() {
  const pathname = usePathname();
  const search = new URLSearchParams(
    useSyncExternalStore(noSearchSubscription, readSearch, () => ""),
  );
  const params = {
    sort: search.get("sort") ?? "latest",
    size: search.get("size") ?? "all",
  };

  return (
    <aside className="editorial-catalog-sidebar sticky top-[7.25rem] w-[188px] flex-shrink-0 self-start border-t-2 border-[var(--text-strong)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] py-4">
        <h2 className="text-[10px] font-black tracking-[0.18em] text-[var(--text-strong)]">FILTER &amp; SORT</h2>
        <Link href="/feed" className="text-[10px] font-bold text-[var(--text-muted)] transition-colors hover:text-[var(--text-strong)]">초기화</Link>
      </div>
      <section className="border-b border-[var(--border)] py-5">
        <h3 className="mb-3 text-xs font-black text-[var(--text-strong)]">정렬</h3>
        <div className="grid gap-2">
          {sortLinks.map(([value, label]) => { const active = pathname === "/" ? value === "latest" : params.sort === value; return <Link key={value} href={value === "latest" ? "/feed" : `/feed?sort=${value}`} aria-current={active ? "page" : undefined} className={`border-l-2 px-3 py-1.5 text-xs font-bold transition-colors ${active ? "border-[var(--text-strong)] text-[var(--text-strong)]" : "border-transparent text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"}`}>{label}</Link>; })}
        </div>
      </section>
      <section className="border-b border-[var(--border)] py-5">
        <h3 className="mb-3 text-xs font-black text-[var(--text-strong)]">사이즈</h3>
        <div className="grid grid-cols-4 gap-1.5">
          {sizes.map((size) => <Link key={size} href={`/feed?size=${size}`} aria-current={params.size === size ? "page" : undefined} className={`grid min-h-8 place-items-center border font-mono text-[11px] font-bold tabular-nums transition-colors ${params.size === size ? "border-[var(--text-strong)] bg-[var(--text-strong)] text-[var(--surface)]" : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-strong)] hover:text-[var(--text-strong)]"}`}>{size}</Link>)}
        </div>
      </section>
      <section className="py-5">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">Auction policy</p>
        <p className="mt-2 break-keep text-xs font-semibold leading-5 text-[var(--text-muted)]">매일 오전 10시 공개 · 20:56 신규 참여 제한 · 21:00 정산 · 22:00 재입찰</p>
      </section>
    </aside>
  );
}
