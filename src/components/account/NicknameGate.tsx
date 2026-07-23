"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import {
  getMyNicknameState,
  setMyInitialNickname,
  type NicknameState,
} from "@/lib/supabase/nickname";

export function NicknameGate() {
  const pathname = usePathname();
  const { loading, revision, session } = useSupabaseSession();
  const [state, setState] = useState<NicknameState | null>(null);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    if (loading || !session || pathname.startsWith("/auth/")) {
      return () => {
        active = false;
      };
    }
    void getMyNicknameState()
      .then((next) => {
        if (!active) return;
        setState(next);
        setNickname(next.isInitialized ? "" : next.displayName);
      })
      .catch(() => {
        if (active) setState(null);
      });
    return () => {
      active = false;
    };
  }, [loading, pathname, revision, session]);

  if (!session || state?.isInitialized !== false) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const displayName = await setMyInitialNickname(nickname);
      setState({
        ...state,
        displayName,
        isInitialized: true,
        canChangeOnce: false,
      });
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "닉네임을 설정하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      aria-labelledby="initial-nickname-title"
      aria-modal="true"
      className="fixed inset-0 z-[220] grid place-items-center bg-black/55 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <form
        className="w-full max-w-md border border-line bg-paper p-6 text-ink shadow-2xl sm:p-8"
        onSubmit={submit}
      >
        <p className="eyebrow text-muted">첫 가입 / 공개 이름</p>
        <h2
          className="mt-3 text-2xl font-black tracking-[-0.06em]"
          id="initial-nickname-title"
        >
          사용할 닉네임을 정해 주세요
        </h2>
        <p className="mt-3 text-sm leading-6 text-muted">
          최초 1회만 바로 저장됩니다. 이후 변경은 운영자 승인을 거쳐
          반영됩니다.
        </p>
        <label className="mt-6 grid gap-2 text-xs font-bold">
          닉네임
          <input
            autoFocus
            className="h-12 border border-line bg-surface px-4 text-sm font-normal outline-none focus:border-ink"
            maxLength={20}
            minLength={2}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="2~20자"
            value={nickname}
          />
        </label>
        {notice && (
          <p className="mt-3 text-xs font-bold text-rose-700" role="alert">
            {notice}
          </p>
        )}
        <button
          className="mt-6 h-12 w-full bg-ink text-sm font-bold text-paper disabled:opacity-40"
          disabled={busy || nickname.trim().length < 2}
          type="submit"
        >
          {busy ? "저장 중…" : "닉네임 저장"}
        </button>
      </form>
    </div>
  );
}
