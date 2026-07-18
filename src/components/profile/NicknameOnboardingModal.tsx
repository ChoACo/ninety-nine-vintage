"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Button, Modal } from "@/src/components/common";
import {
  getMyNicknameState,
  setMyInitialNickname,
} from "@/src/lib/supabase/nickname";

export interface NicknameOnboardingModalProps {
  enabled: boolean;
  userId: string | null;
  onCompleted: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
}

export function NicknameOnboardingModal({
  enabled,
  userId,
  onCompleted,
  onSignOut,
}: NicknameOnboardingModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [nickname, setNickname] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled || !userId) return;

    let active = true;
    const timer = window.setTimeout(() => {
      setIsChecking(true);
      void getMyNicknameState()
        .then((state) => {
          if (!active) return;
          setIsOpen(!state.isInitialized);
          setError("");
        })
        .catch((loadError) => {
          if (!active) return;
          setIsOpen(true);
          setError(
            loadError instanceof Error
              ? loadError.message
              : "닉네임 설정 정보를 불러오지 못했습니다.",
          );
        })
        .finally(() => {
          if (active) setIsChecking(false);
        });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [enabled, userId]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving || isChecking) return;

    setIsSaving(true);
    setError("");
    try {
      await setMyInitialNickname(nickname);
      await onCompleted();
      setIsOpen(false);
      setNickname("");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "닉네임을 저장하지 못했습니다.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      open={enabled && isOpen}
      onClose={() => undefined}
      title="사용할 닉네임을 정해 주세요"
      description="첫 가입 시 한 번 설정하며, 이후에는 내 정보에서 1회 직접 변경할 수 있습니다."
      size="sm"
      showCloseButton={false}
      closeOnBackdrop={false}
    >
      <form onSubmit={handleSubmit} className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3.5">
          <span aria-hidden="true" className="commerce-empty-icon size-10 shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-5"><path d="M16 19.5v-1.2a4.3 4.3 0 0 0-4.3-4.3H7.3A4.3 4.3 0 0 0 3 18.3v1.2M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM16 8h5m-2.5-2.5v5" /></svg>
          </span>
          <div>
            <p className="text-sm font-semibold text-[var(--text-strong)]">경매에서 사용할 공개 이름</p>
            <p className="mt-1 text-xs font-medium leading-5 text-[var(--text-muted)]">온라인 현황과 입찰 내역에는 이 닉네임이 표시됩니다.</p>
          </div>
        </div>

        <label className="block text-xs font-semibold tracking-wide text-[var(--text-strong)]">
          닉네임
          <input
            value={nickname}
            onChange={(event) => {
              setNickname(event.target.value);
              if (error) setError("");
            }}
            minLength={2}
            maxLength={20}
            autoComplete="nickname"
            autoFocus
            disabled={isSaving || isChecking}
            placeholder="2~20자 닉네임"
            className="mt-2 min-h-12 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--input-surface)] px-3 text-base font-semibold text-[var(--text-strong)] outline-none transition-all duration-200 ease-out placeholder:font-normal placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus-ring)]/20 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        <p className="rounded-xl border border-[var(--info-border)] bg-[var(--info-surface)] px-4 py-3 text-xs font-medium leading-5 text-[var(--info-text)]">
          다른 회원의 온라인 목록과 입찰 화면에는 코드형 식별자 대신 이 닉네임이 표시됩니다.
          운영자·직원처럼 직책과 혼동되는 이름은 사용할 수 없습니다.
        </p>

        {error ? (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-[var(--danger-text)]/20 bg-[var(--danger-surface)] px-4 py-3 text-sm font-semibold leading-6 text-[var(--danger-text)]">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="mt-0.5 size-4 shrink-0"><path d="M12 8v4m0 4h.01M10.3 4.4 2.8 17.2A1.2 1.2 0 0 0 3.84 19h16.32a1.2 1.2 0 0 0 1.04-1.8L13.7 4.4a1.98 1.98 0 0 0-3.4 0Z" /></svg>
            <p>{error}</p>
          </div>
        ) : null}

        <Button
          type="submit"
          size="lg"
          fullWidth
          isLoading={isSaving || isChecking}
          disabled={nickname.trim().length < 2 || isChecking}
        >
          {isChecking ? "가입 정보 확인 중..." : isSaving ? "저장 중..." : "이 닉네임으로 시작하기"}
        </Button>
        <button
          type="button"
          onClick={() => void onSignOut()}
          disabled={isSaving}
          className="w-full rounded-lg px-4 py-2 text-xs font-semibold text-[var(--text-muted)] underline decoration-[var(--border-strong)] underline-offset-4 transition-all duration-200 ease-out hover:bg-[var(--surface-muted)] hover:text-[var(--text-strong)] disabled:opacity-50"
        >
          지금은 로그아웃하기
        </button>
      </form>
    </Modal>
  );
}
