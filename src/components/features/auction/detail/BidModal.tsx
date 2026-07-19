"use client";

import { useState } from "react";
import { LockKeyhole, X } from "lucide-react";

interface BidModalProps {
  open: boolean;
  currentPrice: number;
  onClose: () => void;
  onSubmit: (amount: number) => void | Promise<unknown>;
}

export function BidModal({ open, currentPrice, onClose, onSubmit }: BidModalProps) {
  const minimumBid = currentPrice + 1000;
  const [amount, setAmount] = useState(String(minimumBid));
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const submitBid = async () => {
    const numericAmount = Number(amount.replace(/,/g, ""));
    if (!Number.isFinite(numericAmount) || numericAmount < minimumBid) {
      setError(`최소 입찰가는 ${minimumBid.toLocaleString("ko-KR")} KRW입니다.`);
      return;
    }
    if (!agreed) {
      setError("경매 입찰 규칙과 결제 조건에 동의해 주세요.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await onSubmit(numericAmount);
      setSubmitted(true);
      window.setTimeout(onClose, 900);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "입찰을 저장하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/60" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div aria-labelledby="bid-modal-title" aria-modal="true" className="w-[440px] border border-zinc-200 bg-white p-7 text-zinc-950 shadow-2xl" role="dialog">
        <div className="flex items-start justify-between border-b border-zinc-200 pb-5">
          <div>
            <p className="mb-2 text-[10px] font-bold tracking-[0.14em] text-zinc-500">LIVE AUCTION / LOT</p>
            <h2 className="text-lg font-black tracking-[-0.04em]" id="bid-modal-title">실시간 경매 입찰</h2>
          </div>
          <button aria-label="입찰 모달 닫기" className="text-zinc-400 transition-colors hover:text-zinc-950" onClick={onClose} type="button"><X size={18} /></button>
        </div>

        {submitted ? (
          <div className="py-14 text-center">
            <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-950 text-white">✓</div>
            <p className="text-sm font-bold">입찰이 성공적으로 완료되었습니다.</p>
          </div>
        ) : (
          <div className="pt-6">
            <div className="mb-5 flex items-center justify-between bg-zinc-50 px-4 py-3 text-xs">
              <span className="text-zinc-500">현재 입찰가</span>
              <strong className="font-mono">{currentPrice.toLocaleString("ko-KR")} KRW</strong>
            </div>
            <label className="block text-xs font-bold" htmlFor="bid-amount">입찰가 입력</label>
            <div className="mt-2 flex items-center border-b-2 border-zinc-950 py-2">
              <input autoFocus className="w-full bg-transparent font-mono text-xl font-bold outline-none" id="bid-amount" inputMode="numeric" onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))} value={Number(amount).toLocaleString("ko-KR")} />
              <span className="text-xs font-bold">KRW</span>
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">최소 입찰 단위 1,000 KRW</p>
            <label className="mt-6 flex cursor-pointer items-start gap-2 text-xs text-zinc-600">
              <input checked={agreed} className="mt-0.5 accent-zinc-950" onChange={(event) => setAgreed(event.target.checked)} type="checkbox" />
              <span>경매 입찰 규칙 및 낙찰 후 결제 조건을 확인했으며 동의합니다.</span>
            </label>
            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
            <button className="mt-6 flex h-12 w-full items-center justify-center gap-2 bg-zinc-950 text-sm font-bold text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={submitting} onClick={submitBid} type="button">
              <LockKeyhole size={14} /> {submitting ? "입찰 저장 중..." : "최종 입찰하기"}
            </button>
            <p className="mt-3 text-center text-[10px] text-zinc-400">입찰 확정 후에는 취소 및 변경이 제한됩니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}
