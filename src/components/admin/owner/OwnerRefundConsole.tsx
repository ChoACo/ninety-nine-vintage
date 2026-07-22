"use client";

import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

interface ItemRefundRow {
  id: string;
  refundKind: "item";
  inventoryItemId: string;
  memberId: string;
  productId: string;
  title: string;
  originStoreId: string | null;
  originStoreName: string | null;
  status: string;
  amount: number;
  maskedAccountNumber: string | null;
  accountSubmittedAt: string | null;
  accountExpiresAt: string | null;
  approvedAt: string | null;
  completedAt: string | null;
  externalReference: string | null;
  version: number;
}

interface ShippingFeeRefundRow {
  id: string;
  refundKind: "shipping_fee";
  shipmentId: string;
  paymentId: string;
  memberId: string;
  businessId: string;
  status: string;
  amount: number;
  maskedAccountNumber: string | null;
  accountSubmittedAt: string | null;
  accountExpiresAt: string | null;
  createdAt: string;
  externalReference: string | null;
  version: number;
}

type RefundRow = ItemRefundRow | ShippingFeeRefundRow;

interface RevealedAccount {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}

interface QueuePayload {
  refunds?: RefundRow[];
  refundId?: string;
  account?: RevealedAccount;
  refundKind?: "item" | "shipping_fee";
  refund?: { id: string; refundKind: "item" | "shipping_fee"; status: string; version: number };
  error?: string;
  message?: string;
}

const statusLabels: Record<string, string> = {
  requested: "환불 요청",
  approved: "환불 승인",
  completed: "환불 완료",
  cancelled: "환불 취소",
};

function refundKey(refund: RefundRow) {
  return `${refund.refundKind}:${refund.id}`;
}

function refundTitle(refund: RefundRow) {
  return refund.refundKind === "item" ? refund.title : "배송비 환불";
}

