"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  // label: "정책·보안" (legacy wording retained in documentation)
  // 환불 승인 remains the documented detail action under 긴급 요청.
  // 사이트·로그는 관리자 대시보드의 OwnerSiteStatusPanel에서 제공한다.
  { exact: true, href: "/admin/owner", label: "관리자 센터" },
  { exact: false, href: "/admin/owner/payments", label: "입금 확인" },
  { exact: false, href: "/admin/owner/refunds", label: "긴급 요청" },
  { exact: false, href: "/admin/owner/stores", label: "매장·권한" },
  { exact: false, href: "/admin/owner/members", label: "회원·권한" },
  { exact: false, href: "/admin/owner/onboarding", label: "입점 상담" },
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
      {children}
    </div>
  );
}
