"use client";

import { Building2, MessageCircle } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { useAdminNavigationAccess } from "@/hooks/useAdminNavigationAccess";
import { UserMenuDropdown } from "@/components/layout/UserMenuDropdown";

export function AuthStatus({
  basePath = "",
  showWorkLink = true,
  showMyLink = true,
  className = "",
}: {
  basePath?: "" | "/m";
  showWorkLink?: boolean;
  showMyLink?: boolean;
  className?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { loading, session } = useSupabaseSession();
  const access = useAdminNavigationAccess();
  const fallbackReturnTo = pathname.startsWith(`${basePath}/account/login`)
    ? `${basePath}/account`
    : pathname;

  if (loading) return <span aria-label="로그인 상태 확인 중" className="inline-flex h-10 w-[105px] shrink-0 border border-line" role="status" />;
  if (!session) {
    return <Link
      aria-label="카카오 로그인"
      className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-kakao bg-kakao px-3 text-[11px] font-bold whitespace-nowrap text-kakao-foreground shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:brightness-95 hover:shadow-md focus-visible:ring-2 focus-visible:ring-kakao-foreground focus-visible:ring-offset-2 active:translate-y-0 active:scale-[.98]"
      href={`${basePath}/account/login?next=${encodeURIComponent(fallbackReturnTo)}`}
      onClick={(event) => {
        event.preventDefault();
        const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        router.push(
          `${basePath}/account/login?next=${encodeURIComponent(returnTo)}`,
        );
      }}
    ><MessageCircle fill="currentColor" size={15} strokeWidth={1.75} /> 카카오 로그인</Link>;
  }
  const workLink = access.roleCode === "operator"
    ? { href: "/admin/operator", label: "업무" }
    : access.roleCode === "employee"
      ? { href: "/admin/employee", label: "업무" }
      : access.roleCode === "owner"
        ? { href: "/admin/owner", label: "업무" }
        : null;
  const hasWorkLink = Boolean(showWorkLink && workLink);
  const hasMyLink = Boolean(showMyLink);
  if (!hasWorkLink && !hasMyLink) return null;
  return <div className={`flex shrink-0 items-center gap-1 ${className}`}>
    {hasWorkLink && workLink && (
      <Link aria-label={workLink.label} className="inline-flex h-10 shrink-0 items-center gap-2 border border-line px-3 text-[11px] font-bold whitespace-nowrap text-muted transition-colors hover:border-ink hover:text-ink" href={workLink.href}><Building2 size={15} /> {workLink.label}</Link>
    )}
    {hasMyLink && <UserMenuDropdown basePath={basePath} session={session} />}
  </div>;
}
