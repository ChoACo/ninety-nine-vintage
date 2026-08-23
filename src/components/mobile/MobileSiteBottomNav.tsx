"use client";

import { Gavel, Home, Package, ShoppingBag, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSimpleMode } from "@/components/features/accessibility/SimpleModeProvider";
import { useCommerceStore } from "@/store/useCommerceStore";

export function MobileSiteBottomNav() {
  const pathname = usePathname();
  const simpleMode = useSimpleMode();
  const vaultCount = useCommerceStore((state) => state.cartIds.length);
  const standardTabs: ReadonlyArray<readonly [string, string, LucideIcon]> = [
    ["홈", "/m/home", Home],
    ["라이브 옥션", "/m/live", Gavel],
    ["아카이브 숍", "/m/shop", ShoppingBag],
    ["보관함", "/m/account/storage", Package],
    ["MY", "/m/my", UserRound],
  ] as const;
  const tabs: ReadonlyArray<readonly [string, string, LucideIcon]> = simpleMode.enabled
    ? ([
        ["홈", "/m/home", Home],
        ["입찰", "/m/live", Gavel],
        ["구매", "/m/shop", ShoppingBag],
        ["보관함", "/m/account/storage", Package],
        ["MY", "/m/my", UserRound],
      ] as const)
    : standardTabs;
  return (
    <nav aria-label="모바일 주요 메뉴" className="fixed inset-x-0 bottom-4 z-50 mx-auto w-[calc(100%-3rem)] max-w-lg overflow-hidden rounded-full border border-line/40 bg-paper/85 px-4 py-2.5 shadow-2xl backdrop-blur-xl pb-[max(env(safe-area-inset-bottom,0px),0.625rem)] lg:hidden">
      <div className="grid min-h-14" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map(([label, href, Icon]) => {
          const active = pathname === href || (href !== "/m/home" && pathname.startsWith(`${href}/`));
          const live = href === "/m/live"; const count = href === "/m/account/storage" ? vaultCount : 0;
          return <Link aria-current={active ? "page" : undefined} className={`relative flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1 overflow-hidden px-1 py-1 text-[9px] font-bold ${active ? "text-ink" : "text-muted"}`} href={href} key={href} prefetch={false}><span className={`relative grid size-8 shrink-0 place-items-center rounded-full border transition-colors hover:border-ink/60 ${active ? "bg-ink text-paper" : "border-transparent"}`}><Icon size={19} strokeWidth={active ? 2.5 : 1.8} />{live && <span className="absolute right-0 top-0 size-2 animate-pulse rounded-full bg-rose-500" />}{count > 0 && <span className="absolute -right-2 -top-1 grid size-4 place-items-center rounded-full bg-amber-500 font-mono text-[8px] text-zinc-950">{Math.min(count, 9)}</span>}</span><span className="max-w-full truncate">{label}</span></Link>;
        })}
      </div>
    </nav>
  );
}
