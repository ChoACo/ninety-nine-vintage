"use client";

import {
  CreditCard,
  Gavel,
  Heart,
  MapPin,
  PackageCheck,
  ReceiptText,
  RotateCcw,
  Settings,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { useSimpleMode } from "@/components/features/accessibility/SimpleModeProvider";

const tasks = [
  ["결제하기", "결제할 상품과 입금 상태 확인", "/m/account/payments", CreditCard, true],
  ["주문 내역", "구매 상품과 처리 상태 확인", "/m/account/orders", ReceiptText, true],
  ["배송 신청·현황", "배송 신청부터 발송까지 확인", "/m/account/shipping", Truck, true],
  ["보관 상품", "보관 기한과 묶음 배송 확인", "/m/account/storage", PackageCheck, true],
  ["입찰 현황", "최고 입찰과 재입찰 확인", "/m/account/bids", Gavel, true],
  ["배송지", "수령 주소 등록과 선택", "/m/account/addresses", MapPin, false],
  ["찜 목록", "저장한 상품 다시 보기", "/m/account/saved", Heart, false],
  ["환불", "환불 상태와 계좌 등록", "/m/account/refunds", RotateCcw, false],
  ["설정", "간편모드와 모바일 알림 설정", "/m/account/settings", Settings, false],
] as const;

export function MobileAccountTaskGrid() {
  const simpleMode = useSimpleMode();
  const visibleTasks = simpleMode.enabled
    ? tasks.filter((task) => task[4])
    : tasks;

  return (
    <nav
      aria-label="내 정보 업무"
      className={`mt-5 grid gap-px border border-line bg-line ${
        simpleMode.enabled ? "grid-cols-1" : "grid-cols-2"
      }`}
    >
      {visibleTasks.map(([label, description, href, Icon]) => (
        <Link
          className={`bg-paper p-5 transition-colors active:bg-surface ${
            simpleMode.enabled ? "flex min-h-24 items-center gap-5" : "min-h-36"
          }`}
          href={href}
          key={href}
        >
          <Icon className="shrink-0" size={simpleMode.enabled ? 28 : 19} />
          <span>
            <span className={`block font-black ${simpleMode.enabled ? "text-lg" : "mt-7 text-sm"}`}>
              {label}
            </span>
            <span className={`mt-2 block leading-5 text-muted ${simpleMode.enabled ? "text-sm" : "text-[10px]"}`}>
              {description}
            </span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
