"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAdminNavigationAccess } from "@/hooks/useAdminNavigationAccess";

export default function AdminPage() {
  const access = useAdminNavigationAccess();
  const router = useRouter();

  useEffect(() => {
    if (access.loading) return;
    if (access.roleCode === "owner") {
      router.replace("/admin/owner");
    } else if (access.roleCode === "operator") {
      router.replace("/admin/operator");
    } else if (access.roleCode === "employee") {
      router.replace("/admin/employee");
    }
  }, [access.loading, access.roleCode, router]);

  return (
    <div
      className="grid min-h-[420px] place-items-center border border-dashed border-line bg-surface text-sm text-muted"
      role="status"
    >
      계정의 센터 권한을 확인하고 있습니다.
    </div>
  );
}
