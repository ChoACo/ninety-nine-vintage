"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { CatalogImage } from "@/components/ui/CatalogImage";

interface BidItem {
  id: string;
  productId: string;
  title: string;
  imageUrl: string;
  amount: number;
  currentPrice: number;
  closesAt: string;
  state: "leading" | "final" | "outbid" | "closed";
  createdAt: string;
}

interface BidPayload {
  items?: BidItem[];
  summary?: { total: number; leading: number; final: number; outbid: number };
}

const stateLabels: Record<BidItem["state"], string> = {
  leading: "현재 최고 입찰",
  final: "낙찰·결제 확인",
  outbid: "상위 입찰 필요",
  closed: "경매 종료",
};

export function BidHistory() {
  const [items, setItems] = useState<BidItem[]>([]);
  const [summary, setSummary] = useState<BidPayload["summary"]>();
  const [loaded, setLoaded] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        if (!data.session?.access_token) return;
        setSignedIn(true);
        const response = await fetch("/api/account/bids", { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
        if (response.ok) {
          const payload = await response.json() as BidPayload;
          setItems(payload.items ?? []);
          setSummary(payload.summary);
        }
      } catch { /* Guests and local builds without Supabase do not have bid history. */ }
      finally { setLoaded(true); }
    })();
  }, []);

  if (!loaded || !signedIn) return null;
  return <section id="bids"><div className="mb-5 flex items-end justify-between border-b border-ink pb-4"><div><p className="eyebrow text-muted">LIVE AUCTION / MY BIDS</p><h2 className="mt-2 text-xl font-black tracking-[-0.05em]">입찰 현황</h2></div><Link className="text-xs font-bold underline" href="/feed">LIVE AUCTION 보기</Link></div><div className="mb-4 grid grid-cols-3 gap-px border border-line bg-line"><div className="bg-paper p-4"><p className="text-[10px] text-muted">최고 입찰</p><p className="mt-2 font-mono text-xl font-bold">{summary?.leading ?? 0}</p></div><div className="bg-paper p-4"><p className="text-[10px] text-muted">낙찰·결제</p><p className="mt-2 font-mono text-xl font-bold">{summary?.final ?? 0}</p></div><div className="bg-paper p-4"><p className="text-[10px] text-muted">확인 필요</p><p className="mt-2 font-mono text-xl font-bold">{summary?.outbid ?? 0}</p></div></div>{items.length === 0 ? <div className="border border-dashed border-line py-14 text-center text-sm text-muted">아직 입찰한 상품이 없습니다. LIVE AUCTION에서 첫 입찰을 시작해 보세요.</div> : <div className="divide-y divide-line border-y border-line">{items.map((item) => <article className="flex gap-4 py-4" key={item.id}><Link className="size-20 shrink-0 bg-surface" href={`/auction/${item.productId}`}><CatalogImage alt="" className="h-full w-full object-cover" src={item.imageUrl} /></Link><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-4"><Link className="truncate text-sm font-bold hover:underline" href={`/auction/${item.productId}`}>{item.title}</Link><span className={`shrink-0 text-[10px] font-bold ${item.state === "leading" || item.state === "final" ? "text-emerald-700" : "text-amber-700"}`}>{stateLabels[item.state]}</span></div><p className="mt-2 text-xs text-muted">내 입찰 {item.amount.toLocaleString("ko-KR")}원 · 현재가 {item.currentPrice.toLocaleString("ko-KR")}원</p><p className="mt-1 text-[10px] text-muted">{new Date(item.createdAt).toLocaleString("ko-KR")} · 마감 {new Date(item.closesAt).toLocaleString("ko-KR")}</p></div></article>)}</div>}</section>;
}
