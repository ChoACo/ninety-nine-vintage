"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface StorageProviderUsage {
  providerId: string;
  usedBytes: number;
  capacityBytes: number;
  recordCount: number;
  ratio: number;
  state: "active" | "degraded" | "offline" | "unused";
}

interface StorageUsageData {
  providers: StorageProviderUsage[];
  totalUsedBytes: number;
  totalCapacityBytes: number;
  ratio: number;
  rolloverThreshold: number;
  activeProviderId: string;
  measuredAt: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  supabase: "Supabase Storage",
  gcs: "Google Cloud Storage",
  r2: "Cloudflare R2",
  s3: "AWS S3",
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, power);
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[power]}`;
}

function getBarColor(ratio: number): string {
  if (ratio >= 0.95) return "bg-red-600";
  if (ratio >= 0.8) return "bg-amber-500";
  return "bg-emerald-600";
}

function getTextColor(ratio: number): string {
  if (ratio >= 0.95) return "text-red-700";
  if (ratio >= 0.8) return "text-amber-700";
  return "text-emerald-700";
}

function getStateBadgeClasses(state: StorageProviderUsage["state"]): string {
  if (state === "active") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (state === "degraded") return "border-amber-300 bg-amber-50 text-amber-800";
  if (state === "offline") return "border-red-300 bg-red-50 text-red-800";
  return "border-line bg-surface text-muted";
}

function getStateLabel(state: StorageProviderUsage["state"]): string {
  if (state === "active") return "Active";
  if (state === "degraded") return "Degraded";
  if (state === "offline") return "Offline";
  return "Idle";
}

export function StorageUsageGauge() {
  const [data, setData] = useState<StorageUsageData | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
        if (!session) {
          setNotice("소유자 계정으로 로그인해 주세요.");
          return;
        }
        const response = await fetch("/api/admin/owner/storage-usage", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        const payload = await response.json() as StorageUsageData & { error?: string };
        if (!response.ok) {
          throw new Error("스토리지 연동 인증 키를 확인해 주세요");
        }
        setData(payload);
      } catch {
        setNotice("스토리지 연동 인증 키를 확인해 주세요");
      }
    })();
  }, []);

  const isLoading = !data && !notice;
  const totalRatio = data ? data.ratio : 0;
  const rolloverPercent = data ? Math.round(data.rolloverThreshold * 100) : 90;

  return (
    <section className="border border-line bg-paper p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-black text-ink">멀티 클라우드 스토리지 용량 현황</p>
          <p className="mt-1 text-[10px] text-muted">임계치 {rolloverPercent}% 도달 시 다음 프로바이더로 자동 롤오버</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-line bg-surface px-3 py-1 text-[10px] font-bold text-muted">
            {data ? `${data.providers.length}개 프로바이더` : "—"}
          </span>
          {data && (
            <span className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-[10px] font-bold text-emerald-800">
              Active: {PROVIDER_LABELS[data.activeProviderId] ?? data.activeProviderId}
            </span>
          )}
        </div>
      </div>

      {notice && <p className="mt-4 text-xs text-red-700">{notice}</p>}

      {isLoading && (
        <div className="mt-5 space-y-3">
          <div className="h-6 w-full animate-pulse rounded bg-surface" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-16 animate-pulse rounded bg-surface" />
            <div className="h-16 animate-pulse rounded bg-surface" />
          </div>
        </div>
      )}

      {data && (
        <>
          <div className="mt-5 space-y-2">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-mono font-bold text-muted">전체 합산</span>
              <span className={`font-mono font-bold ${getTextColor(totalRatio)}`}>
                {formatBytes(data.totalUsedBytes)} / {formatBytes(data.totalCapacityBytes)} · {(totalRatio * 100).toFixed(1)}%
              </span>
            </div>
            <div className="relative h-3 w-full overflow-hidden rounded-full bg-surface">
              <div
                className={`h-full rounded-full transition-all duration-700 ${getBarColor(totalRatio)}`}
                style={{ width: `${Math.min(totalRatio * 100, 100)}%` }}
              />
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.providers.map((provider) => {
              const isActive = provider.providerId === data.activeProviderId;
              const label = PROVIDER_LABELS[provider.providerId] ?? provider.providerId;
              const percent = provider.capacityBytes > 0 ? (provider.ratio * 100).toFixed(1) : "—";
              return (
                <div
                  className={`border p-4 ${isActive ? "border-emerald-300 bg-emerald-50/40" : "border-line bg-paper"}`}
                  data-active={isActive ? "true" : "false"}
                  data-provider={provider.providerId}
                  key={provider.providerId}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-ink">{label}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${getStateBadgeClasses(provider.state)}`}>
                      {getStateLabel(provider.state)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px]">
                    <span className="font-mono text-muted">
                      {formatBytes(provider.usedBytes)} / {provider.capacityBytes > 0 ? formatBytes(provider.capacityBytes) : "무제한"}
                    </span>
                    <span className={`font-mono font-bold ${getTextColor(provider.ratio)}`}>{percent}{percent !== "—" ? "%" : ""}</span>
                  </div>
                  <div className="mt-2 relative h-2 w-full overflow-hidden rounded-full bg-surface">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${getBarColor(provider.ratio)}`}
                      style={{ width: provider.capacityBytes > 0 ? `${Math.min(provider.ratio * 100, 100)}%` : "0%" }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[9px] text-muted">
                    <span>레코드 {provider.recordCount.toLocaleString("ko-KR")}건</span>
                    {provider.capacityBytes > 0 && (
                      <span>남음 {formatBytes(Math.max(0, provider.capacityBytes - provider.usedBytes))}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {totalRatio >= 0.8 && (
            <div className={`mt-4 border p-3 text-[10px] font-bold ${totalRatio >= 0.95 ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
              {totalRatio >= 0.95
                ? "전체 스토리지 용량이 95%를 초과했습니다. 신규 업로드는 다른 프로바이더로 자동 라우팅됩니다."
                : "전체 스토리지 용량이 80%를 초과했습니다. 임계치 도달 시 자동으로 다음 프로바이더로 롤오버됩니다."}
            </div>
          )}
        </>
      )}
    </section>
  );
}