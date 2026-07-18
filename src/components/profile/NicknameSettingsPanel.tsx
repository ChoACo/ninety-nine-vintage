"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Button } from "@/src/components/common";
import {
  changeMyNicknameOnce,
  getMyNicknameState,
  requestMyNicknameChange,
  type NicknameState,
} from "@/src/lib/supabase/nickname";

export function NicknameSettingsPanel({
  userId,
  onChanged,
}: {
  userId: string;
  onChanged: () => void | Promise<void>;
}) {
  const [state, setState] = useState<NicknameState | null>(null);
  const [nickname, setNickname] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<
    { type: "success" | "error"; message: string } | null
  >(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const next = await getMyNicknameState();
      setState(next);
      setNickname(next.pendingNickname ?? next.displayName);
      setFeedback(null);
    } catch (loadError) {
      setFeedback({
        type: "error",
        message:
          loadError instanceof Error
            ? loadError.message
            : "닉네임 정보를 불러오지 못했습니다.",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload, userId]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!state || isSaving) return;
    setIsSaving(true);
    setFeedback(null);
    try {
      if (state.canChangeOnce) {
        await changeMyNicknameOnce(nickname);
        await onChanged();
        setFeedback({
          type: "success",
          message: "닉네임을 변경했습니다. 1회 직접 변경 기회를 사용했습니다.",
        });
      } else {
        await requestMyNicknameChange(nickname);
        setFeedback({
          type: "success",
          message: "닉네임 변경을 요청했습니다. 운영자 승인 후 반영됩니다.",
        });
      }
      const next = await getMyNicknameState();
      setState(next);
      setNickname(next.pendingNickname ?? next.displayName);
    } catch (saveError) {
      setFeedback({
        type: "error",
        message:
          saveError instanceof Error
            ? saveError.message
            : "닉네임 변경을 처리하지 못했습니다.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="theme-panel mt-5 rounded-2xl border px-5 py-5 shadow-sm sm:px-7 sm:py-6">
      <p className="text-[10px] font-bold tracking-[0.2em] text-[var(--accent-text)]">
        DISPLAY NAME
      </p>
      <h3 className="mt-1.5 text-lg font-semibold tracking-tight text-[var(--text-strong)]">닉네임 변경</h3>
      <p className="mt-1.5 text-sm font-medium leading-6 text-[var(--text-muted)]">
        최초 설정 뒤 한 번은 바로 변경할 수 있고, 그 다음부터는 운영자 확인 후 적용됩니다.
      </p>

      {isLoading ? (
        <div role="status" aria-label="닉네임 정보를 확인하고 있어요" className="mt-5 space-y-3">
          <div className="commerce-skeleton h-12 rounded-lg" />
          <div className="commerce-skeleton h-10 w-36 rounded-lg" />
        </div>
      ) : state ? (
        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <label className="block text-xs font-semibold tracking-wide text-[var(--text-strong)]">
            사용할 닉네임
            <input
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              minLength={2}
              maxLength={20}
              disabled={isSaving}
              className="mt-2 min-h-11 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--input-surface)] px-3 text-sm font-semibold text-[var(--text-strong)] outline-none transition-all duration-200 ease-out focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus-ring)]/20 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
          {state.pendingNickname ? (
            <p className="rounded-xl border border-[var(--warning-text)]/20 bg-[var(--warning-surface)] px-4 py-3 text-xs font-medium leading-5 text-[var(--warning-text)]">
              승인 대기 중: {state.pendingNickname} · 새 이름을 제출하면 요청 내용이 교체됩니다.
            </p>
          ) : null}
          <Button
            type="submit"
            isLoading={isSaving}
            disabled={nickname.trim().length < 2 || nickname.trim() === state.displayName}
          >
            {state.canChangeOnce ? "닉네임 바로 변경" : "변경 승인 요청"}
          </Button>
        </form>
      ) : null}

      {feedback ? (
        <p
          role={feedback.type === "error" ? "alert" : "status"}
          className={`mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm font-semibold leading-6 ${
            feedback.type === "error"
              ? "border-[var(--danger-text)]/20 bg-[var(--danger-surface)] text-[var(--danger-text)]"
              : "border-[var(--success-text)]/20 bg-[var(--success-surface)] text-[var(--success-text)]"
          }`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="mt-0.5 size-4 shrink-0">
            {feedback.type === "error" ? <path d="M12 8v4m0 4h.01M10.3 4.4 2.8 17.2A1.2 1.2 0 0 0 3.84 19h16.32a1.2 1.2 0 0 0 1.04-1.8L13.7 4.4a1.98 1.98 0 0 0-3.4 0Z" /> : <path d="m5 12 4 4L19 6" />}
          </svg>
          <span>{feedback.message}</span>
        </p>
      ) : null}
    </section>
  );
}
