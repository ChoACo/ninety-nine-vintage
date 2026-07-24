"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { exact: true, href: "/admin/operator", label: "대시보드" },
  { exact: true, href: "/admin/operator/products", label: "상품" },
  { exact: false, href: "/admin/operator/payments", label: "주문·입금 확인" },
  { exact: false, href: "/admin/operator/fulfillment", label: "출고·보관" },
  { exact: false, href: "/admin/operator/storage", label: "회원 상품 보관함" },
  { exact: false, href: "/admin/operator/winners", label: "낙찰된 회원" },
  { exact: false, href: "/admin/operator/chat", label: "회원 채팅" },
  { exact: false, href: "/admin/operator/shipping", label: "택배·송장" },
  { exact: false, href: "/admin/operator/products/past", label: "기록 · 지난 상품" },
  { exact: false, href: "/admin/operator/exceptions", label: "기록 · 예외" },
] as const;

export default function OperatorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  return <div><nav aria-label="운영자 메뉴" className="mb-8 flex max-w-full gap-5 overflow-x-auto whitespace-nowrap border-b border-line pb-4 text-xs font-bold [scrollbar-width:none]">{links.map(({ exact, href, label }) => { const active = pathname === href || (!exact && pathname.startsWith(`${href}/`)); return <Link className={active ? "border-b-2 border-ink pb-4" : "text-muted"} href={href} key={href}>{label}</Link>; })}</nav>{children}</div>;
}
