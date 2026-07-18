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
      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4" aria-label="매출 요약">
        {[
          ["오늘", summary.day],
          ["이번 주", summary.week],
          ["이번 달", summary.month],
          ["올해", summary.year],
        ].map(([label, amount]) => (
          <article key={label} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5 transition-all duration-200 ease-out hover:border-[var(--border-strong)] hover:shadow-sm">
            <p className="text-xs font-black text-[var(--text-muted)]">{label}</p>
            {isLoading ? (
              <div role="status" aria-label={`${label} 매출 불러오는 중`} className="commerce-skeleton mt-2 h-6 w-28 rounded" />
            ) : (
              <p className="mt-1.5 font-mono text-lg font-black tabular-nums tracking-tight text-[var(--text-strong)]">{formatKRW(Number(amount))}</p>
            )}
          </article>
        ))}
      </div>

      <form onSubmit={save} className="mt-4 grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--warning-surface)] p-3.5 sm:grid-cols-[160px_minmax(0,1fr)_160px_auto] sm:items-end">
        <label className="text-xs font-black text-[var(--text-strong)]">
          매출 날짜
          <input type="date" max={today} value={revenueDate} onChange={(event) => setRevenueDate(event.target.value)} className="mt-1.5 min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--input-surface)] px-3 font-mono text-sm font-semibold tabular-nums sm:min-h-10" required />
        </label>
        <label className="text-xs font-black text-[var(--text-strong)]">
          확정 하루 매출
          <input type="number" min="0" step="1" value={grossAmount} onChange={(event) => setGrossAmount(event.target.value)} placeholder="입금 확인 금액" className="mt-1.5 min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--input-surface)] px-3 font-mono text-sm font-semibold tabular-nums sm:min-h-10" required />
        </label>
        <label className="text-xs font-black text-[var(--text-strong)]">
          결제 건수
          <input type="number" min="0" step="1" value={paidOrderCount} onChange={(event) => setPaidOrderCount(event.target.value)} placeholder="0" className="mt-1.5 min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--input-surface)] px-3 font-mono text-sm font-semibold tabular-nums sm:min-h-10" required />
        </label>
        <Button type="submit" isLoading={isSaving}>일 매출 저장</Button>
      </form>
      <p className="mt-2 text-[11px] font-semibold leading-5 text-[var(--text-muted)]">
        낙찰가는 자동 매출로 잡지 않습니다. 실제 입금이 확인된 하루 합계와 건수만 한 줄로 보관합니다.
      </p>

      {error ? <p role="alert" className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--danger-surface)] px-3.5 py-2.5 text-xs font-bold text-[var(--danger-text)]">{error}</p> : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="touch-pan-x overflow-x-auto overscroll-x-contain rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] [scrollbar-gutter:stable]">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead className="bg-[var(--surface-muted)] text-[var(--text-muted)]"><tr><th className="px-3 py-2.5 font-black">날짜</th><th className="px-3 py-2.5 font-black">하루 매출</th><th className="px-3 py-2.5 font-black">결제 건수</th><th className="px-3 py-2.5 font-black">수정 시각</th></tr></thead>
            <tbody>
              {[...rows].sort((a, b) => b.revenueDate.localeCompare(a.revenueDate)).slice(0, 31).map((row) => (
                <tr key={row.revenueDate} className="border-t border-[var(--border)] transition-colors duration-200 hover:bg-[var(--surface-muted)]/50"><td className="px-3 py-2.5 font-mono font-black tabular-nums text-[var(--text-strong)]">{row.revenueDate}</td><td className="px-3 py-2.5 font-mono font-bold tabular-nums text-[var(--text-strong)]">{formatKRW(row.grossAmount)}</td><td className="px-3 py-2.5 font-mono tabular-nums">{row.paidOrderCount}건</td><td className="px-3 py-2.5 font-mono text-[10px] tabular-nums text-[var(--text-muted)]">{new Date(row.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</td></tr>
              ))}
              {isLoading ? <tr><td colSpan={4} className="p-3"><div role="status" aria-label="매출 내역 불러오는 중" className="commerce-skeleton h-10 rounded" /></td></tr> : null}
              {!isLoading && rows.length === 0 ? <tr><td colSpan={4} className="px-4 py-10 text-center"><span className="block text-sm font-black text-[var(--text-strong)]">저장된 매출이 없습니다</span><span className="mt-1 block text-xs font-semibold text-[var(--text-muted)]">입금 확인이 끝난 하루 매출을 위 입력란에서 저장하세요.</span></td></tr> : null}
            </tbody>
          </table>
        </div>
        <aside className="rounded-lg border border-[var(--info-border)] bg-[var(--info-surface)] p-3.5">
          <h3 className="text-sm font-black text-[var(--text-strong)]">연도별 누적</h3>
          <ul className="mt-3 space-y-2">
            {yearly.map(([year, amount]) => <li key={year} className="flex justify-between gap-3 rounded-md border border-[var(--info-border)] bg-[var(--surface-raised)] px-3 py-2 text-xs"><span className="font-mono font-black tabular-nums text-[var(--info-text)]">{year}년</span><span className="font-mono font-bold tabular-nums text-[var(--text-strong)]">{formatKRW(amount)}</span></li>)}
            {!isLoading && yearly.length === 0 ? <li className="py-5 text-center text-xs font-semibold text-[var(--info-text)]">누적 데이터가 없습니다.</li> : null}
          </ul>
        </aside>
      </div>
    </div>
  );
}
