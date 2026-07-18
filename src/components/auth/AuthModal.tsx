"use client";

import { useState } from "react";
import Link from "next/link";

import { Modal } from "@/src/components/common";
import { signInWithKakao } from "@/src/lib/supabase/auth";

export interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AuthModal({ open, onClose }: AuthModalProps) {
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const closeModal = () => {
    if (isSubmitting) return;
    setError("");
    onClose();
  };

  const handleKakaoLogin = async () => {
    setIsSubmitting(true);
    setError("");
    try {
      await signInWithKakao();
    } catch (authenticationError) {
      setError(
        authenticationError instanceof Error
          ? authenticationError.message
          : "카카오 로그인을 시작하지 못했어요.",
      );
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={closeModal}
      closeOnBackdrop={!isSubmitting}
      title="카카오로 시작하기"
      description="회원과 운영 스태프는 모두 카카오 계정으로 로그인합니다."
      size="sm"
    >
      <section className="p-5 text-center sm:p-6">
        <div
          aria-hidden="true"
          className="mx-auto grid size-12 place-items-center rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-strong)] shadow-sm"
        >
          <svg viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="1.6">
            <path d="M7.5 18.25 4.5 20l.8-3.4A7.2 7.2 0 0 1 3 11.35C3 7.3 7 4 12 4s9 3.3 9 7.35-4 7.35-9 7.35c-1.6 0-3.13-.34-4.5-.95Z" />
          </svg>
        </div>
        <p className="mt-4 text-[10px] font-bold tracking-[0.2em] text-[var(--text-muted)]">ONE-TAP ACCESS</p>
        <h3 className="mt-1.5 text-xl font-semibold tracking-[-0.035em] text-[var(--text-strong)]">
          비밀번호 없이 간편하게 시작하세요
        </h3>
        <p className="mx-auto mt-2 max-w-sm text-sm font-medium leading-6 text-[var(--text-muted)]">
          카카오 계정으로 처음 로그인하면 회원가입이 함께 완료됩니다. 부여된 역할이
          있으면 같은 카카오 계정으로 운영 업무 화면이 열립니다.
        </p>
        <div className="mx-auto mt-5 max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-left text-xs font-medium leading-5 text-[var(--text-muted)]">
          <p className="font-semibold text-[var(--text-strong)]">필수 동의 · 이름, 성별, 출생연도</p>
          <p className="mt-0.5">이메일과 카카오계정 전화번호는 요청하지 않습니다.</p>
        </div>

        <button
          type="button"
          onClick={handleKakaoLogin}
          disabled={isSubmitting}
          aria-busy={isSubmitting || undefined}
          className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-lg bg-[#fee500] px-5 text-sm font-bold text-[#191919] shadow-sm transition-all duration-200 ease-out hover:scale-[1.02] hover:bg-[#f5dc00] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b9a600] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
        >
          {isSubmitting ? (
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
            />
          ) : (
            <svg aria-hidden="true" viewBox="0 0 32 32" className="size-6 fill-current">
              <path d="M16 4C8.82 4 3 8.47 3 14c0 3.59 2.45 6.73 6.13 8.5L7.7 27.72a.7.7 0 0 0 1.03.78l5.94-3.94c.44.03.88.05 1.33.05 7.18 0 13-4.47 13-10S23.18 4 16 4Z" />
            </svg>
          )}
          {isSubmitting ? "카카오로 이동 중..." : "카카오로 로그인"}
        </button>

        <p className="mt-4 text-[11px] font-medium leading-5 text-[var(--text-muted)]">
          로그인 전에{" "}
          <Link href="/signup" className="underline underline-offset-2" onClick={onClose}>
            회원가입 안내
          </Link>
          와{" "}
          <Link href="/privacy" className="underline underline-offset-2" onClick={onClose}>
            개인정보처리방침
          </Link>
          을 확인해 주세요.
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-[var(--danger-text)]/20 bg-[var(--danger-surface)] px-4 py-3 text-sm font-semibold leading-6 text-[var(--danger-text)]"
          >
            {error}
          </p>
        ) : null}
      </section>
    </Modal>
  );
}
