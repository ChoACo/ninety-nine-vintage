"use client";

/* eslint-disable @next/next/no-img-element -- Supabase Storage 상품 미리보기를 표시합니다. */

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/src/components/common";
import { useAuctionPolicyClock } from "@/src/hooks/useAuctionPolicyClock";
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

function isTransferExpired(
  transfer: PendingManualTransfer,
  now: Date,
): boolean {
  return Boolean(
    transfer.dueAt && Date.parse(transfer.dueAt) <= now.getTime(),
  );
}

export function ManualBankTransferPanel() {
  const auctionNow = useAuctionPolicyClock();
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
    <div className="space-y-3">
      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-[0_1px_0_rgba(255,255,255,0.3)]">
        <div className="border-b border-[var(--border)] bg-[var(--surface-muted)]/45 px-3.5 py-3 sm:px-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black tracking-[0.16em] text-[var(--accent-text)]">
              COMMON DEPOSIT ACCOUNT
            </p>
            <h3 className="mt-0.5 text-base font-black text-[var(--text-strong)]">
              공용 계좌이체 계좌
            </h3>
            <p className="mt-1.5 max-w-3xl break-keep text-xs font-semibold leading-5 text-[var(--text-muted)]">
              이 계좌는 사이트 전체에 하나만 적용됩니다. 수정 후 새로 계좌를
              여는 회원부터 변경된 정보를 보게 됩니다.
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2 py-1 text-[10px] font-bold ${
              configured
                ? "bg-[var(--success-surface)] text-[var(--success-text)]"
                : "bg-[var(--warning-surface)] text-[var(--warning-text)]"
            }`}
          >
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${
                configured
                  ? "bg-[var(--success-text)]"
                  : "bg-[var(--warning-text)] motion-safe:animate-pulse motion-reduce:animate-none"
              }`}
            />
            {configured ? "계좌 설정 완료" : "계좌 설정 필요"}
          </span>
        </div>
        </div>

        <div className="grid gap-3 p-3.5 sm:grid-cols-[minmax(150px,0.45fr)_minmax(240px,1fr)_auto] sm:items-end sm:p-4">
          <label className="text-xs font-black text-[var(--text-strong)]">
            은행명
            <input
              value={bankName}
              onChange={(event) => setBankName(event.target.value)}
              maxLength={40}
              placeholder="예: 국민은행"
              disabled={isLoading || isSaving}
              className="mt-1.5 min-h-10 w-full rounded-md border border-[var(--border)] bg-[var(--input-surface)] px-3 text-sm font-semibold text-[var(--text-strong)] outline-none transition-all duration-200 hover:border-[var(--border-strong)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-surface)]"
            />
          </label>
          <label className="text-xs font-black text-[var(--text-strong)]">
            계좌번호
            <input
              value={accountNumber}
              onChange={(event) => setAccountNumber(event.target.value)}
              maxLength={50}
              inputMode="numeric"
              autoComplete="off"
              placeholder="예: 123-456-789012"
              disabled={isLoading || isSaving}
              className="mt-1.5 min-h-10 w-full rounded-md border border-[var(--border)] bg-[var(--input-surface)] px-3 font-mono text-sm font-semibold tabular-nums tracking-tight text-[var(--text-strong)] outline-none transition-all duration-200 hover:border-[var(--border-strong)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-surface)]"
            />
          </label>
          <Button
            className="active:scale-95 transition-all duration-200"
            onClick={() => void saveAccount()}
            isLoading={isSaving}
            disabled={isLoading || !bankName.trim() || !accountNumber.trim()}
          >
            공용 계좌 저장
          </Button>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-[0_1px_0_rgba(255,255,255,0.3)]">
        <div className="border-b border-[var(--border)] bg-[var(--surface-muted)]/45 px-3.5 py-3 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black tracking-[0.16em] text-[var(--info-text)]">
              DEPOSIT CONFIRMATION
            </p>
            <h3 className="mt-0.5 text-base font-black text-[var(--text-strong)]">
              입금 진행 중
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-baseline gap-1 rounded-md border border-[var(--info-border)] bg-[var(--info-surface)] px-2.5 py-1 font-mono tabular-nums text-lg font-bold tracking-tight text-[var(--info-text)]">
              {pendingTotalCount.toLocaleString("ko-KR")}
              <span className="text-[10px] font-semibold">건 대기</span>
            </span>
            <Button className="active:scale-95 transition-all duration-200" size="sm" variant="ghost" onClick={() => void load()} isLoading={isLoading}>
              새로고침
            </Button>
          </div>
        </div>
        </div>

        <div className="p-3.5 sm:p-4">
        <p className="rounded-md border border-[var(--warning-text)]/25 bg-[var(--warning-surface)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--warning-text)]">
          통장의 입금자명과 금액을 직접 대조한 후에만 확정해 주세요. 버튼을
          누르면 회원의 결제를 완료 처리하고 이력을 남깁니다.
        </p>

        {isLoading && transfers.length === 0 ? (
          <div className="mt-4 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3" role="status" aria-label="입금 확인 대기 목록을 불러오는 중">
            <span className="sr-only">입금 확인 대기 목록을 불러오는 중…</span>
            {Array.from({ length: 3 }).map((_, index) => <div key={index} className="commerce-skeleton h-16 rounded-lg" />)}
          </div>
        ) : transfers.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface-raised)] px-4 py-8 text-center text-sm font-bold text-[var(--text-muted)]">
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
            <ul className="mt-4 divide-y divide-[var(--border)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              {transfers.map((transfer) => (
              <li
                key={transfer.orderId}
                className="p-3 transition-all duration-200 hover:bg-[var(--surface-muted)]/55 sm:p-3.5"
              >
                <div className="flex items-start gap-3">
                  {transfer.productImageUrl ? (
                    <img
                      src={transfer.productImageUrl}
                      alt=""
                      className="size-14 shrink-0 rounded-lg bg-[var(--surface-muted)] object-cover"
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
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--warning-text)]/20 bg-[var(--warning-surface)] px-2 py-1 text-[10px] font-bold text-[var(--warning-text)]">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--warning-text)] motion-safe:animate-pulse motion-reduce:animate-none" />
                    입금 진행 중
                  </span>
                </div>
                <p className="mt-3 font-mono text-xl font-black tabular-nums tracking-tight text-[var(--accent-text)]">
                  {formatKRW(transfer.expectedAmount)}
                </p>
                <p className="mt-1 font-mono text-[10px] font-bold tabular-nums text-[var(--text-muted)]">
                  계좌 확인 {dateTime(transfer.requestedAt)}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {transfer.purchaseOfferKind ? (
                    <span className="rounded-md border border-[var(--info-border)] bg-[var(--info-surface)] px-2 py-1 text-[10px] font-black text-[var(--info-text)]">
                      {transfer.purchaseOfferKind === "second_chance"
                        ? "차순위 구매권"
                        : "원낙찰"}
                      {transfer.purchaseOfferRound
                        ? ` · ${transfer.purchaseOfferRound}회차`
                        : ""}
                    </span>
                  ) : null}
                  <span
                    className={`rounded-md border px-2 py-1 font-mono text-[10px] font-black tabular-nums ${
                      isTransferExpired(transfer, auctionNow)
                        ? "border-[var(--danger-text)]/25 bg-[var(--danger-surface)] text-[var(--danger-text)]"
                        : "border-[var(--warning-text)]/25 bg-[var(--warning-surface)] text-[var(--warning-text)]"
                    }`}
                  >
                    {transfer.paymentDeadlineExempt || !transfer.dueAt
                      ? "입금기한 특례"
                      : isTransferExpired(transfer, auctionNow)
                        ? "기한 만료 · 자동 처리 대기"
                        : `입금 마감 ${dateTime(transfer.dueAt)}`}
                  </span>
                </div>
                <p className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">
                  안내 계좌 · <strong className="font-mono tabular-nums tracking-tight text-[var(--text-strong)]">{transfer.bankName} {transfer.accountNumber}</strong>
                </p>
                <Button
                  fullWidth
                  className="mt-3 active:scale-95 transition-all duration-200"
                  isLoading={confirmingId === transfer.orderId}
                  disabled={
                    Boolean(confirmingId) ||
                    isTransferExpired(transfer, auctionNow)
                  }
                  onClick={() => void confirmTransfer(transfer)}
                >
                  {isTransferExpired(transfer, auctionNow)
                    ? "기한 만료 처리 대기"
                    : "입금 확정하기"}
                </Button>
              </li>
              ))}
            </ul>
          </>
        )}
        </div>
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
