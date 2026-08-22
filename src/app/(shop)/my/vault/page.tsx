import type { Metadata } from "next";
import { Suspense } from "react";
import { MemberAccountBoundary } from "@/components/features/account/MemberAccountBoundary";
import { MyDashboard } from "@/components/features/mypage/MyDashboard";
import { VaultCardSkeleton } from "@/components/skeletons/MySkeletons";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "보관함 | NINETY-NINE VINTAGE", robots: { index: false, follow: false } };

export default function MyVaultPage() {
  return <MemberAccountBoundary returnTo="/my/vault"><Suspense fallback={<VaultCardSkeleton />}><MyDashboard initialTab="vault" /></Suspense></MemberAccountBoundary>;
}
