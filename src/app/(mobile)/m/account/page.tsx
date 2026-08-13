import type { Metadata } from "next";
import { NicknameGate } from "@/components/account/NicknameGate";
import { MemberAccountBoundary } from "@/components/features/account/MemberAccountBoundary";
import { MobileAccountTaskGrid } from "@/components/features/account/MobileAccountTaskGrid";
import { AccountDashboard } from "@/components/features/account/AccountDashboard";
import { RoleWorkCenterLink } from "@/components/features/account/RoleWorkCenterLink";

export const metadata: Metadata = { title: "내 정보", robots: { follow: false, index: false } };

export default function MobileAccountPage() {
  return (
    <MemberAccountBoundary basePath="/m" returnTo="/m/account">
    <div>
      <NicknameGate />
      <AccountDashboard basePath="/m" view="overview" />
      <MobileAccountTaskGrid />
      <div className="mt-5"><RoleWorkCenterLink /></div>
    </div>
    </MemberAccountBoundary>
  );
}
