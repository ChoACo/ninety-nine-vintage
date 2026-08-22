"use client";

import { Building2, MessageSquareText, Settings, ShieldCheck, UsersRound } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

import { OwnerManualTransferAccountPanel } from "@/components/admin/owner/OwnerManualTransferAccountPanel";
import { OwnerMemberAccessPanel } from "@/components/admin/owner/OwnerMemberAccessPanel";
import { OwnerSiteStatusPanel } from "@/components/admin/owner/OwnerSiteStatusPanel";
import { StorageUsageGauge } from "@/components/admin/owner/StorageUsageGauge";
import { TokenUsageGauge } from "@/components/admin/owner/TokenUsageGauge";
import { LocalTestMemberSwitcher } from "@/components/admin/LocalTestMemberSwitcher";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { clearOwnerMemberAccessMarker } from "@/lib/ownerMemberAccess";
import { useOwnerScopeStore } from "@/store/useOwnerScopeStore";
import { OwnerMetricSkeleton } from "@/components/admin/owner/OwnerSkeletons";
const OwnerBusinessAnalytics = dynamic(() => import("@/components/admin/owner/OwnerBusinessAnalytics").then((module) => module.OwnerBusinessAnalytics), { loading: () => <div className="h-72 animate-pulse border border-line bg-surface" role="status" aria-label="운영 분석 불러오는 중" /> });

interface StoreRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  operator_id: string;
  is_active: boolean;
}
interface Overview {
  stores?: StoreRow[];
  auditCount?: number;
  metrics?: { gmv: number; netCommission: number; activeAuctions: number; vaultItems: number; vaultRiskCount: number };
  analytics?: {
    revenue: Array<{ date: string; amount: number; previousAmount: number }>;
    auction: { sold: number; unsold: number };
    vaultFlow: Array<{ date: string; stored: number; shipped: number }>;
  };
}

export function OwnerDashboard({
  enableLocalTestMembers = false,
}: Readonly<{ enableLocalTestMembers?: boolean }>) {
  const [data, setData] = useState<Overview | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const selectedStoreId = useOwnerScopeStore((state) => state.selectedStoreId);
  const setScopeStores = useOwnerScopeStore((state) => state.setStores);

  const loadOverview = useCallback(async () => {
      try {
        setNotice("");
        setLoading(true);
        const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
        if (!session) {
          setNotice("소유자 계정으로 로그인해 주세요.");
          return;
        }
        const query = selectedStoreId ? `?storeId=${encodeURIComponent(selectedStoreId)}` : "";
        const response = await fetch(`/api/admin/owner/overview${query}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        const payload = await response.json() as Overview & { error?: string };
        if (!response.ok) throw new Error("owner_overview_unavailable");
        clearOwnerMemberAccessMarker();
        setData(payload);
        setScopeStores(payload.stores ?? []);
      } catch (error) {
        setNotice(error instanceof Error && error.message === "owner_overview_unavailable" ? "소유자 정보를 불러오는 중 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요." : "소유자 정보를 불러오지 못했습니다. 다시 시도해 주세요.");
      } finally {
        setLoading(false);
      }
  }, [selectedStoreId, setScopeStores]);

  useEffect(() => {
    queueMicrotask(() => { void loadOverview(); });
  }, [loadOverview]);

  const metrics = data?.metrics;

  return (
    <div className="space-y-10">
      <div className="flex flex-col items-start justify-between gap-5 border-b border-ink pb-7">
        <div>
          <p className="eyebrow text-zinc-500">Owner Center · {selectedStoreId ? "개별 센터" : "전체 플랫폼"}</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-.07em] text-zinc-100 md:text-4xl md:tracking-[-.08em]">플랫폼 총괄</h1>
          <p className="mt-3 text-sm text-muted">사이트 설정과 권한, 센터(매장)와 인력 배치, 감사 로그를 관리합니다. 상품·입금·배송 실무는 운영자 센터에서 처리합니다.</p>
        </div>
        <span className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-bold text-emerald-800"><ShieldCheck size={13} /> 소유자 권한</span>
      </div>
      {notice && <div className="rounded-2xl border border-dashed border-line bg-surface p-6 text-sm"><p>{notice}</p><button className="mt-4 min-h-11 rounded-xl border border-line bg-paper px-4 text-xs font-bold hover:border-ink focus-visible:ring-2 focus-visible:ring-ink" onClick={() => void loadOverview()} type="button">다시 시도</button></div>}
      {enableLocalTestMembers && <LocalTestMemberSwitcher />}
      <OwnerMemberAccessPanel />
      {loading && !data ? <OwnerMetricSkeleton /> : <div className="grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        {[{ label: "플랫폼 GMV", value: `${Number(metrics?.gmv ?? 0).toLocaleString("ko-KR")}원` }, { label: "순 플랫폼 수수료", value: `${Number(metrics?.netCommission ?? 0).toLocaleString("ko-KR")}원` }, { label: "진행 중 경매", value: `${metrics?.activeAuctions ?? 0}건` }, { label: "보관 상품", value: `${metrics?.vaultItems ?? 0}건`, note: `D-3 위험 ${metrics?.vaultRiskCount ?? 0}건` }].map((metric) => <div className="bg-zinc-950 p-6 text-zinc-100" key={metric.label}><p className="text-xs text-zinc-500">{metric.label}</p><p className="mt-8 font-mono text-2xl font-bold">{loading ? "—" : metric.value}</p>{metric.note && <p className="mt-2 text-xs text-rose-400">{metric.note}</p>}</div>)}
      </div>}
      {data?.analytics && <OwnerBusinessAnalytics {...data.analytics} />}
      <OwnerManualTransferAccountPanel />
      <div className="grid gap-4 md:grid-cols-2">
        <TokenUsageGauge />
        <StorageUsageGauge />
      </div>
      <OwnerSiteStatusPanel />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link className="flex items-center gap-3 border border-ink p-5 text-sm font-bold" href="/admin/owner/stores"><Building2 size={18} /> 센터(매장)·인력 배치</Link>
        <Link className="flex items-center gap-3 border border-ink p-5 text-sm font-bold" href="/admin/owner/members"><UsersRound size={18} /> 회원·운영자·직원 권한</Link>
        <Link className="flex items-center gap-3 border border-ink p-5 text-sm font-bold" href="/admin/owner/onboarding"><MessageSquareText size={18} /> 입점 전용 상담</Link>
        <Link className="flex items-center gap-3 border border-ink p-5 text-sm font-bold" href="/admin/operator"><Settings size={18} /> 운영자 실무 화면 확인</Link>
      </div>
    </div>
  );
}
