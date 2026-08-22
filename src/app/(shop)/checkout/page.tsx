import type { Metadata } from "next";
import { Suspense } from "react";

import { AccountDashboard } from "@/components/features/account/AccountDashboard";
import { MemberAccountBoundary } from "@/components/features/account/MemberAccountBoundary";
import { OwnerMetricSkeleton } from "@/components/admin/owner/OwnerSkeletons";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "낙찰품 결제 | NINETY-NINE VINTAGE", robots: { follow: false, index: false } };

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ id?: string | string[]; type?: string | string[] }> }) {
  const params = await searchParams;
  const requestedId = typeof params.id === "string" && UUID_PATTERN.test(params.id) ? params.id : null;
  const returnTo = requestedId ? `/checkout?type=auction&id=${requestedId}` : "/checkout?type=auction";

  return <MemberAccountBoundary returnTo={returnTo}>
    <main className="space-y-6" data-checkout-product-id={requestedId ?? undefined}>
      <header className="border-b border-line pb-6">
        <p className="eyebrow text-muted">MY / 옥션 결제</p>
        <h1 className="mt-3 text-3xl font-black tracking-[-.07em]">낙찰품 결제</h1>
        <p className="mt-3 text-sm text-muted">서버에서 확정된 미결제 낙찰품과 입금 정보를 확인합니다.</p>
      </header>
      <Suspense fallback={<OwnerMetricSkeleton />}><AccountDashboard surface="desktop" view="payments" /></Suspense>
    </main>
  </MemberAccountBoundary>;
}
