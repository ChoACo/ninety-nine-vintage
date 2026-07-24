import { NicknameGate } from "@/components/account/NicknameGate";
import { NicknameSettings } from "@/components/account/NicknameSettings";
import { AccountDashboard } from "@/components/features/account/AccountDashboard";
import { BidHistory } from "@/components/features/account/BidHistory";
import { MemberAccountBoundary } from "@/components/features/account/MemberAccountBoundary";
import { OrderHistory } from "@/components/features/account/OrderHistory";

export const dynamic = "force-dynamic";
export default function AccountPage() {
  return (
    <MemberAccountBoundary>
      <NicknameGate />
      <NicknameSettings />
      <AccountDashboard surface="desktop" />
      <details className="group mx-auto w-full max-w-[1540px] border-y border-line px-5 py-1 sm:px-8">
        <summary className="flex cursor-pointer list-none items-end justify-between gap-4 py-4">
          <div>
            <p className="eyebrow text-muted">실시간 경매 / 나의 입찰</p>
            <h2 className="mt-2 text-xl font-black tracking-[-0.05em]">
              입찰 현황
            </h2>
          </div>
          <span className="shrink-0 text-xs font-bold text-muted">
            열기/닫기
          </span>
        </summary>
        <div className="pb-4">
          <BidHistory surface="desktop" />
        </div>
      </details>
      <OrderHistory surface="desktop" />
    </MemberAccountBoundary>
  );
}
