"use client";

import { Radio } from "lucide-react";
import { useAuctionTimer } from "@/hooks/useAuctionTimer";
import { LIVE_AUCTION_ENABLED } from "@/lib/featureFlags";

export function LiveTickerBar({ surface = "mobile" }: { surface?: "desktop" | "mobile" }) {
  if (!LIVE_AUCTION_ENABLED) return null;
  return <EnabledLiveTickerBar surface={surface} />;
}

function EnabledLiveTickerBar({ surface }: { surface: "desktop" | "mobile" }) {
  const { label, status, timeLeft } = useAuctionTimer();
  const connectionLabel = status === "CLOSED"
    ? "입찰 일시 중단"
    : status === "CLOSING_SOON"
      ? "기존 참여자 전용"
      : "서버 시간 동기화";
  return (
    <aside className={`theme-invariant-dark relative z-0 border-b border-zinc-800 bg-zinc-950/95 text-white backdrop-blur-md ${surface === "desktop" ? "h-9" : "h-10"}`}>
      <div className={`mx-auto flex h-full w-full items-center justify-between gap-3 ${surface === "desktop" ? "max-w-[1200px] px-3 text-xs" : "max-w-5xl px-3 text-[9px]"}`}>
        <div className="flex min-w-0 items-center gap-2 font-medium">
          <span className="flex shrink-0 items-center gap-1.5 tracking-[0.12em] text-emerald-400">
            <Radio size={13} strokeWidth={1.75} />
            라이브 옥션
          </span>
          <span className={`${surface === "desktop" ? "truncate" : "line-clamp-2 max-w-40 leading-3"} text-zinc-300`}>10:00 공개 · 20:56 참여 제한 · 21:00–22:00 마감·동기화 점검</span>
        </div>
        <div className={`flex shrink-0 ${surface === "desktop" ? "items-center gap-4" : "flex-col items-end gap-0.5"}`}>
          <strong className={`${surface === "desktop" ? "text-sm tracking-[0.08em]" : "text-[10px] tracking-[0.04em]"} shrink-0 font-mono tabular-nums`}>{label} {timeLeft}</strong>
          <span className="flex items-center gap-1.5 text-zinc-400">
            {status !== "CLOSED" && <span aria-hidden="true" className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" /><span className="relative inline-flex size-2 rounded-full bg-emerald-400" /></span>}
            {connectionLabel}
          </span>
        </div>
      </div>
    </aside>
  );
}
