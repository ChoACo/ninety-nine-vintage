import type { Metadata } from "next";
import { NicknameGate } from "@/components/account/NicknameGate";
import { MemberAccountBoundary } from "@/components/features/account/MemberAccountBoundary";
import { MobileAccountTaskGrid } from "@/components/features/account/MobileAccountTaskGrid";
import { AccountDashboard } from "@/components/features/account/AccountDashboard";
import { RoleWorkCenterLink } from "@/components/features/account/RoleWorkCenterLink";
import { NicknameSettings } from "@/components/account/NicknameSettings";
import { MobilePwaControls } from "@/components/features/pwa/MobilePwaControls";
import { SiteSettingsPage } from "@/components/settings/SiteSettingsPage";
import { StandaloneBackModal } from "@/components/layout/StandaloneBackModal";

export const metadata: Metadata = { title: "내 정보", robots: { follow: false, index: false } };

export default function MobileAccountPage() {
  return (
<MemberAccountBoundary basePath="/m" returnTo="/m/account">
    <StandaloneBackModal />
    <div>
      <NicknameGate />
      <AccountDashboard basePath="/m" view="overview" />
      <MobileAccountTaskGrid />
      <details className="mt-5 border-y border-line py-1" id="account-settings">
        <summary className="cursor-pointer py-4 text-sm font-black">통합 작업공간 · 설정</summary>
        <div className="space-y-6 pb-5">
          <section><h2 className="text-sm font-black">닉네임</h2><div className="mt-3"><NicknameSettings /></div></section>
          <section><h2 className="text-sm font-black">알림</h2><div className="mt-3"><MobilePwaControls detailed /></div></section>
          <section><h2 className="text-sm font-black">사이트 설정</h2><div className="mt-3"><SiteSettingsPage surface="mobile" /></div></section>
        </div>
      </details>
      <div className="mt-5"><RoleWorkCenterLink /></div>
    </div>
    </MemberAccountBoundary>
  );
}
