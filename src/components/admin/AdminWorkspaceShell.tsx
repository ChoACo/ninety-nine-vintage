"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  Banknote,
  Boxes,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Gavel,
  LayoutDashboard,
  Menu,
  PackagePlus,
  Settings,
  Truck,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAdminSidebarStore } from "@/store/useAdminSidebarStore";
import { lockBodyScroll } from "@/lib/browser/bodyScrollLock";

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
  const [mobileOpen, setMobileOpen] = useState(false);
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

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    const releaseBodyScroll = lockBodyScroll();
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      releaseBodyScroll();
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileOpen]);

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

  const workspaceSidebarWidth = darkMode && collapsed ? "5rem" : "18rem";

  return (
    <div
      className="relative min-w-0 md:h-full md:min-h-0 md:flex-1"
      data-admin-workspace={operatorMode ? "operator" : workspaceMode}
      data-sidebar-collapsed={darkMode && collapsed ? "true" : "false"}
    >
      <button
        aria-controls={`${sidebarMode}-workspace-sidebar`}
        aria-expanded={mobileOpen}
        className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-xs font-black shadow-sm md:hidden"
        onClick={() => setMobileOpen(true)}
        type="button"
      >
        <Menu aria-hidden="true" size={18} />
        업무 메뉴
      </button>

      {mobileOpen && (
        <button
          aria-label="업무 메뉴 닫기"
          className="fixed inset-0 z-[80] bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
          type="button"
        />
      )}

      <div
        className="grid min-w-0 items-start gap-6 transition-[grid-template-columns] duration-300 ease-in-out md:h-full md:min-h-0 md:grid-cols-[var(--workspace-sidebar-width)_minmax(0,1fr)] md:gap-0 md:overflow-hidden"
        style={{
          "--workspace-sidebar-width": workspaceSidebarWidth,
        } as CSSProperties}
      >
        <aside
          aria-label={`${title} 업무 사이드바`}
          aria-modal={mobileOpen ? true : undefined}
          className={`fixed inset-y-0 left-0 z-[90] flex w-[min(18rem,calc(100vw-2rem))] translate-x-[var(--workspace-sidebar-offset)] flex-col overflow-hidden rounded-r-2xl border-r shadow-2xl transition-transform duration-300 ease-in-out md:sticky md:top-0 md:z-auto md:h-full md:min-h-0 md:w-full md:translate-x-0 md:rounded-2xl md:border ${darkMode ? "border-zinc-800 bg-zinc-950 text-zinc-100 shadow-zinc-950/20" : "border-line bg-surface text-ink"}`}
          id={`${sidebarMode}-workspace-sidebar`}
          role={mobileOpen ? "dialog" : undefined}
          data-mobile-drawer-open={mobileOpen ? "true" : undefined}
          data-scroll-lock-owner={mobileOpen ? "admin-drawer" : undefined}
          style={{
            "--workspace-sidebar-offset": mobileOpen ? "0%" : "-100%",
          } as CSSProperties}
        >
          <div
            className={`flex shrink-0 items-start justify-between gap-3 border-b p-4 ${darkMode ? "border-zinc-800" : "border-line"} ${collapsed ? "md:items-center md:justify-center md:px-3" : "md:p-5"}`}
          >
            <div className={collapsed ? "md:hidden" : undefined}>
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
            <button
              aria-label="업무 메뉴 닫기"
              className="grid size-11 shrink-0 place-items-center rounded-xl border border-current/20 md:hidden"
              onClick={() => setMobileOpen(false)}
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
            {darkMode && (
              <button
                aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
                className="hidden size-11 shrink-0 place-items-center rounded-xl border border-zinc-700 text-zinc-300 transition hover:border-zinc-400 focus-visible:ring-2 focus-visible:ring-amber-500 md:grid"
                onClick={handleToggleSidebar}
                title="Cmd+B"
                type="button"
              >
                {collapsed ? (
                  <ChevronRight aria-hidden="true" size={18} />
                ) : (
                  <ChevronLeft aria-hidden="true" size={18} />
                )}
              </button>
            )}
          </div>

          {utility && (
            <div
              className={`shrink-0 border-b p-4 ${collapsed ? "md:hidden" : "md:block"} ${darkMode ? "border-zinc-800" : "border-line"}`}
            >
              {utility}
            </div>
          )}

          <nav
            aria-label={`${title} 주요 메뉴`}
            className="independent-scroll no-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3"
          >
            {Object.entries(groups).map(([group, items]) => (
              <div key={group}>
                <p
                  className={`mb-1 px-3 pt-2 text-[10px] font-black tracking-[.14em] ${darkMode ? "text-zinc-500" : "text-muted"} ${collapsed ? "md:hidden" : ""}`}
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
                        className={`group block min-h-11 min-w-0 rounded-xl border px-3 py-3 transition-colors ${collapsed ? "md:grid md:min-h-12 md:place-items-center md:px-0 md:py-0" : "md:block"} ${darkMode ? (active ? "border-amber-500/50 bg-zinc-800 text-zinc-50" : "border-transparent text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100") : active ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:border-ink"}`}
                        href={item.href}
                        key={item.href}
                        onClick={() => setMobileOpen(false)}
                        title={collapsed ? item.label : undefined}
                      >
                        <span
                          className={`flex items-center gap-2 ${collapsed ? "md:justify-center" : "md:justify-start"}`}
                        >
                          {Icon && (
                            <Icon
                              aria-hidden="true"
                              className={`shrink-0 ${active && darkMode ? "text-amber-400" : ""}`}
                              size={18}
                              strokeWidth={1.75}
                            />
                          )}
                          <span
                            className={`truncate text-xs font-black ${collapsed ? "md:hidden" : "md:block"}`}
                          >
                            {item.label}
                          </span>
                          <span className={collapsed ? "md:hidden" : "md:inline"}>
                            {item.badge}
                          </span>
                        </span>
                        {item.description && (
                          <span
                            className={`mt-1 hidden text-[10px] leading-4 ${collapsed ? "md:hidden" : "md:block"} ${darkMode ? "text-zinc-500" : active ? "text-paper/70" : "text-muted"}`}
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

          <div
            className={`shrink-0 border-t p-3 ${darkMode ? "border-zinc-800" : "border-line"}`}
          >
            <Link
              aria-label="구매자 MY로 이동"
              className={`flex min-h-11 items-center justify-center rounded-xl border px-3 text-xs font-bold ${darkMode ? "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-100" : "border-line bg-paper"}`}
              href="/my"
              onClick={() => setMobileOpen(false)}
              title={collapsed ? "구매자 MY로 이동" : undefined}
            >
              <span className={collapsed ? "hidden md:inline" : "hidden"}>MY</span>
              <span className={collapsed ? "md:hidden" : undefined}>
                구매자 MY로 이동
              </span>
            </Link>
          </div>
        </aside>

        <section
          className="no-scrollbar min-w-0 self-start pb-24 md:h-full md:min-h-0 md:overflow-y-auto md:overscroll-contain md:p-6 md:pb-8"
          data-admin-workspace-content
        >
          {contextBar}
          {contentHeader}
          {children}
        </section>
      </div>
    </div>
  );
}
