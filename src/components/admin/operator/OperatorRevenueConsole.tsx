"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Save } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/FormControls";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusNotice } from "@/components/ui/StatusNotice";
import {
  getDailyRevenue,
  upsertDailyRevenue,
  type DailyRevenueEntry,
} from "@/lib/supabase/operations";
import { formatKRW } from "@/utils/formatters";

function kstDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Seoul",
    year: "numeric",
  }).format(date);
}

function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function startOfWeek(dateKey: string): string {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return shiftDateKey(dateKey, -(day === 0 ? 6 : day - 1));
}

function sumAmount(
  rows: DailyRevenueEntry[],
  predicate: (row: DailyRevenueEntry) => boolean,
): number {
  return rows.filter(predicate).reduce((sum, row) => sum + row.grossAmount, 0);
}

export function OperatorRevenueConsole() {
  const today = kstDateKey();
  const [rows, setRows] = useState<DailyRevenueEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"error" | "success">("success");
  const [revenueDate, setRevenueDate] = useState(today);
  const [grossAmount, setGrossAmount] = useState("");
  const [paidOrderCount, setPaidOrderCount] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    setNotice("");
    try {
      setRows(await getDailyRevenue("2000-01-01", today));
    } catch (error) {
      setNoticeTone("error");
      setNotice(error instanceof Error ? error.message : "매출 정보를 불러오지 못했습니다.");
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
    if (isSaving) return;

    const parsedAmount = Number(grossAmount);
    const parsedCount = Number(paidOrderCount);
    if (
      !Number.isSafeInteger(parsedAmount)
      || parsedAmount < 0
      || !Number.isSafeInteger(parsedCount)
      || parsedCount < 0
    ) {
      setNoticeTone("error");
      setNotice("확정 매출액과 결제 건수를 0 이상의 정수로 입력해 주세요.");
      return;
    }

    setIsSaving(true);
    setNotice("");
    try {
      const saved = await upsertDailyRevenue({
        grossAmount: parsedAmount,
        paidOrderCount: parsedCount,
        revenueDate,
      });
      setRows((current) => [
        ...current.filter((row) => row.revenueDate !== saved.revenueDate),
        saved,
      ].sort((left, right) => left.revenueDate.localeCompare(right.revenueDate)));
      setGrossAmount("");
      setPaidOrderCount("");
      setNoticeTone("success");
      setNotice(`${saved.revenueDate} 확정 매출을 저장했습니다.`);
    } catch (error) {
      setNoticeTone("error");
      setNotice(error instanceof Error ? error.message : "일 매출을 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  const summaryCards = [
    ["오늘", summary.day],
    ["이번 주", summary.week],
    ["이번 달", summary.month],
    ["올해", summary.year],
  ] as const;

  return (
    <div className="space-y-8">
      <SectionHeading
        action={(
          <Button
            className="flex items-center gap-2"
            disabled={isLoading}
            onClick={() => void load()}
            type="button"
          >
            <RefreshCw size={13} /> 새로고침
          </Button>
        )}
        description="실제 입금이 확인된 하루 매출만 저장하고 기간별로 합산합니다. 낙찰가는 자동 매출로 계산하지 않습니다."
        eyebrow="운영자 / 매출 원장"
        title="매출 현황"
        variant="page"
      />

      {notice && <StatusNotice variant={noticeTone}>{notice}</StatusNotice>}

      <div aria-label="매출 요약" className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
        {summaryCards.map(([label, amount]) => (
          <article className="bg-paper p-5" key={label}>
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-4 font-mono text-2xl font-bold">
              {isLoading ? "—" : formatKRW(amount)}
            </p>
          </article>
        ))}
      </div>

      <form className="grid grid-cols-1 items-end gap-3 border border-ink bg-surface p-4 sm:grid-cols-2 sm:p-6 xl:grid-cols-[180px_1fr_180px_auto]" onSubmit={save}>
        <label className="text-xs font-bold">
          <span className="mb-2 block text-[10px] text-muted">매출 날짜</span>
          <TextInput
            className="w-full"
            max={today}
            onChange={(event) => setRevenueDate(event.target.value)}
            required
            type="date"
            value={revenueDate}
          />
        </label>
        <label className="text-xs font-bold">
          <span className="mb-2 block text-[10px] text-muted">확정 하루 매출</span>
          <TextInput
            className="w-full font-mono"
            min="0"
            onChange={(event) => setGrossAmount(event.target.value)}
            placeholder="실제 입금 확인 금액"
            required
            step="1"
            type="number"
            value={grossAmount}
          />
        </label>
        <label className="text-xs font-bold">
          <span className="mb-2 block text-[10px] text-muted">결제 건수</span>
          <TextInput
            className="w-full font-mono"
            min="0"
            onChange={(event) => setPaidOrderCount(event.target.value)}
            placeholder="0"
            required
            step="1"
            type="number"
            value={paidOrderCount}
          />
        </label>
        <Button className="flex items-center justify-center gap-2 sm:col-span-2 xl:col-span-1" disabled={isSaving} type="submit" variant="primary">
          <Save size={13} /> {isSaving ? "저장 중…" : "일 매출 저장"}
        </Button>
      </form>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_280px]">
        <div className="overflow-x-auto border-y border-line">
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead className="border-b border-line bg-surface text-[10px] uppercase tracking-[.12em] text-muted">
              <tr>
                <th className="px-4 py-4">날짜</th>
                <th className="px-4 py-4">하루 매출</th>
                <th className="px-4 py-4">결제 건수</th>
                <th className="px-4 py-4">수정 시각</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...rows]
                .sort((left, right) => right.revenueDate.localeCompare(left.revenueDate))
                .slice(0, 31)
                .map((row) => (
                  <tr key={row.revenueDate}>
                    <td className="px-4 py-4 font-mono font-bold">{row.revenueDate}</td>
                    <td className="px-4 py-4 font-mono font-bold">{formatKRW(row.grossAmount)}</td>
                    <td className="px-4 py-4 font-mono">{row.paidOrderCount}건</td>
                    <td className="px-4 py-4 text-[10px] text-muted">
                      {new Date(row.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                    </td>
                  </tr>
                ))}
              {isLoading && (
                <tr>
                  <td className="px-4 py-12 text-center text-muted" colSpan={4}>매출 내역을 불러오는 중…</td>
                </tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td className="px-4 py-12 text-center text-muted" colSpan={4}>저장된 매출이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <aside className="border border-line bg-surface p-5">
          <p className="eyebrow text-muted">연도별 / 누적 매출</p>
          <h2 className="mt-3 text-lg font-black">연도별 누적</h2>
          <ul className="mt-5 divide-y divide-line border-y border-line">
            {yearly.map(([year, amount]) => (
              <li className="flex justify-between gap-3 py-3 text-xs" key={year}>
                <span className="font-mono font-bold">{year}년</span>
                <span className="font-mono">{formatKRW(amount)}</span>
              </li>
            ))}
            {!isLoading && yearly.length === 0 && (
              <li className="py-8 text-center text-xs text-muted">누적 데이터가 없습니다.</li>
            )}
          </ul>
        </aside>
      </div>
    </div>
  );
}
