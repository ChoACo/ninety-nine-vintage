import { ArrowUpRight, Inbox, PackageCheck, Truck } from "lucide-react";
import Link from "next/link";

const tasks = [
  ["/admin/employee/inquiries", "담당 문의", "배정된 회원 문의에 답변합니다.", Inbox],
  ["/admin/employee/fulfillment", "출고·보관", "매장 상품을 출고 즉시 보관 처리합니다.", PackageCheck],
  ["/admin/employee/parcels", "택배·송장", "포장과 송장 등록을 처리합니다.", Truck],
] as const;

export default function EmployeePage() {
  return (
    <div className="space-y-8">
      <header className="border-b border-ink pb-6">
        <p className="eyebrow text-muted">직원센터 / 담당 업무</p>
        <h1 className="mt-3 text-4xl font-black tracking-[-0.08em]">직원센터</h1>
        <p className="mt-3 text-sm text-muted">담당 문의와 매장 상품 출고·보관, 통합 택배 업무를 표시합니다.</p>
      </header>
      <div className="grid gap-px border border-line bg-line sm:grid-cols-2">
        {tasks.map(([href, title, description, Icon]) => (
          <Link className="bg-paper p-6" href={href} key={href}>
            <div className="flex items-center justify-between"><Icon size={18} /><ArrowUpRight size={15} /></div>
            <p className="mt-8 text-lg font-black">{title}</p>
            <p className="mt-2 text-xs text-muted">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
