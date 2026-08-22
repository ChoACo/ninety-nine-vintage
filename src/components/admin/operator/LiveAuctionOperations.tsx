"use client";

import { Clock3, Gavel, RefreshCw, Radio } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AuctionController } from "@/components/admin/operator/AuctionController";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusNotice } from "@/components/ui/StatusNotice";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

interface AuctionProduct {
  id: string;
  title: string;
  current_price: number;
  closes_at: string;
  image_urls: string[];
  sale_type: string;
  status: string;
  stores?: { name: string } | null;
}

export function LiveAuctionOperations() {
  const { session } = useSupabaseSession();
  const token = session?.access_token ?? null;
  const [products, setProducts] = useState<AuctionProduct[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

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
  const active = useMemo(() => products.filter((product) => product.status === "active"), [products]);

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
    <div className="overflow-x-auto border border-line">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead className="border-b border-line bg-surface text-[10px] text-muted"><tr><th className="px-4 py-4">경매 상품</th><th>센터</th><th className="text-right">현재가</th><th className="text-right">마감 시각</th><th className="px-4 text-right">관제</th></tr></thead>
        <tbody className="divide-y divide-line">{active.map((product) => <tr key={product.id}><td className="px-4 py-3"><div className="flex items-center gap-3"><CatalogImage alt="" className="size-12 object-cover" src={product.image_urls?.[0] ?? ""} /><strong className="max-w-[280px] truncate">{product.title}</strong></div></td><td>{product.stores?.name ?? "소속 센터"}</td><td className="text-right font-mono font-bold">{product.current_price.toLocaleString("ko-KR")}원</td><td className="text-right font-mono text-muted">{new Date(product.closes_at).toLocaleString("ko-KR")}</td><td className="px-4 text-right"><AuctionController onChanged={() => void load()} productId={product.id} title={product.title} /></td></tr>)}</tbody>
      </table>
      {!loading && active.length === 0 && <p className="py-16 text-center text-sm text-muted">현재 진행 중인 경매가 없습니다.</p>}
    </div>
  </div>;
}
