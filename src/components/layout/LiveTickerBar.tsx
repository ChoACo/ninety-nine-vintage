"use client";

import { CircleDot } from "lucide-react";
import { useAuctionTimer } from "@/hooks/useAuctionTimer";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";

export function LiveTickerBar() {
  if (!LIVE_AUCTION_ENABLED) return null;
  return <EnabledLiveTickerBar />;
}

function EnabledLiveTickerBar() {
  const { timeLeft } = useAuctionTimer();

  return (
    <aside className="sticky top-0 z-50 h-9 border-b border-zinc-800 bg-zinc-950 text-white">
      <div className="mx-auto flex h-full max-w-[1680px] items-center justify-between gap-3 px-10 text-xs xl:px-12">
        <div className="flex min-w-0 items-center gap-2 font-medium">
          <span className="flex items-center gap-1.5 tracking-[0.12em] text-emerald-400">
            <CircleDot size={14} strokeWidth={2.5} />
            LIVE DROP
          </span>
          <span className="truncate text-zinc-300">오늘의 빈티지 드롭 · 21:00 KST 마감 · 21:00–22:00 점검</span>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <strong className="shrink-0 font-mono text-sm tracking-[0.08em]">
            {timeLeft} 남음
          </strong>
          <span className="text-zinc-400 ">20:56 신규 참여 제한</span>
        </div>
      </div>
    </aside>
  );
}
