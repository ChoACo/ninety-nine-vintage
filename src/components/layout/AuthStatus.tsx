"use client";

import { LogIn, LogOut, ShieldCheck, Store, UserRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface AccessSession { roleCode: string; isStaff: boolean; isOwner: boolean; canAccessOperator: boolean; canAccessOwner: boolean; }

export function AuthStatus() {
  const [signedIn, setSignedIn] = useState(false);
  const [access, setAccess] = useState<AccessSession | null>(null);
  const [busy, setBusy] = useState(false);
  const loadAccess = useCallback(async (accessToken: string | null) => {
    if (!accessToken) { setSignedIn(false); setAccess(null); return; }
    setSignedIn(true);
    try {
      const response = await fetch("/api/account/session", { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      if (!response.ok) { setAccess(null); return; }
      setAccess(((await response.json()) as { session?: AccessSession }).session ?? null);
    } catch { setAccess(null); }
  }, []);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    void client.auth.getSession().then(({ data }) => void loadAccess(data.session?.access_token ?? null));
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => void loadAccess(session?.access_token ?? null));
    return () => listener.subscription.unsubscribe();
  }, [loadAccess]);

  if (!signedIn) return <a aria-label="카카오 로그인" className="inline-flex h-10 shrink-0 items-center gap-2 border border-line px-3 text-[11px] font-bold whitespace-nowrap transition-colors hover:border-ink hover:bg-surface" href="/api/auth/kakao/start?returnTo=%2Faccount"><LogIn size={15} /> 카카오 로그인</a>;
  return <div className="flex shrink-0 items-center gap-1">
    {access?.canAccessOwner && <Link aria-label="관리자 센터" className="inline-flex h-10 shrink-0 items-center gap-1 border border-ink bg-ink px-3 text-[10px] font-bold text-paper whitespace-nowrap" href="/owner"><ShieldCheck size={13} /> 관리자</Link>}
    {access?.canAccessOperator && <Link aria-label="운영자 센터" className="inline-flex h-10 shrink-0 items-center gap-1 border border-line px-3 text-[10px] font-bold whitespace-nowrap" href="/operator"><Store size={13} /> 운영자</Link>}
    <Link aria-label="내 정보" className="inline-flex h-10 shrink-0 items-center gap-2 border border-line px-3 text-[11px] font-bold whitespace-nowrap" href="/account"><UserRound size={15} /> 내 정보</Link>
    <button aria-label="로그아웃" className="inline-flex h-10 shrink-0 items-center gap-2 border border-line px-3 text-[11px] font-bold whitespace-nowrap disabled:opacity-40" disabled={busy} onClick={() => { setBusy(true); void (async () => { const client = getSupabaseBrowserClient(); await client.auth.signOut(); await fetch("/api/auth/kakao/logout", { method: "POST", credentials: "include" }); setBusy(false); })(); }} type="button"><LogOut size={15} /> 로그아웃</button>
  </div>;
}
