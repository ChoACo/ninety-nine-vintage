"use client";

import { Eye, Ruler, X } from "lucide-react";
import { useState } from "react";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
import type { ItemDetail } from "@/types/detail";

interface ConditionReportProps {
  item: ItemDetail;
  surface?: "desktop" | "mobile";
}

export function ConditionReport({ item, surface = "desktop" }: ConditionReportProps) {
  const [open, setOpen] = useState(false);
  const rows = [
    ["어깨", item.measurements.shoulder],
    ["가슴", item.measurements.chest],
    ["소매", item.measurements.sleeve],
    ["총장", item.measurements.length],
  ].filter(
    (row): row is [string, number] =>
      typeof row[1] === "number" && row[1] > 0,
  );
  const notes =
    item.inspectionNotes.length > 0
      ? item.inspectionNotes
      : ["특이사항 없음"];

  return (
    <section className="mt-10 border-t border-zinc-950 pt-6">
      <div className={`rounded-3xl border border-white/10 bg-gradient-to-br from-white to-zinc-50 shadow-xl shadow-black/5 ${surface === "desktop" ? "p-6" : "p-5"}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] font-bold tracking-[0.15em] text-zinc-500">상품 상태 정보</p>
            <h2 className="text-lg font-black leading-snug tracking-tight">빈티지 상품 상태 안내</h2>
          </div>
          <span className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[11px] font-bold text-zinc-700 shadow-sm">
            상태 등급 {item.conditionGrade || "미입력"}
          </span>
        </div>
        <p className="mt-4 line-clamp-2 text-xs leading-relaxed text-zinc-600">{notes.join(" · ")}</p>
        <button className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white text-xs font-bold shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-zinc-950 hover:shadow-lg active:scale-95" onClick={() => setOpen(true)} type="button">
          <Eye size={15} /> 상품 상태 상세 보기
        </button>
      </div>

      <PremiumDialog labelledBy="condition-report-title" onClose={() => setOpen(false)} open={open} panelClassName="max-w-2xl overflow-y-auto">
        <header className="flex items-start justify-between gap-6 border-b border-line px-6 py-5">
          <div>
            <p className="text-[10px] font-bold tracking-[0.14em] text-muted">상품 상태 · 등급 {item.conditionGrade || "미입력"}</p>
            <h2 className="mt-2 text-xl font-black leading-snug tracking-tight" id="condition-report-title">빈티지 상품 상태 상세</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted">사진 확대와 함께 아래 기록을 구매 전 확인해 주세요.</p>
          </div>
          <button aria-label="상품 상태 상세 닫기" className="grid size-10 shrink-0 place-items-center rounded-xl text-muted transition-all duration-300 hover:-translate-y-0.5 hover:bg-surface hover:text-ink active:scale-95" onClick={() => setOpen(false)} type="button"><X size={19} /></button>
        </header>
        <div className="space-y-5 p-6">
          {rows.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
              <h3 className="flex items-center gap-2 border-b border-line bg-surface px-4 py-4 text-xs font-bold"><Ruler size={14} /> 실측 사이즈 가이드</h3>
              <dl className="grid grid-cols-2 gap-px bg-line">
                {rows.map(([label, value]) => (
                  <div className="flex items-center justify-between gap-3 bg-paper px-4 py-3 text-xs" key={label}>
                    <dt className="text-zinc-500">{label}</dt>
                    <dd className="font-mono font-bold text-zinc-950">{value}cm</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          <section className="rounded-2xl border border-line bg-zinc-50 p-5 shadow-sm">
            <h3 className="text-xs font-bold">사용감·오염·하자 기록</h3>
            <ul className="mt-4 space-y-3 text-xs leading-relaxed text-zinc-600">
              {notes.map((note) => <li className="rounded-xl border border-white/70 bg-white px-4 py-3 shadow-sm" key={note}>{note}</li>)}
            </ul>
          </section>
        </div>
      </PremiumDialog>
    </section>
  );
}
