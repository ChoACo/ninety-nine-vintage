"use client";

import { useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { Button, Modal } from "@/src/components/common";
import {
  signInStaff,
  signInWithKakao,
} from "@/src/lib/supabase/auth";

type AuthMode = "member" | "staff";

export interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onAuthenticated?: (user: User) => void;
  initialMode?: AuthMode;
}

const inputClasses =
  "mt-2 h-13 w-full rounded-2xl border-2 border-[#ddcbbb] bg-[#fffdf9] px-4 text-base font-bold text-[#463a34] outline-none transition placeholder:font-medium placeholder:text-[#ad9d92] focus:border-[#d77b67] focus:ring-4 focus:ring-[#e9a99b]/20 disabled:opacity-60";

export default function AuthModal({
  open,
  onClose,
  onAuthenticated,
  initialMode = "member",
}: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = () => {
    setMode(initialMode);
    setIdentifier("");
    setPassword("");
    setError("");
    setIsSubmitting(false);
  };

  const changeMode = (nextMode: AuthMode) => {
    if (isSubmitting) return;
    setMode(nextMode);
    setError("");
  };

  const closeModal = () => {
    if (isSubmitting) return;
    resetForm();
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

  const handleStaffLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const user = await signInStaff(identifier, password);
      onAuthenticated?.(user);
      resetForm();
      onClose();
    } catch (authenticationError) {
      setError(
        authenticationError instanceof Error
          ? authenticationError.message
          : "스태프 로그인을 완료하지 못했어요.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={closeModal}
      closeOnBackdrop={!isSubmitting}
      title="다미네 구제에 어서 오세요"
      description="회원은 카카오로 간편하게, 관리자와 운영자는 전용 계정으로 로그인합니다."
      size="sm"
    >
      <div className="p-5 sm:p-6">
        <div
          role="tablist"
          aria-label="로그인 종류"
          className="grid grid-cols-2 rounded-2xl border border-[#e6d5c6] bg-[#f5eadf] p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "member"}
            onClick={() => changeMode("member")}
            disabled={isSubmitting}
            className={`min-h-11 rounded-xl px-3 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cf7764] ${
              mode === "member"
                ? "bg-[#fffdf9] text-[#554238] shadow-sm"
                : "text-[#8b7465] hover:text-[#554238]"
            }`}
          >
            카카오로 시작
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "staff"}
            onClick={() => changeMode("staff")}
            disabled={isSubmitting}
            className={`min-h-11 rounded-xl px-3 text-sm font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#cf7764] ${
              mode === "staff"
                ? "bg-[#fffdf9] text-[#554238] shadow-sm"
                : "text-[#8b7465] hover:text-[#554238]"
            }`}
          >
            관리자 · 운영자
          </button>
        </div>

        {mode === "member" ? (
          <section role="tabpanel" className="pt-6 text-center">
            <div
              aria-hidden="true"
              className="mx-auto grid size-16 place-items-center rounded-[1.4rem] border border-[#ead5be] bg-[#fff3dc] text-3xl shadow-sm"
            >
              ♡
            </div>
            <h3 className="mt-4 text-xl font-black tracking-[-0.03em] text-[#44372f]">
              처음이어도 바로 가입돼요
            </h3>
            <p className="mx-auto mt-2 max-w-sm text-[15px] font-medium leading-6 text-[#7c695e]">
              카카오 계정으로 로그인하면 회원가입이 함께 완료됩니다. 비밀번호를
              따로 만들 필요가 없어요.
            </p>

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
                <svg
                  aria-hidden="true"
                  viewBox="0 0 32 32"
                  className="size-6 fill-current"
                >
                  <path d="M16 4C8.82 4 3 8.47 3 14c0 3.59 2.45 6.73 6.13 8.5L7.7 27.72a.7.7 0 0 0 1.03.78l5.94-3.94c.44.03.88.05 1.33.05 7.18 0 13-4.47 13-10S23.18 4 16 4Z" />
                </svg>
              )}
              {isSubmitting ? "카카오로 이동 중..." : "카카오로 로그인"}
            </button>
          </section>
        ) : (
          <form role="tabpanel" onSubmit={handleStaffLogin} className="space-y-4 pt-6">
            <div className="rounded-2xl border border-[#ead8c6] bg-[#fff5e9] px-4 py-3 text-sm font-bold leading-6 text-[#806351]">
              운영자는 <span className="text-[#a85041]">operator01~03</span>,
              기존 관리자는 등록된 이메일을 입력해 주세요.
            </div>

            <label className="block text-sm font-black text-[#4c4039]">
              운영자 아이디 또는 관리자 이메일
              <input
                type="text"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                autoComplete="username"
                placeholder="operator01 또는 admin@example.com"
                className={inputClasses}
                disabled={isSubmitting}
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
              />
            </label>

            <label className="block text-sm font-black text-[#4c4039]">
              비밀번호
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className={inputClasses}
                disabled={isSubmitting}
              />
            </label>

            <div className="flex flex-col-reverse gap-2 border-t border-[#eee0d5] pt-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                onClick={closeModal}
                disabled={isSubmitting}
              >
                취소
              </Button>
              <Button type="submit" isLoading={isSubmitting}>
                {isSubmitting ? "권한 확인 중..." : "스태프 로그인"}
              </Button>
            </div>
          </form>
        )}

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-2xl border border-[#f0c5bb] bg-[#fff0ea] px-4 py-3 text-sm font-bold leading-6 text-[#a9493e]"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
