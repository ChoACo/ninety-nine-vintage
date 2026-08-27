"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface R2StorageUsage {
  providerId: "r2";
  bucketName: string;
  usedBytes: number;
  objectCount: number;
  usageVerified: true;
}

interface StorageUsageData {
  provider: R2StorageUsage;
  totalUsedBytes: number;
  totalObjectCount: number;
  measuredAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, power);
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[power]}`;
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
        const payload = await response.json() as StorageUsageData & { error?: string; message?: string };
        if (!response.ok) {
          throw new Error(payload.message ?? payload.error ?? "스토리지 연동 인증 키를 확인해 주세요");
        }
        setData(payload);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "스토리지 연동 인증 키를 확인해 주세요");
      }
    })();
  }, []);

  const isLoading = !data && !notice;
  return (
    <section className="border border-line bg-paper p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-black text-ink">R2 스토리지 사용 현황</p>
          <p className="mt-1 text-[10px] text-muted">Cloudflare R2 버킷을 직접 조회한 현재 사용량입니다.</p>
        </div>
        <span className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-[10px] font-bold text-emerald-800">
          Cloudflare R2
        </span>
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
        <div className="mt-5 rounded-2xl border border-emerald-300 bg-emerald-50/40 p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold text-muted">현재 사용 중</p>
              <p className="mt-2 font-mono text-3xl font-black tracking-[-.05em] text-ink">
                {formatBytes(data.totalUsedBytes)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-muted">저장 객체</p>
              <p className="mt-2 font-mono text-lg font-black text-ink">
                {data.totalObjectCount.toLocaleString("ko-KR")}개
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-emerald-200 pt-3 text-[9px] text-muted">
            <span>버킷 {data.provider.bucketName}</span>
            <time dateTime={data.measuredAt}>조회 {new Date(data.measuredAt).toLocaleString("ko-KR")}</time>
          </div>
          <p className="mt-3 text-[9px] leading-4 text-muted">R2는 종량제이므로 한계 용량과 사용률 대신 실제 저장 바이트를 표시합니다.</p>
        </div>
      )}
    </section>
  );
}
