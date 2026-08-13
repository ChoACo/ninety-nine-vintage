import type { Metadata } from "next";
import { AccountDashboard } from "@/components/features/account/AccountDashboard";
import { MemberAccountBoundary } from "@/components/features/account/MemberAccountBoundary";

export const metadata: Metadata = { title: "찜", robots: { follow: false, index: false } };

export default function MobileSavedPage() {
  return (
    <MemberAccountBoundary basePath="/m" returnTo="/m/saved">
      <div>
        <header className="mb-6 border-b border-ink pb-4">
          <p className="eyebrow text-muted">쇼핑 / 찜</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-.08em]">찜한 상품</h1>
        </header>
        <AccountDashboard basePath="/m" view="saved" />
      </div>
    </MemberAccountBoundary>
  );
}
