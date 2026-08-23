"use client";

import { Eye, Ruler, X } from "lucide-react";
import { useState } from "react";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
import type { ItemDetail } from "@/types/detail";
import { DEFECT_LABELS } from "@/lib/catalog/defects";
import { measurementEntries } from "@/lib/catalog/measurements";
import { formatConditionGrade } from "@/lib/catalog/conditions";

interface ConditionReportProps {
  item: ItemDetail;
  surface?: "desktop" | "mobile";
}

export function ConditionReport({ item, surface = "desktop" }: ConditionReportProps) {
  const [open, setOpen] = useState(false);
  const rows = measurementEntries(item.measurements).map(
    (measurement) => [measurement.label, measurement.value] as [string, number],
  );
  const notes =
    item.inspectionNotes.length > 0
      ? item.inspectionNotes
      : ["특이사항 없음"];
  const defects = item.defectTags
    .map((code) => DEFECT_LABELS[code])
    .filter(Boolean);
  const conditionLabel = formatConditionGrade(item.conditionGrade);

  return (
    <section className="mt-10 border-t border-border pt-6">
      <div className={`rounded-3xl border border-border bg-card text-card-foreground shadow-xl shadow-black/5 ${surface === "desktop" ? "p-6" : "p-5"}`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] font-bold tracking-[0.15em] text-muted-foreground">상품 상태 정보</p>
            <h2 className="text-lg font-black leading-snug tracking-tight text-foreground">빈티지 상품 상태 안내</h2>
          </div>
          {conditionLabel && <span className="rounded-xl border border-border bg-surface px-3 py-2 text-[11px] font-bold text-foreground shadow-sm">{conditionLabel}</span>}
        </div>
        <p className="mt-4 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{notes.join(" · ")}</p>
        {defects.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {defects.map((label) => <li className="rounded-full border border-border/50 bg-muted px-2.5 py-1 text-[10px] font-bold text-foreground" key={label}>{label}</li>)}
          </ul>
        )}
        <button className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border/50 bg-card text-xs font-bold text-foreground shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-foreground hover:shadow-lg active:scale-95" onClick={() => setOpen(true)} type="button">
          <Eye size={15} /> 상품 상태 상세 보기
        </button>
      </div>

      <PremiumDialog labelledBy="condition-report-title" onClose={() => setOpen(false)} open={open} panelClassName="max-w-2xl overflow-y-auto">
        <header className="flex items-start justify-between gap-6 border-b border-line px-6 py-5">
          <div>
            <p className="text-[10px] font-bold tracking-[0.14em] text-muted">{conditionLabel ? `상품 상태 · ${conditionLabel}` : "상품 상태 상세"}</p>
            <h2 className="mt-2 text-xl font-black leading-snug tracking-tight" id="condition-report-title">빈티지 상품 상태 상세</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted">사진 확대와 함께 아래 기록을 구매 전 확인해 주세요.</p>
          </div>
          <button aria-label="상품 상태 상세 닫기" className="grid size-10 shrink-0 place-items-center rounded-xl text-muted transition-all duration-300 hover:-translate-y-0.5 hover:bg-surface hover:text-ink active:scale-95" onClick={() => setOpen(false)} type="button"><X size={19} /></button>
        </header>
        <div className="space-y-5 p-6">
          {rows.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
              <h3 className="flex items-center gap-2 border-b border-line bg-surface px-4 py-4 text-xs font-bold"><Ruler size={14} /> 실측 사이즈 가이드</h3>
              <dl className="grid grid-cols-2 gap-px bg-line">
                {rows.map(([label, value]) => (
                  <div className="flex items-center justify-between gap-3 bg-paper px-4 py-3 text-xs" key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-mono font-bold text-foreground">{value}cm</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          <section className="rounded-2xl border border-line bg-muted p-5 shadow-sm">
            <h3 className="text-xs font-bold">사용감·오염·하자 기록</h3>
            {defects.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-1.5">
                {defects.map((label) => <li className="rounded-full border border-line bg-card px-3 py-1.5 text-[10px] font-bold" key={label}>{label}</li>)}
              </ul>
            )}
            {defects.length === 0 && <p className="mt-4 rounded-xl border border-border/50 bg-card px-4 py-3 text-xs text-muted-foreground">표시된 하자·오염 항목이 없습니다.</p>}
            <ul className="mt-4 space-y-3 text-xs leading-relaxed text-muted-foreground">
              {notes.map((note) => <li className="rounded-xl border border-border/50 bg-card px-4 py-3 shadow-sm" key={note}>{note}</li>)}
            </ul>
          </section>
        </div>
      </PremiumDialog>
    </section>
  );
}
