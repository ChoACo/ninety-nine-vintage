"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { exact: true, href: "/admin/operator", label: "OVERVIEW" },
  { exact: true, href: "/admin/operator/products", label: "PRODUCTS" },
  { exact: false, href: "/admin/operator/products/past", label: "PAST PRODUCTS" },
  { exact: false, href: "/admin/operator/members", label: "MEMBERS" },
  { exact: false, href: "/admin/operator/orders", label: "ORDERS" },
  { exact: false, href: "/admin/operator/shipping", label: "SHIPPING" },
  { exact: false, href: "/admin/operator/chat", label: "CHAT" },
] as const;

export default function OperatorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  return <div><nav aria-label="운영자 메뉴" className="mb-8 flex max-w-full gap-4 overflow-x-auto whitespace-nowrap border-b border-line pb-4 text-xs font-bold">{links.map(({ exact, href, label }) => { const active = pathname === href || (!exact && pathname.startsWith(`${href}/`)); return <Link className={active ? "border-b-2 border-ink pb-4" : "text-muted"} href={href} key={href}>{label}</Link>; })}</nav>{children}</div>;
}
