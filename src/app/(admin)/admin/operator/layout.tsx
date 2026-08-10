"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { OperatorStoreScopeSelector } from "@/components/admin/operator/OperatorStoreScopeSelector";

interface OperatorNavItem {
  exact: boolean;
  href: string;
  label: string;
}

interface OperatorNavGroup {
  href: string;
  items: readonly OperatorNavItem[];
  key: string;
  label: string;
}

const mainNavigationItem = {
  href: "/admin/operator",
  label: "메인",
} as const;

const navigation: readonly OperatorNavGroup[] = [
  {
    href: "/admin/operator/products",
    items: [
      {
        exact: true,
        href: "/admin/operator/products",
        label: "상품",
      },
      {
        exact: true,
        href: "/admin/operator/products/registration",
        label: "상품 등록",
      },
      {
        exact: false,
        href: "/admin/operator/products/past",
        label: "지난 상품",
      },
    ],
    key: "sales",
    label: "판매",
  },
  {
    href: "/admin/operator/winners",
    items: [
      {
        exact: false,
        href: "/admin/operator/winners",
        label: "낙찰된 회원",
      },
    ],
    key: "payments",
    label: "결제 상태",
  },
  {
    href: "/admin/operator/fulfillment",
    items: [
      {
        exact: false,
        href: "/admin/operator/fulfillment",
        label: "출고·보관",
      },
      {
        exact: false,
        href: "/admin/operator/storage",
        label: "회원 보관함",
      },
      {
        exact: true,
        href: "/admin/operator/shipping",
        label: "택배 요청",
      },
      {
        exact: false,
        href: "/admin/operator/shipping/completed",
        label: "택배 발송 완료",
      },
      {
        exact: false,
        href: "/admin/operator/shipping/history",
        label: "지난 택배 기록",
      },
      {
        exact: false,
        href: "/admin/operator/exceptions",
        label: "출고 예외",
      },
    ],
    key: "fulfillment",
    label: "준비·배송",
  },
  {
    href: "/admin/operator/chat",
    items: [
      {
        exact: false,
        href: "/admin/operator/chat",
        label: "회원 채팅",
      },
    ],
    key: "inquiries",
    label: "문의",
  },
  {
    href: "/admin/operator",
    items: [],
    key: "settlements",
    label: "매출·정산",
  },
  {
    href: "/admin/operator/platform",
    items: [{ exact: true, href: "/admin/operator/platform", label: "등급·정산계좌" }],
    key: "settings",
    label: "매장 설정",
  },
] as const;

function matchesPath(pathname: string, item: OperatorNavItem) {
  return pathname === item.href
    || (!item.exact && pathname.startsWith(`${item.href}/`));
}

function isGroupActive(pathname: string, group: OperatorNavGroup) {
  return group.items.some((item) => matchesPath(pathname, item));
}

export default function OperatorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const activeGroup = navigation.find((group) =>
    isGroupActive(pathname, group)
  );

  return (
    <div>
      <nav aria-label="운영자 상단 탭" className="mb-3 border-b border-ink pb-3">
        <Link
          aria-current={pathname === mainNavigationItem.href ? "page" : undefined}
          className={`inline-flex min-h-11 items-center whitespace-nowrap px-5 text-xs font-black ${
            pathname === mainNavigationItem.href
              ? "bg-ink text-paper"
              : "border border-line text-muted"
          }`}
          href={mainNavigationItem.href}
        >
          {mainNavigationItem.label}
        </Link>
      </nav>
      <p className="mb-2 text-[10px] font-black tracking-[.12em] text-muted">운영 탭</p>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-ink pb-3">
        <nav
          aria-label="운영자 대분류"
          className="flex max-w-full gap-2 overflow-x-auto whitespace-nowrap text-xs font-black [scrollbar-width:none]"
        >
          {navigation.map((group) => {
            const active = activeGroup?.key === group.key;
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={active
                  ? "bg-ink px-4 py-3 text-paper"
                  : "border border-line px-4 py-3 text-muted"}
                href={group.href}
                key={group.key}
              >
                {group.label}
              </Link>
            );
          })}
        </nav>
        <OperatorStoreScopeSelector />
      </div>

      {activeGroup && activeGroup.items.length > 0 && (
        <nav
          aria-label={`${activeGroup.label} 소분류`}
          className="mb-8 flex max-w-full gap-5 overflow-x-auto whitespace-nowrap border-b border-line bg-surface px-4 pt-4 text-xs font-bold [scrollbar-width:none]"
        >
          {activeGroup.items.map((item) => {
            const active = matchesPath(pathname, item);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={active
                  ? "border-b-2 border-ink pb-4 text-ink"
                  : "pb-4 text-muted"}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}

      {!activeGroup && <div className="mb-8" />}
      {children}
    </div>
  );
}
