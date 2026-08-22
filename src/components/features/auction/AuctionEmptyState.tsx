"use client";

import { Bell, Clock3, Gavel, Sparkles } from "lucide-react";
import Link from "next/link";
import { useAuctionTimer } from "@/hooks/useAuctionTimer";

export function AuctionEmptyState({ basePath = "" }: { basePath?: "" | "/m" }) {
  const { label, status, timeLeft } = useAuctionTimer();
  return (
    <div className="grid overflow-hidden rounded-3xl border border-dashed border-line bg-surface/60 md:grid-cols-[1.15fr_.85fr]">
      <div className="p-7 sm:p-10">
        <span className="grid size-11 place-items-center rounded-2xl bg-ink text-paper"><Sparkles size={20} strokeWidth={1.75} /></span>
        <p className="mt-6 text-lg font-black tracking-[-.04em]">다음 빈티지 경매를 준비하고 있습니다.</p>
        <p className="mt-2 max-w-lg text-sm leading-6 text-muted">매일 오전 10시에 새 상품이 공개됩니다. 알림을 켜두면 새로운 경매 시작을 놓치지 않을 수 있어요.</p>
        <div className="mt-5 flex flex-wrap items-center gap-3"><span className="inline-flex items-center gap-2 rounded-xl border border-line bg-paper px-4 py-3 font-mono text-xs font-bold tabular-nums"><Clock3 size={15} strokeWidth={1.75} /> {label} {status !== "CLOSED" ? timeLeft : "다음 공개 준비 중"}</span><Link className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-ink px-4 text-xs font-bold text-paper transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:scale-[.98]" href={`${basePath}/account/notifications`}><Bell size={15} strokeWidth={1.75} /> 다음 경매 알림 받기</Link></div>
      </div>
      <div className="border-t border-line bg-paper/70 p-7 md:border-l md:border-t-0 sm:p-10"><p className="flex items-center gap-2 text-xs font-black"><Gavel size={16} strokeWidth={1.75} /> 매일 경매 이용 시간</p><dl className="mt-5 grid grid-cols-[5rem_1fr] gap-y-3 text-xs"><dt className="font-mono text-muted">10:00</dt><dd>오늘의 상품 공개</dd><dt className="font-mono text-muted">20:56</dt><dd>신규 참여 제한</dd><dt className="font-mono text-muted">21:00</dt><dd>경매 마감</dd><dt className="font-mono text-muted">21–22시</dt><dd>결과·정산 반영</dd></dl></div>
    </div>
  );
}
