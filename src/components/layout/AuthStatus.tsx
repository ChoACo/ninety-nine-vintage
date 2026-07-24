"use client";

import { Building2, LogIn, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { useAdminNavigationAccess } from "@/hooks/useAdminNavigationAccess";
import { disableWebPush } from "@/lib/webPush/client";

export function AuthStatus({ basePath = "" }: { basePath?: "" | "/m" }) {
  const pathname = usePathname();
  const router = useRouter();
  const { loading, session } = useSupabaseSession();
  const access = useAdminNavigationAccess();
  const [busy, setBusy] = useState(false);
  const fallbackReturnTo = pathname.startsWith(`${basePath}/account/login`)
    ? `${basePath}/account`
    : pathname;

  if (loading) return <span aria-label="로그인 상태 확인 중" className="inline-flex h-10 w-[105px] shrink-0 border border-line" role="status" />;
  if (!session) {
    return <Link
      aria-label="카카오 로그인"
      className="inline-flex h-10 shrink-0 items-center gap-2 border border-line px-3 text-[11px] font-bold whitespace-nowrap transition-colors hover:border-ink hover:bg-surface"
      href={`${basePath}/account/login?next=${encodeURIComponent(fallbackReturnTo)}`}
      onClick={(event) => {
        event.preventDefault();
        const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        router.push(
          `${basePath}/account/login?next=${encodeURIComponent(returnTo)}`,
        );
      }}
    ><LogIn size={15} /> 카카오 로그인</Link>;
  }
  const accountLink = access.roleCode === "operator"
    ? { href: "/admin/operator/fulfillment", label: "출고·보관", Icon: Building2 }
    : access.roleCode === "employee"
      ? { href: "/admin/employee", label: "직원센터", Icon: Building2 }
      : access.roleCode === "owner"
        ? { href: "/admin/owner", label: "소유자 센터", Icon: Building2 }
        : { href: `${basePath}/account`, label: "내 정보", Icon: UserRound };
  const AccountIcon = accountLink.Icon;
  return <div className="flex shrink-0 items-center gap-1">
    <Link aria-label={accountLink.label} className="inline-flex h-10 shrink-0 items-center gap-2 border border-line px-3 text-[11px] font-bold whitespace-nowrap" href={accountLink.href}><AccountIcon size={15} /> {accountLink.label}</Link>
    <button aria-label="로그아웃" className="inline-flex h-10 shrink-0 items-center gap-2 border border-line px-3 text-[11px] font-bold whitespace-nowrap disabled:opacity-40" disabled={busy} onClick={() => { setBusy(true); void (async () => { try { const client = getSupabaseBrowserClient(); await disableWebPush(session.access_token); await Promise.allSettled([client.auth.signOut(), fetch("/api/auth/kakao/logout", { method: "POST", credentials: "include" })]); } finally { setBusy(false); } })(); }} type="button"><LogOut size={15} /> 로그아웃</button>
  </div>;
}
