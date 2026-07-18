"use client";

/* eslint-disable @next/next/no-img-element -- Supabase Storage 상품 미리보기를 표시합니다. */

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/src/components/common";
import {
  confirmManualBankTransfer,
  getManualBankAccountForStaff,
  getPendingManualTransfers,
  updateManualBankAccount,
  type PendingManualTransfer,
} from "@/src/lib/supabase/manualPayments";
import { formatKRW } from "@/src/utils/formatters";

type Feedback = { tone: "success" | "error"; message: string } | null;

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function dateTime(value: string | null): string {
  if (!value) return "기록 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "확인 필요";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function ManualBankTransferPanel() {
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [configured, setConfigured] = useState(false);
  const [transfers, setTransfers] = useState<PendingManualTransfer[]>([]);
  const [pendingTotalCount, setPendingTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setFeedback(null);
    try {
      const [settings, pending] = await Promise.all([
        getManualBankAccountForStaff(),
        getPendingManualTransfers(),
      ]);
      setBankName(settings?.bankName ?? "");
      setAccountNumber(settings?.accountNumber ?? "");
      setConfigured(Boolean(settings?.configured));
      setTransfers(pending);
      setPendingTotalCount(pending[0]?.totalCount ?? 0);
    } catch (error) {
      setFeedback({
        tone: "error",
        message: messageOf(error, "입금 관리 정보를 불러오지 못했습니다."),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const saveAccount = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setFeedback(null);
    try {
      const saved = await updateManualBankAccount({ bankName, accountNumber });
      setBankName(saved.bankName);
      setAccountNumber(saved.accountNumber);
      setConfigured(saved.configured);
      setFeedback({
        tone: "success",
        message:
          "공용 입금 계좌를 저장했습니다. 모든 회원의 이후 계좌 안내에 즉시 적용됩니다.",
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: messageOf(error, "공용 입금 계좌를 저장하지 못했습니다."),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const confirmTransfer = async (transfer: PendingManualTransfer) => {
    if (confirmingId) return;
    const approved = window.confirm(
      `${transfer.buyerDisplayName}님의 ${formatKRW(transfer.expectedAmount)} 입금을 실제 통장에서 확인했나요?\n\n확정 후 상품은 회원의 결제 완료 보관함으로 이동합니다.`,
    );
    if (!approved) return;

    setConfirmingId(transfer.orderId);
    setFeedback(null);
    try {
      await confirmManualBankTransfer({
        orderId: transfer.orderId,
        expectedUpdatedAt: transfer.updatedAt,
      });
      setTransfers((current) =>
        current.filter((item) => item.orderId !== transfer.orderId),
      );
      setPendingTotalCount((current) => Math.max(0, current - 1));
      setFeedback({
        tone: "success",
        message: `${transfer.buyerDisplayName}님의 ${formatKRW(transfer.expectedAmount)} 입금을 확정했습니다.`,
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: messageOf(error, "입금 확정을 완료하지 못했습니다."),
      });
    } finally {
      setConfirmingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-[1.4rem] border border-[var(--border)] bg-[var(--surface-muted)] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black tracking-[0.14em] text-[var(--accent-text)]">
              COMMON DEPOSIT ACCOUNT
            </p>
            <h3 className="mt-1 text-lg font-black text-[var(--text-strong)]">
              공용 계좌이체 계좌
            </h3>
            <p className="mt-2 max-w-3xl break-keep text-sm font-bold leading-6 text-[var(--text-muted)]">
              이 계좌는 사이트 전체에 하나만 적용됩니다. 수정 후 새로 계좌를
              여는 회원부터 변경된 정보를 보게 됩니다.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1.5 text-xs font-black ${
              configured
                ? "bg-[var(--success-surface)] text-[var(--success-text)]"
                : "bg-[var(--warning-surface)] text-[var(--warning-text)]"
            }`}
          >
            {configured ? "계좌 설정 완료" : "계좌 설정 필요"}
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(150px,0.45fr)_minmax(240px,1fr)_auto] sm:items-end">
          <label className="text-sm font-black text-[var(--text-strong)]">
            은행명
            <input
              value={bankName}
              onChange={(event) => setBankName(event.target.value)}
              maxLength={40}
              placeholder="예: 국민은행"
              disabled={isLoading || isSaving}
              className="mt-2 min-h-12 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 font-bold text-[var(--text-strong)] outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-surface)]"
            />
          </label>
          <label className="text-sm font-black text-[var(--text-strong)]">
            계좌번호
            <input
              value={accountNumber}
              onChange={(event) => setAccountNumber(event.target.value)}
              maxLength={50}
              inputMode="numeric"
              autoComplete="off"
              placeholder="예: 123-456-789012"
              disabled={isLoading || isSaving}
              className="mt-2 min-h-12 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 font-bold text-[var(--text-strong)] outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-surface)]"
            />
          </label>
          <Button
            onClick={() => void saveAccount()}
            isLoading={isSaving}
            disabled={isLoading || !bankName.trim() || !accountNumber.trim()}
          >
            공용 계좌 저장
          </Button>
        </div>
      </section>

      <section className="rounded-[1.4rem] border border-[var(--info-border)] bg-[var(--info-surface)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black tracking-[0.14em] text-[var(--info-text)]">
              DEPOSIT CONFIRMATION
            </p>
            <h3 className="mt-1 text-lg font-black text-[var(--text-strong)]">
              입금 진행 중
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[var(--surface-raised)] px-3 py-1 text-sm font-black text-[var(--info-text)]">
              {pendingTotalCount.toLocaleString("ko-KR")}건
            </span>
            <Button size="sm" variant="ghost" onClick={() => void load()} isLoading={isLoading}>
              새로고침
            </Button>
          </div>
        </div>

        <p className="mt-3 rounded-2xl border border-[var(--warning-text)]/25 bg-[var(--warning-surface)] px-4 py-3 text-sm font-bold leading-6 text-[var(--warning-text)]">
          통장의 입금자명과 금액을 직접 대조한 후에만 확정해 주세요. 버튼을
          누르면 회원의 결제를 완료 처리하고 이력을 남깁니다.
        </p>

        {isLoading && transfers.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-[var(--surface-raised)] px-4 py-7 text-center font-bold text-[var(--text-muted)]" role="status">
            입금 확인 대기 목록을 불러오는 중…
          </p>
        ) : transfers.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-raised)] px-4 py-7 text-center font-bold text-[var(--text-muted)]">
            {pendingTotalCount > 0
              ? "현재 표시된 내역을 모두 처리했습니다. 새로고침하면 다음 내역이 표시됩니다."
              : "현재 계좌를 확인하고 입금을 진행 중인 회원이 없습니다."}
          </p>
        ) : (
          <>
            {pendingTotalCount > transfers.length ? (
              <p className="mt-3 text-xs font-bold text-[var(--text-muted)]">
                요청 시각이 빠른 {transfers.length.toLocaleString("ko-KR")}건을
                표시합니다. 입금을 확정한 후 새로고침하면 다음 내역이
                이어서 표시됩니다.
              </p>
            ) : null}
            <ul className="mt-4 grid gap-3 lg:grid-cols-2">
              {transfers.map((transfer) => (
              <li
                key={transfer.orderId}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] p-4 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  {transfer.productImageUrl ? (
                    <img
                      src={transfer.productImageUrl}
                      alt=""
                      className="size-16 shrink-0 rounded-xl bg-[var(--surface-muted)] object-cover"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <strong className="line-clamp-2 block font-black text-[var(--text-strong)]">
                      {transfer.productTitle}
                    </strong>
                    <p className="mt-1 text-sm font-bold text-[var(--text-muted)]">
                      입금자 확인 대상 · {transfer.buyerDisplayName}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-[var(--warning-surface)] px-2.5 py-1 text-xs font-black text-[var(--warning-text)]">
                    입금 진행 중
                  </span>
                </div>
                <p className="mt-4 text-2xl font-black text-[var(--accent-text)]">
                  {formatKRW(transfer.expectedAmount)}
                </p>
                <p className="mt-1 text-xs font-bold text-[var(--text-muted)]">
                  계좌 확인 {dateTime(transfer.requestedAt)}
                </p>
                <p className="mt-2 rounded-xl bg-[var(--surface-muted)] px-3 py-2 text-xs font-bold text-[var(--text-muted)]">
                  안내 계좌 · <strong className="text-[var(--text-strong)]">{transfer.bankName} {transfer.accountNumber}</strong>
                </p>
                <Button
                  fullWidth
                  className="mt-4"
                  isLoading={confirmingId === transfer.orderId}
                  disabled={Boolean(confirmingId)}
                  onClick={() => void confirmTransfer(transfer)}
                >
                  입금 확정하기
                </Button>
              </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {feedback ? (
        <p
          role={feedback.tone === "error" ? "alert" : "status"}
          className={`rounded-2xl border px-4 py-3 font-bold ${
            feedback.tone === "error"
              ? "border-[var(--danger-text)]/25 bg-[var(--danger-surface)] text-[var(--danger-text)]"
              : "border-[var(--success-text)]/25 bg-[var(--success-surface)] text-[var(--success-text)]"
          }`}
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}
