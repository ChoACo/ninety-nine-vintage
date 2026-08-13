"use client";

import { BriefcaseBusiness, Gavel, Heart, Home, Store, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSimpleMode } from "@/components/features/accessibility/SimpleModeProvider";
import { useAdminNavigationAccess } from "@/hooks/useAdminNavigationAccess";
import { getMobileRoleNavigation } from "@/lib/admin/mobileNavigation";

export function MobileSiteBottomNav() {
  const pathname = usePathname();
  const simpleMode = useSimpleMode();
  const access = useAdminNavigationAccess();
  const roleNavigation = getMobileRoleNavigation(access.roleCode);
  const standardTabs: ReadonlyArray<readonly [string, string, LucideIcon]> = [
    ["홈", "/m/home", Home],
    ["경매", "/m/feed", Gavel],
    ["구매", "/m/shop", Store],
    roleNavigation.isStaff
      ? ["업무", roleNavigation.centerHref, BriefcaseBusiness]
      : ["관심", "/m/saved", Heart],
    ["MY", "/m/account", UserRound],
  ] as const;
  const tabs: ReadonlyArray<readonly [string, string, LucideIcon]> = simpleMode.enabled
    ? ([
        ["홈", "/m/home", Home],
        ["입찰", "/m/feed", Gavel],
        ["구매", "/m/shop", Store],
        ["찜", "/m/saved", Heart],
        ["MY", "/m/account", UserRound],
      ] as const)
    : standardTabs;
  return (
    <nav aria-label="모바일 주요 메뉴" className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
      <div className="grid h-16" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map(([label, href, Icon]) => {
          const active = pathname === href || (href !== "/m/home" && pathname.startsWith(`${href}/`));
          return <Link aria-current={active ? "page" : undefined} className={`relative flex min-h-[68px] min-w-0 flex-col items-center justify-center gap-1 px-1 text-[10px] font-bold ${active ? "text-ink" : "text-muted"}`} href={href} key={href} prefetch={false}><span className={`relative grid size-8 place-items-center rounded-full transition-colors ${active ? "bg-ink text-paper" : ""}`}><Icon size={19} strokeWidth={active ? 2.5 : 1.8} /></span><span className="truncate">{label}</span></Link>;
        })}
      </div>
    </nav>
  );
}
