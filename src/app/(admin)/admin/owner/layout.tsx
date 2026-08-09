"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { exact: true, href: "/admin/owner", label: "정책·보안" },
  { exact: false, href: "/admin/owner/payments", label: "입금 확인" },
  { exact: false, href: "/admin/owner/refunds", label: "긴급 요청" },
  { exact: false, href: "/admin/owner/stores", label: "매장·권한" },
  { exact: false, href: "/admin/owner/platform", label: "정산" },
] as const;

export default function OwnerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();

  return (
    <div>
      <nav
        aria-label="소유자 메뉴"
        className="mb-8 flex max-w-full gap-4 overflow-x-auto whitespace-nowrap border-b border-line pb-4 text-xs font-bold"
      >
        {links.map(({ exact, href, label }) => {
          const active =
            pathname === href || (!exact && pathname.startsWith(`${href}/`));
          return (
            <Link
              className={active ? "border-b-2 border-ink pb-4" : "text-muted"}
              href={href}
              key={href}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      <nav
        aria-label="소유자 상세 업무"
        className="mb-8 flex max-w-full gap-4 overflow-x-auto whitespace-nowrap text-[10px] font-bold text-muted"
      >
        <Link href="/admin/owner/stores">센터(매장) 관리</Link>
        <Link href="/admin/owner/members">회원·권한</Link>
        <Link href="/admin/owner/refunds">환불 승인</Link>
        <Link href="/admin/owner/onboarding">입점 상담</Link>
        <span>사이트·로그</span>
      </nav>
      {children}
    </div>
  );
}
