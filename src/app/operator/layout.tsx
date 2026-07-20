"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["OVERVIEW", "/operator"],
  ["PRODUCTS", "/operator/products"],
  ["PAST PRODUCTS", "/operator/products/past"],
  ["MEMBERS", "/operator/members"],
  ["ORDERS", "/operator/orders"],
  ["SHIPPING", "/operator/shipping"],
  ["CHAT", "/operator/chat"],
] as const;

export default function OperatorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  return <div><nav aria-label="운영자 메뉴" className="mb-8 flex gap-4 border-b border-line pb-4 text-xs font-bold">{links.map(([label, href]) => { const active = pathname === href || (href !== "/operator" && pathname.startsWith(`${href}/`)); return <Link className={active ? "border-b-2 border-ink pb-4" : "text-muted"} href={href} key={href}>{label}</Link>; })}</nav>{children}</div>;
}
