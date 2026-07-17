"use client";

import { type FormEvent, useState } from "react";

import { Button, Modal } from "@/src/components/common";
import { unlockOwnerMode } from "@/src/lib/ownerMode/client";

export interface OwnerModePinModalProps {
  open: boolean;
  onClose: () => void;
  onUnlocked: (expiresAt: string | null) => void;
}

export function OwnerModePinModal({
  open,
  onClose,
  onUnlocked,
}: OwnerModePinModalProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const close = () => {
    if (isSubmitting) return;
    setPin("");
    setError("");
    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setError("");
    setIsSubmitting(true);

    try {
      const status = await unlockOwnerMode(pin);
      setPin("");
      onUnlocked(status.expiresAt);
    } catch (submitError) {
      setPin("");
      setError(
        submitError instanceof Error
          ? submitError.message
          : "전용 모드를 열지 못했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      closeOnBackdrop={!isSubmitting}
      title="전용 관리 모드 확인"
      description="계속하려면 전용 PIN을 입력해 주세요. PIN은 브라우저에 저장되지 않습니다."
      size="sm"
    >
      <form className="space-y-5 p-5 sm:p-6" onSubmit={handleSubmit}>
        <label className="block text-sm font-black text-[var(--text-strong)]">
          전용 PIN
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]{4}"
            maxLength={4}
            value={pin}
            onChange={(event) => {
              setPin(event.target.value.replace(/\D/g, "").slice(0, 4));
              if (error) setError("");
            }}
            disabled={isSubmitting}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "owner-mode-pin-error" : undefined}
            className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 text-center text-xl font-black tracking-[0.45em] text-[var(--text-strong)] outline-none transition focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-surface)]"
          />
        </label>

        {error ? (
          <p
            id="owner-mode-pin-error"
            role="alert"
            className="rounded-2xl bg-[var(--danger-surface)] px-4 py-3 text-sm font-bold text-[var(--danger-text)]"
          >
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close} disabled={isSubmitting}>
            취소
          </Button>
          <Button type="submit" isLoading={isSubmitting} disabled={pin.length !== 4}>
            {isSubmitting ? "확인 중..." : "전용 모드 열기"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
