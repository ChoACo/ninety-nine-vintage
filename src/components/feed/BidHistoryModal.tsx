"use client";

import { useMemo } from "react";
import Modal from "@/src/components/common/Modal";
import type { AuctionPost } from "@/src/types/auction";
import { formatKRW } from "@/src/utils/formatters";

export interface BidHistoryModalProps {
  open: boolean;
  itemTitle: string;
  history: AuctionPost["bidHistory"];
  onClose: () => void;
}

function formatBidTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export default function BidHistoryModal({
  open,
  itemTitle,
  history,
  onClose,
}: BidHistoryModalProps) {
  const latestFirstHistory = useMemo(
    () =>
      [...history].sort(
        (a, b) => new Date(b.bidAt).getTime() - new Date(a.bidAt).getTime(),
      ),
    [history],
  );
  const latestActiveBidId = latestFirstHistory.find(
    (bid) => (bid.outcome ?? "active") === "active",
  )?.id;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="입찰 현황"
      description={`‘${itemTitle}’의 전체 입찰 기록을 최신순으로 확인합니다.`}
      size="md"
      className="max-sm:absolute max-sm:bottom-0 max-sm:max-h-[92dvh] max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0"
    >
      <div className="p-5 sm:p-6">
        <div className="border-l-2 border-[var(--info-text)] bg-[var(--info-surface)] px-4 py-3">
          <p className="flex items-start gap-2 text-sm font-black leading-6 text-[var(--info-text)]">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="mt-0.5 h-4 w-4 shrink-0"><path d="M7 10V7a5 5 0 0 1 10 0v3m-11 0h12v10H6V10Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
            <span>읽기 전용 입찰 기록</span>
          </p>
          <p className="mt-1 break-keep text-xs font-medium leading-5 text-[var(--info-text)] opacity-80">
            조작 의혹 없이 확인할 수 있도록 입찰자 닉네임·입찰 시각·금액을 모두
            공개하며, 운영 센터에서도 이 기록을 수정하는 기능은 제공되지 않습니다.
            미입금 취소나 제재로 효력이 사라진 입찰도 삭제하지 않고 상태를 함께 남깁니다.
          </p>
        </div>

        {latestFirstHistory.length > 0 ? (
          <ol className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)]" aria-label="최신순 입찰 기록">
            {latestFirstHistory.map((bid) => (
              <li
                key={bid.id}
                className="bg-[var(--surface-raised)] px-1 py-4 transition-colors duration-200 hover:bg-[var(--surface-muted)] sm:px-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="break-all text-sm font-black text-[var(--text-strong)]">
                        {bid.bidderName.trim() || "닉네임 없음"}
                      </strong>
                      {bid.outcome === "unpaid_cancelled" ? (
                        <span className="border border-[var(--danger-text)]/25 bg-[var(--danger-surface)] px-2 py-0.5 text-[10px] font-black tracking-[0.04em] text-[var(--danger-text)]">
                          미입금 취소
                        </span>
                      ) : bid.outcome === "cancelled" ? (
                        <span className="border border-[var(--warning-text)]/25 bg-[var(--warning-surface)] px-2 py-0.5 text-[10px] font-black tracking-[0.04em] text-[var(--warning-text)]">
                          입찰 효력 취소
                        </span>
                      ) : bid.id === latestActiveBidId ? (
                        <span className="border border-[var(--accent-text)]/25 bg-[var(--accent-surface)] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-[var(--accent-text)]">
                          최신 유효 입찰
                        </span>
                      ) : null}
                    </div>
                    <time
                      dateTime={bid.bidAt}
                      className="mt-1 block font-mono text-[11px] font-medium tabular-nums tracking-tight text-[var(--text-muted)]"
                    >
                      {formatBidTime(bid.bidAt)}
                    </time>
                  </div>
                  <strong className="shrink-0 font-mono text-base font-black tabular-nums tracking-tight text-[var(--accent-text)] sm:text-lg">
                    {formatKRW(bid.amount)}
                  </strong>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="mt-5 border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)] px-5 py-12 text-center">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="mx-auto h-9 w-9 text-[var(--text-muted)]"><path d="M5 5h14v14H5V5Zm3 4h8m-8 3h8m-8 3h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            <p className="mt-3 text-base font-black text-[var(--text-strong)]">
              아직 입찰 기록이 없습니다
            </p>
            <p className="mt-1.5 text-sm font-medium text-[var(--text-muted)]">
              첫 입찰 기록이 등록되면 이곳에 표시됩니다.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
