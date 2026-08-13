"use client";

import { NicknameSettings } from "@/components/account/NicknameSettings";
import { SimpleModeToggle } from "@/components/features/accessibility/SimpleModeToggle";
import { useSimpleMode } from "@/components/features/accessibility/SimpleModeProvider";
import { AccountDashboard } from "@/components/features/account/AccountDashboard";
import { MobileAccountTaskGrid } from "@/components/features/account/MobileAccountTaskGrid";
import { RoleWorkCenterLink } from "@/components/features/account/RoleWorkCenterLink";

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
        view={simpleMode.enabled ? "simple" : "overview"}
      />
      <section className="mx-auto w-full max-w-[1540px] px-5 sm:px-8">
        <div className="mb-10">
          <p className="eyebrow text-muted">MY / 빠른 메뉴</p>
          <h2 className="mt-2 text-xl font-black tracking-[-0.05em]">필요한 업무로 바로 이동</h2>
          <MobileAccountTaskGrid basePath="" />
        </div>
        <RoleWorkCenterLink />
      </section>
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
