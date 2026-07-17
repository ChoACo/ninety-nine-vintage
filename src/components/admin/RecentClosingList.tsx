import type { BuyerInfo } from "@/src/types/auction";

import type { RecentClosingDay } from "./adminTypes";
import { RecentClosingDayAccordion } from "./RecentClosingDayAccordion";

interface RecentClosingListProps {
  days: readonly RecentClosingDay[];
  onOpenChat: (buyer: BuyerInfo) => void;
}

export function RecentClosingList({ days, onOpenChat }: RecentClosingListProps) {
  return (
    <section aria-labelledby="recent-closing-title" className="space-y-4">
      <div>
        <p className="text-[17px] font-black tracking-[0.12em] text-[#688492]">
          RECENT 7 DAYS
        </p>
        <h2
          id="recent-closing-title"
          className="mt-1 text-2xl font-black text-[#473a32] sm:text-3xl"
        >
          최근 7일 날짜별 마감 관리
        </h2>
        <p className="mt-2 text-[17px] font-bold leading-7 text-[#75685f]">
          옷 사진과 입금·발송 상태에 집중할 수 있도록 핵심 정보만 표시합니다.
        </p>
      </div>

      <div className="space-y-3" aria-label="최근 7일 마감 날짜 목록">
        {days.map((day, index) => (
          <RecentClosingDayAccordion
            key={day.dateKey}
            day={day}
            defaultOpen={index === 0}
            onOpenChat={onOpenChat}
          />
        ))}
      </div>
    </section>
  );
}
