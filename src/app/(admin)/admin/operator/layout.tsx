"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

const navigation: readonly OperatorNavGroup[] = [
  {
    href: "/admin/operator",
    items: [],
    key: "main",
    label: "메인",
  },
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
    ],
    key: "products",
    label: "상품",
  },
  {
    href: "/admin/operator/payments",
    items: [
      {
        exact: false,
        href: "/admin/operator/payments",
        label: "주문",
      },
      {
        exact: false,
        href: "/admin/operator/winners",
        label: "낙찰된 회원",
      },
      {
        exact: false,
        href: "/admin/operator/chat",
        label: "회원 채팅",
      },
    ],
    key: "orders",
    label: "주문·입금",
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
    ],
    key: "fulfillment",
    label: "출고·보관",
  },
  {
    href: "/admin/operator/products/past",
    items: [
      {
        exact: false,
        href: "/admin/operator/products/past",
        label: "지난 상품",
      },
      {
        exact: false,
        href: "/admin/operator/exceptions",
        label: "예외",
      },
    ],
    key: "records",
    label: "기록",
  },
  {
    href: "/admin/operator/shipping",
    items: [
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
    ],
    key: "shipping",
    label: "택배",
  },
] as const;

function matchesPath(pathname: string, item: OperatorNavItem) {
  return pathname === item.href
    || (!item.exact && pathname.startsWith(`${item.href}/`));
}

function isGroupActive(pathname: string, group: OperatorNavGroup) {
  if (group.key === "main") return pathname === group.href;
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
      <nav
        aria-label="운영자 대분류"
        className="flex max-w-full gap-2 overflow-x-auto whitespace-nowrap border-b border-ink pb-3 text-xs font-black [scrollbar-width:none]"
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

      {!activeGroup?.items.length && <div className="mb-8" />}
      {children}
    </div>
  );
}
