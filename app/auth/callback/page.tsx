"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/src/lib/supabase/client";

export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let hasRedirected = false;
    const client = getSupabaseBrowserClient();

    const finish = () => {
      if (!active || hasRedirected) return;
      hasRedirected = true;
      window.location.replace("/");
    };

    const fail = (message: string) => {
      if (active && !hasRedirected) setError(message);
    };

    const completeLogin = async () => {
      let kakaoSessionCreated = false;
      const query = new URLSearchParams(window.location.search);
      const providerError =
        query.get("error_description") || query.get("error") || null;

      if (providerError) {
        fail("카카오 로그인이 취소되었거나 승인되지 않았어요.");
        return;
      }

      try {
        if (query.get("kakao_oidc") === "1") {
          const tokenResponse = await fetch("/api/auth/kakao/session", {
            method: "POST",
            headers: { Accept: "application/json" },
            credentials: "same-origin",
            cache: "no-store",
          });
          const tokenPayload = (await tokenResponse.json()) as {
            idToken?: unknown;
            nonce?: unknown;
          };
          if (
            !tokenResponse.ok ||
            typeof tokenPayload.idToken !== "string" ||
            typeof tokenPayload.nonce !== "string"
          ) {
            throw new Error("Kakao OIDC handoff expired.");
          }

          const { data, error: idTokenError } =
            await client.auth.signInWithIdToken({
              provider: "kakao",
              token: tokenPayload.idToken,
              nonce: tokenPayload.nonce,
            });
          if (idTokenError) throw idTokenError;
          if (data.session) {
            kakaoSessionCreated = true;
            const profileResponse = await fetch("/api/auth/kakao/profile", {
              method: "POST",
              headers: {
                Accept: "application/json",
                Authorization: `Bearer ${data.session.access_token}`,
              },
              credentials: "same-origin",
              cache: "no-store",
            });
            if (!profileResponse.ok) {
              throw new Error("Kakao profile synchronization failed.");
            }
            finish();
            return;
          }
        }

        const { data: current, error: sessionError } =
          await client.auth.getSession();
        if (sessionError) throw sessionError;
        if (current.session) {
          finish();
          return;
        }

        // This also supports a future switch from the browser implicit flow to
        // PKCE without changing the public callback URL.
        const code = query.get("code");
        if (code) {
          const { data, error: exchangeError } =
            await client.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
          if (data.session) {
            finish();
            return;
          }
        }

        fail("로그인 정보를 확인하지 못했어요. 처음부터 다시 시도해 주세요.");
      } catch {
        if (kakaoSessionCreated) {
          await client.auth.signOut();
        }
        fail("로그인을 마무리하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    };

    void completeLogin();

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="theme-app-shell grid min-h-dvh place-items-center px-5 py-12">
      <section className="theme-panel w-full max-w-md rounded-[2rem] border p-8 text-center sm:p-10">
        <div
          aria-hidden="true"
          className="mx-auto grid size-16 place-items-center rounded-[1.4rem] bg-[#f7ded4] text-3xl"
        >
          ♡
        </div>
        <p className="mt-5 text-xs font-black tracking-[0.2em] text-[#b96858]">
          DAMINE VINTAGE
        </p>
        <h1 className="mt-2 text-2xl font-black tracking-[-0.04em] text-[var(--text-strong)]">
          {error ? "로그인을 완료하지 못했어요" : "카카오 로그인 확인 중"}
        </h1>

        {error ? (
          <>
            <p role="alert" className="mt-3 font-bold leading-7 text-[#9f4c41]">
              {error}
            </p>
            <Link
              href="/"
              className="mt-6 inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#e97764] px-6 font-black text-white shadow-sm transition hover:bg-[#d96755] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e97764] focus-visible:ring-offset-2"
            >
              홈으로 돌아가기
            </Link>
          </>
        ) : (
          <div className="mt-5" role="status" aria-live="polite">
            <span
              aria-hidden="true"
              className="mx-auto block size-7 animate-spin rounded-full border-3 border-[#e4c8b8] border-r-[#d66e5b]"
            />
            <p className="mt-3 font-bold text-[var(--text-muted)]">
              안전하게 로그인 정보를 연결하고 있어요.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
