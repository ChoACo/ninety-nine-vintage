"use client";

import { Ban, Clock3, Gavel, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { PremiumDialog } from "@/components/ui/PremiumDialog";

interface Bid { id: string; bidder_id: string; bidder_display_name: string; amount: number; created_at: string; is_final: boolean }
type Action = "extend_10" | "extend_30" | "close_now" | "cancel_bid" | "block_bidder";

export function AuctionController({ productId, title, onChanged }: { productId: string; title: string; onChanged: () => void }) {
  const { session } = useSupabaseSession();
  const token = session?.access_token;
  const [open, setOpen] = useState(false);
  const [bids, setBids] = useState<Bid[]>([]);
  const [product, setProduct] = useState<{ current_price: number; closes_at: string } | null>(null);
  const [pending, setPending] = useState<{ action: Action; bid?: Bid } | null>(null);
  const [reason, setReason] = useState("");
  const [blockMinutes, setBlockMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    const response = await fetch(`/api/admin/operator/auctions/live/${productId}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const payload = await response.json().catch(() => null) as { product?: { current_price: number; closes_at: string }; bids?: Bid[]; message?: string } | null;
    if (!response.ok || !payload?.product) { setNotice(payload?.message ?? "경매 현황을 불러오지 못했습니다."); return; }
    setProduct(payload.product); setBids(payload.bids ?? []);
  }, [productId, token]);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => void load());
    const channel = getSupabaseBrowserClient().channel(`admin-auction:${productId}`).on("postgres_changes", { event: "*", schema: "public", table: "auction_bids", filter: `product_id=eq.${productId}` }, () => void load()).subscribe();
    return () => { void getSupabaseBrowserClient().removeChannel(channel); };
  }, [load, open, productId]);

  const run = async () => {
    if (!token || !pending || busy || reason.trim().length < 2) return;
    setBusy(true); setNotice("");
    const response = await fetch(`/api/admin/operator/auctions/live/${productId}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: pending.action, bidId: pending.bid?.id, bidderId: pending.bid?.bidder_id, reason: reason.trim(), blockMinutes }) });
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    setBusy(false);
    if (!response.ok) { setNotice(payload?.message ?? "경매 작업을 완료하지 못했습니다."); return; }
    setPending(null); setReason(""); setNotice("작업을 완료하고 감사 기록에 남겼습니다."); await load(); onChanged();
  };

  const choose = (action: Action, bid?: Bid) => { setPending({ action, bid }); setReason(""); setNotice(""); };
  return <>
    <button className="inline-flex items-center gap-1 font-bold underline" onClick={() => setOpen(true)} type="button"><Gavel size={13} /> 실시간 제어</button>
    <PremiumDialog ariaLabel="실시간 경매 제어" labelledBy="auction-controller-title" onClose={() => setOpen(false)} open={open} panelClassName="max-w-4xl">
      <div className="p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5"><div><p className="eyebrow text-muted">Live auction operations</p><h2 className="mt-2 text-xl font-black" id="auction-controller-title">{title}</h2><p className="mt-2 text-xs text-muted">현재가 {product?.current_price.toLocaleString("ko-KR") ?? "—"}원 · 마감 {product ? new Date(product.closes_at).toLocaleString("ko-KR") : "—"}</p></div><div className="flex flex-wrap gap-2"><button className="border border-line px-3 py-2 text-xs font-bold" onClick={() => choose("extend_10")} type="button">+10분 연장</button><button className="border border-line px-3 py-2 text-xs font-bold" onClick={() => choose("extend_30")} type="button">+30분 연장</button><button className="border border-red-600 bg-red-600 px-3 py-2 text-xs font-bold text-white" onClick={() => choose("close_now")} type="button">즉시 마감·정산</button></div></div>
      {notice && <p className="mt-4 border border-line bg-surface p-3 text-xs font-bold" role="status">{notice}</p>}
      <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead className="border-b border-line text-[10px] text-muted"><tr><th className="py-3">순위</th><th>참여자</th><th>입찰액</th><th>시각</th><th className="text-right">조치</th></tr></thead><tbody className="divide-y divide-line">{bids.map((bid, index) => <tr className={index === 0 ? "bg-emerald-500/10" : ""} key={bid.id}><td className="py-3 font-mono">{index + 1}</td><td>{bid.bidder_display_name}</td><td className="font-mono font-bold">{bid.amount.toLocaleString("ko-KR")}원</td><td>{new Date(bid.created_at).toLocaleTimeString("ko-KR")}</td><td><div className="flex justify-end gap-3"><button className="inline-flex items-center gap-1 underline" onClick={() => choose("cancel_bid", bid)} type="button"><RotateCcw size={12} />입찰 취소</button><button className="inline-flex items-center gap-1 text-red-700 underline" onClick={() => choose("block_bidder", bid)} type="button"><Ban size={12} />입찰 차단</button></div></td></tr>)}</tbody></table>{bids.length === 0 && <p className="py-12 text-center text-xs text-muted">아직 입찰 기록이 없습니다.</p>}</div>
      {pending && <section className="mt-5 border border-ink bg-surface p-4"><p className="flex items-center gap-2 text-xs font-black"><Clock3 size={14} />2단계 확인 · {pending.action === "close_now" ? "즉시 마감" : pending.action === "cancel_bid" ? "입찰 취소" : pending.action === "block_bidder" ? "사용자 입찰 차단" : pending.action === "extend_30" ? "30분 연장" : "10분 연장"}</p>{pending.action === "block_bidder" && <select className="mt-3 h-10 border border-line bg-paper px-3 text-xs" onChange={(event) => setBlockMinutes(Number(event.target.value))} value={blockMinutes}><option value={30}>30분</option><option value={60}>1시간</option><option value={180}>3시간</option><option value={1440}>24시간</option></select>}<textarea className="mt-3 min-h-20 w-full border border-line bg-paper p-3 text-xs" maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="감사 기록에 남길 사유를 2자 이상 입력" value={reason} /><div className="mt-3 flex justify-end gap-2"><button className="border border-line px-4 py-2 text-xs font-bold" onClick={() => setPending(null)} type="button">취소</button><button className="bg-ink px-4 py-2 text-xs font-bold text-paper disabled:opacity-40" disabled={busy || reason.trim().length < 2} onClick={() => void run()} type="button">{busy ? "처리 중…" : "확인 후 실행"}</button></div></section>}
      </div>
    </PremiumDialog>
  </>;
}
