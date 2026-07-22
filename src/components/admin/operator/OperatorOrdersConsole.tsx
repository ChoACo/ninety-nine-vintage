"use client";

import { CircleCheck, Clock3, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CatalogImage } from "@/components/ui/CatalogImage";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/FormControls";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusNotice } from "@/components/ui/StatusNotice";
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

interface Item {
  order_id: string;
  product_id: string;
  unit_price: number;
  payment_status: string;
  products?: { title: string; image_urls: string[] } | null;
  commerce_orders?: { member_id: string; total: number; status: string; created_at: string } | null;
}

interface LedgerEntry {
  id: string;
  entry_type: "receipt" | "reversal";
  amount: number;
  depositor_name: string | null;
  memo: string;
  created_at: string;
  reversal_of: string | null;
  recorded_by: string;
}

interface Transfer {
  id: string;
  order_id: string;
  member_id: string;
  status: string;
  expected_amount: number;
  receivedAmount: number;
  ledgerEntryCount: number;
  ledgerHistoryComplete: boolean;
  remainingAmount: number;
  bank_name_snapshot: string;
  requested_at: string;
  activityAt: string;
  ledger: LedgerEntry[];
  items: Item[];
}

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

function paymentStatusLabel(status: string) {
  if (status === "pending") return "결제 대기";
  if (status === "awaiting_transfer") return "입금 대기";
  if (status === "partially_paid") return "부분 입금";
  if (status === "confirmed" || status === "paid") return "결제 완료";
  if (status === "cancelled") return "취소";
  if (status === "refunded") return "환불";
  return status;
}

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
  const [filter, setFilter] = useState({ search: "", status: "all" });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
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
    return (!query || text.includes(query)) && (filter.status === "all" || transfer.status === filter.status);
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
  const settled = visibleHistoryTransfers.filter(
    (transfer) => transfer.status === "confirmed",
  ).length;
  const visibleItemCount = visibleTransfers.reduce(
    (count, transfer) => count + transfer.items.length,
    0,
  );

  return <div className="space-y-8">
    <SectionHeading action={<Button className="flex items-center gap-2" disabled={!token} onClick={() => void load(token, sessionRevision).catch((error) => setNotice(error instanceof Error ? error.message : "새로고침에 실패했습니다."))} type="button"><RefreshCw size={13} /> 새로고침</Button>} description="입금액을 부분 기록하고 잔액이 0원일 때만 주문을 결제 완료로 전환합니다." eyebrow="운영자 / 주문 관리" title="입금·주문 처리" variant="page" />
    {notice && <StatusNotice>{notice}</StatusNotice>}
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="border border-line p-5"><Clock3 size={17} /><p className="mt-7 text-xs text-muted">잔액 입금 대기</p><p className="mt-2 font-mono text-3xl font-bold">{waiting}</p></div>
      <div className="border border-line p-5"><CircleCheck size={17} /><p className="mt-7 text-xs text-muted">불러온 입금 완료</p><p className="mt-2 font-mono text-3xl font-bold">{settled}</p></div>
      <div className="border border-line bg-ink p-5 text-paper"><p className="eyebrow text-zinc-400">주문 상품</p><p className="mt-7 font-mono text-3xl font-bold">{visibleItemCount}</p><p className="mt-2 text-xs text-zinc-400">현재 불러온 통합 주문 상품 수</p></div>
    </div>
    <div className="flex flex-col gap-3 sm:flex-row"><div className="flex flex-1 items-center gap-2 border border-line bg-paper px-3"><Search size={14} className="text-muted" /><input aria-label="주문 검색" className="h-11 w-full bg-transparent text-xs outline-none" onChange={(event) => setFilter({ ...filter, search: event.target.value })} placeholder="주문번호·회원 식별자·상품명 검색" value={filter.search} /></div><select aria-label="주문 상태 필터" className="h-11 w-full border border-line bg-paper px-3 text-xs sm:w-48" onChange={(event) => setFilter({ ...filter, status: event.target.value })} value={filter.status}><option value="all">전체 상태</option><option value="awaiting_transfer">입금 대기</option><option value="partially_paid">부분 입금</option><option value="confirmed">입금 확인</option><option value="cancelled">취소</option></select></div>
    <div className="divide-y divide-line border-y border-line">{orders.map(({ transfer, lines }) => {
      const form = forms[transfer.id] ?? emptyForm;
      return <article className="py-6" key={transfer.id}>
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:gap-6"><div className="min-w-0"><p className="break-all text-sm font-bold">주문 {transfer.order_id}</p><p className="mt-1 break-all text-xs text-muted">{lines[0]?.commerce_orders?.member_id ?? "회원 미상"} · {new Date(transfer.requested_at).toLocaleString("ko-KR")} · {transfer.bank_name_snapshot}</p></div><div className="sm:text-right"><p className="font-mono text-sm font-bold">{formatWon(transfer.expected_amount)}</p><p className="mt-1 text-[10px] text-muted">누적 {formatWon(transfer.receivedAmount)} · 잔액 {formatWon(transfer.remainingAmount)}</p></div></div>
        <div className="mt-4 divide-y divide-line border-y border-line">{lines.map((line) => <div className="flex items-center gap-3 py-3" key={line.product_id}><CatalogImage alt="" className="size-12 object-cover" src={line.products?.image_urls?.[0] ?? ""} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{line.products?.title ?? line.product_id}</p><p className="mt-1 text-[10px] text-muted">{paymentStatusLabel(line.payment_status)} · {formatWon(line.unit_price)}</p></div></div>)}</div>
        {isActionableTransfer(transfer) && <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[140px_150px_1fr_auto]"><TextInput aria-label={`${transfer.order_id} 입금액`} className="h-10" inputMode="numeric" onChange={(event) => updateForm(transfer.id, { amount: event.target.value })} placeholder={`최대 ${formatWon(transfer.remainingAmount)}`} value={form.amount} /><TextInput aria-label={`${transfer.order_id} 입금자명`} className="h-10" maxLength={MANUAL_TRANSFER_DEPOSITOR_NAME_MAX_LENGTH} onChange={(event) => updateForm(transfer.id, { depositorName: event.target.value })} placeholder="입금자명" value={form.depositorName} /><TextInput aria-label={`${transfer.order_id} 메모`} className="h-10" maxLength={MANUAL_TRANSFER_MEMO_MAX_LENGTH} onChange={(event) => updateForm(transfer.id, { memo: event.target.value })} placeholder="메모 (선택)" value={form.memo} /><Button className="h-10" disabled={busy === transfer.id || !form.amount || !form.depositorName} variant="outline" onClick={() => void mutateLedger(transfer, { action: "record", kind: "commerce", amount: Number(form.amount.replaceAll(",", "")), expectedReceivedAmount: transfer.receivedAmount, expectedLedgerEntryCount: transfer.ledgerEntryCount, depositorName: form.depositorName, memo: form.memo })} type="button">입금 기록</Button></div>}
        {transfer.ledger.length > 0 && <div className="mt-4 space-y-2 border-l-2 border-line pl-4">{transfer.ledger.map((entry) => <div className="flex flex-col items-start justify-between gap-2 text-[11px] sm:flex-row sm:items-center sm:gap-4" key={entry.id}><span>{entry.entry_type === "receipt" ? `입금 ${formatWon(entry.amount)} · ${entry.depositor_name}` : `취소 ${formatWon(entry.amount)} · ${entry.memo}`} · 처리자 {entry.recorded_by} · {new Date(entry.created_at).toLocaleString("ko-KR")}</span>{entry.entry_type === "receipt" && !transfer.ledger.some((candidate) => candidate.reversal_of === entry.id) && <button className="shrink-0 underline disabled:opacity-40" disabled={busy === transfer.id} onClick={() => { const reason = window.prompt("입금 기록 취소 사유를 입력하세요."); if (reason) void mutateLedger(transfer, { action: "reverse", kind: "commerce", ledgerId: entry.id, reason, amount: entry.amount, expectedReceivedAmount: transfer.receivedAmount, expectedLedgerEntryCount: transfer.ledgerEntryCount }); }} type="button">취소 원장 추가</button>}</div>)}</div>}
        {!transfer.ledgerHistoryComplete && <p className="mt-3 text-[10px] text-muted">전체 원장 {transfer.ledgerEntryCount.toLocaleString("ko-KR")}건 중 최근 기록만 표시합니다. 누적액과 원장 버전은 전체 원장 기준입니다.</p>}
      </article>;
    })}{orders.length === 0 && <p className="py-16 text-center text-sm text-muted">조건에 맞는 주문이 없습니다.</p>}</div>
    {snapshotIsCurrent && historyHasMore && historyCursor && <div className="flex justify-center"><Button disabled={historyLoading || Boolean(busy)} onClick={() => {
      setNotice("");
      void load(token, sessionRevision, { appendHistory: true, cursor: historyCursor }).catch((error) => {
        setNotice(error instanceof Error ? error.message : "이전 입금 이력을 불러오지 못했습니다.");
      });
    }} type="button" variant="outline">{historyLoading ? "불러오는 중" : "이전 완료·취소 이력 더 보기"}</Button></div>}
  </div>;
}
