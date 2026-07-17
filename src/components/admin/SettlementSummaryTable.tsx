/* eslint-disable @next/next/no-img-element -- 낙찰 썸네일은 추후 상품 CDN URL을 사용합니다. */
import type { BuyerInfo } from "@/src/types/auction";
import { formatKRW } from "@/src/utils/formatters";

import type {
  AdminSettlementGroup,
  SettlementStatusTone,
} from "./adminTypes";

interface SettlementSummaryTableProps {
  settlements: readonly AdminSettlementGroup[];
  onOpenChat: (buyer: BuyerInfo) => void;
}

const statusClasses: Record<SettlementStatusTone, string> = {
  warning: "border-[#efb5a8] bg-[#fff0ec] text-[#a64d40]",
  mint: "border-[#a9d4bf] bg-[#e8f7ef] text-[#39725a]",
  blue: "border-[#abcbd8] bg-[#eaf5f8] text-[#3e6d7e]",
  slate: "border-[#c9c5bd] bg-[#f3f1ed] text-[#625d55]",
};

function ProductThumbnails({ group }: { group: AdminSettlementGroup }) {
  const visible = group.sales.slice(0, 4);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {visible.map((sale) => (
        <figure key={sale.id} className="w-16">
          <img
            src={sale.thumbnailUrl}
            alt={sale.title}
            className="size-16 rounded-xl border border-[#e4d7ca] bg-[#eee6dd] object-cover"
          />
          <figcaption className="sr-only">{sale.title}</figcaption>
        </figure>
      ))}
      {group.sales.length > visible.length ? (
        <span className="grid size-16 place-items-center rounded-xl bg-[#e9eff1] text-[17px] font-black text-[#55707a]">
          +{group.sales.length - visible.length}
        </span>
      ) : null}
      <span className="text-[17px] font-black text-[#6e6259]">
        총 {group.sales.length}벌
      </span>
    </div>
  );
}

function StatusAndChat({
  group,
  onOpenChat,
}: {
  group: AdminSettlementGroup;
  onOpenChat: (buyer: BuyerInfo) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`rounded-full border-2 px-3 py-1.5 text-[17px] font-black ${statusClasses[group.statusTone]}`}
      >
        {group.statusLabel}
      </span>
      <button
        type="button"
        onClick={() => onOpenChat(group.buyer)}
        className="min-h-11 rounded-full border-2 border-[#d7ad9e] bg-white px-4 py-2 text-[17px] font-black text-[#a55545] transition hover:bg-[#fff0ea] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f0cec4]"
        aria-label={`${group.buyer.name} 고객과 1대1 채팅`}
      >
        💬 1:1 톡
      </button>
    </div>
  );
}

export function SettlementSummaryTable({
  settlements,
  onOpenChat,
}: SettlementSummaryTableProps) {
  if (settlements.length === 0) {
    return (
      <p className="rounded-[1.35rem] border-2 border-dashed border-[#d9ccbd] bg-white/70 px-5 py-10 text-center text-[17px] font-bold text-[#776a60]">
        이 날짜에 마감된 낙찰 내역이 없습니다.
      </p>
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[58rem] table-fixed border-collapse text-left">
          <caption className="sr-only">
            낙찰자, 낙찰 상품 사진, 낙찰 금액, 진행 상태
          </caption>
          <thead>
            <tr className="border-b-2 border-[#e4d7c9] text-[17px] font-black text-[#6d6057]">
              <th scope="col" className="w-[18%] px-4 py-4">
                낙찰자 성명
              </th>
              <th scope="col" className="w-[34%] px-4 py-4">
                낙찰 상품 사진
              </th>
              <th scope="col" className="w-[18%] px-4 py-4">
                낙찰 금액
              </th>
              <th scope="col" className="w-[30%] px-4 py-4">
                진행 상태
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#ece2d8]">
            {settlements.map((group) => (
              <tr key={group.id} className="align-middle hover:bg-[#fff9f1]">
                <td className="px-4 py-5 text-xl font-black text-[#463b34]">
                  {group.buyer.name}
                </td>
                <td className="px-4 py-5">
                  <ProductThumbnails group={group} />
                </td>
                <td className="px-4 py-5 text-xl font-black text-[#bd6250]">
                  {formatKRW(group.totalWinningBid)}
                </td>
                <td className="px-4 py-5">
                  <StatusAndChat group={group} onOpenChat={onOpenChat} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-4 lg:hidden" aria-label="날짜별 낙찰 마감 목록">
        {settlements.map((group) => (
          <li
            key={group.id}
            className="rounded-[1.4rem] border border-[#e5d8cb] bg-white p-4 text-[17px]"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eee4da] pb-3">
              <p className="text-xl font-black text-[#463b34]">
                낙찰자: {group.buyer.name}
              </p>
              <p className="text-xl font-black text-[#bd6250]">
                {formatKRW(group.totalWinningBid)}
              </p>
            </div>
            <div className="mt-4">
              <ProductThumbnails group={group} />
            </div>
            <div className="mt-4">
              <StatusAndChat group={group} onOpenChat={onOpenChat} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
