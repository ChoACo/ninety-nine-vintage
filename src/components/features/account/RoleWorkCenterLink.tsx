"use client";

import { ArrowUpRight, Building2 } from "lucide-react";
import Link from "next/link";
import { useAdminNavigationAccess } from "@/hooks/useAdminNavigationAccess";
import { getMobileRoleNavigation } from "@/lib/admin/mobileNavigation";

export function RoleWorkCenterLink() {
  const access = useAdminNavigationAccess();
  if (access.loading) {
    return <div aria-label="업무 권한 확인 중" className="h-20 animate-pulse border border-line bg-surface" role="status" />;
  }
  const navigation = getMobileRoleNavigation(access.roleCode);
  if (!navigation.isStaff) return null;
  const label = access.roleCode === "operator"
    ? "판매센터"
    : access.roleCode === "employee"
      ? "직원센터"
      : "사이트 관리";
  return (
    <Link className="flex items-center gap-4 border border-ink bg-ink p-5 text-paper" href={navigation.centerHref}>
      <Building2 className="shrink-0" size={20} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-black">{label}로 이동</span>
        <span className="mt-1 block text-[11px] text-paper/70">구매 화면과 업무 화면을 분리해 관리합니다.</span>
      </span>
      <ArrowUpRight className="shrink-0" size={17} />
    </Link>
  );
}
