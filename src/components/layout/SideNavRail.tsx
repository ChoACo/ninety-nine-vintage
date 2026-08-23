"use client";

import { Gavel, Home, Package, ShoppingBag, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useSimpleMode } from "@/components/features/accessibility/SimpleModeProvider";
import { useCommerceStore } from "@/store/useCommerceStore";

const STANDARD_ITEMS: ReadonlyArray<readonly [string, string, LucideIcon]> = [
  ["홈", "/m/home", Home],
  ["라이브 옥션", "/m/live", Gavel],
  ["아카이브 숍", "/m/shop", ShoppingBag],
  ["보관함", "/m/account/storage", Package],
  ["MY", "/m/my", UserRound],
];

export function SideNavRail() {
  const pathname = usePathname();
  const simpleMode = useSimpleMode();
  const vaultCount = useCommerceStore((state) => state.cartIds.length);
  const items = simpleMode.enabled
    ? STANDARD_ITEMS.map(([label, href, Icon]) => [
        href === "/m/live" ? "입찰" : href === "/m/shop" ? "구매" : label,
        href,
        Icon,
      ] as const)
    : STANDARD_ITEMS;

  return (
    <nav
      aria-label="태블릿 주요 메뉴"
      className="fixed inset-y-0 left-0 z-40 hidden w-20 flex-col items-center gap-8 border-r border-line/40 bg-card/75 py-6 backdrop-blur-xl lg:flex"
    >
      <Link
        aria-label="홈으로 이동"
        className="grid size-12 shrink-0 place-items-center rounded-2xl bg-ink text-sm font-black text-paper shadow-lg"
        href="/m/home"
      >
        99
      </Link>
      <div className="flex w-full flex-1 flex-col items-center justify-center gap-3">
        {items.map(([label, href, Icon]) => {
          const active =
            pathname === href ||
            (href !== "/m/home" && pathname.startsWith(`${href}/`));
          const count = href === "/m/account/storage" ? vaultCount : 0;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              aria-label={label}
              className={`group relative flex min-h-[52px] min-w-[52px] flex-col items-center justify-center gap-1 rounded-2xl transition-all duration-200 hover:-translate-y-0.5 hover:bg-surface focus-visible:ring-2 focus-visible:ring-ink ${active ? "bg-ink text-paper shadow-lg" : "text-muted hover:text-ink"}`}
              href={href}
              key={href}
              prefetch={false}
              title={label}
            >
              <span className="relative">
                <Icon size={20} strokeWidth={active ? 2.5 : 1.8} />
                {count > 0 && (
                  <span className="absolute -right-3 -top-2 grid size-4 place-items-center rounded-full bg-amber-500 font-mono text-[8px] font-black text-zinc-950">
                    {Math.min(count, 9)}
                  </span>
                )}
              </span>
              <span className="max-w-16 truncate text-[9px] font-bold">
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
