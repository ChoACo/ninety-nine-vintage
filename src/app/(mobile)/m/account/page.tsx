import type { Metadata } from "next";
import { Gavel, Heart, MapPin, PackageCheck, ReceiptText, RotateCcw, Settings, Truck } from "lucide-react";
import Link from "next/link";

import { NicknameGate } from "@/components/account/NicknameGate";
import { MemberAccountBoundary } from "@/components/features/account/MemberAccountBoundary";

export const metadata: Metadata = { title: "내 정보", robots: { follow: false, index: false } };

const tasks = [
  ["주문 내역", "결제·입금 상태 확인", "/m/account/orders", ReceiptText],
  ["입찰 현황", "최고 입찰·재입찰 확인", "/m/account/bids", Gavel],
  ["보관 상품", "보관 기한과 묶음 배송", "/m/account/storage", PackageCheck],
  ["배송 현황", "요청·발송 상태 확인", "/m/account/shipping", Truck],
  ["배송지", "수령 주소 등록과 선택", "/m/account/addresses", MapPin],
  ["찜 목록", "저장한 상품 다시 보기", "/m/account/saved", Heart],
  ["환불", "환불 상태와 계좌 등록", "/m/account/refunds", RotateCcw],
  ["설정", "화면·테마·계정 설정", "/m/account/settings", Settings],
] as const;

export default function MobileAccountPage() {
  return (
    <MemberAccountBoundary basePath="/m" returnTo="/m/account">
    <div>
      <NicknameGate />
      <header className="border-b border-ink pb-6">
        <p className="eyebrow text-muted">내 정보 / 빠른 메뉴</p>
        <h1 className="mt-3 text-3xl font-black tracking-[-.08em]">
          무엇을 확인할까요?
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          긴 화면을 찾지 않고 필요한 업무로 바로 이동하세요.
        </p>
      </header>
      <nav
        aria-label="내 정보 업무"
        className="mt-5 grid grid-cols-2 gap-px border border-line bg-line"
      >
        {tasks.map(([label, description, href, Icon]) => (
          <Link
            className="min-h-36 bg-paper p-4 transition-colors active:bg-surface"
            href={href}
            key={href}
          >
            <Icon size={19} />
            <p className="mt-7 text-sm font-black">{label}</p>
            <p className="mt-2 text-[10px] leading-4 text-muted">
              {description}
            </p>
          </Link>
        ))}
      </nav>
    </div>
    </MemberAccountBoundary>
  );
}
