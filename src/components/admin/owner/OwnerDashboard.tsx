"use client";

import { Building2, Clock3, Database, Settings, ShieldCheck, Store, UsersRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { OwnerManualTransferAccountPanel } from "@/components/admin/owner/OwnerManualTransferAccountPanel";
import { OwnerSiteStatusPanel } from "@/components/admin/owner/OwnerSiteStatusPanel";
import { LocalTestMemberSwitcher } from "@/components/admin/LocalTestMemberSwitcher";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useOwnerMemberMode } from "@/components/features/auth/OwnerMemberModeProvider";

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
  orders?: Array<{ id: string; status: string; total: number }>;
  auditCount?: number;
}

export function OwnerDashboard({
  enableLocalTestMembers = false,
}: Readonly<{ enableLocalTestMembers?: boolean }>) {
  const [data, setData] = useState<Overview | null>(null);
  const [notice, setNotice] = useState("");
  const memberMode = useOwnerMemberMode();

  useEffect(() => {
    void (async () => {
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
        if (!session) {
          setNotice("소유자 계정으로 로그인해 주세요.");
          return;
        }
        const response = await fetch("/api/admin/owner/overview", {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        const payload = await response.json() as Overview & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "소유자 데이터를 불러오지 못했습니다.");
        setData(payload);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "소유자 데이터를 불러오지 못했습니다.");
      }
    })();
  }, []);

  const stores = data?.stores ?? [];
  const orders = data?.orders ?? [];
  const paidTotal = orders
    .filter((order) => order.status === "paid" || order.status === "shipped")
    .reduce((sum, order) => sum + Number(order.total), 0);

  return (
    <div className="space-y-10">
      <div className="flex flex-col items-start justify-between gap-5 border-b border-ink pb-7">
        <div>
          <p className="eyebrow text-muted">관리자 · 전체 매장</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-.07em] md:text-4xl md:tracking-[-.08em]">관리자 센터</h1>
          <p className="mt-3 text-sm text-muted">사이트 설정과 권한, 센터(매장)와 인력 배치, 감사 로그를 관리합니다. 상품·입금·배송 실무는 운영자 센터에서 처리합니다.</p>
        </div>
        <span className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-bold text-emerald-800"><ShieldCheck size={13} /> 소유자 권한</span>
      </div>
      {notice && <div className="border border-dashed border-line bg-surface p-6 text-sm">{notice}</div>}
      {enableLocalTestMembers && <LocalTestMemberSwitcher />}
      {memberMode.eligible && (
        <section className="border border-amber-300 bg-amber-50 p-5">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="inline-flex items-center gap-2 text-xs font-black text-amber-950">
                <Clock3 size={15} /> 회원 화면 임시 확인
              </p>
              <p className="mt-2 text-xs leading-5 text-amber-900">
                저장된 소유자 권한은 변경하지 않고 3분 동안 회원과 같은 권한으로 사이트를 확인합니다.
              </p>
            </div>
            <button
              className="h-11 shrink-0 bg-amber-950 px-5 text-xs font-bold text-white disabled:opacity-40"
              disabled={memberMode.busy}
              onClick={() => {
                void memberMode.run("activate").then((activated) => {
                  if (activated) window.location.assign("/home");
                  else setNotice("임시 회원 권한을 활성화하지 못했습니다.");
                });
              }}
              type="button"
            >
              3분간 회원 권한 활성화
            </button>
          </div>
        </section>
      )}
      <div className="grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-3">
        <div className="bg-paper p-6"><Store size={17} /><p className="mt-8 text-xs text-muted">운영 중인 센터(매장)</p><p className="mt-2 font-mono text-3xl font-bold">{stores.filter((store) => store.is_active).length}</p></div>
        <div className="bg-paper p-6"><Database size={17} /><p className="mt-8 text-xs text-muted">결제 완료 거래</p><p className="mt-2 font-mono text-3xl font-bold">{paidTotal.toLocaleString("ko-KR")}원</p></div>
        <div className="bg-ink p-6 text-paper"><p className="eyebrow text-zinc-400">감사 · 활동 기록</p><p className="mt-8 font-mono text-3xl font-bold">{data?.auditCount ?? 0}</p><p className="mt-2 text-xs text-zinc-400">감사 로그</p></div>
      </div>
      <OwnerManualTransferAccountPanel />
      <OwnerSiteStatusPanel />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link className="flex items-center gap-3 border border-ink p-5 text-sm font-bold" href="/admin/owner/stores"><Building2 size={18} /> 센터(매장)·인력 배치</Link>
        <Link className="flex items-center gap-3 border border-ink p-5 text-sm font-bold" href="/admin/owner/members"><UsersRound size={18} /> 회원·운영자·직원 권한</Link>
        <Link className="flex items-center gap-3 border border-ink p-5 text-sm font-bold" href="/admin/operator"><Settings size={18} /> 운영자 실무 화면 확인</Link>
      </div>
    </div>
  );
}
