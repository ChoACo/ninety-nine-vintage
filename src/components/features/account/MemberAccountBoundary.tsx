"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useSupabaseSession } from "@/hooks/useSupabaseSession";

export function MemberAccountBoundary({
  basePath = "",
  children,
  returnTo = `${basePath}/account`,
}: {
  basePath?: "" | "/m";
  children: React.ReactNode;
  returnTo?: string;
}) {
  const router = useRouter();
  const { loading, session } = useSupabaseSession();

  useEffect(() => {
    if (!loading && !session) {
      router.replace(
        `${basePath}/account/login?next=${encodeURIComponent(returnTo)}`,
      );
    }
  }, [basePath, loading, returnTo, router, session]);

  if (loading || !session) {
    return (
      <div
        className="grid min-h-[50vh] place-items-center text-sm text-muted"
        role="status"
      >
        {loading ? "로그인 상태를 확인하고 있습니다." : "로그인 화면으로 이동합니다."}
      </div>
    );
  }

  return children;
}
