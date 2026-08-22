"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SalesChartsDeck } from "./sales/SalesChartsDeck";
import { SalesHeaderFilter } from "./sales/SalesHeaderFilter";
import { SalesLedgerTable } from "./sales/SalesLedgerTable";
import { SalesMetricCards } from "./sales/SalesMetricCards";
import { SalesSkeleton } from "./sales/SalesSkeleton";
import type { SalesMetrics, SalesStoreReport } from "./sales/types";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { useOperatorStoreScope } from "@/store/useOperatorStoreScope";
import { type SalesRangePreset, useSalesDateRangeStore } from "@/store/useSalesDateRangeStore";

interface ReportPayload { stores?: SalesStoreReport[]; message?: string }
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function kstDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" }).format(date);
}

function rangeFor(preset: Exclude<SalesRangePreset, "custom">, now = new Date()) {
  const to = kstDate(now);
  if (preset === "today") return { from: to, to };
  if (preset === "month") return { from: `${to.slice(0, 7)}-01`, to };
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - (preset === "7d" ? 6 : 29));
  return { from: kstDate(fromDate), to };
}

function csvCell(value: string | number) { return `"${String(value).replaceAll('"', '""')}"`; }

export function OperatorSalesConsole() {
  const { session } = useSupabaseSession();
  const token = session?.access_token ?? null;
  const router = useRouter();
  const searchParams = useSearchParams();
  const scope = useOperatorStoreScope((state) => state.scope);
  const stores = useOperatorStoreScope((state) => state.stores);
  const loadScope = useOperatorStoreScope((state) => state.load);
  const { preset, from, to, setRange } = useSalesDateRangeStore();
  const [report, setReport] = useState<SalesStoreReport | null>(null);
  const [previousGross, setPreviousGross] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => { void loadScope(); }, [loadScope]);
  useEffect(() => {
    const queryFrom = searchParams.get("from");
    const queryTo = searchParams.get("to");
    const queryRange = searchParams.get("range") as SalesRangePreset | null;
    if (queryFrom && queryTo && DATE_PATTERN.test(queryFrom) && DATE_PATTERN.test(queryTo)) setRange("custom", queryFrom, queryTo);
    else {
      const safePreset = queryRange && ["today", "7d", "30d", "month"].includes(queryRange) ? queryRange as Exclude<SalesRangePreset, "custom"> : "30d";
      const next = rangeFor(safePreset);
      setRange(safePreset, next.from, next.to);
    }
  }, [searchParams, setRange]);

  const updateUrl = useCallback((nextPreset: SalesRangePreset, nextFrom: string, nextTo: string) => {
    const params = new URLSearchParams();
    if (nextPreset === "custom") { params.set("from", nextFrom); params.set("to", nextTo); }
    else params.set("range", nextPreset);
    router.replace(`/admin/operator/sales?${params}`, { scroll: false });
    setRange(nextPreset, nextFrom, nextTo);
  }, [router, setRange]);

  const load = useCallback(async () => {
    if (!token || !from || !to) return;
    setLoading(true); setNotice("");
    try {
      const duration = Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1);
      const previousToDate = new Date(`${from}T00:00:00Z`); previousToDate.setUTCDate(previousToDate.getUTCDate() - 1);
      const previousFromDate = new Date(previousToDate); previousFromDate.setUTCDate(previousFromDate.getUTCDate() - duration + 1);
      const headers = { Authorization: `Bearer ${token}` };
      const [currentResponse, previousResponse] = await Promise.all([
        fetch(`/api/admin/operator/revenue?from=${from}&to=${to}`, { cache: "no-store", headers }),
        fetch(`/api/admin/operator/revenue?from=${kstDate(previousFromDate)}&to=${kstDate(previousToDate)}`, { cache: "no-store", headers }),
      ]);
      const [current, previous] = await Promise.all([currentResponse.json(), previousResponse.json()]) as [ReportPayload, ReportPayload];
      if (!currentResponse.ok || !current.stores?.[0]) throw new Error(current.message ?? "매출 분석 데이터를 불러오지 못했습니다.");
      setReport(current.stores[0]);
      setPreviousGross(previousResponse.ok ? previous.stores?.[0]?.grossSales ?? 0 : 0);
    } catch (error) { setNotice(error instanceof Error ? error.message : "매출 분석 데이터를 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [from, to, token]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const entries = useMemo(() => report?.entries ?? [], [report]);
  const metrics = useMemo<SalesMetrics>(() => {
    const payments = entries.filter((entry) => entry.entryKind === "item_payment" && entry.amount > 0);
    const auction = payments.filter((entry) => entry.saleType === "auction");
    const shop = payments.filter((entry) => entry.saleType === "shop");
    const gross = payments.reduce((sum, entry) => sum + entry.amount, 0);
    const commission = payments.reduce((sum, entry) => sum + entry.commissionAmount, 0);
    const nextDate = payments.map((entry) => entry.settlementDate).filter((date): date is string => Boolean(date)).sort()[0] ?? null;
    return { gross, previousGross, auctionGross: auction.reduce((sum, entry) => sum + entry.amount, 0), auctionCount: auction.length, shopGross: shop.reduce((sum, entry) => sum + entry.amount, 0), shopCount: shop.length, commission, payout: Math.max(0, gross - commission), nextSettlementDate: nextDate };
  }, [entries, previousGross]);

  const applyPreset = (nextPreset: Exclude<SalesRangePreset, "custom">) => { const next = rangeFor(nextPreset); updateUrl(nextPreset, next.from, next.to); };
  const applyCustom = (nextFrom: string, nextTo: string) => { if (DATE_PATTERN.test(nextFrom) && DATE_PATTERN.test(nextTo) && nextFrom <= nextTo) updateUrl("custom", nextFrom, nextTo); else setRange("custom", nextFrom, nextTo); };
  const exportCsv = () => {
    const header = ["주문번호", "결제일시", "상품명", "판매유형", "판매가", "수수료", "실정산액", "구매자", "상태"];
    const lines = entries.map((entry) => [entry.orderNumber, entry.occurredAt, entry.productTitle ?? "상품 정보 확인", entry.saleType === "auction" ? "라이브 옥션" : "아카이브 숍", entry.amount, entry.commissionAmount, entry.amount - entry.commissionAmount, entry.buyerMasked ?? "-", entry.settlementStatus === "paid" ? "정산완료" : "정산대기"].map(csvCell).join(","));
    const blob = new Blob([`\uFEFF${header.map(csvCell).join(",")}\r\n${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `매출원장_${from}_${to}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  const storeName = report?.storeName ?? stores.find((store) => store.id === scope.storeId)?.name ?? "담당 매장";
  if (loading && !report) return <SalesSkeleton />;
  return <div className="space-y-6 text-zinc-100"><SalesHeaderFilter busy={loading} from={from} onCustom={applyCustom} onExport={exportCsv} onPreset={applyPreset} preset={preset} storeName={storeName} to={to}/>{notice && <p aria-live="polite" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{notice}</p>}<SalesMetricCards metrics={metrics}/><SalesChartsDeck entries={entries}/><SalesLedgerTable entries={entries}/></div>;
}
