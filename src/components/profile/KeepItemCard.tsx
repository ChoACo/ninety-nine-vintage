/* eslint-disable @next/next/no-img-element -- 보관 상품 이미지는 추후 CDN 응답으로 교체합니다. */
import type { WonAuction } from "@/src/types/auction";
import { formatKoreanDate, formatKRW } from "@/src/utils/formatters";
import {
  formatKeepDday,
  getKeepLimitDays,
} from "@/src/utils/shipping";

import { getKeepItemExpiration } from "./keepStorageUtils";

interface KeepItemCardProps {
  item: WonAuction;
  checked: boolean;
  now: Date;
  onToggle: (itemId: string) => void;
}

export function KeepItemCard({
  item,
  checked,
  now,
  onToggle,
}: KeepItemCardProps) {
  const expiresAt = getKeepItemExpiration(item);
  const expired = new Date(expiresAt).getTime() <= now.getTime();
  const keepLimit = getKeepLimitDays(item.isBulky);

  return (
    <li
      className={`h-full overflow-hidden rounded-[1.5rem] border-2 bg-white shadow-[0_10px_28px_rgba(91,75,58,0.07)] transition ${
        checked
          ? "border-[#64a88d] ring-4 ring-[#cce8dc]/70"
          : expired
            ? "border-[#e8b6ab] opacity-75"
            : "border-[#e7dccd]"
      }`}
    >
      <label
        className={`grid h-full min-h-40 grid-cols-[7.25rem_minmax(0,1fr)] ${
          expired ? "cursor-not-allowed" : "cursor-pointer"
        }`}
      >
        <span className="relative min-h-40 bg-[#eee5da]">
          <img
            src={item.thumbnailUrl}
            alt={`${item.title} 보관 상품`}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <input
            type="checkbox"
            checked={checked}
            disabled={expired}
            onChange={() => onToggle(item.id)}
            className="absolute left-3 top-3 size-7 rounded accent-[#4d947b]"
            aria-label={`${item.title} 택배 접수 선택`}
          />
        </span>

        <span className="flex min-w-0 flex-col justify-between gap-3 p-4">
          <span>
            <span className="line-clamp-2 text-[18px] font-extrabold leading-7 text-[#493b31]">
              {item.title}
            </span>
            <span className="mt-1 block text-[17px] font-black text-[#cb6e5b]">
              {formatKRW(item.winningBid)}
            </span>
          </span>

          <span>
            <span
              className={`inline-flex rounded-full px-3 py-1.5 text-[17px] font-black ${
                expired
                  ? "bg-[#ffe8e2] text-[#a4473c]"
                  : item.isBulky
                    ? "bg-[#fff0df] text-[#9a602a]"
                    : "bg-[#e7f5ef] text-[#34705a]"
              }`}
            >
              {formatKeepDday(expiresAt, now)}
            </span>
            <span className="mt-2 block text-[17px] font-bold leading-7 text-[#786b61]">
              {item.isBulky ? "부피 상품" : "일반 의류"} · 최대 D-{keepLimit}
              <br />
              {formatKoreanDate(expiresAt)}까지
            </span>
          </span>
        </span>
      </label>
    </li>
  );
}
