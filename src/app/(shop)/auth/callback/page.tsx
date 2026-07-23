"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { safeSameOriginReturnTo } from "@/lib/kakao/returnTo";
import { completeForOwnedKakaoSession } from "@/lib/kakao/callbackFlow";

interface KakaoSessionPayload {
  idToken?: string;
  nonce?: string;
  returnTo?: string;
  error?: string;
}

interface KakaoCallbackResult {
  returnTo: string;
}

// The callback cookies are one-time credentials. Keep one operation per URL
// for the lifetime of this browser document so React StrictMode remounts do not
// consume them twice or submit the same ID token twice.
const kakaoCallbackOperations = new Map<
  string,
  Promise<KakaoCallbackResult>
>();

async function completeKakaoCallback(): Promise<KakaoCallbackResult> {
  const params = new URLSearchParams(window.location.search);
  const callbackError = params.get("error");
  if (callbackError) {
    throw new Error(`카카오 로그인에 실패했습니다. (${callbackError})`);
  }

  const flow = params.get("flow");
  const sessionPath = flow
    ? `/api/auth/kakao/session?flow=${encodeURIComponent(flow)}`
    : "/api/auth/kakao/session";
  const sessionResponse = await fetch(sessionPath, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
  });
  const sessionPayload = (await sessionResponse.json()) as KakaoSessionPayload;
  if (!sessionResponse.ok || !sessionPayload.idToken || !sessionPayload.nonce) {
    throw new Error(
      sessionPayload.error ?? "카카오 인증 세션이 만료되었습니다.",
    );
  }

  const supabase = getSupabaseBrowserClient();
  const { data: signInData, error: signInError } = await supabase.auth.signInWithIdToken({
    provider: "kakao",
    token: sessionPayload.idToken,
    nonce: sessionPayload.nonce,
  });
  if (signInError) throw signInError;
  const signedInSession = signInData.session;
  if (!signedInSession?.access_token) {
    throw new Error("회원 세션을 만들지 못했습니다.");
  }

  await completeForOwnedKakaoSession({
    session: signedInSession,
    complete: async (accessToken) => {
      const profilePath = flow
        ? `/api/auth/kakao/profile?flow=${encodeURIComponent(flow)}`
        : "/api/auth/kakao/profile";
      const profileResponse = await fetch(profilePath, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        credentials: "include",
      });
      let profilePayload: { error?: string };
      try {
        profilePayload = (await profileResponse.json()) as { error?: string };
      } catch {
        throw new Error(
          "회원 프로필 응답을 확인하지 못했습니다. 잠시 후 다시 로그인해 주세요.",
        );
      }
      if (!profileResponse.ok) {
        if (
          profileResponse.status === 422 ||
          profilePayload.error === "required_profile_incomplete"
        ) {
          throw new Error(
            "필수 프로필 제공 동의가 완료되지 않았습니다. 카카오 계정의 이름·성별·출생연도 동의를 확인한 뒤 다시 로그인해 주세요.",
          );
        }
        throw new Error(
          profilePayload.error === "duplicate_identity"
            ? "이미 다른 계정에 연결된 카카오 프로필입니다. 운영팀에 문의해 주세요."
            : "회원 프로필을 동기화하지 못했습니다. 잠시 후 다시 로그인해 주세요.",
        );
      }
    },
    getCurrentSession: async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return data.session;
    },
    signOutCurrentSession: () => supabase.auth.signOut({ scope: "local" }),
  });

  return {
    returnTo: safeSameOriginReturnTo(
      sessionPayload.returnTo,
      window.location.origin,
      window.location.pathname.startsWith("/m/") ? "/m/account" : "/account",
    ),
  };
}

function getKakaoCallbackOperation(): Promise<KakaoCallbackResult> {
  const operationKey = `${window.location.pathname}${window.location.search}`;
  const existing = kakaoCallbackOperations.get(operationKey);
  if (existing) return existing;

  const operation = completeKakaoCallback();
  kakaoCallbackOperations.set(operationKey, operation);
  return operation;
}

function AuthCallbackPage() {
  const pathname = usePathname();
  const basePath = pathname.startsWith("/m/") ? "/m" : "";
  const [message, setMessage] = useState("카카오 계정을 확인하고 있습니다.");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let redirectTimer: number | null = null;

    void getKakaoCallbackOperation().then(
      ({ returnTo }) => {
        if (!active) return;
        setMessage("로그인되었습니다. 잠시 후 이동합니다.");
        redirectTimer = window.setTimeout(
          () => window.location.replace(returnTo),
          500,
        );
      },
      (caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "카카오 로그인에 실패했습니다.");
      },
    );

    return () => {
      active = false;
      if (redirectTimer !== null) window.clearTimeout(redirectTimer);
    };
  }, []);

  return <main className="mx-auto grid min-h-[60vh] max-w-xl place-items-center px-6 py-20 text-center"><div><p className="eyebrow text-muted">카카오 · 로그인 확인</p><h1 className="mt-4 text-3xl font-black tracking-[-.08em]">{error ? "로그인을 완료하지 못했습니다." : message}</h1>{error && <><p className="mt-4 text-sm text-red-700">{error}</p><Link className="mt-8 inline-flex border border-ink px-5 py-3 text-xs font-bold" href={`${basePath}/account`}>내 정보로 돌아가기</Link></>}</div></main>;
}

export default AuthCallbackPage;
