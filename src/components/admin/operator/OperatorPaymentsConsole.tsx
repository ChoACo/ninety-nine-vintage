"use client";

import { CheckCircle2, Clock3, Landmark, RefreshCw } from "lucide-react";
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
    "confirmedAt", "confirmedBy", "lastDepositorName", "buyerName", "products",
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
  return Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field)) &&
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
  const [includeHistory, setIncludeHistory] = useState(false);
  const [offset, setOffset] = useState(0);
  const [depositorNames, setDepositorNames] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
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
        if (token) await load(token, false, 0);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "입금 대기열을 불러오지 못했습니다.");
      }
    })();
  }, [load]);

  const changeHistory = (next: boolean) => {
    setIncludeHistory(next);
    setOffset(0);
    void load(accessToken, next, 0).catch((error) => {
      setNotice(error instanceof Error ? error.message : "입금 대기열을 불러오지 못했습니다.");
    });
  };

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
    if (!depositorName) {
      setNotice("입금자명을 입력해 주세요.");
      return;
    }
    const idempotencyKey = sessionStorage.getItem(key) ?? crypto.randomUUID();
    sessionStorage.setItem(key, idempotencyKey);
    setBusyKey(key);
    setNotice("");
    try {
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
      sessionStorage.removeItem(key);
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

  const summary = useMemo(() => ({
    pending: payments.filter((payment) => payment.remainingAmount > 0).length,
    confirmed: payments.filter((payment) => payment.remainingAmount === 0).length,
  }), [payments]);
  const buyerGroups = useMemo(() => {
    const grouped = new Map<
      string,
      { memberId: string; buyerName: string; payments: PaymentRow[] }
    >();
    for (const payment of payments) {
      const current = grouped.get(payment.memberId);
      if (current) {
        current.payments.push(payment);
      } else {
        grouped.set(payment.memberId, {
          memberId: payment.memberId,
          buyerName: payment.buyerName,
          payments: [payment],
        });
      }
    }
    return [...grouped.values()];
  }, [payments]);

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
        <label className="flex items-center gap-2 text-xs font-bold"><input checked={includeHistory} onChange={(event) => changeHistory(event.target.checked)} type="checkbox" /> 확인 완료 내역 포함</label>
        <p className="text-[11px] text-muted">서버 기준 {formatAt(serverTime)}</p>
      </div>

      <div className="space-y-5">
        {buyerGroups.map((group) => (
          <section className="border border-line" key={group.memberId}>
            <header className="flex items-end justify-between gap-4 border-b border-ink bg-surface px-5 py-4">
              <div>
                <p className="text-base font-black">{group.buyerName}</p>
                <p className="mt-1 break-all font-mono text-[10px] text-muted">
                  {group.memberId}
                </p>
              </div>
              <p className="text-xs font-bold">
                주문·입금 {group.payments.length}건
              </p>
            </header>
            {group.payments.map((payment) => {
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
          return (
            <article className="border-b border-line px-4 py-5 last:border-b-0 sm:px-5" key={`${payment.paymentKind}:${payment.paymentId}`}>
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:gap-6">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="border border-line px-2 py-1 text-[10px] font-bold">{kindLabel(payment.paymentKind)}</span><span className="border border-line px-2 py-1 text-[10px] font-bold">{statusLabel(payment.status)}</span></div>
                  <p className="mt-3 break-words text-sm font-bold">{payment.reference}</p>
                  <p className="mt-1 break-all font-mono text-[10px] text-muted">{payment.paymentId}</p>
                  {payment.products.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {payment.products.map((product) => (
                        <div
                          className="flex max-w-xs items-center gap-2 border border-line bg-paper p-2"
                          key={product.id}
                        >
                          <CatalogImage
                            alt=""
                            className="size-10 object-cover"
                            src={product.imageUrl ?? ""}
                          />
                          <span className="line-clamp-2 text-[11px] font-bold">
                            {product.title}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="w-full max-w-sm border border-line p-3 text-xs sm:w-80">
                  <p className="flex items-center gap-2 font-bold"><Landmark size={13} /> 입금 계좌</p>
                  <p className="mt-2 break-all text-muted">{account}</p>
                </div>
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-xs sm:grid-cols-4">
                <div><dt className="text-muted">예상 금액</dt><dd className="mt-1 font-bold">{formatWon(payment.expectedAmount)}</dd></div>
                <div><dt className="text-muted">누적 입금</dt><dd className="mt-1 font-bold">{formatWon(payment.receivedAmount)}</dd></div>
                <div><dt className="text-muted">잔액</dt><dd className="mt-1 font-bold">{formatWon(payment.remainingAmount)}</dd></div>
                <div><dt className="text-muted">원장 행</dt><dd className="mt-1 font-mono font-bold">{payment.ledgerEntryCount}</dd></div>
                <div><dt className="text-muted">입금자</dt><dd className="mt-1 break-words">{payment.lastDepositorName ?? "-"}</dd></div>
                <div><dt className="text-muted">요청 시각</dt><dd className="mt-1">{formatAt(payment.requestedAt)}</dd></div>
                <div><dt className="text-muted">확인자</dt><dd className="mt-1 break-all">{payment.confirmedBy ?? "-"}</dd></div>
                <div><dt className="text-muted">확인 시각</dt><dd className="mt-1">{formatAt(payment.confirmedAt)}</dd></div>
              </dl>

              {confirmable && (
                <div className="mt-5 grid grid-cols-1 gap-2 border-t border-line pt-4 sm:grid-cols-[minmax(0,240px)_auto]">
                  <input aria-label={`${payment.reference} 입금자명`} className="h-10 border border-line px-3 text-xs" maxLength={80} onChange={(event) => setDepositorNames((current) => ({ ...current, [key]: event.target.value }))} placeholder="입금자명" value={depositorNames[key] ?? payment.lastDepositorName ?? ""} />
                  <button className="h-10 bg-ink px-4 text-xs font-bold text-paper disabled:opacity-40" disabled={busyKey !== null} onClick={() => void confirm(payment)} type="button">{payment.remainingAmount === 0 ? "원장 금액 결제 확정" : "잔액 전액 입금 확인 완료"}</button>
                </div>
              )}
              {needsLedgerAdjustment && (
                <p className="mt-5 border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">
                  부분·초과 입금 또는 역분개 상태입니다. 이 단순 확인 화면에서는 처리하지 않고 고급 원장 조정을 사용해 주세요.
                </p>
              )}
            </article>
          );
            })}
          </section>
        ))}
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
