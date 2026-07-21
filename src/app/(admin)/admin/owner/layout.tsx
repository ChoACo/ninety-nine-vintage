"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { exact: true, href: "/admin/owner", label: "전체 현황" },
  { exact: false, href: "/admin/owner/products", label: "상품 관리" },
  { exact: false, href: "/admin/owner/operations", label: "배송·결제" },
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
