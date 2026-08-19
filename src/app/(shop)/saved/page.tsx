import type { Metadata } from "next";
import { AccountDashboard } from "@/components/features/account/AccountDashboard";
import { MemberAccountBoundary } from "@/components/features/account/MemberAccountBoundary";
import { StandaloneBackModal } from "@/components/layout/StandaloneBackModal";

export const metadata: Metadata = { title: "찜", robots: { follow: false, index: false } };

export default function SavedPage() {
  return (
<MemberAccountBoundary returnTo="/saved">
      <StandaloneBackModal />
      <AccountDashboard view="saved" />
    </MemberAccountBoundary>
  );
}