export function OwnerRefundConsole() {
  const { session } = useSupabaseSession();
  const token = session?.access_token ?? null;
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [references, setReferences] = useState<Record<string, string>>({});
  const [accessReasons, setAccessReasons] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, RevealedAccount>>({});
  const keys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setNotice("");
    setRevealed({});
    try {
      const response = await fetch(
        `/api/admin/owner/refunds?includeCompleted=${includeCompleted}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const payload = await response.json() as QueuePayload;
      if (!response.ok || !Array.isArray(payload.refunds)) {
        throw new Error(payload.message ?? "환불 목록을 불러오지 못했습니다.");
      }
      setRefunds(payload.refunds);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "환불 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [includeCompleted, token]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const mutate = async (
    refund: RefundRow,
    action: "reveal_account" | "approve" | "complete" | "cancel",
  ) => {
    if (!token) return;
    const subjectKey = refundKey(refund);
    const reason = accessReasons[subjectKey]?.trim() || null;
    const externalReference = references[subjectKey]?.trim() || null;
    const note = notes[subjectKey]?.trim() || null;
    if (action === "reveal_account" && !reason) {
      setNotice("환불 계좌 열람 사유를 입력해 주세요.");
      return;
    }
    if (action === "complete" && !externalReference) {
      setNotice("실제 환불 송금 참조번호를 입력해 주세요.");
      return;
    }

    const scope = `${subjectKey}:${refund.version}:${action}`;
    const idempotencyKey = keys.current.get(scope) ?? crypto.randomUUID();
    keys.current.set(scope, idempotencyKey);
    setBusyId(subjectKey);
    setNotice("");
    try {
      const response = await fetch("/api/admin/owner/refunds", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          refundKind: refund.refundKind,
          refundId: refund.id,
          expectedVersion: refund.version,
          externalReference: action === "complete" ? externalReference : null,
          note,
          reason: action === "reveal_account" ? reason : null,
          idempotencyKey,
        }),
      });
      const payload = await response.json() as QueuePayload;
      if (!response.ok) {
        if (response.status === 409) await load();
        throw new Error(payload.message ?? "환불 작업을 처리하지 못했습니다.");
      }
      keys.current.delete(scope);
      if (action === "reveal_account") {
        if (!payload.account || payload.refundId !== refund.id || payload.refundKind !== refund.refundKind) {
          throw new Error("환불 계좌 응답을 확인할 수 없습니다.");
        }
        setRevealed((current) => ({ ...current, [subjectKey]: payload.account as RevealedAccount }));
        setNotice("계좌 열람을 감사 기록에 남겼습니다. 확인 후 즉시 숨겨 주세요.");
      } else {
        setNotice(
          action === "approve"
            ? "환불을 승인했습니다."
            : action === "complete"
              ? "외부 송금 완료를 기록했습니다."
              : "환불 요청을 취소했습니다.",
        );
        await load();
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "환불 작업을 처리하지 못했습니다.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col justify-between gap-4 border-b border-ink pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow text-muted">Owner / 수동 환불</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.07em]">환불 승인·송금 확인</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">매장과 센터가 보고한 상품 문제를 검토하고, 실제 계좌 송금 뒤 참조번호를 남깁니다.</p>
        </div>
        <button className="flex items-center justify-center gap-2 border border-line px-4 py-3 text-xs font-bold disabled:opacity-40" disabled={loading} onClick={() => void load()} type="button">
          <RefreshCw size={14} /> 새로고침
        </button>
      </header>

      <label className="flex w-fit items-center gap-2 text-xs font-bold">
        <input checked={includeCompleted} onChange={(event) => setIncludeCompleted(event.target.checked)} type="checkbox" /> 완료·취소 포함
      </label>
      {notice && <div aria-live="polite" className="border border-line bg-surface px-4 py-3 text-sm">{notice}</div>}

      <section className="space-y-4" aria-busy={loading}>
        {refunds.map((refund) => {
          const subjectKey = refundKey(refund);
          const account = revealed[subjectKey];
          const busy = busyId === subjectKey;
          return (
            <article className="border border-line" key={subjectKey}>
              <div className="flex flex-col justify-between gap-3 border-b border-line bg-surface p-5 sm:flex-row sm:items-start">
                <div>
                  <p className="text-sm font-black">{refundTitle(refund)}</p>
                  <p className="mt-2 text-xs text-muted">{refund.refundKind === "item" ? refund.originStoreName ?? "매장 확인 필요" : `통합 배송 · 요청 ${refund.shipmentId}`} · {refund.id}</p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="font-mono text-lg font-bold">{refund.amount.toLocaleString("ko-KR")}원</p>
                  <p className="mt-1 text-[11px] font-bold">{statusLabels[refund.status] ?? refund.status}</p>
                </div>
              </div>
              <div className="grid gap-5 p-5 lg:grid-cols-2">
                <div className="space-y-3 text-xs">
                  <p>구매자: <span className="font-mono">{refund.memberId}</span></p>
                  <p>계좌 등록: {refund.accountSubmittedAt ? new Date(refund.accountSubmittedAt).toLocaleString("ko-KR") : "미등록"}</p>
                  <p>계좌: {refund.maskedAccountNumber ?? "미등록"}</p>
                  {account && (
                    <div className="border border-amber-300 bg-amber-50 p-4 text-amber-950">
                      <p className="font-black">{account.bankName} · {account.accountNumber}</p>
                      <p className="mt-2">예금주 {account.accountHolder}</p>
                      <button className="mt-3 flex items-center gap-2 text-[11px] font-bold underline" onClick={() => setRevealed((current) => { const next = { ...current }; delete next[subjectKey]; return next; })} type="button"><EyeOff size={13} /> 계좌 숨기기</button>
                    </div>
                  )}
                  {!account && refund.accountSubmittedAt && refund.status !== "completed" && refund.status !== "cancelled" && (
                    <div className="space-y-2">
                      <input className="w-full border border-line px-3 py-2" maxLength={500} onChange={(event) => setAccessReasons((current) => ({ ...current, [subjectKey]: event.target.value }))} placeholder="계좌 열람 사유" value={accessReasons[subjectKey] ?? ""} />
                      <button className="flex items-center gap-2 border border-line px-3 py-2 font-bold disabled:opacity-40" disabled={busy} onClick={() => void mutate(refund, "reveal_account")} type="button"><Eye size={13} /> 계좌 확인</button>
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  {refund.refundKind === "item" && <textarea className="min-h-20 w-full border border-line p-3 text-xs" maxLength={1_000} onChange={(event) => setNotes((current) => ({ ...current, [subjectKey]: event.target.value }))} placeholder="처리 메모 (선택)" value={notes[subjectKey] ?? ""} />}
                  {(refund.status === "approved" || (refund.refundKind === "shipping_fee" && refund.status === "requested")) && <input className="w-full border border-line px-3 py-2 text-xs" maxLength={160} onChange={(event) => setReferences((current) => ({ ...current, [subjectKey]: event.target.value }))} placeholder="외부 송금 참조번호" value={references[subjectKey] ?? ""} />}
                  <div className="flex flex-wrap gap-2">
                    {refund.refundKind === "item" && refund.status === "requested" && <button className="bg-ink px-4 py-2 text-xs font-bold text-paper disabled:opacity-40" disabled={busy || !refund.accountSubmittedAt} onClick={() => void mutate(refund, "approve")} type="button">환불 승인</button>}
                    {((refund.refundKind === "item" && refund.status === "approved") || (refund.refundKind === "shipping_fee" && refund.status === "requested")) && <button className="bg-ink px-4 py-2 text-xs font-bold text-paper disabled:opacity-40" disabled={busy || !refund.accountSubmittedAt} onClick={() => void mutate(refund, "complete")} type="button">송금 완료</button>}
                    {refund.refundKind === "item" && (refund.status === "requested" || refund.status === "approved") && <button className="border border-line px-4 py-2 text-xs font-bold disabled:opacity-40" disabled={busy} onClick={() => void mutate(refund, "cancel")} type="button">환불 취소</button>}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
        {!loading && refunds.length === 0 && <div className="border border-dashed border-line py-16 text-center text-sm text-muted">처리할 환불 요청이 없습니다.</div>}
      </section>
    </div>
  );
}
