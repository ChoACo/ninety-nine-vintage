import { MapPin, PackageCheck, Send, Truck } from "lucide-react";
import Link from "next/link";

const items = [
  ["보관 상품", "storage", PackageCheck],
  ["배송 신청", "shipping-request", Send],
  ["배송 현황", "shipping", Truck],
  ["배송지", "addresses", MapPin],
] as const;

export function AccountShippingNav({ basePath = "", current }: { basePath?: "" | "/m"; current: string }) {
  return (
    <nav aria-label="보관·배송 작업" className="mb-8 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-4">
      {items.map(([label, section, Icon]) => {
        const active = current === section;
        return (
          <Link aria-current={active ? "page" : undefined} className={`flex min-h-16 items-center gap-2 px-3 text-xs font-black ${active ? "bg-ink text-paper" : "bg-paper text-ink hover:bg-surface"}`} href={`${basePath}/account/${section}`} key={section}>
            <Icon className="shrink-0" size={16} /> {label}
          </Link>
        );
      })}
    </nav>
  );
}
