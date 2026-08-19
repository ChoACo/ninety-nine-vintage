"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export interface AdminWorkspaceItem {
  exact?: boolean;
  href: string;
  label: string;
  description?: string;
  matchPrefixes?: readonly string[];
  group?: string;
}

interface AdminWorkspaceShellProps {
  children: ReactNode;
  contentHeader?: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  navigation: readonly AdminWorkspaceItem[];
  utility?: ReactNode;
}

function isActive(pathname: string, item: AdminWorkspaceItem) {
  if (item.matchPrefixes?.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return true;
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AdminWorkspaceShell({ children, contentHeader, description, eyebrow, navigation, title, utility }: Readonly<AdminWorkspaceShellProps>) {
  const pathname = usePathname();
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-10">
      <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        <div className="border border-line bg-surface p-4 sm:p-5">
          <p className="eyebrow text-muted">{eyebrow}</p>
          <h1 className="mt-2 text-xl font-black tracking-[-.05em]">{title}</h1>
          <p className="mt-2 text-xs leading-5 text-muted">{description}</p>
          {utility && <div className="mt-4 border-t border-line pt-4">{utility}</div>}
        </div>
        <nav aria-label={`${title} 주요 메뉴`} className="mt-3 flex max-w-full gap-2 overflow-x-auto pb-1 [scrollbar-width:none] lg:grid lg:gap-1 lg:overflow-visible">
          {navigation.map((item) => {
            const active = isActive(pathname, item);
            return (
              <div key={item.href}>
                <Link aria-current={active ? "page" : undefined} className={`group block w-full min-w-[132px] border px-4 py-3 transition-colors lg:min-w-0 ${active ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:border-ink"}`} href={item.href}>
                <span className="block text-sm font-black">{item.label}</span>
                {item.description && <span className={`mt-1 hidden text-[10px] leading-4 lg:block ${active ? "text-paper/70" : "text-muted"}`}>{item.description}</span>}
                </Link>
              </div>
            );
          })}
        </nav>
        <Link className="mt-3 hidden min-h-11 items-center justify-center border border-line bg-paper px-4 text-xs font-bold lg:flex" href="/account">구매자 MY로 이동</Link>
      </aside>
      <section className="min-w-0" data-admin-workspace-content>
        {contentHeader}
        {children}
      </section>
    </div>
  );
}
