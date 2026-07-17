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
          className="mx-auto grid size-16 place-items-center rounded-[1.4rem] border border-[#ead5be] bg-[#fff3dc] text-3xl shadow-sm"
        >
          ♡
        </div>
        <h3 className="mt-4 text-xl font-black tracking-[-0.03em] text-[#44372f]">
          별도 아이디나 비밀번호가 필요 없어요
        </h3>
        <p className="mx-auto mt-2 max-w-sm text-[15px] font-medium leading-6 text-[#7c695e]">
          카카오 계정으로 처음 로그인하면 회원가입이 함께 완료됩니다. 부여된 역할이
          있으면 같은 카카오 계정으로 운영 업무 화면이 열립니다.
        </p>
        <div className="mx-auto mt-4 max-w-sm rounded-2xl border border-[#ead8b4] bg-[#fff7df] px-4 py-3 text-left text-sm font-bold leading-6 text-[#725c36]">
          <p><strong>필수 동의:</strong> 이름, 성별, 출생연도</p>
          <p>이메일과 카카오계정 전화번호는 요청하지 않습니다.</p>
        </div>

        <button
          type="button"
          onClick={handleKakaoLogin}
          disabled={isSubmitting}
          aria-busy={isSubmitting || undefined}
          className="mt-6 inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-[#fee500] px-5 text-base font-black text-[#191919] shadow-[0_8px_20px_rgba(105,86,0,0.13)] transition hover:bg-[#f5dc00] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b9a600] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
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

        <p className="mt-4 text-xs font-bold leading-5 text-[#86746a]">
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
            className="mt-4 rounded-2xl border border-[#f0c5bb] bg-[#fff0ea] px-4 py-3 text-sm font-bold leading-6 text-[#a9493e]"
          >
            {error}
          </p>
        ) : null}
      </section>
    </Modal>
  );
}
