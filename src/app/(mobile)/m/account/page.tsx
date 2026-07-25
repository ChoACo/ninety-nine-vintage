import type { Metadata } from "next";
import { NicknameGate } from "@/components/account/NicknameGate";
import { MemberAccountBoundary } from "@/components/features/account/MemberAccountBoundary";
import { MobileAccountTaskGrid } from "@/components/features/account/MobileAccountTaskGrid";

export const metadata: Metadata = { title: "내 정보", robots: { follow: false, index: false } };

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
      <MobileAccountTaskGrid />
    </div>
    </MemberAccountBoundary>
  );
}
