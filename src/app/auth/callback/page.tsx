"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  const [message, setMessage] = useState("카카오 계정을 확인하고 있습니다.");
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const callbackError = params.get("error");
        if (callbackError) throw new Error(`카카오 로그인에 실패했습니다. (${callbackError})`);
        const sessionResponse = await fetch("/api/auth/kakao/session", { method: "POST", credentials: "include", cache: "no-store" });
        const sessionPayload = await sessionResponse.json() as { idToken?: string; nonce?: string; returnTo?: string; error?: string };
        if (!sessionResponse.ok || !sessionPayload.idToken || !sessionPayload.nonce) throw new Error(sessionPayload.error ?? "카카오 인증 세션이 만료되었습니다.");
        const { error: signInError } = await getSupabaseBrowserClient().auth.signInWithIdToken({ provider: "kakao", token: sessionPayload.idToken, nonce: sessionPayload.nonce });
        if (signInError) throw signInError;
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        if (!data.session?.access_token) throw new Error("회원 세션을 만들지 못했습니다.");
        const profileResponse = await fetch("/api/auth/kakao/profile", { method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}` }, credentials: "include" });
        const profilePayload = await profileResponse.json() as { error?: string };
        if (!profileResponse.ok && profileResponse.status !== 422) throw new Error(profilePayload.error ?? "회원 프로필을 동기화하지 못했습니다.");
        setMessage("로그인되었습니다. 잠시 후 이동합니다.");
        const returnTo = sessionPayload.returnTo?.startsWith("/") && !sessionPayload.returnTo.startsWith("//") ? sessionPayload.returnTo : "/account";
        window.setTimeout(() => window.location.replace(returnTo), 500);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "카카오 로그인에 실패했습니다.");
      }
    })();
  }, []);

  return <main className="mx-auto grid min-h-[60vh] max-w-xl place-items-center px-6 py-20 text-center"><div><p className="eyebrow text-muted">KAKAO / AUTHENTICATION</p><h1 className="mt-4 text-3xl font-black tracking-[-.08em]">{error ? "로그인을 완료하지 못했습니다." : message}</h1>{error && <><p className="mt-4 text-sm text-red-700">{error}</p><Link className="mt-8 inline-flex border border-ink px-5 py-3 text-xs font-bold" href="/account">내 정보로 돌아가기</Link></>}</div></main>;
}
