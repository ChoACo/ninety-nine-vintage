"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import {
  Banknote,
  Boxes,
  ChartNoAxesCombined,
  CircleHelp,
  Gavel,
  LayoutDashboard,
  PackagePlus,
  Settings,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { useAdminSidebarStore } from "@/store/useAdminSidebarStore";

const WORKSPACE_ICONS: Record<string, LucideIcon> = {
  auctions: Gavel,
  dashboard: LayoutDashboard,
  inquiries: CircleHelp,
  orders: ChartNoAxesCombined,
  products: Boxes,
  revenue: Banknote,
  register: PackagePlus,
  settings: Settings,
  shipping: Truck,
  vault: Boxes,
};

export interface AdminWorkspaceItem {
  exact?: boolean;
  href: string;
  label: string;
  description?: string;
  matchPrefixes?: readonly string[];
  group?: string;
  badge?: ReactNode;
  icon?: keyof typeof WORKSPACE_ICONS;
}

interface AdminWorkspaceShellProps {
  children: ReactNode;
  contentHeader?: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  navigation: readonly AdminWorkspaceItem[];
  utility?: ReactNode;
  contextBar?: ReactNode;
  operatorMode?: boolean;
  workspaceMode?: "default" | "operator" | "owner";
}

function isActive(pathname: string, item: AdminWorkspaceItem) {
  if (
    item.matchPrefixes?.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  )
    return true;
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AdminWorkspaceShell({
  children,
  contentHeader,
  contextBar,
  description,
  eyebrow,
  navigation,
  operatorMode = false,
  title,
  utility,
  workspaceMode = "default",
}: Readonly<AdminWorkspaceShellProps>) {
  const pathname = usePathname();
  const darkMode = operatorMode || workspaceMode !== "default";
  const sidebarMode = workspaceMode === "owner" ? "owner" : "operator";
  const sidebarStorageKey =
    workspaceMode === "owner"
      ? "ninety-nine:owner-sidebar"
      : "ninety-nine:operator-sidebar";
  const collapsed = useAdminSidebarStore(
    (state) => state.collapsed[sidebarMode],
  );
  const hydrateSidebar = useAdminSidebarStore((state) => state.hydrate);
  const toggleSidebar = useAdminSidebarStore((state) => state.toggle);

  useEffect(() => {
    if (!darkMode) return;
    hydrateSidebar(
      sidebarMode,
      window.localStorage.getItem(sidebarStorageKey) === "collapsed",
    );
  }, [darkMode, hydrateSidebar, sidebarMode, sidebarStorageKey]);

  useEffect(() => {
    if (!darkMode) return;
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        const next = !useAdminSidebarStore.getState().collapsed[sidebarMode];
        toggleSidebar(sidebarMode);
        window.localStorage.setItem(
          sidebarStorageKey,
          next ? "collapsed" : "expanded",
        );
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [darkMode, sidebarMode, sidebarStorageKey, toggleSidebar]);

  const handleToggleSidebar = () => {
    const next = !collapsed;
    toggleSidebar(sidebarMode);
    window.localStorage.setItem(
      sidebarStorageKey,
      next ? "collapsed" : "expanded",
    );
  };

  const groups = navigation.reduce<Record<string, AdminWorkspaceItem[]>>(
    (acc, item) => {
      const group = item.group ?? "메뉴";
      (acc[group] ??= []).push(item);
      return acc;
    },
    {},
  );

  return (
    <div
      className={`grid min-w-0 gap-6 transition-[grid-template-columns] duration-200 md:grid-cols-[64px_minmax(0,1fr)] lg:gap-8 ${darkMode ? (collapsed ? "lg:grid-cols-[64px_minmax(0,1fr)]" : "lg:grid-cols-[256px_minmax(0,1fr)]") : "lg:grid-cols-[248px_minmax(0,1fr)]"}`}
    >
      <aside className="h-fit min-w-0 md:sticky md:top-6 md:self-start">
        <div
          className={`${darkMode ? "rounded-2xl border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl shadow-zinc-950/20" : "border-line bg-surface"} border p-4 sm:p-5 md:p-3 ${collapsed ? "lg:p-3" : "lg:p-5"}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div
              className={`${collapsed ? "lg:hidden" : "lg:block"} md:hidden`}
            >
              <p
                className={`eyebrow ${darkMode ? "text-zinc-500" : "text-muted"}`}
              >
                {eyebrow}
              </p>
              <h1 className="mt-2 text-xl font-black tracking-[-.05em]">
                {title}
              </h1>
              <p
                className={`mt-2 text-xs leading-5 ${darkMode ? "text-zinc-400" : "text-muted"}`}
              >
                {description}
              </p>
            </div>
            {darkMode && (
              <button
                aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
                className="hidden size-11 shrink-0 place-items-center rounded-xl border border-zinc-700 text-zinc-300 transition hover:border-zinc-400 focus-visible:ring-2 focus-visible:ring-amber-500 md:grid"
                onClick={handleToggleSidebar}
                title="Cmd+B"
                type="button"
              >
                {collapsed ? "→" : "←"}
              </button>
            )}
          </div>
          {utility && (
            <div
              className={`mt-4 border-t pt-4 ${darkMode ? "border-zinc-800" : "border-line"} md:hidden ${collapsed ? "lg:hidden" : "lg:block"}`}
            >
              {utility}
            </div>
          )}
        </div>
        <nav
          aria-label={`${title} 주요 메뉴`}
          className={`${darkMode ? "rounded-2xl border border-zinc-800 bg-zinc-950 p-2" : ""} mt-3 flex max-w-full gap-2 overflow-x-auto pb-1 [scrollbar-width:none] md:grid md:gap-3 md:overflow-visible`}
        >
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <p
                className={`mb-1 px-3 pt-2 text-[10px] font-black tracking-[.14em] ${darkMode ? "text-zinc-500" : "text-muted"} md:hidden ${collapsed ? "lg:hidden" : "lg:block"}`}
              >
                {group}
              </p>
              <div className="grid gap-1">
                {items.map((item) => {
                  const active = isActive(pathname, item);
                  const Icon = item.icon
                    ? WORKSPACE_ICONS[item.icon]
                    : undefined;
                  return (
                    <Link
                      aria-current={active ? "page" : undefined}
                      aria-label={item.label}
                      className={`group block min-w-[145px] rounded-xl border px-3 py-3 transition-colors md:grid md:min-h-11 md:min-w-0 md:place-items-center md:px-0 md:py-0 ${collapsed ? "" : "lg:block lg:px-3 lg:py-3"} ${darkMode ? (active ? "border-amber-500/50 bg-zinc-800 text-zinc-50" : "border-transparent text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100") : active ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:border-ink"}`}
                      href={item.href}
                      key={item.href}
                      title={collapsed ? item.label : undefined}
                    >
                      <span
                        className={`flex items-center gap-2 md:justify-center ${collapsed ? "" : "lg:justify-start"}`}
                      >
                        {Icon && (
                          <Icon
                            className={
                              active && darkMode ? "text-amber-400" : undefined
                            }
                            size={16}
                            strokeWidth={1.75}
                          />
                        )}
                        <span
                          className={`truncate text-sm font-black md:hidden ${collapsed ? "lg:hidden" : "lg:block"}`}
                        >
                          {item.label}
                        </span>
                        <span
                          className={`md:hidden ${collapsed ? "lg:hidden" : "lg:inline"}`}
                        >
                          {item.badge}
                        </span>
                      </span>
                      {item.description && (
                        <span
                          className={`mt-1 hidden text-[10px] leading-4 ${collapsed ? "lg:hidden" : "lg:block"} ${darkMode ? "text-zinc-500" : active ? "text-paper/70" : "text-muted"}`}
                        >
                          {item.description}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <Link
          aria-label="구매자 MY로 이동"
          className={`mt-3 hidden min-h-11 items-center justify-center rounded-xl border text-xs font-bold md:flex ${collapsed ? "px-0" : "lg:px-4"} ${darkMode ? "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-100" : "border-line bg-paper"}`}
          href="/my"
          title={collapsed ? "구매자 MY로 이동" : undefined}
        >
          <span className={collapsed ? undefined : "lg:hidden"}>MY</span>
          {!collapsed && (
            <span className="hidden lg:inline">구매자 MY로 이동</span>
          )}
        </Link>
      </aside>
      <section className="min-w-0 self-start" data-admin-workspace-content>
        {contextBar}
        {contentHeader}
        {children}
      </section>
    </div>
  );
}
