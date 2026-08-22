"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/FormControls";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusNotice } from "@/components/ui/StatusNotice";
import { OrderDetailDrawer } from "@/components/admin/operator/orders/OrderDetailDrawer";
import { OrderFilterHeader } from "@/components/admin/operator/orders/OrderFilterHeader";
import { OrderTable } from "@/components/admin/operator/orders/OrderTable";
import type { OperatorOrderTransfer, OrderSaleFilter, OrderStatusFilter } from "@/components/admin/operator/orders/types";
import { orderWorkflowStatus } from "@/components/admin/operator/orders/types";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import {
  clearPendingManualTransferReceipt,
  getOrCreatePendingManualTransferReceipt,
  MANUAL_TRANSFER_DEPOSITOR_NAME_MAX_LENGTH,
  MANUAL_TRANSFER_MEMO_MAX_LENGTH,
  manualTransferReversalFingerprint,
  manualTransferReceiptFingerprint,
} from "@/lib/manualTransferReceipt";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Transfer = OperatorOrderTransfer;

interface HistoryCursor {
  activityAt: string;
  transferId: string;
}

interface ReceiptForm {
  amount: string;
  depositorName: string;
  memo: string;
  reversalReason: string;
}

const emptyForm: ReceiptForm = { amount: "", depositorName: "", memo: "", reversalReason: "" };
const formatWon = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;

function readIdempotentReplay(payload: unknown): boolean | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const result = (payload as Record<string, unknown>).result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const replay = (result as Record<string, unknown>).idempotent_replay;
  return typeof replay === "boolean" ? replay : null;
}

function readManualTransferReversalReplay(
  payload: unknown,
  expected: {
    transferId: string;
    ledgerId: string;
    receivedAmount: number;
    remainingAmount: number;
    ledgerEntryCount: number;
  },
): boolean | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const result = (payload as Record<string, unknown>).result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const value = result as Record<string, unknown>;
  const expectedFields = [
    "transfer_kind",
    "transfer_id",
    "ledger_id",
    "reversal_of",
    "received_amount",
    "remaining_amount",
    "status",
    "idempotent_replay",
    "ledger_entry_count",
  ];
  if (
    Object.keys(value).length !== expectedFields.length ||
    !expectedFields.every((field) => Object.hasOwn(value, field)) ||
    value.transfer_kind !== "commerce" ||
    value.transfer_id !== expected.transferId ||
    typeof value.ledger_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.ledger_id) ||
    value.ledger_id === expected.ledgerId ||
    value.reversal_of !== expected.ledgerId ||
    value.received_amount !== expected.receivedAmount ||
    value.remaining_amount !== expected.remainingAmount ||
    typeof value.status !== "string" ||
    !value.status ||
    typeof value.idempotent_replay !== "boolean" ||
    value.ledger_entry_count !== expected.ledgerEntryCount
  ) {
    return null;
  }
  return value.idempotent_replay;
}

function isActionableTransfer(transfer: Transfer) {
  return (
    (transfer.status === "awaiting_transfer" ||
      transfer.status === "partially_paid") &&
    transfer.remainingAmount > 0
  );
}

