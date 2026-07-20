"use client";

import { RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { CatalogImage } from "@/components/ui/CatalogImage";

interface PastProduct {
  id: string;
  title: string;
  current_price: number;
  image_urls: string[];
  store_id: string | null;
  past_at: string | null;
  past_expires_at: string | null;
  stores?: { name: string } | null;
}

export function OperatorPastProductsConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [products, setProducts] = useState<PastProduct[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (accessToken: string | null) => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const response = await fetch("/api/operator/products/past", { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const payload = await response.json() as { products?: PastProduct[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "지난 상품을 불러오지 못했습니다.");
      setProducts(payload.products ?? []);
      setSelected((current) => current.filter((id) => (payload.products ?? []).some((product) => product.id === id)));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "지난 상품을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
      setToken(session?.access_token ?? null);
      await load(session?.access_token ?? null);
    })().catch((error) => setNotice(error instanceof Error ? error.message : "운영자 세션을 확인하지 못했습니다."));
  }, [load]);

  const allSelected = products.length > 0 && selected.length === products.length;
  const expiryLabel = useMemo(() => (value: string | null) => value ? new Date(value).toLocaleString("ko-KR") : "-", []);

  const toggleAll = () => setSelected(allSelected ? [] : products.map((product) => product.id));
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const act = async (action: "relist" | "delete") => {
    if (!token || busy || selected.length === 0) return;
    if (action === "delete" && !window.confirm(`${selected.length}개 지난 상품을 삭제할까요? 입찰·주문 이력이 있으면 보존됩니다.`)) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/operator/products/past", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ productIds: selected, action }),
      });
      const payload = await response.json() as { error?: string; result?: { processed_count?: number; skipped_count?: number } };
      if (!response.ok) throw new Error(payload.error ?? "지난 상품을 처리하지 못했습니다.");
      setNotice(`${payload.result?.processed_count ?? 0}개 처리 완료 · ${payload.result?.skipped_count ?? 0}개 보존 또는 건너뜀`);
      await load(token);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "지난 상품을 처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="space-y-8">
    <div className="flex items-end justify-between border-b border-ink pb-6">
      <div><p className="eyebrow text-muted">OPERATOR / PAST AUCTIONS</p><h1 className="mt-3 text-4xl font-black tracking-[-.08em]">지난 상품</h1><p className="mt-3 text-sm text-muted">7일이 지난 미낙찰 경매는 최대 3일 동안 이곳에서 재등록하거나 삭제할 수 있습니다.</p></div>
      <button className="flex items-center gap-2 border border-line px-4 py-3 text-xs font-bold" disabled={loading} onClick={() => void load(token)} type="button"><RefreshCw size={13} /> 새로고침</button>
    </div>
    {notice && <div aria-live="polite" className="border border-line bg-surface px-4 py-3 text-xs">{notice}</div>}
    <div className="flex items-center justify-between border-y border-line py-4 text-xs">
      <label className="flex items-center gap-2 font-bold"><input checked={allSelected} onChange={toggleAll} type="checkbox" /> 전체 선택 <span className="text-muted">({selected.length}/{products.length})</span></label>
      <div className="flex gap-2"><button className="flex items-center gap-2 border border-ink px-3 py-2 font-bold disabled:opacity-40" disabled={busy || selected.length === 0} onClick={() => void act("relist")} type="button"><RotateCcw size={13} /> 선택 재등록</button><button className="flex items-center gap-2 border border-red-300 px-3 py-2 font-bold text-red-700 disabled:opacity-40" disabled={busy || selected.length === 0} onClick={() => void act("delete")} type="button"><Trash2 size={13} /> 선택 삭제</button></div>
    </div>
    <div className="divide-y divide-line border-y border-line">{products.map((product) => <label className="flex cursor-pointer items-center gap-4 px-4 py-5" key={product.id}><input checked={selected.includes(product.id)} onChange={() => toggle(product.id)} type="checkbox" /><CatalogImage alt="" className="size-16 object-cover" src={product.image_urls?.[0] ?? ""} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{product.title}</span><span className="mt-1 block text-xs text-muted">{product.stores?.name ?? "미지정 숍"} · {product.current_price.toLocaleString("ko-KR")}원</span></span><span className="text-right text-[10px] text-muted"><span className="block">지난 시각 {expiryLabel(product.past_at)}</span><span className="mt-1 block text-amber-700">자동 삭제 {expiryLabel(product.past_expires_at)}</span></span></label>)}{products.length === 0 && <div className="py-20 text-center text-sm text-muted">현재 처리할 지난 상품이 없습니다.</div>}</div>
  </div>;
}
