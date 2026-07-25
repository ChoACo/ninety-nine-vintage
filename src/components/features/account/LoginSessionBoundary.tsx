"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";

import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { resolveKakaoPostLoginReturnTo } from "@/lib/kakao/returnTo";
import { getMyNicknameState } from "@/lib/supabase/nickname";

export function LoginSessionBoundary({
  children,
  returnTo,
}: {
  children: ReactNode;
  returnTo: string;
}) {
  const { loading, session } = useSupabaseSession();

  useEffect(() => {
    let active = true;
    if (loading || !session) {
      return () => {
        active = false;
      };
    }

    const hasKakaoIdentity =
      session.user.identities?.some(
        (identity) => identity.provider === "kakao",
      ) === true;

    void (async () => {
      let nicknameInitialized = true;
      if (hasKakaoIdentity) {
        try {
          nicknameInitialized = (await getMyNicknameState()).isInitialized;
        } catch {
          // Keep the authenticated user out of the login loop. The account
          // hub can retry the nickname check and show the required gate.
          nicknameInitialized = false;
        }
      }

      if (!active) return;
      window.location.replace(
        resolveKakaoPostLoginReturnTo(returnTo, nicknameInitialized),
      );
    })();

    return () => {
      active = false;
    };
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
