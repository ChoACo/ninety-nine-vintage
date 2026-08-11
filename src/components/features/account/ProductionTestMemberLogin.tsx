"use client";

import { FormEvent, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function ProductionTestMemberLogin({ returnTo }: { returnTo: string }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/test-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: form.get("identifier"),
          password: form.get("password"),
        }),
      });
      const payload = await response.json().catch(() => null) as
        | { error?: string; session?: { accessToken?: string; refreshToken?: string } }
        | null;
      if (
        !response.ok ||
        !payload?.session?.accessToken ||
        !payload.session.refreshToken
      ) {
        throw new Error(response.status === 429
          ? "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요."
          : "아이디 또는 비밀번호를 확인해 주세요.");
      }
      const { error } = await getSupabaseBrowserClient().auth.setSession({
        access_token: payload.session.accessToken,
        refresh_token: payload.session.refreshToken,
      });
      if (error) throw error;
      window.location.replace(returnTo);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "로그인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-md border border-line bg-paper p-7 shadow-xl shadow-black/5">
      <div className="flex items-center gap-2 text-xs font-black">
        <ShieldCheck size={16} /> 운영 검증 전용 회원 로그인
      </div>
      <h1 className="mt-4 text-2xl font-black tracking-tight">일반 회원 테스트 계정</h1>
      <p className="mt-3 text-xs leading-5 text-muted">
        승인된 운영 검증 계정만 사용할 수 있습니다. 회원가입과 계정 복구는 제공하지 않습니다.
      </p>
      <form className="mt-7 grid gap-4" onSubmit={submit}>
        <label className="grid gap-2 text-xs font-bold">
          아이디
          <input autoComplete="username" className="h-12 border border-line bg-surface px-4 font-normal" name="identifier" required />
        </label>
        <label className="grid gap-2 text-xs font-bold">
          비밀번호
          <input autoComplete="current-password" className="h-12 border border-line bg-surface px-4 font-normal" minLength={12} name="password" required type="password" />
        </label>
        <button className="h-12 bg-ink text-sm font-bold text-paper disabled:opacity-40" disabled={busy} type="submit">
          {busy ? "확인 중..." : "회원으로 로그인"}
        </button>
      </form>
      {notice && <p aria-live="polite" className="mt-4 text-xs text-red-700">{notice}</p>}
    </section>
  );
}
