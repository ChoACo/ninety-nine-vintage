"use client";

import { LogIn, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function AuthStatus() {
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const client = getSupabaseBrowserClient();
    void client.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)));
    return () => listener.subscription.unsubscribe();
  }, []);
  if (!signedIn) return <a aria-label="카카오 로그인" className="inline-flex h-10 shrink-0 items-center gap-2 border border-line px-3 text-[11px] font-bold whitespace-nowrap transition-colors hover:border-ink hover:bg-surface" href="/api/auth/kakao/start?returnTo=%2Faccount"><LogIn size={15} /> 카카오 로그인</a>;
  return <div className="flex shrink-0 items-center gap-1"><Link aria-label="내 정보" className="inline-flex h-10 shrink-0 items-center gap-2 border border-line px-3 text-[11px] font-bold whitespace-nowrap" href="/account"><UserRound size={15} /> 내 정보</Link><button aria-label="로그아웃" className="inline-flex h-10 shrink-0 items-center gap-2 border border-line px-3 text-[11px] font-bold whitespace-nowrap disabled:opacity-40" disabled={busy} onClick={() => { setBusy(true); void (async () => { const client = getSupabaseBrowserClient(); await client.auth.signOut(); await fetch("/api/auth/kakao/logout", { method: "POST", credentials: "include" }); setBusy(false); })(); }} type="button"><LogOut size={15} /> 로그아웃</button></div>;
}
