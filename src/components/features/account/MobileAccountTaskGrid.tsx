"use client";

import {
  Bell,
  CreditCard,
  PackageCheck,
  RotateCcw,
  Settings,
} from "lucide-react";
import Link from "next/link";

import { useSimpleMode } from "@/components/features/accessibility/SimpleModeProvider";

const tasks = [
  [
    "주문·결제",
    "/m/account/payments",
    CreditCard,
    [
      ["결제하기", "/m/account/payments"],
      ["주문 내역", "/m/account/orders"],
      ["입찰 현황", "/m/account/bids"],
    ],
    true,
  ],
  [
    "보관·배송",
    "/m/account/storage",
    PackageCheck,
    [
      ["보관 상품", "/m/account/storage"],
      ["배송 신청·현황", "/m/account/shipping"],
      ["배송지", "/m/account/addresses"],
    ],
    true,
  ],
  [
    "취소·환불",
    "/m/account/refunds",
    RotateCcw,
    [["환불 상태·계좌", "/m/account/refunds"]],
    true,
  ],
  [
    "채팅·알림",
    "/m/chat",
    Bell,
    [
      ["문의 채팅", "/m/chat"],
      ["알림 설정", "/m/account/settings"],
    ],
    true,
  ],
  [
    "계정",
    "/m/account/settings",
    Settings,
    [
      ["계정·화면 설정", "/m/account/settings"],
      ["찜 목록", "/m/account/saved"],
    ],
    true,
  ],
] as const;

export function MobileAccountTaskGrid() {
  const simpleMode = useSimpleMode();
  const visibleTasks = simpleMode.enabled
    ? tasks.filter((task) => task[4])
    : tasks;

  return (
    <nav
      aria-label="내 정보 핵심 업무"
      className={`mt-5 grid gap-px border border-line bg-line ${
        simpleMode.enabled ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"
      }`}
    >
      {visibleTasks.map(([label, href, Icon, links]) => (
        <section className="bg-paper p-5" key={href}>
          <Link className="flex items-center gap-3" href={href}>
            <Icon className="shrink-0" size={simpleMode.enabled ? 28 : 20} />
            <span className={simpleMode.enabled ? "text-lg font-black" : "text-sm font-black"}>
              {label}
            </span>
          </Link>
          <div className="mt-4 flex flex-wrap gap-2">
            {links.map(([linkLabel, linkHref]) => (
              <Link
                className="border border-line px-3 py-2 text-[10px] font-bold"
                href={linkHref}
                key={linkHref}
              >
                {linkLabel}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </nav>
  );
}
