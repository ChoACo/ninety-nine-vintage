"use client";

import Link from "next/link";
import { ShieldCheck, Store } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface AccessSession { userId: string; displayName: string; roleCode: string; gradeLevel: number; isStaff: boolean; isOwner: boolean; canAccessOperator: boolean; canAccessOwner: boolean; }

const roleLabels: Record<string, string> = { owner: "OWNER / 소유자", operator: "OPERATOR / 운영자", employee: "EMPLOYEE / 직원", band_member: "BAND MEMBER / 밴드 회원", member: "MEMBER / 일반 회원" };

export function AccountSessionPanel() {
  const [access, setAccess] = useState<AccessSession | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        if (!data.session?.access_token) return;
        const response = await fetch("/api/account/session", { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
        if (response.ok) setAccess(((await response.json()) as { session?: AccessSession }).session ?? null);
      } finally { setLoaded(true); }
    })();
  }, []);
  if (!loaded || !access) return null;
  return <section className="border border-ink bg-surface p-6"><div className="flex items-start justify-between gap-6"><div><p className="eyebrow text-muted">ACCESS / CURRENT SESSION</p><h2 className="mt-2 text-xl font-black tracking-[-0.05em]">현재 권한 세션</h2><p className="mt-2 text-xs text-muted">{access.displayName} · {access.userId}</p></div><span className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-bold text-emerald-800"><ShieldCheck size={14} /> {roleLabels[access.roleCode] ?? access.roleCode}</span></div><div className="mt-5 flex flex-wrap gap-2">{access.canAccessOwner && <Link className="inline-flex items-center gap-2 border border-ink bg-paper px-4 py-3 text-xs font-bold" href="/owner"><ShieldCheck size={14} /> 관리자 센터</Link>}{access.canAccessOperator && <Link className="inline-flex items-center gap-2 border border-ink bg-paper px-4 py-3 text-xs font-bold" href="/operator"><Store size={14} /> 운영자 센터</Link>}</div></section>;
}
