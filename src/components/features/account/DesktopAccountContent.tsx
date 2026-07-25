"use client";

import { NicknameSettings } from "@/components/account/NicknameSettings";
import { SimpleModeToggle } from "@/components/features/accessibility/SimpleModeToggle";
import { useSimpleMode } from "@/components/features/accessibility/SimpleModeProvider";
import { AccountDashboard } from "@/components/features/account/AccountDashboard";
import { BidHistory } from "@/components/features/account/BidHistory";
import { OrderHistory } from "@/components/features/account/OrderHistory";

export function DesktopAccountContent() {
  const simpleMode = useSimpleMode();
  return (
    <>
      <section className="mx-auto mb-10 w-full max-w-[1540px] px-5 pt-6 sm:px-8">
        <div className="max-w-md">
          <SimpleModeToggle detailed />
        </div>
      </section>
      <AccountDashboard
        surface="desktop"
        view={simpleMode.enabled ? "simple" : "full"}
      />
      <OrderHistory surface="desktop" />
      <details
        className="group mx-auto w-full max-w-[1540px] border-y border-line px-5 py-1 sm:px-8"
        open={simpleMode.enabled ? true : undefined}
      >
        <summary className="flex cursor-pointer list-none items-end justify-between gap-4 py-4">
          <div>
            <p className="eyebrow text-muted">실시간 경매 / 나의 입찰</p>
            <h2 className="mt-2 text-xl font-black tracking-[-0.05em]">입찰 현황</h2>
          </div>
          <span className="shrink-0 text-xs font-bold text-muted">열기/닫기</span>
        </summary>
        <div className="pb-4">
          <BidHistory surface="desktop" />
        </div>
      </details>
      {!simpleMode.enabled && (
        <details className="mx-auto w-full max-w-[1540px] border-y border-line px-5 py-1 sm:px-8">
          <summary className="cursor-pointer py-4 text-sm font-black">닉네임 설정</summary>
          <div className="pb-6">
            <NicknameSettings />
          </div>
        </details>
      )}
    </>
  );
}
