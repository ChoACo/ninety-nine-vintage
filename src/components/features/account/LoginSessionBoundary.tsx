"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";

import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { resolveKakaoPostLoginReturnTo } from "@/lib/kakao/returnTo";

export function LoginSessionBoundary({
  children,
  returnTo,
}: {
  children: ReactNode;
  returnTo: string;
}) {
  const { loading, session } = useSupabaseSession();

  useEffect(() => {
    if (loading || !session) {
      return;
    }

    window.location.replace(resolveKakaoPostLoginReturnTo(returnTo));
  }, [loading, returnTo, session]);

  if (loading || session) {
    return (
      <div
        className="grid min-h-48 place-items-center text-sm text-muted"
        role="status"
      >
        {session
          ? "로그인된 계정으로 이동하고 있습니다."
          : "로그인 상태를 확인하고 있습니다."}
      </div>
    );
  }

  return children;
}
