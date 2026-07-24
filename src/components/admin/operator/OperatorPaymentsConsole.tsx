"use client";

import { CheckCircle2, Clock3, Pencil, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type PaymentKind = "commerce" | "auction" | "shipping_fee";

interface PaymentRow {
  paymentKind: PaymentKind;
  paymentId: string;
  businessId: string;
  memberId: string;
  reference: string;
  expectedAmount: number;
  receivedAmount: number;
  remainingAmount: number;
  ledgerEntryCount: number;
  version: number;
  status: string;
  bankNameSnapshot: string | null;
  accountNumberSnapshot: string | null;
  requestedAt: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  lastDepositorName: string | null;
  buyerName: string;
  reversibleLedgerId: string | null;
  products: PaymentProduct[];
}

interface PaymentProduct {
  id: string;
  title: string;
  imageUrl: string | null;
}

interface PaymentQueueResponse {
  payments: PaymentRow[];
  serverTime: string;
}

interface ConfirmationResult {
  payment_kind: PaymentKind;
  payment_id: string;
  status: string;
  received_amount: number;
  remaining_amount: number;
  ledger_entry_count: number;
  version: number;
  idempotent_replay: boolean;
}

const PAGE_SIZE = 50;
const SESSION_KEY_PREFIX = "ninety-nine:unified-manual-payment-confirm:";

function formatWon(amount: number) {
  return `${new Intl.NumberFormat("ko-KR").format(amount)}원`;
}

function formatAt(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ko-KR");
}

function kindLabel(kind: PaymentKind) {
  return {
    commerce: "상품 결제",
    auction: "경매 결제",
    shipping_fee: "배송비",
  }[kind];
}

function statusLabel(status: string) {
  return {
    awaiting_transfer: "입금 대기 중",
    awaiting_manual_transfer: "입금 대기 중",
    partially_paid: "부분 입금",
    confirmed: "입금 확인 완료",
    paid: "결제 완료",
    cancelled: "취소됨",
  }[status] ?? status;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPaymentKind(value: unknown): value is PaymentKind {
  return value === "commerce" || value === "auction" || value === "shipping_fee";
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSignedInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isTextOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isPaymentProduct(value: unknown): value is PaymentProduct {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    isTextOrNull(value.imageUrl)
  );
}

function isPaymentRow(value: unknown): value is PaymentRow {
  if (!isRecord(value)) return false;
  const fields = [
    "paymentKind", "paymentId", "businessId", "memberId", "reference",
    "expectedAmount", "receivedAmount", "remainingAmount", "ledgerEntryCount",
    "version", "status", "bankNameSnapshot", "accountNumberSnapshot", "requestedAt",
    "confirmedAt", "confirmedBy", "lastDepositorName", "buyerName",
    "reversibleLedgerId", "products",
  ];
  return Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field)) &&
    isPaymentKind(value.paymentKind) &&
    typeof value.paymentId === "string" &&
    typeof value.businessId === "string" &&
    typeof value.memberId === "string" &&
    typeof value.reference === "string" &&
    isInteger(value.expectedAmount) &&
    isSignedInteger(value.receivedAmount) &&
    isSignedInteger(value.remainingAmount) &&
    isInteger(value.ledgerEntryCount) &&
    isInteger(value.version) &&
    typeof value.status === "string" &&
    isTextOrNull(value.bankNameSnapshot) &&
    isTextOrNull(value.accountNumberSnapshot) &&
    typeof value.requestedAt === "string" &&
    isTextOrNull(value.confirmedAt) &&
    isTextOrNull(value.confirmedBy) &&
    isTextOrNull(value.lastDepositorName) &&
    typeof value.buyerName === "string" &&
    isTextOrNull(value.reversibleLedgerId) &&
    Array.isArray(value.products) &&
    value.products.every(isPaymentProduct);
}

function isQueueResponse(value: unknown): value is PaymentQueueResponse {
  return isRecord(value) && Object.keys(value).length === 2 &&
    Array.isArray(value.payments) && value.payments.every(isPaymentRow) &&
    typeof value.serverTime === "string";
}

