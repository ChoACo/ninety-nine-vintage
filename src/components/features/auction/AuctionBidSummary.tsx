"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface Summary { total: number; leading: number; final: number; outbid: number; }

export function AuctionBidSummary() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session?.access_token) return;
      const response = await fetch("/api/account/bids", { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
      if (!response.ok || cancelled) return;
      const payload = await response.json() as { summary?: Summary };
      if (!cancelled) { setSignedIn(true); setSummary(payload.summary ?? { total: 0, leading: 0, final: 0, outbid: 0 }); }
    })();
    return () => { cancelled = true; };
  }, []);

  return <div className="mb-6 border border-line bg-surface px-4 py-3"><div className="flex items-center justify-between gap-4"><div><p className="text-[10px] font-bold tracking-[0.14em] text-muted">MY BIDS / LIVE STATUS</p><p className="mt-1 text-xs font-bold">{signedIn ? "내 입찰 현황" : "카카오 로그인 후 입찰 현황을 확인하세요."}</p></div><Link className="shrink-0 text-[10px] font-bold underline" href={signedIn ? "/account#bids" : "/api/auth/kakao/start?returnTo=%2Ffeed"}>{signedIn ? "전체 보기" : "로그인"}</Link></div>{signedIn && summary && <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-[10px] text-muted"><span>참여 {summary.total}</span><span className="font-bold text-emerald-700">최고 입찰 {summary.leading}</span><span>낙찰·결제 {summary.final}</span>{summary.outbid > 0 && <span className="font-bold text-amber-700">확인 필요 {summary.outbid}</span>}</div>}</div>;
}
