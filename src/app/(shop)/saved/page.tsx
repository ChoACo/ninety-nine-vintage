import type { Metadata } from "next";
import { AccountDashboard } from "@/components/features/account/AccountDashboard";
import { MemberAccountBoundary } from "@/components/features/account/MemberAccountBoundary";

export const metadata: Metadata = { title: "찜", robots: { follow: false, index: false } };

export default function SavedPage() {
  return (
    <MemberAccountBoundary returnTo="/saved">
      <AccountDashboard view="saved" />
    </MemberAccountBoundary>
  );
}
