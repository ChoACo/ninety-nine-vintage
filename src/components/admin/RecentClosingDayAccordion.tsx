"use client";

import { useId, useState } from "react";

import { formatKRW } from "@/src/utils/formatters";

import type { RecentClosingDay } from "./adminTypes";
import { SettlementSummaryTable } from "./SettlementSummaryTable";

interface RecentClosingDayAccordionProps {
  day: RecentClosingDay;
  defaultOpen?: boolean;
}

export function RecentClosingDayAccordion({
  day,
  defaultOpen = false,
}: RecentClosingDayAccordionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const panelId = useId();
  const total = day.sales.reduce((sum, sale) => sum + sale.winningBid, 0);

  return (
    <section className="overflow-hidden rounded-[1.65rem] border-2 border-[#e5d7c8] bg-[#fffdf9] shadow-[0_10px_28px_rgba(92,70,49,0.05)]">
      <h3>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setIsOpen((current) => !current)}
          className="flex min-h-20 w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-[#fff7ed] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#efc8bc] sm:px-6"
        >
          <span className="flex min-w-0 items-center gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[#f5d9d0] text-xl font-black text-[#b96553]">
              {day.weekdayLabel}
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 text-xl font-black text-[#453a33]">
                {day.label}
                {day.isToday ? (
                  <span className="rounded-full bg-[#e4f1f4] px-3 py-1 text-[17px] font-black text-[#477585]">
                    오늘
                  </span>
                ) : null}
              </span>
              <span className="mt-1 block text-[17px] font-bold text-[#796c62]">
                {day.sales.length}벌 · {formatKRW(total)}
              </span>
            </span>
          </span>
          <span
            aria-hidden="true"
            className={`grid size-11 shrink-0 place-items-center rounded-full bg-[#edf3f4] text-2xl font-black text-[#587681] transition-transform duration-300 ${
              isOpen ? "rotate-180" : ""
            }`}
          >
            ⌄
          </span>
        </button>
      </h3>

      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            id={panelId}
            className="border-t border-[#e9ded3] bg-white/65 p-3 sm:p-4"
          >
            <SettlementSummaryTable
              settlements={day.settlements}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
