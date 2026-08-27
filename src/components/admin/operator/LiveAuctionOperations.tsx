"use client";

import { Clock3, Gavel, RefreshCw, Radio } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusNotice } from "@/components/ui/StatusNotice";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface AuctionProduct {
  id: string;
  title: string;
  current_price: number;
  closes_at: string;
  image_urls: string[];
  sale_type: string;
  status: string;
  bid_count?: number;
  stores?: { name: string } | null;
}

export function LiveAuctionOperations() {
  const { session } = useSupabaseSession();
  const token = session?.access_token ?? null;
  const [products, setProducts] = useState<AuctionProduct[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [flashedProductId, setFlashedProductId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await fetch("/api/admin/operator/products", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => null) as { products?: AuctionProduct[]; message?: string } | null;
      if (!response.ok) throw new Error(payload?.message ?? "경매 운영 현황을 불러오지 못했습니다.");
      setProducts((payload?.products ?? []).filter((product) => product.sale_type === "auction"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "경매 운영 현황을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const interval = window.setInterval(tick, 1_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        tick();
        void load();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);
  useEffect(() => {
    if (!token) return;
    const client = getSupabaseBrowserClient();
    const channel = client
      .channel("operator-live-auction-bids")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "auction_bids" },
        (payload) => {
          const productId = typeof payload.new.product_id === "string"
            ? payload.new.product_id
            : null;
          setFlashedProductId(productId);
          void load();
          window.setTimeout(() => setFlashedProductId((current) => current === productId ? null : current), 900);
        },
      )
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [load, token]);
  const active = useMemo(() => products.filter((product) => product.status === "active"), [products]);
  const remaining = (closesAt: string) => {
    const diff = Math.max(0, new Date(closesAt).getTime() - now);
    const hours = Math.floor(diff / 3_600_000);
    const minutes = Math.floor((diff % 3_600_000) / 60_000);
    const seconds = Math.floor((diff % 60_000) / 1_000);
    return diff === 0 ? "마감" : `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  };

  return <div className="space-y-8">
    <SectionHeading
      action={<button className="inline-flex h-10 items-center gap-2 border border-line px-4 text-xs font-bold disabled:opacity-40" disabled={!token || loading} onClick={() => void load()} type="button"><RefreshCw size={14} />새로고침</button>}
      description="진행 중인 경매의 입찰 흐름을 확인하고 연장·마감·부정 입찰 조치를 실행합니다."
      eyebrow="운영자 / 라이브 관제"
      title="실시간 경매 운영"
      variant="page"
    />
    {notice && <StatusNotice>{notice}</StatusNotice>}
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="border border-line p-5"><Radio size={17} /><p className="mt-7 text-xs text-muted">진행 중</p><p className="mt-2 font-mono text-3xl font-bold">{active.length}</p></div>
      <div className="border border-line p-5"><Clock3 size={17} /><p className="mt-7 text-xs text-muted">예정·대기</p><p className="mt-2 font-mono text-3xl font-bold">{products.filter((product) => product.status === "pending").length}</p></div>
      <div className="border border-line bg-ink p-5 text-paper"><Gavel size={17} /><p className="mt-7 text-xs text-zinc-400">전체 경매 상품</p><p className="mt-2 font-mono text-3xl font-bold">{products.length}</p></div>
    </div>
    <div className="grid gap-3 md:hidden">
      {active.map((product) => <article className="w-full max-w-full overflow-hidden break-keep rounded-2xl border border-line bg-paper p-4" key={product.id}>
        <div className="flex min-w-0 gap-3"><CatalogImage alt="" className="size-16 shrink-0 rounded-xl object-cover" src={product.image_urls?.[0] ?? ""} /><div className="min-w-0 flex-1"><strong className="line-clamp-2 text-sm">{product.title}</strong><p className="mt-1 text-[11px] text-muted">{product.stores?.name ?? "소속 센터"}</p></div></div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className={`rounded-xl p-2 transition-colors ${flashedProductId === product.id ? "bg-amber-200" : "bg-surface"}`}><span className="block text-[10px] text-muted">현재 최고가</span><strong className="mt-1 block font-mono text-xs">{product.current_price.toLocaleString("ko-KR")}원</strong></div><div className="rounded-xl bg-surface p-2"><span className="block text-[10px] text-muted">입찰</span><strong className="mt-1 block font-mono text-xs">{product.bid_count ?? 0}회</strong></div><div className="rounded-xl bg-surface p-2"><span className="block text-[10px] text-muted">남은 시간</span><strong className="mt-1 block font-mono text-xs">{remaining(product.closes_at)}</strong></div></div>
        <div className="mt-3 flex min-h-11 items-center justify-end text-[10px] font-bold text-muted">모니터링 전용</div>
      </article>)}
      {!loading && active.length === 0 && <p className="py-16 text-center text-sm text-muted">현재 진행 중인 경매가 없습니다.</p>}
    </div>
    <div className="hidden overflow-x-auto border border-line md:block">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead className="border-b border-line bg-surface text-[10px] text-muted"><tr><th className="px-4 py-4">경매 상품</th><th>센터</th><th className="text-right">현재가</th><th className="text-right">마감 시각</th><th className="px-4 text-right">관제</th></tr></thead>
        <tbody className="divide-y divide-line">{active.map((product) => <tr key={product.id}><td className="px-4 py-3"><div className="flex items-center gap-3"><CatalogImage alt="" className="size-12 object-cover" src={product.image_urls?.[0] ?? ""} /><strong className="max-w-[280px] truncate">{product.title}</strong></div></td><td>{product.stores?.name ?? "소속 센터"}</td><td className={`text-right font-mono font-bold transition-colors ${flashedProductId === product.id ? "bg-amber-200 text-ink" : ""}`}>{product.current_price.toLocaleString("ko-KR")}원<br /><span className="text-[10px] font-normal text-muted">{product.bid_count ?? 0}회</span></td><td className="text-right font-mono text-muted">{remaining(product.closes_at)}</td><td className="px-4 text-right text-[10px] font-bold text-muted">모니터링 전용</td></tr>)}</tbody>
      </table>
      {!loading && active.length === 0 && <p className="py-16 text-center text-sm text-muted">현재 진행 중인 경매가 없습니다.</p>}
    </div>
  </div>;
}
