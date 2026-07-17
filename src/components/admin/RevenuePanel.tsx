"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import Button from "@/src/components/common/Button";
import {
  getDailyRevenue,
  upsertDailyRevenue,
  type DailyRevenueEntry,
} from "@/src/lib/supabase/operations";
import { formatKRW } from "@/src/utils/formatters";

function kstDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function startOfWeek(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const day = date.getUTCDay();
  return shiftDateKey(dateKey, -(day === 0 ? 6 : day - 1));
}

function sumAmount(rows: DailyRevenueEntry[], predicate: (row: DailyRevenueEntry) => boolean): number {
  return rows.filter(predicate).reduce((sum, row) => sum + row.grossAmount, 0);
}

export function RevenuePanel() {
  const today = kstDateKey();
  const [rows, setRows] = useState<DailyRevenueEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [revenueDate, setRevenueDate] = useState(today);
  const [grossAmount, setGrossAmount] = useState("");
  const [paidOrderCount, setPaidOrderCount] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      setRows(await getDailyRevenue("2000-01-01", today));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "매출 정보를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [today]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const summary = useMemo(() => {
    const weekStart = startOfWeek(today);
    const monthPrefix = today.slice(0, 7);
    const yearPrefix = today.slice(0, 4);
    return {
      day: sumAmount(rows, (row) => row.revenueDate === today),
      week: sumAmount(rows, (row) => row.revenueDate >= weekStart && row.revenueDate <= today),
      month: sumAmount(rows, (row) => row.revenueDate.startsWith(monthPrefix)),
      year: sumAmount(rows, (row) => row.revenueDate.startsWith(yearPrefix)),
    };
  }, [rows, today]);

  const yearly = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      const year = row.revenueDate.slice(0, 4);
      totals.set(year, (totals.get(year) ?? 0) + row.grossAmount);
    }
    return [...totals.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [rows]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedAmount = Number(grossAmount);
    const parsedCount = Number(paidOrderCount);
    if (!Number.isSafeInteger(parsedAmount) || parsedAmount < 0 || !Number.isSafeInteger(parsedCount) || parsedCount < 0) {
      setError("확정 매출액과 결제 건수를 0 이상의 정수로 입력해 주세요.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const saved = await upsertDailyRevenue({
        revenueDate,
        grossAmount: parsedAmount,
        paidOrderCount: parsedCount,
      });
      setRows((current) => [...current.filter((row) => row.revenueDate !== saved.revenueDate), saved].sort((a, b) => a.revenueDate.localeCompare(b.revenueDate)));
      setGrossAmount("");
      setPaidOrderCount("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "일 매출을 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="매출 요약">
        {[
          ["오늘", summary.day],
          ["이번 주", summary.week],
          ["이번 달", summary.month],
          ["올해", summary.year],
        ].map(([label, amount]) => (
          <article key={label} className="rounded-[1.3rem] border border-[#dfd3c7] bg-white p-4">
            <p className="text-sm font-black text-[#8b7a6d]">{label}</p>
            <p className="mt-2 text-xl font-black text-[#493b31]">{isLoading ? "—" : formatKRW(Number(amount))}</p>
          </article>
        ))}
      </div>

      <form onSubmit={save} className="mt-5 grid gap-3 rounded-[1.4rem] border border-[#ead5a9] bg-[#fff9e9] p-4 sm:grid-cols-[160px_minmax(0,1fr)_160px_auto] sm:items-end">
        <label className="text-sm font-black text-[#65533f]">
          매출 날짜
          <input type="date" max={today} value={revenueDate} onChange={(event) => setRevenueDate(event.target.value)} className="mt-2 w-full rounded-xl border border-[#dfcfb5] bg-white px-3 py-2.5 font-semibold" required />
        </label>
        <label className="text-sm font-black text-[#65533f]">
          확정 하루 매출
          <input type="number" min="0" step="1" value={grossAmount} onChange={(event) => setGrossAmount(event.target.value)} placeholder="입금 확인 금액" className="mt-2 w-full rounded-xl border border-[#dfcfb5] bg-white px-3 py-2.5 font-semibold" required />
        </label>
        <label className="text-sm font-black text-[#65533f]">
          결제 건수
          <input type="number" min="0" step="1" value={paidOrderCount} onChange={(event) => setPaidOrderCount(event.target.value)} placeholder="0" className="mt-2 w-full rounded-xl border border-[#dfcfb5] bg-white px-3 py-2.5 font-semibold" required />
        </label>
        <Button type="submit" isLoading={isSaving}>일 매출 저장</Button>
      </form>
      <p className="mt-2 text-xs font-bold leading-5 text-[#8b7a6d]">
        낙찰가는 자동 매출로 잡지 않습니다. 실제 입금이 확인된 하루 합계와 건수만 한 줄로 보관합니다.
      </p>

      {error ? <p role="alert" className="mt-4 rounded-2xl bg-[#fff0ea] px-4 py-3 text-sm font-bold text-[#a84c3f]">{error}</p> : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="overflow-x-auto rounded-2xl border border-[#e4d8cd] bg-white">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-[#faf5ef] text-[#77685d]"><tr><th className="px-4 py-3">날짜</th><th className="px-4 py-3">하루 매출</th><th className="px-4 py-3">결제 건수</th><th className="px-4 py-3">수정 시각</th></tr></thead>
            <tbody>
              {[...rows].sort((a, b) => b.revenueDate.localeCompare(a.revenueDate)).slice(0, 31).map((row) => (
                <tr key={row.revenueDate} className="border-t border-[#eee4db]"><td className="px-4 py-3 font-black text-[#493b31]">{row.revenueDate}</td><td className="px-4 py-3 font-bold">{formatKRW(row.grossAmount)}</td><td className="px-4 py-3">{row.paidOrderCount}건</td><td className="px-4 py-3 text-xs text-[#8b7a6d]">{new Date(row.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</td></tr>
              ))}
              {!isLoading && rows.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center font-bold text-[#8b7a6d]">저장된 매출이 없습니다.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <aside className="rounded-2xl border border-[#cbdde5] bg-[#edf7fa] p-4">
          <h3 className="font-black text-[#3e5b69]">연도별 누적</h3>
          <ul className="mt-3 space-y-2">
            {yearly.map(([year, amount]) => <li key={year} className="flex justify-between gap-3 rounded-xl bg-white/80 px-3 py-2 text-sm"><span className="font-black text-[#526e78]">{year}년</span><span className="font-bold text-[#3e5b69]">{formatKRW(amount)}</span></li>)}
          </ul>
        </aside>
      </div>
    </div>
  );
}
