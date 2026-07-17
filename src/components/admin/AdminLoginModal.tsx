"use client";

import { useState, type FormEvent } from "react";
import { Button, Modal } from "@/src/components/common";
import { signInSupabaseAdmin } from "@/src/lib/supabase/adminAuth";

export interface AdminLoginModalProps {
  open: boolean;
  onClose: () => void;
  onAuthenticated: () => void;
}

export default function AdminLoginModal({
  open,
  onClose,
  onAuthenticated,
}: AdminLoginModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = () => {
    setEmail("");
    setPassword("");
    setError("");
    setIsSubmitting(false);
  };

  const closeModal = () => {
    if (isSubmitting) return;
    resetForm();
    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError("관리자 이메일과 비밀번호를 모두 입력해 주세요.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await signInSupabaseAdmin(email, password);
      resetForm();
      onAuthenticated();
    } catch (authenticationError) {
      setError(
        authenticationError instanceof Error
          ? authenticationError.message
          : "관리자 로그인을 완료하지 못했어요.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClasses =
    "mt-2 h-12 w-full rounded-2xl border border-[#decdbf] bg-white px-4 text-base text-[#463a34] outline-none transition placeholder:text-[#b7aaa1] focus:border-[#ec7866] focus:ring-4 focus:ring-[#ec7866]/10";

  return (
    <Modal
      open={open}
      onClose={closeModal}
      title="Supabase 관리자 로그인"
      description="상품과 사진을 안전하게 등록할 수 있는 관리자 계정으로 로그인해 주세요."
      size="sm"
      closeOnBackdrop={!isSubmitting}
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-5 sm:p-6">
        <label className="block text-sm font-black text-[#4c4039]">
          관리자 이메일
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            className={inputClasses}
            disabled={isSubmitting}
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

        {error ? (
          <p
            role="alert"
            className="rounded-2xl bg-[#fff0ea] px-4 py-3 text-sm font-bold leading-6 text-[#b14c3f]"
          >
            {error}
          </p>
        ) : null}

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
            {isSubmitting ? "로그인 확인 중..." : "관리자 로그인"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
