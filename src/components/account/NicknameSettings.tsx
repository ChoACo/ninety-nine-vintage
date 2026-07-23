"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import {
  getMyNicknameState,
  requestMyNicknameChange,
  type NicknameState,
} from "@/lib/supabase/nickname";

export function NicknameSettings() {
  const { revision, session } = useSupabaseSession();
  const [state, setState] = useState<NicknameState | null>(null);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!session) {
      setState(null);
      return;
    }
    try {
      setState(await getMyNicknameState());
    } catch {
      setState(null);
    }
  }, [session]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load, revision]);

  if (!session || !state?.isInitialized) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await requestMyNicknameChange(nickname);
      setNickname("");
      setNotice("닉네임 변경 승인을 요청했습니다.");
      await load();
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "닉네임 변경을 요청하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border border-line bg-surface p-5">
      <p className="eyebrow text-muted">계정 / 닉네임</p>
      <h2 className="mt-2 text-lg font-black">공개 닉네임</h2>
      <p className="mt-2 text-xs leading-5 text-muted">
        현재 <strong className="text-ink">{state.displayName}</strong>
        {state.pendingNickname
          ? ` · ${state.pendingNickname} 승인 대기 중`
          : " · 변경 시 운영자 승인이 필요합니다."}
      </p>
      <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
        <input
          className="h-11 min-w-0 flex-1 border border-line bg-paper px-3 text-xs"
          disabled={busy}
          maxLength={20}
          minLength={2}
          onChange={(event) => setNickname(event.target.value)}
          placeholder="새 닉네임 2~20자"
          value={nickname}
        />
        <button
          className="h-11 bg-ink px-5 text-xs font-bold text-paper disabled:opacity-40"
          disabled={busy || nickname.trim().length < 2}
          type="submit"
        >
          승인 요청
        </button>
      </form>
      {notice && (
        <p className="mt-3 text-xs text-muted" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