function isConfirmationResult(
  value: unknown,
  expectedKind: PaymentKind,
  expectedId: string,
): value is ConfirmationResult {
  if (!isRecord(value)) return false;
  const fields = [
    "payment_kind", "payment_id", "status", "received_amount", "remaining_amount",
    "ledger_entry_count", "version", "idempotent_replay",
  ];
  return fields.every((field) => Object.hasOwn(value, field)) &&
    value.payment_kind === expectedKind && value.payment_id === expectedId &&
    typeof value.status === "string" &&
    isInteger(value.received_amount) && isInteger(value.remaining_amount) &&
    isInteger(value.ledger_entry_count) && isInteger(value.version) &&
    typeof value.idempotent_replay === "boolean";
}

function sessionKey(payment: PaymentRow) {
  return `${SESSION_KEY_PREFIX}${payment.paymentKind}:${payment.paymentId}:${payment.receivedAmount}:${payment.ledgerEntryCount}:${payment.version}`;
}

export function OperatorPaymentsConsole() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [serverTime, setServerTime] = useState<string | null>(null);
  const [includeHistory] = useState(true);
  const [offset, setOffset] = useState(0);
  const [depositorNames, setDepositorNames] = useState<Record<string, string>>({});
  const [confirmationAmounts, setConfirmationAmounts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (
    token: string | null,
    history: boolean,
    nextOffset: number,
  ) => {
    if (!token) return;
    const query = new URLSearchParams({
      includeHistory: String(history),
      limit: String(PAGE_SIZE),
      offset: String(nextOffset),
    });
    const response = await fetch(`/api/admin/operator/payments?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok || !isQueueResponse(payload)) {
      const error = isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : "입금 대기열을 불러오지 못했습니다.";
      throw new Error(error);
    }
    setPayments(payload.payments);
    setServerTime(payload.serverTime);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
        const token = session?.access_token ?? null;
        setAccessToken(token);
        if (token) await load(token, true, 0);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "입금 대기열을 불러오지 못했습니다.");
      }
    })();
  }, [load]);

  const refresh = () => {
    void load(accessToken, includeHistory, offset).catch((error) => {
      setNotice(error instanceof Error ? error.message : "새로고침에 실패했습니다.");
    });
  };

  const changePage = (nextOffset: number) => {
    setOffset(nextOffset);
    void load(accessToken, includeHistory, nextOffset).catch((error) => {
      setNotice(error instanceof Error ? error.message : "입금 대기열을 불러오지 못했습니다.");
    });
  };

  const confirm = async (payment: PaymentRow) => {
    if (!accessToken || busyKey || payment.remainingAmount < 1) return;
    const key = sessionKey(payment);
    const depositorName = (depositorNames[key] ?? payment.lastDepositorName ?? "").trim();
    const confirmationAmount = Number(
      (confirmationAmounts[key] ?? String(payment.remainingAmount)).replaceAll(",", ""),
    );
    if (
      !Number.isSafeInteger(confirmationAmount) ||
      confirmationAmount < 1 ||
      confirmationAmount > payment.remainingAmount
    ) {
      setExpandedKey(key);
      setNotice(`확인 금액은 1원부터 ${formatWon(payment.remainingAmount)}까지 입력해 주세요.`);
      return;
    }
    if (!depositorName) {
      setExpandedKey(key);
      setNotice("입금자명을 입력해 주세요.");
      return;
    }
    const idempotencyStorageKey = `${key}:amount:${confirmationAmount}`;
    const idempotencyKey = sessionStorage.getItem(idempotencyStorageKey) ?? crypto.randomUUID();
    sessionStorage.setItem(idempotencyStorageKey, idempotencyKey);
    setBusyKey(key);
    setNotice("");
    try {
      if (confirmationAmount !== payment.remainingAmount) {
        if (
          payment.paymentKind === "auction" &&
          payment.paymentId === payment.memberId
        ) {
          throw new Error("낙찰품 일괄 결제는 나누지 않고 표시된 전체 금액만 확인할 수 있습니다.");
        }
        const response = await fetch(
          `/api/admin/operator/transfers/${payment.paymentId}/ledger`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              action: "record",
              kind: payment.paymentKind === "shipping_fee"
                ? "shipping"
                : payment.paymentKind,
              amount: confirmationAmount,
              depositorName,
              expectedReceivedAmount: payment.receivedAmount,
              expectedLedgerEntryCount: payment.ledgerEntryCount,
              idempotencyKey,
              memo: "입금 확인 목록에서 금액 변경",
            }),
          },
        );
        const payload = await response.json().catch(() => null) as unknown;
        if (!response.ok || !isRecord(payload) || !isRecord(payload.result)) {
          throw new Error(
            isRecord(payload) && typeof payload.error === "string"
              ? payload.error
              : "변경한 입금 금액을 기록하지 못했습니다.",
          );
        }
        sessionStorage.removeItem(idempotencyStorageKey);
        setNotice(`${formatWon(confirmationAmount)} 입금을 확인했습니다.`);
        await load(accessToken, includeHistory, offset);
        return;
      }
      const response = await fetch(
        `/api/admin/operator/payments/${payment.paymentKind}/${payment.paymentId}/confirm`,
        {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          depositorName,
          observedReceivedAmount: payment.receivedAmount,
          observedLedgerEntryCount: payment.ledgerEntryCount,
          expectedVersion: payment.version,
          idempotencyKey,
        }),
      });
      const payload = await response.json().catch(() => null) as unknown;
      if (response.status === 409) {
        await load(accessToken, includeHistory, offset);
        throw new Error("입금 상태가 변경되었습니다. 최신 목록을 확인해 주세요.");
      }
      if (!response.ok || !isRecord(payload) || !isConfirmationResult(
        payload.payment,
        payment.paymentKind,
        payment.paymentId,
      )) {
        const message = isRecord(payload) && typeof payload.message === "string"
          ? payload.message
          : "입금 확인 결과를 검증하지 못했습니다.";
        throw new Error(message);
      }
      sessionStorage.removeItem(idempotencyStorageKey);
      setNotice(payload.payment.idempotent_replay
        ? "기존 입금 확인 결과를 다시 확인했습니다."
        : "잔액 전액을 입금 확인 처리했습니다.");
      await load(accessToken, includeHistory, offset);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "입금 확인을 처리하지 못했습니다.");
    } finally {
      setBusyKey(null);
    }
  };

  const reverse = async (payment: PaymentRow) => {
    if (!accessToken || busyKey || !payment.reversibleLedgerId) return;
    const reason = window.prompt("입금 확인 취소 사유를 입력해 주세요.");
    if (!reason?.trim()) return;
    const key = `reverse:${payment.paymentKind}:${payment.paymentId}:${payment.reversibleLedgerId}`;
    const idempotencyKey = sessionStorage.getItem(key) ?? crypto.randomUUID();
    sessionStorage.setItem(key, idempotencyKey);
    setBusyKey(key);
    setNotice("");
    try {
      const response = await fetch(
        `/api/admin/operator/transfers/${payment.paymentId}/ledger`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            action: "reverse",
            kind: payment.paymentKind === "shipping_fee"
              ? "shipping"
              : payment.paymentKind,
            ledgerId: payment.reversibleLedgerId,
            reason: reason.trim(),
            expectedReceivedAmount: payment.receivedAmount,
            expectedLedgerEntryCount: payment.ledgerEntryCount,
            idempotencyKey,
          }),
        },
      );
      const payload = await response.json().catch(() => null) as unknown;
      if (!response.ok || !isRecord(payload) || !isRecord(payload.result)) {
        throw new Error(
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "입금 확인을 취소하지 못했습니다.",
        );
      }
      sessionStorage.removeItem(key);
      setNotice("입금 확인을 취소하고 이전 단계로 되돌렸습니다.");
      await load(accessToken, includeHistory, offset);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "입금 확인을 취소하지 못했습니다.");
    } finally {
      setBusyKey(null);
    }
  };

  const summary = useMemo(() => ({
    pending: payments.filter((payment) => payment.remainingAmount > 0).length,
    confirmed: payments.filter((payment) => payment.remainingAmount === 0).length,
  }), [payments]);
  const orderedPayments = useMemo(() => [
    ...payments.filter((payment) => payment.remainingAmount > 0),
    ...payments.filter((payment) => payment.remainingAmount === 0),
  ], [payments]);
  const pendingCount = summary.pending;

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-stretch justify-between gap-5 border-b border-ink pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow text-muted">운영자 / 주문·입금 확인</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-.06em] sm:text-4xl sm:tracking-[-.08em]">주문·입금 확인</h1>
          <p className="mt-3 text-sm text-muted">구매자별 주문 상품을 확인하고 잔액 전액을 한 번에 결제 확정합니다.</p>
        </div>
        <button className="flex items-center justify-center gap-2 border border-line px-4 py-3 text-xs font-bold" onClick={refresh} type="button">
          <RefreshCw size={13} /> 새로고침
        </button>
      </div>

      {notice && <div aria-live="polite" className="border border-line bg-surface px-4 py-3 text-xs">{notice}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="border border-line p-5"><Clock3 size={17} /><p className="mt-7 text-xs text-muted">현재 페이지 입금 대기</p><p className="mt-3 font-mono text-3xl font-bold">{summary.pending}</p></div>
        <div className="border border-line bg-ink p-5 text-paper"><CheckCircle2 size={17} /><p className="mt-7 text-xs text-zinc-400">현재 페이지 확인 완료</p><p className="mt-3 font-mono text-3xl font-bold">{summary.confirmed}</p></div>
      </div>

      <div className="flex flex-col gap-4 border-b border-line pb-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-bold">입금 확인 완료 내역은 처리 시각부터 최대 7일간 표시됩니다.</p>
        <p className="text-[11px] text-muted">서버 기준 {formatAt(serverTime)}</p>
      </div>

      <div className="overflow-hidden border border-line">
        <div className="hidden grid-cols-[minmax(120px,1fr)_minmax(180px,2fr)_120px_110px_150px] gap-4 border-b border-ink bg-surface px-4 py-3 text-[11px] font-bold text-muted md:grid">
          <span>회원</span>
          <span>상품</span>
          <span className="text-right">금액</span>
          <span className="text-center">상태</span>
          <span className="text-center">처리</span>
        </div>
        <div className="border-b border-ink bg-paper px-4 py-3 text-xs font-black">
          입금 확인 하기 · {summary.pending}건
        </div>
        {orderedPayments.map((payment, index) => {
          const key = sessionKey(payment);
          const pending = payment.remainingAmount > 0;
          const confirmable = payment.receivedAmount >= 0 && (
            pending || (
              payment.paymentKind === "shipping_fee" &&
              payment.status === "partially_paid" &&
              payment.remainingAmount === 0
            )
          );
          const needsLedgerAdjustment = payment.receivedAmount < 0 || payment.remainingAmount < 0;
          const account = [payment.bankNameSnapshot, payment.accountNumberSnapshot].filter(Boolean).join(" · ") || "계좌 정보 없음";
          const firstProduct = payment.products[0];
          const productSummary = firstProduct
            ? `${firstProduct.title}${payment.products.length > 1 ? ` 외 ${payment.products.length - 1}개` : ""}`
            : payment.reference;
          const expanded = expandedKey === key;
          return (
            <div key={`${payment.paymentKind}:${payment.paymentId}`}>
              {index === pendingCount && (
                <div className="border-y border-ink bg-ink px-4 py-3 text-xs font-black text-paper">
                  입금 확인 완료 · 최근 7일 · {summary.confirmed}건
                </div>
              )}
            <article className="border-b border-line last:border-b-0">
              <div className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(120px,1fr)_minmax(180px,2fr)_120px_110px_150px] md:items-center md:gap-4">
                <div className="min-w-0">
                  <p className="truncate text-xs font-black">{payment.buyerName}</p>
                  <p className="mt-1 text-[10px] text-muted">{kindLabel(payment.paymentKind)}</p>
                </div>
                <button
                  className="min-w-0 text-left"
                  onClick={() => setExpandedKey(expanded ? null : key)}
                  type="button"
                >
                  <p className="truncate text-xs font-bold">{productSummary}</p>
                  <p className="mt-1 text-[10px] font-bold underline">
                    {expanded ? "상세 닫기" : "상세보기"}
                  </p>
                </button>
                <p className="font-mono text-sm font-black md:text-right">
                  {formatWon(payment.remainingAmount)}
                  {pending && (
                    <button
                      className="mt-1 flex items-center gap-1 text-[10px] font-bold underline md:ml-auto"
                      onClick={() => setExpandedKey(expanded ? null : key)}
                      type="button"
                    >
                      <Pencil size={10} /> 금액 변경하기
                    </button>
                  )}
                </p>
                <p className="text-xs font-bold md:text-center">
                  {statusLabel(payment.status)}
                </p>
                {confirmable ? (
                  <button
                    className="h-10 bg-ink px-3 text-xs font-bold text-paper disabled:opacity-40"
                    disabled={busyKey !== null}
                    onClick={() => void confirm(payment)}
                    type="button"
                  >
                    {busyKey === key ? "처리 중..." : "입금 확인 완료"}
                  </button>
                ) : (
                  <button
                    className="inline-flex h-10 items-center justify-center gap-1 border border-line px-3 text-xs font-bold disabled:opacity-40"
                    disabled={busyKey !== null || !payment.reversibleLedgerId}
                    onClick={() => void reverse(payment)}
                    type="button"
                  >
                    <RotateCcw size={12} /> 입금 확인 취소하기
                  </button>
                )}
              </div>

              {expanded && (
                <div className="border-t border-line bg-surface px-4 py-4">
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(240px,.7fr)]">
                    <div>
                      <p className="text-xs font-black">
                        상품 {payment.products.length}개
                      </p>
                      <div className="mt-3 divide-y divide-line border-y border-line bg-paper">
                        {payment.products.map((product) => (
                          <div className="flex items-center gap-3 py-2" key={product.id}>
                            <CatalogImage
                              alt=""
                              className="size-10 shrink-0 object-cover"
                              src={product.imageUrl ?? ""}
                            />
                            <span className="min-w-0 truncate text-xs font-bold">
                              {product.title}
                            </span>
                          </div>
                        ))}
                        {payment.products.length === 0 && (
                          <p className="py-4 text-xs text-muted">{payment.reference}</p>
                        )}
                      </div>
                    </div>
                    <div className="text-xs">
                      <p><span className="text-muted">입금 계좌</span><br />{account}</p>
                      <p className="mt-3"><span className="text-muted">요청 시각</span><br />{formatAt(payment.requestedAt)}</p>
                      <label className="mt-4 block font-bold" htmlFor={`depositor-${key}`}>
                        입금자명
                      </label>
                      <input
                        className="mt-2 h-10 w-full border border-line bg-paper px-3 text-xs"
                        id={`depositor-${key}`}
                        maxLength={80}
                        onChange={(event) => setDepositorNames((current) => ({ ...current, [key]: event.target.value }))}
                        placeholder="입금자명"
                        value={depositorNames[key] ?? payment.lastDepositorName ?? ""}
                      />
                      {pending && (
                        <>
                          <label className="mt-4 block font-bold" htmlFor={`amount-${key}`}>
                            이번 확인 금액
                          </label>
                          <input
                            className="mt-2 h-10 w-full border border-line bg-paper px-3 font-mono text-xs"
                            id={`amount-${key}`}
                            inputMode="numeric"
                            max={payment.remainingAmount}
                            min={1}
                            onChange={(event) => setConfirmationAmounts((current) => ({
                              ...current,
                              [key]: event.target.value.replace(/[^0-9]/gu, ""),
                            }))}
                            value={confirmationAmounts[key] ?? String(payment.remainingAmount)}
                          />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {needsLedgerAdjustment && (
                <p className="border-t border-amber-300 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">
                  부분·초과 입금 또는 역분개 상태입니다. 이 단순 확인 화면에서는 처리하지 않고 고급 원장 조정을 사용해 주세요.
                </p>
              )}
            </article>
            </div>
          );
        })}
        {payments.length === 0 && <p className="py-16 text-center text-sm text-muted">표시할 입금 요청이 없습니다.</p>}
      </div>

      <div className="flex items-center justify-between gap-4">
        <button className="border border-line px-4 py-2 text-xs font-bold disabled:opacity-40" disabled={offset === 0} onClick={() => changePage(Math.max(0, offset - PAGE_SIZE))} type="button">이전</button>
        <p className="font-mono text-[11px] text-muted">{offset + 1}–{offset + payments.length}</p>
        <button className="border border-line px-4 py-2 text-xs font-bold disabled:opacity-40" disabled={payments.length < PAGE_SIZE} onClick={() => changePage(offset + PAGE_SIZE)} type="button">다음</button>
      </div>
    </div>
  );
}
