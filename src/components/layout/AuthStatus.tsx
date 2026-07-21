"use client";

import { LogIn, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

export function AuthStatus() {
  const { loading, session } = useSupabaseSession();
  const [busy, setBusy] = useState(false);

  if (loading) return <span aria-label="로그인 상태 확인 중" className="inline-flex h-10 w-[105px] shrink-0 border border-line" role="status" />;
  if (!session) return <Link aria-label="카카오 로그인" className="inline-flex h-10 shrink-0 items-center gap-2 border border-line px-3 text-[11px] font-bold whitespace-nowrap transition-colors hover:border-ink hover:bg-surface" href="/account/login?next=%2Faccount"><LogIn size={15} /> 카카오 로그인</Link>;
  return <div className="flex shrink-0 items-center gap-1">
    <Link aria-label="내 정보" className="inline-flex h-10 shrink-0 items-center gap-2 border border-line px-3 text-[11px] font-bold whitespace-nowrap" href="/account"><UserRound size={15} /> 내 정보</Link>
    <button aria-label="로그아웃" className="inline-flex h-10 shrink-0 items-center gap-2 border border-line px-3 text-[11px] font-bold whitespace-nowrap disabled:opacity-40" disabled={busy} onClick={() => { setBusy(true); void (async () => { try { const client = getSupabaseBrowserClient(); await Promise.allSettled([client.auth.signOut(), fetch("/api/auth/kakao/logout", { method: "POST", credentials: "include" })]); } finally { setBusy(false); } })(); }} type="button"><LogOut size={15} /> 로그아웃</button>
  </div>;
}
