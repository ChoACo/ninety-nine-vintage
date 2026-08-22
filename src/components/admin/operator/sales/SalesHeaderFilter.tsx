"use client";

import { CalendarDays, Download, Store } from "lucide-react";
import type { SalesRangePreset } from "@/store/useSalesDateRangeStore";

interface Props {
  storeName: string;
  preset: SalesRangePreset;
  from: string;
  to: string;
  busy: boolean;
  onPreset: (preset: Exclude<SalesRangePreset, "custom">) => void;
  onCustom: (from: string, to: string) => void;
  onExport: () => void;
}

const CHIPS: Array<[Exclude<SalesRangePreset, "custom">, string]> = [["today", "오늘"], ["7d", "7일"], ["30d", "30일"], ["month", "이번 달"]];

export function SalesHeaderFilter({ storeName, preset, from, to, busy, onPreset, onCustom, onExport }: Props) {
  return <header className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-100 shadow-xl shadow-black/10">
    <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
      <div><span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-400"><Store size={12} strokeWidth={1.75} />{storeName}</span><h1 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl">매출 및 정산 분석</h1><p className="mt-2 text-sm text-zinc-500">담당 매장에 귀속된 결제·환불·정산 원장을 분석합니다.</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex rounded-xl border border-zinc-800 bg-zinc-900 p-1">{CHIPS.map(([value, label]) => <button aria-pressed={preset === value} className={`min-h-10 rounded-lg px-3 text-xs font-bold transition focus-visible:ring-2 focus-visible:ring-amber-500 ${preset === value ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white"}`} key={value} onClick={() => onPreset(value)} type="button">{label}</button>)}</div>
        <label className="flex min-h-11 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-xs text-zinc-400"><CalendarDays size={15} /><input aria-label="매출 시작일" className="bg-transparent font-mono text-zinc-200 outline-none" max={to} onChange={(event) => onCustom(event.target.value, to)} type="date" value={from} /><span>–</span><input aria-label="매출 종료일" className="bg-transparent font-mono text-zinc-200 outline-none" min={from} onChange={(event) => onCustom(from, event.target.value)} type="date" value={to} /></label>
        <button className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-500 px-4 text-xs font-black text-zinc-950 transition hover:bg-amber-400 focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-40" disabled={busy} onClick={onExport} type="button"><Download size={15} strokeWidth={1.75} />엑셀 다운로드 <span className="text-[10px] opacity-70">CSV</span></button>
      </div>
    </div>
  </header>;
}
