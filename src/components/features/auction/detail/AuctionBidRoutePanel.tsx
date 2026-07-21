"use client";

import { Gavel, Lightbulb, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { formatProductDisplayNumber } from "@/lib/productDisplayNumber";

interface AuctionBidRoutePanelProps {
  bidIncrement: number;
  currentPrice: number;
  minimumBid: number;
  productId: string;
  productTitle: string;
}

export function AuctionBidRoutePanel({ bidIncrement, currentPrice, minimumBid, productId, productTitle }: AuctionBidRoutePanelProps) {
  const { loading, session } = useSupabaseSession();
  const [amount, setAmount] = useState(String(minimumBid));
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const submit = async () => {
    if (busy) return;
    const numericAmount = Number(amount);
    if (!Number.isSafeInteger(numericAmount) || numericAmount < minimumBid) {
      setMessage({ kind: "error", text: `최소 입찰가는 ${minimumBid.toLocaleString("ko-KR")}원입니다.` });
      return;
    }
    if (!agreed) {
      setMessage({ kind: "error", text: "입찰·결제 규칙을 확인하고 동의해 주세요." });
      return;
    }
    if (!session?.access_token) {
      setMessage({ kind: "error", text: "카카오 회원 로그인 후 입찰할 수 있습니다." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auction/bids", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: numericAmount, productId }),
      });
      const payload = await response.json().catch(() => null) as { bid?: { currentPrice?: number; isFinal?: boolean }; error?: string } | null;
      if (!response.ok || !payload?.bid) throw new Error(payload?.error ?? "입찰을 저장하지 못했습니다.");
      setAmount(String(Number(payload.bid.currentPrice ?? numericAmount) + bidIncrement));
      setAgreed(false);
      setMessage({ kind: "success", text: payload.bid.isFinal ? "첫 입찰이 즉시 낙찰로 확정되었습니다." : "입찰이 완료되었습니다. 현재가가 실시간으로 갱신됩니다." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "입찰을 저장하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-xl">
      <div className="border-b border-ink pb-5">
        <p className="text-[10px] font-bold tracking-[0.14em] text-muted">{formatProductDisplayNumber(productId)}</p>
        <h1 className="mt-3 text-2xl font-black tracking-[-0.05em]">실시간 경매 입찰</h1>
        <p className="mt-2 truncate text-sm text-muted">{productTitle}</p>
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden border border-line bg-line text-sm">
        <div className="bg-paper p-4"><dt className="text-xs text-muted">현재 최고 입찰가</dt><dd className="mt-2 font-mono text-lg font-bold">{currentPrice.toLocaleString("ko-KR")}원</dd></div>
        <div className="bg-paper p-4"><dt className="text-xs text-muted">최소 입찰가</dt><dd className="mt-2 font-mono text-lg font-bold">{minimumBid.toLocaleString("ko-KR")}원</dd></div>
      </dl>
      <label className="mt-6 block text-xs font-bold" htmlFor={`route-bid-${productId}`}>입찰 금액</label>
      <div className="mt-2 flex h-13 items-center border border-ink px-4">
        <input className="min-w-0 flex-1 bg-transparent font-mono text-lg font-bold outline-none" disabled={busy || loading || !session} id={`route-bid-${productId}`} inputMode="numeric" min={minimumBid} onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))} step={bidIncrement} value={amount} />
        <span className="text-sm font-bold">원</span>
      </div>
      <label className="mt-4 flex items-start gap-3 border border-line bg-surface p-4 text-xs leading-5"><input checked={agreed} className="mt-1 accent-ink" disabled={busy || !session} onChange={(event) => setAgreed(event.target.checked)} type="checkbox" /><span>낙찰 후 안내된 결제 기한과 미결제 시 차순위 전환 규칙을 확인했습니다. 입찰은 취소할 수 없습니다.</span></label>
      <details className="mt-4 border border-line bg-paper p-4">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-bold"><Lightbulb size={15} /> 실시간 경매 입찰 가이드</summary>
        <ul className="mt-4 space-y-2 text-xs leading-5 text-muted"><li>• 서버의 절대 시간을 기준으로 마감합니다.</li><li>• 마감 3분 이내의 유효 입찰은 남은 시간을 다시 3분으로 연장합니다.</li><li>• 연장전에는 이미 참여한 회원만 추가 입찰할 수 있습니다.</li><li>• 낙찰 후 결제하지 않으면 낙찰이 취소되고 차순위 회원에게 구매 기회가 넘어갈 수 있습니다.</li><li>• 미결제 경고가 누적되면 입찰이 제한될 수 있습니다.</li></ul>
      </details>
      {message && <p aria-live="polite" className={`mt-4 border px-4 py-3 text-xs font-bold leading-5 ${message.kind === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{message.text}</p>}
      {!loading && !session ? <Link className="mt-5 flex h-13 w-full items-center justify-center bg-[#FEE500] text-sm font-bold text-[#191919]" href={`/account/login?next=${encodeURIComponent(`/auction/${productId}/bid`)}`}>카카오 로그인 후 입찰</Link> : <button className="mt-5 flex h-13 w-full items-center justify-center gap-2 bg-ink text-sm font-bold text-paper disabled:opacity-40" disabled={busy || loading || !session} onClick={() => void submit()} type="button">{busy ? <><LockKeyhole size={16} /> 서버에 저장 중</> : <><Gavel size={16} /> 입찰하기</>}</button>}
    </section>
  );
}
