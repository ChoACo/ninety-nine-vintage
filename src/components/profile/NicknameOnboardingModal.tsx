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
        <label className="block text-sm font-black text-[var(--text-strong)]">
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
            className="mt-2 min-h-13 w-full rounded-2xl border-2 border-[var(--border)] bg-[var(--surface-raised)] px-4 text-[17px] font-bold text-[var(--text-strong)] outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-surface)]"
          />
        </label>

        <p className="rounded-2xl bg-[var(--info-surface)] px-4 py-3 text-sm font-bold leading-6 text-[var(--info-text)]">
          다른 회원의 온라인 목록과 입찰 화면에는 코드형 식별자 대신 이 닉네임이 표시됩니다.
          관리자·운영자·직원처럼 직책과 혼동되는 이름은 사용할 수 없습니다.
        </p>

        {error ? (
          <p role="alert" className="text-sm font-bold leading-6 text-[var(--danger-text)]">
            {error}
          </p>
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
          className="w-full text-sm font-bold text-[var(--text-muted)] underline underline-offset-4 disabled:opacity-50"
        >
          지금은 로그아웃하기
        </button>
      </form>
    </Modal>
  );
}
