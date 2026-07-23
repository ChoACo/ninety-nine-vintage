"use client";

import { CircleDot } from "lucide-react";
import { useAuctionTimer } from "@/hooks/useAuctionTimer";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";

export function LiveTickerBar({ surface = "mobile" }: { surface?: "desktop" | "mobile" }) {
  if (!LIVE_AUCTION_ENABLED) return null;
  return <EnabledLiveTickerBar surface={surface} />;
}

function EnabledLiveTickerBar({ surface }: { surface: "desktop" | "mobile" }) {
  const { label, status, timeLeft } = useAuctionTimer();

  return (
    <aside className="theme-invariant-dark sticky top-0 z-50 h-9 border-b border-zinc-800 bg-zinc-950 text-white">
      <div className={`mx-auto flex h-full items-center justify-between gap-3 ${surface === "desktop" ? "w-[1200px] text-xs" : "max-w-5xl px-4 text-[10px]"}`}>
        <div className="flex min-w-0 items-center gap-2 font-medium">
          <span className="flex items-center gap-1.5 tracking-[0.12em] text-emerald-400">
            <CircleDot size={14} strokeWidth={2.5} />
            실시간 경매
          </span>
          {surface === "desktop" && <span className="truncate text-zinc-300">10:00 공개 · 20:56 신규 참여 제한 · 21:00–22:00 정산</span>}
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <strong className="shrink-0 font-mono text-sm tracking-[0.08em]">
            {label} {timeLeft}
          </strong>
          {surface === "desktop" && <span className="text-zinc-400">{status === "CLOSED" ? "입찰 일시 중단" : status === "CLOSING_SOON" ? "기존 참여자 전용" : "서버 시간 동기화"}</span>}
        </div>
      </div>
    </aside>
  );
}
