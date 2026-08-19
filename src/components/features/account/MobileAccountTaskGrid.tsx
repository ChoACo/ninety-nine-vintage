"use client";

import {
  Bell,
  ChevronRight,
  CreditCard,
  Gavel,
  Heart,
  MapPin,
  PackageCheck,
  RotateCcw,
  ShoppingBag,
  Settings,
  Truck,
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
      ["배송 신청", "/m/account/shipping-request"],
      ["배송 현황", "/m/account/shipping"],
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
    "채팅",
    "/m/chat",
    Bell,
    [["문의 채팅", "/m/chat"]],
    true,
  ],
  [
    "설정",
    "/m/account#account-settings",
    Settings,
    [
      ["닉네임", "/m/account#account-settings"],
      ["배송지", "/m/account/addresses"],
      ["알림", "/m/account#account-settings"],
      ["계정·계좌", "/m/account#account-settings"],
    ],
    true,
  ],
] as const;

const quickActions = [
  ["결제하기", "/m/account/payments", CreditCard],
  ["주문 내역", "/m/account/orders", ShoppingBag],
  ["배송 신청", "/m/account/shipping-request", PackageCheck],
  ["배송 현황", "/m/account/shipping", Truck],
] as const;

export function MobileAccountTaskGrid({ basePath = "/m" }: { basePath?: "" | "/m" }) {
  const simpleMode = useSimpleMode();
  const visibleTasks = simpleMode.enabled
    ? tasks.filter((task) => task[4])
    : tasks;

  return (
    <nav aria-label="내 정보 핵심 업무" className="mt-6 space-y-7">
      <section>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-lg font-black">자주 쓰는 메뉴</h2>
          <span className="text-[11px] text-muted">바로 이동</span>
        </div>
        <div className={`grid gap-3 ${simpleMode.enabled ? "grid-cols-1" : "grid-cols-2"}`}>
          {quickActions.map(([label, href, Icon]) => (
            <Link
              className="flex min-h-24 flex-col justify-between rounded-2xl bg-surface p-4 active:scale-[.98]"
              href={`${basePath}${href.slice(2)}`}
              key={href}
            >
              <Icon size={22} />
              <span className="text-sm font-black">{label}</span>
            </Link>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-lg font-black">전체 메뉴</h2>
        <div className="overflow-hidden rounded-2xl border border-line bg-paper">
          {visibleTasks.map(([label, href, Icon, links]) => (
            <div className="border-b border-line last:border-b-0" key={href}>
              <Link className="flex min-h-16 items-center gap-3 px-4" href={`${basePath}${href.slice(2)}`}>
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface"><Icon size={19} /></span>
                <span className="min-w-0 flex-1 text-sm font-black">{label}</span>
                <ChevronRight className="text-muted" size={18} />
              </Link>
              {!simpleMode.enabled && (
                <div className="-mt-1 flex flex-wrap gap-x-4 gap-y-2 px-16 pb-4">
                  {links.slice(1).map(([linkLabel, linkHref]) => (
                    <Link className="text-xs font-bold text-muted underline-offset-4 hover:underline" href={`${basePath}${linkHref.slice(2)}`} key={linkHref}>{linkLabel}</Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Link className="flex min-h-12 items-center justify-center gap-1 rounded-xl border border-line text-xs font-bold" href={`${basePath}/account/bids`}><Gavel size={15} /> 입찰</Link>
          <Link className="flex min-h-12 items-center justify-center gap-1 rounded-xl border border-line text-xs font-bold" href={`${basePath}/saved`}><Heart size={15} /> 찜</Link>
          <Link className="flex min-h-12 items-center justify-center gap-1 rounded-xl border border-line text-xs font-bold" href={`${basePath}/account/addresses`}><MapPin size={15} /> 배송지</Link>
        </div>
      </section>
    </nav>
  );
}
