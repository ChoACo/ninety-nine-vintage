"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface CombinedAuctionWin {
  productId: string;
  title: string;
  amount: number;
  dueAt: string | null;
}

interface CombinedTransfer {
  paymentId: string;
  depositorName: string;
  expectedAmount: number;
  itemSubtotal: number;
  shippingFee: number;
  shippingCreditQuantity: number;
  includeShippingFee: boolean;
  itemCount: number;
  bankName: string;
  accountNumber: string;
  requestedAt: string;
  dueAt: string | null;
  items: Array<{
    orderId: string;
    productId: string;
    title: string;
    amount: number;
    dueAt: string | null;
  }>;
}

interface CombinedAuctionPaymentProps {
  deadlineEnforcementExempt: boolean;
  rememberedDepositorName: string | null;
  serverTime: string | null;
  wins: CombinedAuctionWin[];
}

function formatAt(value: string | null) {
  if (!value) return "마감 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function isCombinedTransfer(value: unknown): value is CombinedTransfer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.paymentId === "string" &&
    typeof row.depositorName === "string" &&
    Number.isSafeInteger(Number(row.expectedAmount)) &&
    Number.isSafeInteger(Number(row.itemSubtotal)) &&
    Number.isSafeInteger(Number(row.shippingFee)) &&
    Number.isSafeInteger(Number(row.shippingCreditQuantity)) &&
    typeof row.includeShippingFee === "boolean" &&
    Number.isSafeInteger(Number(row.itemCount)) &&
    typeof row.bankName === "string" &&
    typeof row.accountNumber === "string" &&
    typeof row.requestedAt === "string" &&
    (row.dueAt === null || typeof row.dueAt === "string") &&
    Array.isArray(row.items);
}

