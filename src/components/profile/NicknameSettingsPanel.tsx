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
    <section className="theme-panel mt-6 rounded-[2rem] border px-6 py-6 shadow-sm sm:px-9">
      <p className="text-xs font-black tracking-[0.16em] text-[var(--accent-text)]">
        DISPLAY NAME
      </p>
      <h3 className="mt-2 text-xl font-black text-[var(--text-strong)]">닉네임 변경</h3>
      <p className="mt-2 text-sm font-bold leading-6 text-[var(--text-muted)]">
        최초 설정 뒤 한 번은 바로 변경할 수 있고, 그 다음부터는 운영자 확인 후 적용됩니다.
      </p>

      {isLoading ? (
        <p role="status" className="mt-4 font-bold text-[var(--text-muted)]">
          닉네임 정보를 확인하고 있어요.
        </p>
      ) : state ? (
        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <label className="block text-sm font-black text-[var(--text-strong)]">
            사용할 닉네임
            <input
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              minLength={2}
              maxLength={20}
              disabled={isSaving}
              className="mt-2 min-h-12 w-full rounded-2xl border-2 border-[var(--border)] bg-[var(--surface-raised)] px-4 text-[17px] font-bold text-[var(--text-strong)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          {state.pendingNickname ? (
            <p className="rounded-2xl bg-[var(--warning-surface)] px-4 py-3 text-sm font-bold text-[var(--warning-text)]">
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
          className={`mt-4 rounded-2xl px-4 py-3 text-sm font-bold ${
            feedback.type === "error"
              ? "bg-[var(--danger-surface)] text-[var(--danger-text)]"
              : "bg-[var(--success-surface)] text-[var(--success-text)]"
          }`}
        >
          {feedback.message}
        </p>
      ) : null}
    </section>
  );
}
