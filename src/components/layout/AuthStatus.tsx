"use client";

import { Building2, LogIn, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { useAdminNavigationAccess } from "@/hooks/useAdminNavigationAccess";

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
    {hasMyLink && (
      <Link aria-label="MY" className="inline-flex h-10 shrink-0 items-center gap-2 border border-line px-3 text-[11px] font-bold whitespace-nowrap text-muted transition-colors hover:border-ink hover:text-ink" href={`${basePath}/account`}><UserRound size={15} /> MY</Link>
    )}
  </div>;
}
