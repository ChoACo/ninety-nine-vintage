"use client";

import { Trash2, UserRoundCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type MemberSlot = "member-primary";

interface TestAccountStatus {
  created: boolean;
  displayName: string;
  role: "member" | "operator" | "owner";
  slot: MemberSlot | "operator-primary" | "operator-secondary" | "owner";
}

const MEMBER_SLOTS: readonly MemberSlot[] = ["member-primary"];

async function fetchAccountStatuses() {
  const response = await fetch("/api/local-test-accounts", {
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as {
    accounts?: TestAccountStatus[];
  } | null;
  return response.ok ? payload?.accounts ?? [] : null;
}

export function LocalTestMemberSwitcher() {
  const [accounts, setAccounts] = useState<TestAccountStatus[]>([]);
  const [busy, setBusy] = useState<MemberSlot | "cleanup" | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const nextAccounts = await fetchAccountStatuses();
    if (nextAccounts) setAccounts(nextAccounts);
  }, []);

  useEffect(() => {
    let active = true;
    void fetchAccountStatuses().then((nextAccounts) => {
      if (active && nextAccounts) setAccounts(nextAccounts);
    });
    return () => {
      active = false;
    };
  }, []);

  async function accessMember(slot: MemberSlot) {
    if (busy) return;
    setBusy(slot);
    setNotice("");
    try {
      const response = await fetch("/api/local-test-accounts", {
        body: JSON.stringify({ slot }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json().catch(() => null) as {
        session?: { accessToken?: string; refreshToken?: string };
      } | null;
      if (
        !response.ok ||
        !payload?.session?.accessToken ||
        !payload.session.refreshToken
      ) {
        throw new Error("테스트 회원 계정을 준비하지 못했습니다.");
      }
      const { error } = await getSupabaseBrowserClient().auth.setSession({
        access_token: payload.session.accessToken,
        refresh_token: payload.session.refreshToken,
      });
      if (error) throw error;
      window.location.assign("/home");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "테스트 회원 계정을 준비하지 못했습니다.",
      );
      setBusy(null);
    }
  }

  async function deleteMembers() {
    if (
      busy ||
      !window.confirm(
        "테스트 회원의 로그인 계정을 삭제할까요?",
      )
    ) {
      return;
    }
    setBusy("cleanup");
    setNotice("");
    try {
      for (const slot of MEMBER_SLOTS) {
        const response = await fetch("/api/local-test-accounts", {
          body: JSON.stringify({ slot }),
          headers: { "Content-Type": "application/json" },
          method: "DELETE",
        });
        if (!response.ok) {
          throw new Error("테스트 회원 계정을 삭제하지 못했습니다.");
        }
      }
      setNotice(
        "테스트 회원의 로그인을 삭제했습니다. 거래 데이터까지 비우려면 npm run db:reset-local을 실행하세요.",
      );
      await load();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "테스트 회원 계정을 삭제하지 못했습니다.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="border border-dashed border-ink bg-surface p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="eyebrow text-muted">로컬 전용 / 회원 테스트</p>
          <h2 className="mt-2 text-lg font-black">테스트 회원 접속</h2>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-muted">
            버튼을 누르면 일반 회원을 없으면 만들고 바로 전환합니다. 로컬
            Supabase에서만 표시되며, 카카오 회원과 같은 회원 권한·프로필·배송
            계정을 사용합니다.
          </p>
        </div>
        <Button
          className="inline-flex items-center justify-center gap-2"
          disabled={busy !== null}
          onClick={() => void deleteMembers()}
          size="compact"
          type="button"
          variant="danger"
        >
          <Trash2 size={13} />
          {busy === "cleanup" ? "삭제 중…" : "테스트 회원 삭제"}
        </Button>
      </div>
      <div className="mt-5 grid gap-3">
        {MEMBER_SLOTS.map((slot) => {
          const account = accounts.find((candidate) => candidate.slot === slot);
          return (
            <button
              className="flex items-center justify-between gap-4 border border-ink bg-paper p-4 text-left disabled:opacity-50"
              disabled={busy !== null}
              key={slot}
              onClick={() => void accessMember(slot)}
              type="button"
            >
              <span>
                <span className="block text-xs font-black">
                  테스트 회원
                </span>
                <span className="mt-1 block text-[11px] text-muted">
                  {account?.created ? "생성됨 · 바로 접속" : "미생성 · 누르면 생성"}
                </span>
              </span>
              <UserRoundCheck size={18} />
            </button>
          );
        })}
      </div>
      {notice && (
        <p className="mt-4 text-[11px] leading-5 text-muted" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
