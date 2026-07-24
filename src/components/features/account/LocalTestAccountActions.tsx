"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type LocalTestAccountSlot =
  | "member-primary"
  | "operator-primary"
  | "operator-secondary"
  | "owner";

export function LocalTestAccountActions({ returnTo }: { returnTo: string }) {
  const [busy, setBusy] = useState<"cleanup" | LocalTestAccountSlot | null>(null);
  const [notice, setNotice] = useState("");

  async function signIn(slot: LocalTestAccountSlot) {
    if (busy) return;
    setBusy(slot);
    setNotice("");
    try {
      const response = await fetch("/api/local-test-accounts", {
        body: JSON.stringify({ slot }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json() as {
        error?: string;
        session?: { accessToken?: string; refreshToken?: string };
      };
      if (!response.ok || !payload.session?.accessToken || !payload.session.refreshToken) {
        throw new Error("로컬 테스트 계정을 준비하지 못했습니다.");
      }
      const { error } = await getSupabaseBrowserClient().auth.setSession({
        access_token: payload.session.accessToken,
        refresh_token: payload.session.refreshToken,
      });
      if (error) throw error;
      window.location.assign(returnTo);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "로컬 테스트 계정을 준비하지 못했습니다.");
      setBusy(null);
    }
  }

  async function cleanup() {
    if (busy || !window.confirm("로컬 테스트 회원, 운영자, 관리자 계정을 모두 삭제할까요?")) return;
    setBusy("cleanup");
    setNotice("");
    try {
      await getSupabaseBrowserClient().auth.signOut();
      const response = await fetch("/api/local-test-accounts", { method: "DELETE" });
      if (!response.ok) throw new Error("로컬 테스트 계정을 삭제하지 못했습니다.");
      setNotice("로컬 테스트 계정을 삭제했습니다. 테스트 데이터까지 모두 지우려면 npm run db:reset-local을 실행하세요.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "로컬 테스트 계정을 삭제하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-6 border border-dashed border-line bg-surface p-4 text-left">
      <p className="text-xs font-black">로컬 테스트 계정</p>
      <p className="mt-1 text-[11px] leading-5 text-muted">
        이 버튼은 localhost Supabase와 개발 모드에서만 보입니다. 계정은 없으면 생성하고, 있으면 바로 전환합니다.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button className="border border-ink px-3 py-2 text-xs font-bold disabled:opacity-50" disabled={busy !== null} onClick={() => signIn("member-primary")} type="button">
          {busy === "member-primary" ? "회원 준비 중..." : "테스트 회원으로 접속"}
        </button>
        <button className="bg-ink px-3 py-2 text-xs font-bold text-paper disabled:opacity-50" disabled={busy !== null} onClick={() => signIn("operator-primary")} type="button">
          {busy === "operator-primary" ? "운영자 계정 준비 중..." : "테스트 운영자 ID 1로 접속"}
        </button>
        <button className="bg-ink px-3 py-2 text-xs font-bold text-paper disabled:opacity-50" disabled={busy !== null} onClick={() => signIn("operator-secondary")} type="button">
          {busy === "operator-secondary" ? "운영자 계정 준비 중..." : "테스트 운영자 ID 2로 접속"}
        </button>
        <button className="bg-ink px-3 py-2 text-xs font-bold text-paper disabled:opacity-50" disabled={busy !== null} onClick={() => signIn("owner")} type="button">
          {busy === "owner" ? "관리자 계정 준비 중..." : "테스트 관리자로 접속"}
        </button>
      </div>
      <button className="mt-3 text-[11px] font-bold text-muted underline underline-offset-4 disabled:opacity-50" disabled={busy !== null} onClick={() => void cleanup()} type="button">
        {busy === "cleanup" ? "계정 삭제 중..." : "로컬 테스트 계정 모두 삭제"}
      </button>
      {notice && <p className="mt-3 text-[11px] leading-5 text-muted" role="status">{notice}</p>}
    </section>
  );
}
