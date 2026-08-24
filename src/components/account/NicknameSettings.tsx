"use client";

import { PencilLine, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { PremiumDialog } from "@/components/ui/PremiumDialog";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import {
  getMyNicknameState,
  requestMyNicknameChange,
  type NicknameState,
} from "@/lib/supabase/nickname";

type NicknameSettingsPresentation = "inline" | "modal";

export function NicknameSettings({
  presentation = "inline",
}: Readonly<{ presentation?: NicknameSettingsPresentation }>) {
  const { revision, session } = useSupabaseSession();
  const [state, setState] = useState<NicknameState | null>(null);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!session) {
      setState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const nextState = await getMyNicknameState();
      if (requestId !== requestIdRef.current) return;
      setState(nextState);
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return;
      setState(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "닉네임 설정을 불러오지 못했습니다.",
      );
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => {
      requestIdRef.current += 1;
      window.clearTimeout(timeoutId);
    };
  }, [load, revision]);

  if (!session) return null;

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
    } catch (submitError) {
      setNotice(
        submitError instanceof Error
          ? submitError.message
          : "닉네임 변경을 요청하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-5" role="status">
        <p className="text-sm font-black">닉네임 설정</p>
        <p className="mt-2 text-xs text-muted">현재 닉네임을 확인하고 있습니다.</p>
      </section>
    );
  }

  if (error || !state) {
    return (
      <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
        <p className="text-sm font-black">닉네임 설정을 표시하지 못했습니다.</p>
        <p className="mt-2 break-keep text-xs leading-5">{error || "잠시 후 다시 시도해 주세요."}</p>
        <button className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-400 px-4 text-xs font-black" onClick={() => void load()} type="button">
          <RefreshCw aria-hidden="true" size={14} /> 다시 불러오기
        </button>
      </section>
    );
  }

  if (!state.isInitialized) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-5">
        <p className="text-sm font-black">닉네임 설정</p>
        <p className="mt-2 break-keep text-xs leading-5 text-muted">먼저 화면에 표시된 최초 닉네임 설정을 완료해 주세요.</p>
      </section>
    );
  }

  const currentState = (
    <p className="mt-2 break-keep text-xs leading-5 text-muted">
      현재 <strong className="text-ink">{state.displayName}</strong>
      {state.pendingNickname
        ? ` · ${state.pendingNickname} 승인 대기 중`
        : " · 변경 시 운영자 승인이 필요합니다."}
    </p>
  );

  const form = (
    <form className="mt-5 space-y-4" onSubmit={submit}>
      <label className="block text-xs font-black" htmlFor="nickname-change-input">
        새 닉네임
        <input
          autoComplete="nickname"
          className="mt-2 h-12 w-full rounded-xl border border-line bg-paper px-4 text-base outline-none focus:border-ink md:text-sm"
          disabled={busy}
          id="nickname-change-input"
          maxLength={20}
          minLength={2}
          onChange={(event) => setNickname(event.target.value)}
          placeholder="새 닉네임 2~20자"
          value={nickname}
        />
      </label>
      <button className="min-h-12 w-full rounded-xl bg-ink px-5 text-sm font-black text-paper disabled:opacity-40" disabled={busy || nickname.trim().length < 2} type="submit">
        {busy ? "요청 중…" : "닉네임 변경 승인 요청"}
      </button>
      {notice && <p className="rounded-xl bg-surface px-4 py-3 text-xs font-bold" role="status">{notice}</p>}
    </form>
  );

  if (presentation === "modal") {
    return (
      <>
        <section className="rounded-2xl border border-line bg-surface p-5">
          <p className="text-sm font-black">닉네임 설정</p>
          {currentState}
          <button aria-haspopup="dialog" className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 text-sm font-black text-paper" onClick={() => { setNotice(""); setDialogOpen(true); }} type="button">
            <PencilLine aria-hidden="true" size={16} /> 닉네임 변경
          </button>
        </section>
        <PremiumDialog labelledBy="nickname-settings-title" onClose={() => setDialogOpen(false)} open={dialogOpen} panelClassName="sm:max-w-md" placement="sheet-bottom">
          <div className="p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:p-6">
            <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
              <div>
                <p className="eyebrow text-muted">계정 설정</p>
                <h2 className="mt-2 text-xl font-black" id="nickname-settings-title">닉네임 변경</h2>
              </div>
              <button aria-label="닉네임 설정 닫기" className="grid size-11 shrink-0 place-items-center rounded-xl border border-line" onClick={() => setDialogOpen(false)} type="button"><X size={18} /></button>
            </div>
            {currentState}
            {form}
          </div>
        </PremiumDialog>
      </>
    );
  }

  return (
    <section className="border border-line bg-surface p-5">
      <p className="eyebrow text-muted">계정 / 닉네임</p>
      <h2 className="mt-2 text-lg font-black">공개 닉네임</h2>
      {currentState}
      {form}
    </section>
  );
}
