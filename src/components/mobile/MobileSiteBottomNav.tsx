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
    ["아카이브숍", "/m/shop", ShoppingBag],
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
    <nav
      aria-label="모바일 주요 메뉴"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line/70 bg-paper/95 px-[max(.5rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgb(0_0_0/.08)] backdrop-blur-xl lg:hidden"
    >
      <div
        className="mx-auto grid min-h-14 w-full max-w-lg"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map(([label, href, Icon]) => {
          const active = pathname === href || (href !== "/m/home" && pathname.startsWith(`${href}/`));
          const live = href === "/m/live"; const count = href === "/m/account/storage" ? vaultCount : 0;
          return <Link aria-current={active ? "page" : undefined} className={`relative flex min-h-[52px] min-w-[44px] flex-col items-center justify-center gap-1 overflow-hidden rounded-xl px-0.5 py-1 text-[10px] font-bold transition-colors active:scale-[.98] ${active ? "text-ink" : "text-muted"}`} href={href} key={href} prefetch><span className={`relative grid size-8 shrink-0 place-items-center rounded-full transition-colors ${active ? "bg-ink text-paper shadow-sm" : "bg-transparent"}`}><Icon size={19} strokeWidth={active ? 2.5 : 1.8} />{live && <span className="absolute right-0 top-0 size-2 animate-pulse rounded-full bg-rose-500" />}{count > 0 && <span className="absolute -right-2 -top-1 grid size-4 place-items-center rounded-full bg-amber-500 font-mono text-[8px] text-zinc-950">{Math.min(count, 9)}</span>}</span><span className="max-w-full truncate leading-none">{label}</span>{active ? <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-ink" /> : null}</Link>;
        })}
      </div>
    </nav>
  );
}
