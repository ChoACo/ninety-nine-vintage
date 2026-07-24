"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/admin/employee", "업무 현황"],
  ["/admin/employee/inquiries", "담당 문의"],
  ["/admin/employee/fulfillment", "출고·보관"],
  ["/admin/employee/parcels", "택배·송장"],
] as const;

export default function EmployeeLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  return (
    <div>
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
