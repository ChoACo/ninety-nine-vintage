"use client";

import { useEffect, useState } from "react";

interface TokenUsageData {
  totalTokens: number;
  primaryCalls: number;
  fallbackCalls: number;
  primaryModel: string;
}

const MONTHLY_LIMIT = 1_000_000;

function getGaugeColor(percentage: number): string {
  if (percentage >= 95) return "bg-red-600";
  if (percentage >= 80) return "bg-amber-500";
  return "bg-emerald-600";
}

function getTextColor(percentage: number): string {
  if (percentage >= 95) return "text-red-700";
  if (percentage >= 80) return "text-amber-700";
  return "text-emerald-700";
}

function getBorderColor(percentage: number): string {
  if (percentage >= 95) return "border-red-200 bg-red-50";
  if (percentage >= 80) return "border-amber-200 bg-amber-50";
  return "border-emerald-200 bg-emerald-50";
}

export function TokenUsageGauge() {
  const [data, setData] = useState<TokenUsageData | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/admin/owner/token-usage", {
          cache: "no-store",
        });
        const payload = await response.json() as TokenUsageData & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "토큰 사용량을 불러오지 못했습니다.");
        setData(payload);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "토큰 사용량을 불러오지 못했습니다.");
      }
    })();
  }, []);

  const isLoading = !data && !notice;

  return (
    <section className="border border-line bg-paper p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-black text-ink">AI 토큰 사용 현황</p>
          <p className="mt-1 text-[10px] text-muted">월간 한도 {MONTHLY_LIMIT.toLocaleString("ko-KR")} 토큰</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-[10px] font-bold ${isLoading ? "bg-surface text-muted" : data && data.fallbackCalls > 0 ? "border border-amber-300 bg-amber-50 text-amber-800" : "border border-emerald-300 bg-emerald-50 text-emerald-800"}`}>
            {isLoading ? "로딩 중" : data && data.fallbackCalls > 0 ? "Fallback 활성" : "Primary 정상"}
          </span>
        </div>
      </div>

      {notice && <p className="mt-4 text-xs text-red-700">{notice}</p>}

      {isLoading && (
        <div className="mt-5 space-y-3">
          <div className="h-6 w-full animate-pulse rounded bg-surface" />
          <div className="flex justify-between text-[10px] text-muted">
            <div className="h-3 w-16 animate-pulse rounded bg-surface" />
            <div className="h-3 w-16 animate-pulse rounded bg-surface" />
          </div>
        </div>
      )}

      {data && (
        <div className="mt-5 space-y-3">
          <div className="relative h-6 w-full overflow-hidden rounded-full bg-surface">
            <div
              className={`h-full rounded-full transition-all duration-700 ${getGaugeColor((data.totalTokens / MONTHLY_LIMIT) * 100)}`}
              style={{ width: `${Math.min((data.totalTokens / MONTHLY_LIMIT) * 100, 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className={`font-mono font-bold ${getTextColor((data.totalTokens / MONTHLY_LIMIT) * 100)}`}>
              {data.totalTokens.toLocaleString("ko-KR")}
            </span>
            <span className="text-muted">
              {MONTHLY_LIMIT.toLocaleString("ko-KR")} · {((data.totalTokens / MONTHLY_LIMIT) * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      )}

      {data && (
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4">
          <div>
            <p className="text-[10px] text-muted">Primary 호출</p>
            <p className="mt-1 font-mono text-sm font-bold">{data.primaryCalls.toLocaleString("ko-KR")}건</p>
          </div>
          <div>
            <p className="text-[10px] text-muted">Fallback 호출</p>
            <p className={`mt-1 font-mono text-sm font-bold ${data.fallbackCalls > 0 ? "text-amber-700" : ""}`}>{data.fallbackCalls.toLocaleString("ko-KR")}건</p>
          </div>
          <div>
            <p className="text-[10px] text-muted">사용 중 모델</p>
            <p className="mt-1 truncate text-[10px] font-bold">{data.primaryModel.split("/")[1] ?? data.primaryModel}</p>
          </div>
        </div>
      )}

      {data && (data.totalTokens / MONTHLY_LIMIT) >= 0.8 && (
        <div className={`mt-4 border p-3 text-[10px] font-bold ${getBorderColor((data.totalTokens / MONTHLY_LIMIT) * 100)}`}>
          {(data.totalTokens / MONTHLY_LIMIT) >= 0.95
            ? "월간 토큰 한도를 거의 소진했습니다. 과금을 확인하세요."
            : "월간 토큰 사용량이 80%를 초과했습니다. 사용량을 모니터링하세요."}
        </div>
      )}
    </section>
  );
}