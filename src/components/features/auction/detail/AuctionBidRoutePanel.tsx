"use client";

import { Gavel, Lightbulb, LockKeyhole, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { formatProductDisplayNumber } from "@/lib/productDisplayNumber";
import { Button } from "@/components/ui/Button";
import { PremiumDialog } from "@/components/ui/PremiumDialog";

interface AuctionBidRoutePanelProps {
  basePath?: "" | "/m";
  bidIncrement: number;
  currentPrice: number;
  minimumBid: number;
  productId: string;
  productTitle: string;
}

export function AuctionBidRoutePanel({ basePath = "", bidIncrement, currentPrice, minimumBid, productId, productTitle }: AuctionBidRoutePanelProps) {
  const surface = basePath === "/m" ? "mobile" : "desktop";
  const { loading, session } = useSupabaseSession();
  const [amount, setAmount] = useState(String(minimumBid));
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const requestConfirmation = () => {
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
    setMessage(null);
    setConfirmOpen(true);
  };

  const submit = async () => {
    if (busy) return;
    const numericAmount = Number(amount);
    if (!Number.isSafeInteger(numericAmount) || numericAmount < minimumBid || !agreed || !session?.access_token) {
      setConfirmOpen(false);
      setMessage({ kind: "error", text: "입찰 조건이 변경되었습니다. 금액과 동의 상태를 다시 확인해 주세요." });
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
      setConfirmOpen(false);
      setMessage({ kind: "success", text: payload.bid.isFinal ? "첫 입찰이 즉시 낙찰로 확정되었습니다." : "입찰이 완료되었습니다. 현재가가 실시간으로 갱신됩니다." });
      window.dispatchEvent(new Event("ninety-nine:close-route-modal"));
    } catch (error) {
      setConfirmOpen(false);
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "입찰을 저장하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <section className={`mx-auto w-full max-w-xl rounded-3xl border border-white/10 bg-paper shadow-xl shadow-black/5 ${surface === "desktop" ? "p-3" : "p-1"}`}>
      <div className="border-b border-ink pb-5">
        <p className="text-[10px] font-bold tracking-[0.14em] text-muted">{formatProductDisplayNumber(productId)}</p>
        <h1 className="mt-3 text-2xl font-black tracking-[-0.05em]">실시간 경매 입찰</h1>
        <p className="mt-2 truncate text-sm text-muted">{productTitle}</p>
      </div>
      <dl className={`mt-6 grid gap-px overflow-hidden rounded-2xl border border-line bg-line text-sm ${surface === "desktop" ? "grid-cols-2" : "grid-cols-1"}`}>
        <div className="bg-paper p-4"><dt className="text-xs text-muted">현재 최고 입찰가</dt><dd className="mt-2 font-mono text-lg font-bold tracking-tight">{currentPrice.toLocaleString("ko-KR")}원</dd></div>
        <div className="bg-paper p-4"><dt className="text-xs text-muted">최소 입찰가</dt><dd className="mt-2 font-mono text-lg font-bold tracking-tight">{minimumBid.toLocaleString("ko-KR")}원</dd></div>
      </dl>
      <label className="mt-6 block text-xs font-bold" htmlFor={`route-bid-${productId}`}>입찰 금액</label>
      <div className="mt-2 flex h-13 items-center rounded-2xl border border-ink px-2 shadow-sm transition-all duration-300 focus-within:ring-4 focus-within:ring-black/5">
        <button aria-label={`입찰 금액 ${bidIncrement.toLocaleString("ko-KR")}원 줄이기`} className="grid size-10 shrink-0 place-items-center rounded-xl border border-line text-lg font-bold disabled:opacity-35" disabled={busy || loading || !session || Number(amount) <= minimumBid} onClick={() => setAmount(String(Math.max(minimumBid, Number(amount || minimumBid) - bidIncrement)))} type="button">−</button>
        <input className="min-w-0 flex-1 bg-transparent font-mono text-lg font-bold outline-none" disabled={busy || loading || !session} id={`route-bid-${productId}`} inputMode="numeric" min={minimumBid} onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))} step={bidIncrement} value={amount} />
        <span className="text-sm font-bold">원</span>
        <button aria-label={`입찰 금액 ${bidIncrement.toLocaleString("ko-KR")}원 늘리기`} className="ml-2 grid size-10 shrink-0 place-items-center rounded-xl border border-line text-lg font-bold disabled:opacity-35" disabled={busy || loading || !session} onClick={() => setAmount(String(Math.max(minimumBid, Number(amount || minimumBid)) + bidIncrement))} type="button">+</button>
      </div>
      <label className="mt-4 flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-xs leading-relaxed shadow-sm"><input checked={agreed} className="mt-1 accent-ink" disabled={busy || !session} onChange={(event) => setAgreed(event.target.checked)} type="checkbox" /><span>낙찰 후 안내된 결제 기한과 미결제 시 차순위 전환 규칙을 확인했습니다. 입찰은 취소할 수 없습니다.</span></label>
      <details className="mt-4 rounded-2xl border border-line bg-paper p-4 shadow-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-bold"><Lightbulb size={15} /> 실시간 경매 입찰 가이드</summary>
        <ul className="mt-4 space-y-2 text-xs leading-5 text-muted"><li>• 서버의 절대 시간을 기준으로 마감합니다.</li><li>• 마감 3분 이내의 유효 입찰은 남은 시간을 다시 3분으로 연장합니다.</li><li>• 연장전에는 이미 참여한 회원만 추가 입찰할 수 있습니다.</li><li>• 낙찰 후 결제하지 않으면 낙찰이 취소되고 차순위 회원에게 구매 기회가 넘어갈 수 있습니다.</li><li>• 미결제 경고가 누적되면 입찰이 제한될 수 있습니다.</li></ul>
      </details>
      {message && <p aria-live="polite" className={`mt-4 rounded-2xl border px-4 py-3 text-xs font-bold leading-5 shadow-sm ${message.kind === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{message.text}</p>}
      {!loading && !session ? <Link className="mt-5 flex h-13 w-full items-center justify-center rounded-2xl bg-[#FEE500] text-sm font-bold text-[#191919] shadow-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-xl active:scale-95" href={`${basePath}/account/login?next=${encodeURIComponent(`${basePath}/auction/${productId}/bid`)}`}>카카오 로그인 후 입찰</Link> : <button className="mt-5 flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-ink text-sm font-bold text-paper shadow-lg shadow-black/10 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl active:scale-95 disabled:opacity-40" disabled={busy || loading || !session} onClick={requestConfirmation} type="button">{busy ? <><LockKeyhole size={16} /> 서버에 저장 중</> : <><Gavel size={16} /> 입찰 내용 확인</>}</button>}
    </section>
    <PremiumDialog closeDisabled={busy} labelledBy="bid-final-confirm-title" onClose={() => setConfirmOpen(false)} open={confirmOpen} panelClassName="max-w-lg">
      <header className="flex items-start justify-between gap-6 border-b border-line px-6 py-5">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-bold tracking-[0.14em] text-muted"><ShieldCheck size={13} /> 최종 확인 · 서버 저장 전</p>
          <h2 className="mt-2 text-xl font-black leading-snug tracking-tight" id="bid-final-confirm-title">이 금액으로 입찰할까요?</h2>
          <p className="mt-2 truncate text-xs text-muted">{productTitle}</p>
        </div>
        <button aria-label="입찰 최종 확인 닫기" className="grid size-10 shrink-0 place-items-center rounded-xl text-muted transition-all duration-300 hover:-translate-y-0.5 hover:bg-surface hover:text-ink active:scale-95 disabled:opacity-40" disabled={busy} onClick={() => setConfirmOpen(false)} type="button"><X size={19} /></button>
      </header>
      <div className="p-6">
        <div className="rounded-2xl border border-white/10 bg-zinc-950 p-5 text-white shadow-xl shadow-black/15">
          <p className="text-[10px] font-bold tracking-[0.12em] text-zinc-400">최종 입찰 금액</p>
          <p className="mt-2 font-mono text-3xl font-black tracking-tight">{Number(amount || 0).toLocaleString("ko-KR")}원</p>
        </div>
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-relaxed text-amber-900">입찰은 제출 후 취소할 수 없으며, 낙찰 시 안내된 기한 안에 결제해야 합니다.</p>
        <div className="mt-6 grid grid-cols-2 gap-2"><Button disabled={busy} onClick={() => setConfirmOpen(false)} type="button">금액 다시 보기</Button><Button disabled={busy} onClick={() => void submit()} type="button" variant="primary">{busy ? "서버에 저장 중" : "동의하고 최종 입찰"}</Button></div>
      </div>
    </PremiumDialog>
    </>
  );
}
