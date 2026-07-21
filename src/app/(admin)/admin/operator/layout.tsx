"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { exact: true, href: "/admin/operator", label: "대시보드" },
  { exact: true, href: "/admin/operator/products", label: "상품" },
  { exact: false, href: "/admin/operator/products/past", label: "지난 상품" },
  { exact: false, href: "/admin/operator/members", label: "회원" },
  { exact: false, href: "/admin/operator/orders", label: "주문" },
  { exact: false, href: "/admin/operator/revenue", label: "매출" },
  { exact: false, href: "/admin/operator/shipping", label: "배송" },
  { exact: false, href: "/admin/operator/chat", label: "상담" },
] as const;

export default function OperatorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  return <div><nav aria-label="운영자 메뉴" className="mb-8 flex max-w-full gap-5 overflow-x-auto whitespace-nowrap border-b border-line pb-4 text-xs font-bold [scrollbar-width:none]">{links.map(({ exact, href, label }) => { const active = pathname === href || (!exact && pathname.startsWith(`${href}/`)); return <Link className={active ? "border-b-2 border-ink pb-4" : "text-muted"} href={href} key={href}>{label}</Link>; })}</nav>{children}</div>;
}
