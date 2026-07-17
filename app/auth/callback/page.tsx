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

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (session) finish();
    });

    const completeLogin = async () => {
      const query = new URLSearchParams(window.location.search);
      const providerError =
        query.get("error_description") || query.get("error") || null;

      if (providerError) {
        fail("카카오 로그인이 취소되었거나 승인되지 않았어요.");
        return;
      }

      try {
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
        fail("로그인을 마무리하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
    };

    void completeLogin();

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f5eee6] px-5 py-12">
      <section className="w-full max-w-md rounded-[2rem] border border-white/80 bg-[#fffaf4] p-8 text-center shadow-[0_24px_70px_rgba(79,57,42,0.14)] sm:p-10">
        <div
          aria-hidden="true"
          className="mx-auto grid size-16 place-items-center rounded-[1.4rem] bg-[#f7ded4] text-3xl"
        >
          ♡
        </div>
        <p className="mt-5 text-xs font-black tracking-[0.2em] text-[#b96858]">
          DAMINE VINTAGE
        </p>
        <h1 className="mt-2 text-2xl font-black tracking-[-0.04em] text-[#45382f]">
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
            <p className="mt-3 font-bold text-[#78665a]">
              안전하게 로그인 정보를 연결하고 있어요.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