export function CombinedAuctionPayment({
  deadlineEnforcementExempt,
  rememberedDepositorName,
  serverTime,
  wins,
}: CombinedAuctionPaymentProps) {
  const [dialog, setDialog] = useState<"payment" | "info" | null>(null);
  const [busy, setBusy] = useState(false);
  const [depositorName, setDepositorName] = useState(
    rememberedDepositorName ?? "",
  );
  const [includeShippingFee, setIncludeShippingFee] = useState(true);
  const [message, setMessage] = useState("");
  const [transfer, setTransfer] = useState<CombinedTransfer | null>(null);
  const total = useMemo(
    () => wins.reduce((sum, win) => sum + win.amount, 0),
    [wins],
  );
  const earliestDeadline = useMemo(
    () => wins
      .flatMap((win) => win.dueAt ? [win.dueAt] : [])
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null,
    [wins],
  );
  const serverNow = serverTime ? Date.parse(serverTime) : Number.NaN;
  const expired = Boolean(
    earliestDeadline &&
    Number.isFinite(serverNow) &&
    Date.parse(earliestDeadline) <= serverNow,
  );
  const paymentBlocked = expired && !deadlineEnforcementExempt;

  useEffect(() => {
    if (!dialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setDialog(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, dialog]);

  const begin = async () => {
    const canonicalName = depositorName.trim();
    if (!canonicalName) {
      setMessage("입금자명을 입력해 주세요.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const session = (await getSupabaseBrowserClient().auth.getSession()).data
        .session;
      if (!session?.access_token) throw new Error("로그인 후 결제할 수 있습니다.");
      const response = await fetch("/api/payments/manual-transfer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "begin",
          depositorName: canonicalName,
          includeShippingFee,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        transfer?: unknown;
        error?: string;
        message?: string;
      } | null;
      if (!response.ok || !isCombinedTransfer(payload?.transfer)) {
        throw new Error(
          payload?.message ?? payload?.error ?? "일괄 결제를 시작하지 못했습니다.",
        );
      }
      setTransfer(payload.transfer);
      setDepositorName(payload.transfer.depositorName);
      setDialog(null);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "일괄 결제를 시작하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mt-5 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold">
            {wins.length}개 낙찰품 · 총 {total.toLocaleString("ko-KR")}원
          </p>
          <p className={`mt-1 text-[11px] ${paymentBlocked ? "font-bold text-red-700" : "text-muted"}`}>
            가장 빠른 결제 마감 {formatAt(earliestDeadline)}
          </p>
        </div>
        <button
          className="h-11 bg-ink px-6 text-xs font-bold text-paper disabled:opacity-40"
          disabled={paymentBlocked}
          onClick={() => {
            setMessage("");
            setDepositorName((current) =>
              current || rememberedDepositorName || ""
            );
            setDialog(transfer ? "info" : "payment");
          }}
          type="button"
        >
          {paymentBlocked
            ? "결제 마감"
            : transfer
              ? "입금 정보 보기"
              : "낙찰품 전체 결제하기"}
        </button>
      </div>

      {dialog === "payment" && (
        <div
          aria-labelledby="combined-auction-payment-title"
          aria-modal="true"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setDialog(null);
          }}
          role="dialog"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto bg-paper p-5 shadow-2xl sm:p-7">
            <div className="flex items-start justify-between gap-4 border-b border-ink pb-4">
              <div>
                <p className="eyebrow text-muted">낙찰품 일괄 결제</p>
                <h3
                  className="mt-2 text-xl font-black"
                  id="combined-auction-payment-title"
                >
                  한 번에 {wins.length}개 결제
                </h3>
              </div>
              <button
                aria-label="결제 창 닫기"
                className="p-2"
                disabled={busy}
                onClick={() => setDialog(null)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-5 divide-y divide-line border-y border-line">
              {wins.map((win) => (
                <div
                  className="flex items-center justify-between gap-4 py-3 text-xs"
                  key={win.productId}
                >
                  <span className="min-w-0 truncate font-bold">{win.title}</span>
                  <span className="shrink-0 font-mono">
                    {win.amount.toLocaleString("ko-KR")}원
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between text-sm font-black">
              <span>낙찰품 합계</span>
              <span>{total.toLocaleString("ko-KR")}원</span>
            </div>

            <label className="mt-5 flex cursor-pointer items-start gap-3 border border-line bg-surface p-4">
              <input
                checked={includeShippingFee}
                className="mt-0.5"
                onChange={(event) => setIncludeShippingFee(event.target.checked)}
                type="checkbox"
              />
              <span>
                <span className="block text-xs font-black">택배비 포함 결제</span>
                <span className="mt-1 block text-[11px] leading-5 text-muted">
                  기본 선택입니다. 포함하면 결제 확인 후 배송 크레딧으로
                  적립되며, 원하지 않으면 선택을 해제할 수 있습니다.
                </span>
              </span>
            </label>
            <div className="mt-4 space-y-2 border-y border-line py-4 text-xs">
              <p className="flex justify-between gap-4">
                <span>낙찰품 합계</span>
                <span>{total.toLocaleString("ko-KR")}원</span>
              </p>
              {includeShippingFee && (
                <p className="flex justify-between gap-4 font-bold">
                  <span>+택배비</span>
                  <span>결제 정보 생성 시 확정</span>
                </p>
              )}
              <p className="flex justify-between gap-4 border-t border-line pt-2 text-sm font-black">
                <span>총 결제 금액</span>
                <span>{includeShippingFee ? "낙찰품 합계 + 택배비" : `${total.toLocaleString("ko-KR")}원`}</span>
              </p>
            </div>
            <label className="mt-6 block text-xs font-bold" htmlFor="combined-auction-depositor">
              입금자명 <span className="text-red-700">필수</span>
            </label>
            <input
              autoFocus
              className="mt-2 h-11 w-full border border-line px-3 text-sm"
              id="combined-auction-depositor"
              maxLength={80}
              onChange={(event) => setDepositorName(event.target.value)}
              placeholder="실제 입금할 이름"
              value={depositorName}
            />
            <p className="mt-2 text-[11px] text-muted">
              저장된 이름이 있어도 확인을 위해 매번 이 창이 열립니다. 이름은 언제든 수정할 수 있습니다.
            </p>
            <button
              className="mt-5 h-12 w-full bg-ink text-sm font-bold text-paper disabled:opacity-40"
              disabled={busy || !depositorName.trim()}
              onClick={() => void begin()}
              type="button"
            >
              {busy ? "결제 정보 만드는 중..." : "결제하기"}
            </button>
            {message && (
              <p aria-live="polite" className="mt-4 text-xs font-bold text-red-700">
                {message}
              </p>
            )}
          </div>
        </div>
      )}

      {dialog === "info" && transfer && (
        <div
          aria-labelledby="combined-auction-transfer-title"
          aria-modal="true"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialog(null);
          }}
          role="dialog"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto bg-paper p-5 shadow-2xl sm:p-7">
            <div className="flex items-start justify-between gap-4 border-b border-ink pb-4">
              <div>
                <p className="eyebrow text-muted">낙찰품 일괄 결제</p>
                <h3 className="mt-2 text-xl font-black" id="combined-auction-transfer-title">
                  입금 정보
                </h3>
              </div>
              <button aria-label="입금 정보 창 닫기" className="p-2" onClick={() => setDialog(null)} type="button">
                <X size={18} />
              </button>
            </div>
            <div className="mt-6 border border-ink bg-surface p-4 text-sm leading-7">
              <p className="font-black">입금 정보가 준비되었습니다.</p>
              <p className="mt-2">{transfer.bankName} {transfer.accountNumber}</p>
              <p>입금자명 {transfer.depositorName}</p>
              <div className="my-3 border-y border-line py-3 text-xs">
                <p className="flex justify-between gap-4">
                  <span>낙찰품 합계</span>
                  <span>{transfer.itemSubtotal.toLocaleString("ko-KR")}원</span>
                </p>
                {transfer.includeShippingFee && (
                  <p className="mt-1 flex justify-between gap-4">
                    <span>+택배비 · 크레딧 {transfer.shippingCreditQuantity}개</span>
                    <span>{transfer.shippingFee.toLocaleString("ko-KR")}원</span>
                  </p>
                )}
              </div>
              <p className="flex justify-between gap-4 font-black">
                <span>총 결제 금액</span>
                <span>{transfer.expectedAmount.toLocaleString("ko-KR")}원</span>
              </p>
              <p className="mt-2 text-xs text-muted">결제 마감 {formatAt(transfer.dueAt)}</p>
              <p className="mt-3 text-xs">
                위 총액을 한 번만 입금해 주세요. 운영자가 입금을 확인하면 모든 낙찰품이 함께 결제 완료됩니다.
              </p>
            </div>
            <button
              className="mt-3 w-full border border-ink px-4 py-3 text-xs font-bold"
              onClick={() => {
                setTransfer(null);
                setMessage("");
                setDialog("payment");
              }}
              type="button"
            >
              입금자명 수정하기
            </button>
          </div>
        </div>
      )}
    </>
  );
}
