"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EmployeeOwnerScopeBridge } from "@/components/admin/employee/EmployeeOwnerScopeBridge";

const links = [
  ["/admin/employee", "오늘의 작업"],
  ["/admin/employee/fulfillment", "입출고·보관"],
  ["/admin/employee/parcels", "소포·송장"],
  ["/admin/employee/inquiries", "문의"],
] as const;

export default function EmployeeLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  return (
    <div>
      <EmployeeOwnerScopeBridge />
      <nav aria-label="직원센터 메뉴" className="mb-8 flex max-w-full gap-5 overflow-x-auto whitespace-nowrap border-b border-line pb-4 text-xs font-bold">
        {links.map(([href, label], index) => {
          const active = index === 0 ? pathname === href : pathname.startsWith(href);
          return <Link className={active ? "border-b-2 border-ink pb-4" : "text-muted"} href={href} key={href}>{label}</Link>;
        })}
      </nav>
      {children}
    </div>
  );
}
