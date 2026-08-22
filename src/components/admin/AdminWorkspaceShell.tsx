"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Boxes, ChartNoAxesCombined, CircleHelp, Gavel, LayoutDashboard, PackagePlus, Settings, Truck, type LucideIcon } from "lucide-react";

const WORKSPACE_ICONS: Record<string, LucideIcon> = {
  auctions: Gavel,
  dashboard: LayoutDashboard,
  inquiries: CircleHelp,
  orders: ChartNoAxesCombined,
  products: Boxes,
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
  if (item.matchPrefixes?.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return true;
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AdminWorkspaceShell({ children, contentHeader, contextBar, description, eyebrow, navigation, operatorMode = false, title, utility, workspaceMode = "default" }: Readonly<AdminWorkspaceShellProps>) {
  const pathname = usePathname();
  const darkMode = operatorMode || workspaceMode !== "default";
  const sidebarStorageKey = workspaceMode === "owner" ? "ninety-nine:owner-sidebar" : "ninety-nine:operator-sidebar";
  const [collapsed, setCollapsed] = useState(() => darkMode && typeof window !== "undefined" && window.localStorage.getItem(sidebarStorageKey) === "collapsed");

  useEffect(() => {
    if (!darkMode) return;
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setCollapsed((value) => {
          const next = !value;
          window.localStorage.setItem(sidebarStorageKey, next ? "collapsed" : "expanded");
          return next;
        });
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [darkMode, sidebarStorageKey]);

  const groups = navigation.reduce<Record<string, AdminWorkspaceItem[]>>((acc, item) => {
    const group = item.group ?? "메뉴";
    (acc[group] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className={`grid min-w-0 gap-6 lg:gap-8 ${darkMode ? "lg:grid-cols-[250px_minmax(0,1fr)]" : "lg:grid-cols-[248px_minmax(0,1fr)]"}`}>
      <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        <div className={`${darkMode ? "rounded-2xl border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl shadow-zinc-950/20" : "border-line bg-surface"} border p-4 sm:p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div className={collapsed ? "lg:hidden" : undefined}>
              <p className={`eyebrow ${darkMode ? "text-zinc-500" : "text-muted"}`}>{eyebrow}</p>
              <h1 className="mt-2 text-xl font-black tracking-[-.05em]">{title}</h1>
              <p className={`mt-2 text-xs leading-5 ${darkMode ? "text-zinc-400" : "text-muted"}`}>{description}</p>
            </div>
            {darkMode && <button aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"} className="hidden size-9 shrink-0 place-items-center rounded-xl border border-zinc-700 text-zinc-300 transition hover:border-zinc-400 focus-visible:ring-2 focus-visible:ring-amber-500 lg:grid" onClick={() => setCollapsed((value) => { const next = !value; window.localStorage.setItem(sidebarStorageKey, next ? "collapsed" : "expanded"); return next; })} title="Cmd+B" type="button">{collapsed ? "→" : "←"}</button>}
          </div>
          {utility && <div className={`mt-4 border-t pt-4 ${darkMode ? "border-zinc-800" : "border-line"} ${collapsed ? "lg:hidden" : ""}`}>{utility}</div>}
        </div>
        <nav aria-label={`${title} 주요 메뉴`} className={`${darkMode ? "rounded-2xl border border-zinc-800 bg-zinc-950 p-2" : ""} mt-3 flex max-w-full gap-2 overflow-x-auto pb-1 [scrollbar-width:none] lg:grid lg:gap-3 lg:overflow-visible`}>
          {Object.entries(groups).map(([group, items]) => <div key={group}>
            <p className={`mb-1 px-3 pt-2 text-[10px] font-black tracking-[.14em] ${darkMode ? "text-zinc-500" : "text-muted"} ${collapsed ? "lg:hidden" : ""}`}>{group}</p>
            <div className="grid gap-1">
              {items.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon ? WORKSPACE_ICONS[item.icon] : undefined;
                return <Link aria-current={active ? "page" : undefined} className={`group block min-w-[145px] rounded-xl border px-3 py-3 transition-colors lg:min-w-0 ${darkMode ? (active ? "border-amber-500/50 bg-zinc-800 text-zinc-50" : "border-transparent text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100") : (active ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:border-ink")}`} href={item.href} key={item.href} title={collapsed ? item.label : undefined}>
                  <span className="flex items-center gap-2">
                    {Icon && <Icon className={active && darkMode ? "text-amber-400" : undefined} size={16} strokeWidth={1.75} />}
                    <span className={`block truncate text-sm font-black ${collapsed ? "lg:hidden" : ""}`}>{item.label}</span>
                    {item.badge}
                  </span>
                  {item.description && <span className={`mt-1 hidden text-[10px] leading-4 lg:block ${collapsed ? "lg:hidden" : ""} ${darkMode ? "text-zinc-500" : active ? "text-paper/70" : "text-muted"}`}>{item.description}</span>}
                </Link>;
              })}
            </div>
          </div>)}
        </nav>
        <Link className={`mt-3 hidden min-h-11 items-center justify-center rounded-xl border px-4 text-xs font-bold lg:flex ${darkMode ? "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-100" : "border-line bg-paper"}`} href="/account">구매자 MY로 이동</Link>
      </aside>
      <section className="min-w-0" data-admin-workspace-content>
        {contextBar}
        {contentHeader}
        {children}
      </section>
    </div>
  );
}