export function OperatorOrdersConsole() {
  const { loading: sessionLoading, revision: sessionRevision, session } =
    useSupabaseSession();
  const token = session?.access_token ?? null;
  const actorId = session?.user.id ?? null;
  const [activeTransfers, setActiveTransfers] = useState<Transfer[]>([]);
  const [historyTransfers, setHistoryTransfers] = useState<Transfer[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [historyCursor, setHistoryCursor] = useState<HistoryCursor | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [forms, setForms] = useState<Record<string, ReceiptForm>>({});
  const [filter, setFilter] = useState<{ search: string; status: OrderStatusFilter; saleType: OrderSaleFilter }>({ search: "", status: "all", saleType: "all" });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [loadedSessionRevision, setLoadedSessionRevision] = useState<
    number | null
  >(null);
  const loadGeneration = useRef(0);
  const ledgerMutationsInFlight = useRef(new Set<string>());
  const busyMutationScope = useRef<string | null>(null);
  const sessionSnapshot = useRef({
    actorId,
    loading: sessionLoading,
    revision: sessionRevision,
    token,
  });

  useEffect(() => {
    sessionSnapshot.current = {
      actorId,
      loading: sessionLoading,
      revision: sessionRevision,
      token,
    };
  }, [actorId, sessionLoading, sessionRevision, token]);

  const load = useCallback(async (
    accessToken: string | null,
    expectedSessionRevision: number,
    options?: { appendHistory?: boolean; cursor?: HistoryCursor | null },
  ) => {
    const generation = ++loadGeneration.current;
    if (!accessToken) {
      setActiveTransfers([]);
      setHistoryTransfers([]);
      setActiveCount(0);
      setHistoryCursor(null);
      setHistoryHasMore(false);
      setHistoryLoading(false);
      setForms({});
      setLoadedSessionRevision(null);
      setNotice("");
      return;
    }
    const appendHistory = options?.appendHistory === true;
    const cursor = options?.cursor ?? null;
    if (appendHistory && !cursor) return;
    if (appendHistory) {
      setHistoryLoading(true);
    } else {
      setLoadedSessionRevision(null);
      setHistoryCursor(null);
      setHistoryHasMore(false);
    }
    try {
      const query = cursor
        ? `?before=${encodeURIComponent(cursor.activityAt)}&beforeId=${encodeURIComponent(cursor.transferId)}`
        : "";
      const response = await fetch(`/api/admin/operator/orders${query}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const payload = await response.json() as {
        activeCount?: number;
        activeTransfers?: Transfer[];
        historyTransfers?: Transfer[];
        historyHasMore?: boolean;
        nextHistoryCursor?: HistoryCursor | null;
        error?: string;
      };
      if (generation !== loadGeneration.current) return;
      const currentSnapshot = sessionSnapshot.current;
      if (
        currentSnapshot.loading ||
        currentSnapshot.token !== accessToken ||
        currentSnapshot.revision !== expectedSessionRevision
      ) {
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "주문을 불러오지 못했습니다.");
      const nextActive = payload.activeTransfers ?? [];
      const historyPage = payload.historyTransfers ?? [];
      const activeIds = new Set(nextActive.map((transfer) => transfer.id));
      setActiveTransfers(nextActive);
      setForms((current) => Object.fromEntries(
        nextActive
          .filter((transfer) => current[transfer.id])
          .map((transfer) => [transfer.id, current[transfer.id]]),
      ));
      setHistoryTransfers((current) => {
        const historyById = new Map(
          (appendHistory ? current : []).map((transfer) => [transfer.id, transfer]),
        );
        for (const transfer of historyPage) historyById.set(transfer.id, transfer);
        for (const activeId of activeIds) historyById.delete(activeId);
        return [...historyById.values()];
      });
      setActiveCount(payload.activeCount ?? nextActive.length);
      setHistoryHasMore(payload.historyHasMore === true);
      setHistoryCursor(payload.nextHistoryCursor ?? null);
      setLoadedSessionRevision(expectedSessionRevision);
    } catch (error) {
      if (generation === loadGeneration.current) {
        setActiveTransfers([]);
        setHistoryTransfers([]);
        setActiveCount(0);
        setHistoryCursor(null);
        setHistoryHasMore(false);
        setForms({});
        setLoadedSessionRevision(null);
      }
      throw error;
    } finally {
      if (generation === loadGeneration.current) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionLoading) return;
    const timer = window.setTimeout(() => {
      setForms({});
      setBusy(null);
      setNotice("");
      busyMutationScope.current = null;
      void load(token, sessionRevision).catch((error) => {
        setNotice(error instanceof Error ? error.message : "주문을 불러오지 못했습니다.");
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      loadGeneration.current += 1;
    };
  }, [load, sessionLoading, sessionRevision, token]);

  const snapshotIsCurrent =
    !sessionLoading &&
    Boolean(token) &&
    Boolean(actorId) &&
    loadedSessionRevision === sessionRevision;
  const visibleActiveTransfers = useMemo(
    () => snapshotIsCurrent ? activeTransfers : [],
    [activeTransfers, snapshotIsCurrent],
  );
  const visibleHistoryTransfers = useMemo(
    () => snapshotIsCurrent ? historyTransfers : [],
    [historyTransfers, snapshotIsCurrent],
  );
  const visibleTransfers = useMemo(
    () => [...visibleActiveTransfers, ...visibleHistoryTransfers],
    [visibleActiveTransfers, visibleHistoryTransfers],
  );

  const orders = useMemo(() => visibleTransfers.map((transfer) => ({
    transfer,
    lines: transfer.items,
  })).filter(({ transfer, lines }) => {
    const query = filter.search.trim().toLowerCase();
    const text = [transfer.order_id, lines[0]?.commerce_orders?.member_id ?? "", ...lines.map((line) => line.products?.title ?? "")].join(" ").toLowerCase();
    const saleTypeMatches = filter.saleType === "all" || lines.some((line) => line.saleType === filter.saleType);
    const statusMatches = filter.status === "all" || orderWorkflowStatus(transfer) === filter.status;
    return (!query || text.includes(query)) && saleTypeMatches && statusMatches;
  }), [filter, visibleTransfers]);

  const updateForm = (id: string, patch: Partial<ReceiptForm>) => {
    setForms((current) => ({ ...current, [id]: { ...(current[id] ?? emptyForm), ...patch } }));
  };

  const mutateLedger = async (transfer: Transfer, body: Record<string, unknown>) => {
    if (!token || !actorId || !snapshotIsCurrent || busy) return;
    const expectedToken = token;
    const expectedActorId = actorId;
    const expectedSessionRevision = sessionRevision;
    const mutationScope = `${expectedActorId}:${transfer.id}`;
    if (ledgerMutationsInFlight.current.has(mutationScope)) return;
    ledgerMutationsInFlight.current.add(mutationScope);
    busyMutationScope.current = mutationScope;
    setBusy(transfer.id);
    setNotice("");
    let pendingScope: string | null = null;
    let pendingFingerprint: string | null = null;
    let requestStarted = false;
    let outcomeDefinitive = false;
    let responseOutcomeUnknown = false;
    try {
      const requestBody = { ...body };
      if (body.action === "record") {
        pendingScope = `commerce:${transfer.id}`;
        pendingFingerprint = await manualTransferReceiptFingerprint({
          kind: "commerce",
          targetId: transfer.id,
          amount: typeof body.amount === "number" ? body.amount : Number(body.amount),
          depositorName: body.depositorName,
          memo: body.memo,
        });
      } else if (body.action === "reverse") {
        const ledgerId = typeof body.ledgerId === "string" ? body.ledgerId : "";
        const reason = typeof body.reason === "string" ? body.reason : "";
        pendingScope = `commerce:${transfer.id}:reversal:${ledgerId}`;
        pendingFingerprint = await manualTransferReversalFingerprint({
          kind: "commerce",
          targetId: transfer.id,
          ledgerId,
          reason,
          expectedReceivedAmount: transfer.receivedAmount,
          expectedLedgerEntryCount: transfer.ledgerEntryCount,
        });
      }
      const latestSession = (await getSupabaseBrowserClient().auth.getSession()).data.session;
      const currentSnapshot = sessionSnapshot.current;
      if (
        !latestSession?.access_token ||
        latestSession.access_token !== expectedToken ||
        latestSession.user.id !== expectedActorId ||
        currentSnapshot.loading ||
        currentSnapshot.token !== expectedToken ||
        currentSnapshot.actorId !== expectedActorId ||
        currentSnapshot.revision !== expectedSessionRevision
      ) {
        throw new Error("로그인 계정이 변경되었습니다. 운영자 권한을 다시 확인해 주세요.");
      }
      if (pendingFingerprint && pendingScope) {
        requestBody.idempotencyKey = getOrCreatePendingManualTransferReceipt(
          actorId,
          pendingScope,
          pendingFingerprint,
        );
      }
      requestStarted = true;
      const response = await fetch(`/api/admin/operator/transfers/${transfer.id}/ledger`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${latestSession.access_token}` },
        body: JSON.stringify(requestBody),
      });
      const payload = await response.json().catch(() => null) as {
        error?: string;
        outcome?: "rejected" | "unknown";
        result?: unknown;
      } | null;
      if (!response.ok) {
        outcomeDefinitive = payload?.outcome === "rejected";
        responseOutcomeUnknown = requestStarted && !outcomeDefinitive;
        throw new Error(payload?.error ?? "입금 원장을 갱신하지 못했습니다.");
      }
      if (!payload) throw new Error("입금 원장 응답을 확인하지 못했습니다.");
      const idempotentReplay = body.action === "record"
        ? readIdempotentReplay(payload)
        : body.action === "reverse"
          ? readManualTransferReversalReplay(payload, {
            transferId: transfer.id,
            ledgerId: typeof body.ledgerId === "string" ? body.ledgerId : "",
            receivedAmount: transfer.receivedAmount - (typeof body.amount === "number" ? body.amount : 0),
            remainingAmount: transfer.remainingAmount + (typeof body.amount === "number" ? body.amount : 0),
            ledgerEntryCount: transfer.ledgerEntryCount + 1,
          })
          : null;
      if (body.action === "record" && idempotentReplay === null) {
        throw new Error("입금 원장 응답 결과를 확인하지 못했습니다.");
      }
      if (
        body.action === "reverse" &&
        (idempotentReplay === null || response.status !== (idempotentReplay ? 200 : 201))
      ) {
        throw new Error("취소 원장 응답 결과를 확인하지 못했습니다.");
      }
      outcomeDefinitive = true;
      if (pendingFingerprint && pendingScope) {
        clearPendingManualTransferReceipt(
          actorId,
          pendingScope,
          pendingFingerprint,
        );
      }
      const currentSession = (await getSupabaseBrowserClient().auth.getSession()).data.session;
      const snapshotAfterMutation = sessionSnapshot.current;
      if (
        !currentSession?.access_token ||
        currentSession.access_token !== expectedToken ||
        currentSession.user.id !== expectedActorId ||
        snapshotAfterMutation.loading ||
        snapshotAfterMutation.token !== expectedToken ||
        snapshotAfterMutation.actorId !== expectedActorId ||
        snapshotAfterMutation.revision !== expectedSessionRevision
      ) {
        return;
      }
      setForms((current) => ({ ...current, [transfer.id]: emptyForm }));
      const successNotice = body.action === "reverse"
        ? idempotentReplay
          ? "기존 취소 원장을 확인했습니다. 새 취소 원장은 추가되지 않았습니다."
          : "취소 원장을 추가했습니다."
        : idempotentReplay
          ? "기존 입금 영수증을 확인했습니다. 새 입금은 추가되지 않았습니다."
          : "입금 영수증을 기록했습니다.";
      setNotice(successNotice);
      try {
        await load(currentSession.access_token, expectedSessionRevision);
      } catch {
        setNotice(`${successNotice} 목록 새로고침은 실패했으므로 다시 불러와 주세요.`);
      }
    } catch (error) {
      const currentSnapshot = sessionSnapshot.current;
      if (
        currentSnapshot.loading ||
        currentSnapshot.token !== expectedToken ||
        currentSnapshot.actorId !== expectedActorId ||
        currentSnapshot.revision !== expectedSessionRevision
      ) {
        return;
      }
      const outcomeUnknown =
        responseOutcomeUnknown || (requestStarted && !outcomeDefinitive);
      setNotice(outcomeUnknown
        ? body.action === "record"
          ? "입금 기록 결과를 확인하지 못했습니다. 목록을 새로고침하거나 같은 내용으로 다시 시도해 주세요."
          : "취소 처리 결과를 확인하지 못했습니다. 목록을 새로고침해 확인해 주세요."
        : error instanceof Error
          ? error.message
          : "입금 원장을 갱신하지 못했습니다.");
    } finally {
      ledgerMutationsInFlight.current.delete(mutationScope);
      if (busyMutationScope.current === mutationScope) {
        busyMutationScope.current = null;
        setBusy(null);
      }
    }
  };

  const waiting = snapshotIsCurrent ? activeCount : 0;
  const selectedTransfer = visibleTransfers.find((transfer) => transfer.id === selectedTransferId) ?? null;

  return <div className="space-y-5">
    <SectionHeading action={<Button className="flex items-center gap-2" disabled={!token} onClick={() => void load(token, sessionRevision).catch((error) => setNotice(error instanceof Error ? error.message : "새로고침에 실패했습니다."))} type="button"><RefreshCw size={13} /> 새로고침</Button>} description={`센터에 연결된 판매 주문을 고밀도 원장으로 확인합니다. 현재 결제 처리 대기 ${waiting}건`} eyebrow="운영자 / 거래내역" title="판매·주문" variant="page" />
    {notice && <StatusNotice>{notice}</StatusNotice>}
    <OrderFilterHeader allOrders={visibleTransfers} filteredOrders={orders.map(({ transfer }) => transfer)} onQueryChange={(search) => setFilter((current) => ({ ...current, search }))} onSaleTypeChange={(saleType) => setFilter((current) => ({ ...current, saleType }))} onStatusChange={(status) => setFilter((current) => ({ ...current, status }))} query={filter.search} saleType={filter.saleType} status={filter.status} />
    <OrderTable onOpen={(order) => setSelectedTransferId(order.id)} onSelectionChange={setSelectedOrderIds} orders={orders.map(({ transfer }) => transfer)} selectedIds={selectedOrderIds} />
    {snapshotIsCurrent && historyHasMore && historyCursor && <div className="flex justify-center"><Button disabled={historyLoading || Boolean(busy)} onClick={() => {
      setNotice("");
      void load(token, sessionRevision, { appendHistory: true, cursor: historyCursor }).catch((error) => {
        setNotice(error instanceof Error ? error.message : "이전 입금 이력을 불러오지 못했습니다.");
      });
    }} type="button" variant="outline">{historyLoading ? "불러오는 중" : "이전 완료·취소 이력 더 보기"}</Button></div>}
    <OrderDetailDrawer onClose={() => setSelectedTransferId(null)} order={selectedTransfer}>{selectedTransfer && (() => { const form = forms[selectedTransfer.id] ?? emptyForm; return <>{isActionableTransfer(selectedTransfer) && <section className="mt-5 border-t border-zinc-800 pt-5"><p className="text-xs font-black">입금 상태 처리</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><TextInput aria-label={`${selectedTransfer.order_id} 입금액`} inputMode="numeric" onChange={(event) => updateForm(selectedTransfer.id, { amount: event.target.value })} placeholder={`최대 ${formatWon(selectedTransfer.remainingAmount)}`} value={form.amount} /><TextInput aria-label={`${selectedTransfer.order_id} 입금자명`} maxLength={MANUAL_TRANSFER_DEPOSITOR_NAME_MAX_LENGTH} onChange={(event) => updateForm(selectedTransfer.id, { depositorName: event.target.value })} placeholder="입금자명" value={form.depositorName} /><TextInput aria-label={`${selectedTransfer.order_id} 메모`} className="sm:col-span-2" maxLength={MANUAL_TRANSFER_MEMO_MAX_LENGTH} onChange={(event) => updateForm(selectedTransfer.id, { memo: event.target.value })} placeholder="메모 (선택)" value={form.memo} /><Button className="sm:col-span-2" disabled={busy === selectedTransfer.id || !form.amount || !form.depositorName} onClick={() => void mutateLedger(selectedTransfer, { action: "record", kind: "commerce", amount: Number(form.amount.replaceAll(",", "")), expectedReceivedAmount: selectedTransfer.receivedAmount, expectedLedgerEntryCount: selectedTransfer.ledgerEntryCount, depositorName: form.depositorName, memo: form.memo })} type="button">입금 기록 및 상태 갱신</Button></div></section>}{selectedTransfer.ledger.length > 0 && <section className="mt-5 border-t border-zinc-800 pt-5"><p className="text-xs font-black">감사 가능한 입금 원장</p><TextInput aria-label="입금 취소 사유" className="mt-3" maxLength={MANUAL_TRANSFER_MEMO_MAX_LENGTH} onChange={(event) => updateForm(selectedTransfer.id, { reversalReason: event.target.value })} placeholder="취소 작업 시 사유를 입력하세요" value={form.reversalReason} /><div className="mt-3 divide-y divide-zinc-800 border-y border-zinc-800">{selectedTransfer.ledger.map((entry) => { const reversible = entry.entry_type === "receipt" && !selectedTransfer.ledger.some((candidate) => candidate.reversal_of === entry.id); return <div className="flex items-center justify-between gap-3 py-3 text-[11px]" key={entry.id}><p>{entry.entry_type === "receipt" ? "입금" : "취소"} {formatWon(entry.amount)} · 처리자 {entry.recorded_by}<br /><span className="text-zinc-500">{new Date(entry.created_at).toLocaleString("ko-KR")} · {entry.memo || entry.depositor_name}</span></p>{reversible && <button className="shrink-0 underline disabled:opacity-40" disabled={busy === selectedTransfer.id || form.reversalReason.trim().length < 2} onClick={() => void mutateLedger(selectedTransfer, { action: "reverse", kind: "commerce", ledgerId: entry.id, reason: form.reversalReason.trim(), amount: entry.amount, expectedReceivedAmount: selectedTransfer.receivedAmount, expectedLedgerEntryCount: selectedTransfer.ledgerEntryCount })} type="button">취소 원장 추가</button>}</div>; })}</div></section>}</>; })()}</OrderDetailDrawer>
  </div>;
}
