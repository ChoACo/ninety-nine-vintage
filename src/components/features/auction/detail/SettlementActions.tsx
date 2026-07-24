"use client";

import Link from "next/link";

interface SettlementActionsProps {
  basePath?: "" | "/m";
  deadlineAt?: string | null;
  deadlineEnforcementExempt?: boolean;
  initialStatus?: string | null;
  productId: string;
  serverTime?: string | null;
}

export function SettlementActions({
  basePath = "",
  deadlineAt = null,
  deadlineEnforcementExempt = false,
}: SettlementActionsProps) {
  const deadline = deadlineAt && Number.isFinite(Date.parse(deadlineAt))
    ? new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Seoul",
      }).format(new Date(deadlineAt))
    : null;

  return (
    <div className="mt-6 border-t border-zinc-200 pt-5">
      <p className="mb-3 text-[10px] font-bold tracking-[0.12em] text-zinc-500">
        낙찰 결제
      </p>
      <p className="mb-3 text-[11px] leading-5 text-zinc-500">
        낙찰품은 개별 결제하지 않습니다. 계정의 모든 미결제 낙찰품을 한 번에
        확인하고 총액을 한 번만 입금해 주세요.
      </p>
      <Link
        className="flex h-10 w-full items-center justify-center border border-zinc-950 text-xs font-bold transition-colors hover:bg-zinc-950 hover:text-white"
        href={`${basePath}/account#auction-payments`}
      >
        낙찰품 전체 결제하기
      </Link>
      {deadline && (
        <p className="mt-3 text-[11px] font-bold text-zinc-600">
          결제 마감 {deadline}
          {deadlineEnforcementExempt ? " · 마감 예외 회원" : ""}
        </p>
      )}
    </div>
  );
}
