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

function maskBidderName(name: string) {
  const trimmedName = name.trim();
  if (!trimmedName) return "***";
  if (trimmedName.includes("*")) return trimmedName;
  if (trimmedName.length === 1) return `${trimmedName}*`;
  if (trimmedName.length === 2) return `${trimmedName[0]}*`;
  return `${trimmedName[0]}*${trimmedName.at(-1)}`;
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="입찰 현황"
      description={`‘${itemTitle}’의 전체 입찰 기록을 최신순으로 확인합니다.`}
      size="md"
    >
      <div className="p-5 sm:p-6">
        <div className="rounded-2xl border border-[#cfe1e5] bg-[#edf7f9] px-4 py-3">
          <p className="flex items-start gap-2 text-base font-black leading-6 text-[#345f69]">
            <span aria-hidden="true">🔒</span>
            <span>읽기 전용 입찰 기록</span>
          </p>
          <p className="mt-1 break-keep text-sm font-semibold leading-6 text-[#58777e]">
            운영 센터에서도 이 기록을 수정하는 기능은 제공되지 않습니다.
          </p>
        </div>

        {latestFirstHistory.length > 0 ? (
          <ol className="mt-5 space-y-3" aria-label="최신순 입찰 기록">
            {latestFirstHistory.map((bid, index) => (
              <li
                key={bid.id}
                className="rounded-2xl border border-[#eadbce] bg-white px-4 py-4 sm:px-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-lg font-black text-[#3f342e]">
                        {maskBidderName(bid.bidderName)}
                      </strong>
                      {index === 0 ? (
                        <span className="rounded-full bg-[#ffe2d7] px-2.5 py-1 text-xs font-black text-[#a54336]">
                          최신 입찰
                        </span>
                      ) : null}
                    </div>
                    <time
                      dateTime={bid.bidAt}
                      className="mt-1 block text-sm font-bold text-[#75665d]"
                    >
                      {formatBidTime(bid.bidAt)}
                    </time>
                  </div>
                  <strong className="shrink-0 text-xl font-black tabular-nums text-[#a54135] sm:text-2xl">
                    {formatKRW(bid.amount)}
                  </strong>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-[#d9c8ba] bg-[#fff9f2] px-5 py-10 text-center">
            <p className="text-lg font-black text-[#55483f]">
              아직 입찰 기록이 없습니다
            </p>
            <p className="mt-2 text-base font-semibold text-[#78695f]">
              첫 입찰 기록이 등록되면 이곳에 표시됩니다.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
