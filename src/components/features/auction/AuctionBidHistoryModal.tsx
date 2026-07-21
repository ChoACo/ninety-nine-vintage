"use client";

import { X } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
import { isActiveAuctionBid, type PublicAuctionBid } from "@/components/features/auction/auctionFeedLogic";

export type { PublicAuctionBid } from "@/components/features/auction/auctionFeedLogic";

interface AuctionBidHistoryModalProps {
  history: readonly PublicAuctionBid[];
  itemTitle: string;
  onClose: () => void;
  open: boolean;
}

function formatBidTime(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "시각 확인 중";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  }).format(timestamp);
}

export function AuctionBidHistoryModal({
  history,
  itemTitle,
  onClose,
  open,
}: AuctionBidHistoryModalProps) {
  const latestFirst = useMemo(
    () => [...history].sort((a, b) => Date.parse(b.bidAt) - Date.parse(a.bidAt)),
    [history],
  );
  const latestActiveId = latestFirst.find(isActiveAuctionBid)?.id;

  return (
    <PremiumDialog labelledBy="auction-bid-history-title" onClose={onClose} open={open} panelClassName="flex max-w-2xl flex-col">
        <header className="flex items-start justify-between gap-6 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-[0.14em] text-muted">공개 입찰 원장 · 읽기 전용</p>
            <h2 className="mt-2 text-xl font-black tracking-[-0.04em]" id="auction-bid-history-title">입찰 현황</h2>
            <p className="mt-2 truncate text-xs text-muted">{itemTitle}</p>
          </div>
          <button aria-label="입찰 현황 닫기" className="grid size-10 shrink-0 place-items-center rounded-xl text-muted transition-all duration-300 hover:-translate-y-0.5 hover:bg-surface hover:text-ink active:scale-95" onClick={onClose} type="button"><X size={19} /></button>
        </header>

        <div className="min-h-0 overflow-y-auto px-6 py-5">
          <div className="rounded-2xl border border-white/10 bg-surface px-4 py-3 text-xs leading-5 text-muted shadow-sm">
            서버 입찰 원장을 최신순으로 표시합니다. 이 화면에서는 입찰 기록을 수정하거나 삭제할 수 없습니다.
          </div>

          {latestFirst.length > 0 ? (
            <ol aria-label="최신순 입찰 기록" className="mt-5 divide-y divide-line border-y border-line">
              {latestFirst.map((bid) => {
                const cancelled = !isActiveAuctionBid(bid);
                const outcomeLabel = bid.outcome === "unpaid_cancelled" ? "미결제로 무효" : "입찰 취소";
                return (
                <li className={`flex items-start justify-between gap-5 py-4 ${cancelled ? "text-muted" : ""}`} key={bid.id}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <strong className="break-all text-sm">{bid.bidderName || "회원"}</strong>
                      {cancelled
                        ? <span className="rounded-lg border border-zinc-300 bg-zinc-100 px-2 py-1 text-[9px] font-bold text-zinc-600">{outcomeLabel}</span>
                        : bid.id === latestActiveId && <span className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-[9px] font-bold text-emerald-800">최신 유효 입찰</span>}
                    </div>
                    <time className="mt-1 block font-mono text-[10px] text-muted" dateTime={bid.bidAt}>{formatBidTime(bid.bidAt)}</time>
                  </div>
                  <strong className={`shrink-0 font-mono text-base tabular-nums ${cancelled ? "line-through" : ""}`}>{bid.amount.toLocaleString("ko-KR")}원</strong>
                </li>
                );
              })}
            </ol>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-line px-5 py-12 text-center">
              <p className="text-sm font-bold">아직 입찰 기록이 없습니다.</p>
              <p className="mt-2 text-xs text-muted">첫 입찰이 서버에 저장되면 이곳에 표시됩니다.</p>
            </div>
          )}
        </div>

        <footer className="border-t border-line px-6 py-4 text-right">
          <Button onClick={onClose} type="button" variant="outline">닫기</Button>
        </footer>
    </PremiumDialog>
  );
}
