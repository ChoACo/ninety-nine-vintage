"use client";

import { AlertTriangle, Clock3, History, PackageCheck, RefreshCw, Search, ShieldCheck, Truck, Undo2, XCircle } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";
import { PremiumDialog } from "@/components/ui/PremiumDialog";

interface MemberSearchRow {
  id: string;
  displayName: string;
  phone: string | null;
  accountStatus: string | null;
  shippingCreditCount: number;
  lastDepositorName: string | null;
}

interface ProductSummary {
  id: string;
  title: string;
  status: string;
  sale_type: string;
  final_bid_id: string | null;
  image_urls: string[];
}

interface BidRow {
  id: string;
  product_id: string;
  amount: number;
  is_final: boolean;
  created_at: string;
  bidder_display_name: string;
  product: ProductSummary | null;
}

interface AuctionPaymentRow {
  id: string;
  product_id: string;
  order_name: string;
  expected_amount: number;
  status: string;
  due_at: string | null;
  requested_at: string;
  version: number;
  receivedAmount: number;
  ledgerEntryCount: number;
  product: ProductSummary | null;
}

interface CommerceTransfer {
  id: string;
  expected_amount: number;
  status: string;
  payment_due_at: string | null;
  requested_at: string;
  version: number;
  receivedAmount: number;
  ledgerEntryCount: number;
}

interface CommerceOrder {
  id: string;
  status: string;
  total: number;
  created_at: string;
  items: Array<{ id: string; product_id: string; payment_status: string; product: ProductSummary | null }>;
  transfer: CommerceTransfer | null;
}

interface LegacyPaymentRow {
  id: string;
  product_id: string;
  order_name: string;
  expected_amount: number;
  payment_status: string;
  portone_status: string | null;
  paid_at: string | null;
  created_at: string;
  product: ProductSummary | null;
}

interface InventoryRow {
  id: string;
  product_id: string;
  paid_amount: number;
  paid_at: string;
  ownership_status: string;
  storage_duration_days: number;
  storage_started_at: string | null;
  storage_expires_at: string | null;
  version: number;
  activeShipmentId: string | null;
  product: ProductSummary | null;
  fulfillment: { current_stage: string; location_kind: string; is_blocked: boolean } | null;
}

interface ShipmentRow {
  id: string;
  status: string;
  settlement_method: string;
  courier: string | null;
  tracking_number: string | null;
  delivery_status: string;
  version: number;
  created_at: string;
  items: Array<{ inventory_item_id: string; product_id: string; line_status: string; product: ProductSummary | null }>;
}

interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  reason: string;
  occurred_at: string;
  restorable: boolean;
  result?: { externalActionsRequired?: { bankRefund?: boolean; physicalShipmentRecall?: boolean } };
}

interface LedgerPayload {
  members?: MemberSearchRow[];
  member?: MemberSearchRow;
  bids?: BidRow[];
  cancelledBids?: unknown[];
  auctionPayments?: AuctionPaymentRow[];
  legacyPayments?: LegacyPaymentRow[];
  commerceOrders?: CommerceOrder[];
  inventory?: InventoryRow[];
  shipments?: ShipmentRow[];
  audits?: AuditRow[];
  error?: string;
  message?: string;
}

interface LinkedLedgerGroup {
  id: string;
  productIds: string[];
  products: ProductSummary[];
  bids: BidRow[];
  auctionPayments: AuctionPaymentRow[];
  legacyPayments: LegacyPaymentRow[];
  commerceOrders: CommerceOrder[];
  inventory: InventoryRow[];
  shipments: ShipmentRow[];
}

type RepairAction =
  | "cancel_bid"
  | "cancel_auction_payment"
  | "cancel_commerce_order"
  | "cancel_legacy_payment"
  | "update_auction_due_at"
  | "cancel_inventory_item"
  | "restore_inventory_item"
  | "update_storage_duration"
  | "cancel_shipment"
  | "correct_shipment_tracking"
  | "restore_audit_event";

interface RepairTarget {
  action: RepairAction;
  entityId: string;
  expectedVersion: number | null;
  title: string;
  description: string;
  expectedReceivedAmount?: number;
  expectedLedgerEntryCount?: number;
  payload?: Record<string, unknown>;
}

const ACTION_LABELS: Record<RepairAction, string> = {
  cancel_bid: "입찰·낙찰 취소",
  cancel_auction_payment: "낙찰 거래 강제 철회",
  cancel_commerce_order: "즉시구매 거래 강제 철회",
  cancel_legacy_payment: "과거 결제 강제 철회",
  update_auction_due_at: "결제 마감 수정",
  cancel_inventory_item: "보관 원장 해제",
  restore_inventory_item: "보관 원장 복원",
  update_storage_duration: "보관 기간 수정",
  cancel_shipment: "배송 신청 취소",
  correct_shipment_tracking: "운송장 정정",
  restore_audit_event: "감사 기록에서 복구",
};

const FORCE_ACTIONS = new Set<RepairAction>([
  "cancel_bid",
  "cancel_auction_payment",
  "cancel_commerce_order",
  "cancel_legacy_payment",
  "cancel_inventory_item",
  "cancel_shipment",
]);

function formatWon(value: number) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

function formatAt(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "—";
}

function statusBadge(status: string) {
  return <span className="inline-flex border border-zinc-700 px-2 py-1 text-[10px] font-black text-zinc-300">{status}</span>;
}

function buildLinkedLedgerGroups(ledger: LedgerPayload | null): LinkedLedgerGroup[] {
  if (!ledger) return [];

  const parent = new Map<string, string>();
  const products = new Map<string, ProductSummary>();
  const addProduct = (productId: string, product: ProductSummary | null | undefined) => {
    if (!productId) return;
    if (!parent.has(productId)) parent.set(productId, productId);
    if (product) products.set(productId, product);
  };
  const find = (productId: string): string => {
    const current = parent.get(productId) ?? productId;
    if (current === productId) return current;
    const root = find(current);
    parent.set(productId, root);
    return root;
  };
  const union = (productIds: string[]) => {
    const ids = [...new Set(productIds.filter(Boolean))];
    if (ids.length < 2) return;
    const root = find(ids[0]);
    for (const id of ids.slice(1)) parent.set(find(id), root);
  };

  for (const bid of ledger.bids ?? []) addProduct(bid.product_id, bid.product);
  for (const payment of ledger.auctionPayments ?? []) addProduct(payment.product_id, payment.product);
  for (const payment of ledger.legacyPayments ?? []) addProduct(payment.product_id, payment.product);
  for (const item of ledger.inventory ?? []) addProduct(item.product_id, item.product);
  for (const order of ledger.commerceOrders ?? []) {
    for (const item of order.items) addProduct(item.product_id, item.product);
    union(order.items.map((item) => item.product_id));
  }
  for (const shipment of ledger.shipments ?? []) {
    for (const item of shipment.items) addProduct(item.product_id, item.product);
    union(shipment.items.map((item) => item.product_id));
  }

  const groups = new Map<string, LinkedLedgerGroup>();
  const getGroup = (productId: string, fallbackId: string) => {
    const key = productId ? find(productId) : fallbackId;
    const existing = groups.get(key);
    if (existing) return existing;
    const next: LinkedLedgerGroup = { id: key, productIds: [], products: [], bids: [], auctionPayments: [], legacyPayments: [], commerceOrders: [], inventory: [], shipments: [] };
    groups.set(key, next);
    return next;
  };
  const attachProduct = (group: LinkedLedgerGroup, productId: string) => {
    if (!productId || group.productIds.includes(productId)) return;
    group.productIds.push(productId);
    const product = products.get(productId);
    if (product) group.products.push(product);
  };

  for (const bid of ledger.bids ?? []) { const group = getGroup(bid.product_id, `bid:${bid.id}`); attachProduct(group, bid.product_id); group.bids.push(bid); }
  for (const payment of ledger.auctionPayments ?? []) { const group = getGroup(payment.product_id, `auction:${payment.id}`); attachProduct(group, payment.product_id); group.auctionPayments.push(payment); }
  for (const payment of ledger.legacyPayments ?? []) { const group = getGroup(payment.product_id, `legacy:${payment.id}`); attachProduct(group, payment.product_id); group.legacyPayments.push(payment); }
  for (const item of ledger.inventory ?? []) { const group = getGroup(item.product_id, `inventory:${item.id}`); attachProduct(group, item.product_id); group.inventory.push(item); }
  for (const order of ledger.commerceOrders ?? []) {
    const firstProductId = order.items[0]?.product_id ?? "";
    const group = getGroup(firstProductId, `order:${order.id}`);
    for (const item of order.items) attachProduct(group, item.product_id);
    group.commerceOrders.push(order);
  }
  for (const shipment of ledger.shipments ?? []) {
    const firstProductId = shipment.items[0]?.product_id ?? "";
    const group = getGroup(firstProductId, `shipment:${shipment.id}`);
    for (const item of shipment.items) attachProduct(group, item.product_id);
    group.shipments.push(shipment);
  }

  return [...groups.values()].sort((a, b) => {
    const aTitle = a.products.map((product) => product.title).join(", ") || a.id;
    const bTitle = b.products.map((product) => product.title).join(", ") || b.id;
    return aTitle.localeCompare(bTitle, "ko");
  });
}

function getGroupForceTarget(group: LinkedLedgerGroup): RepairTarget | null {
  const title = group.products.map((product) => product.title).join(", ") || `연결 거래 ${group.id}`;
  const description = "표시된 상품의 결제·보관·배송·구매자 권리·판매자 정산을 하나의 연결 거래로 묶어 강제 철회합니다.";
  const order = group.commerceOrders.find((item) => item.status !== "owner_reversed");
  if (order) return { action: "cancel_commerce_order", entityId: order.id, expectedVersion: order.transfer?.version ?? null, title, description };
  const shipment = group.shipments.find((item) => item.status !== "cancelled");
  if (shipment) return { action: "cancel_shipment", entityId: shipment.id, expectedVersion: shipment.version, title, description: `${description} 실제 이동한 택배는 별도 회수가 필요합니다.` };
  const auctionPayment = group.auctionPayments.find((item) => item.status !== "owner_reversed");
  if (auctionPayment) return { action: "cancel_auction_payment", entityId: auctionPayment.id, expectedVersion: auctionPayment.version, title, description };
  const inventory = group.inventory.find((item) => item.ownership_status !== "cancelled");
  if (inventory) return { action: "cancel_inventory_item", entityId: inventory.id, expectedVersion: inventory.version, title, description };
  const legacyPayment = group.legacyPayments.find((item) => item.payment_status !== "소유자철회");
  if (legacyPayment) return { action: "cancel_legacy_payment", entityId: legacyPayment.id, expectedVersion: null, title, description };
  const bid = group.bids[0];
  return bid ? { action: "cancel_bid", entityId: bid.id, expectedVersion: null, title, description } : null;
}

export function OwnerLedgerRepairConsole() {
  const { session } = useSupabaseSession();
  const token = session?.access_token ?? null;
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<MemberSearchRow[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [target, setTarget] = useState<RepairTarget | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [courier, setCourier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [storageDuration, setStorageDuration] = useState("14");
  const [busy, setBusy] = useState(false);
  const requestKeys = useRef(new Map<string, string>());

  const loadMember = useCallback(async (memberId: string) => {
    if (!token) return;
    setLoading(true);
    setNotice("");
    try {
      const response = await fetch(`/api/admin/owner/ledger-repair?memberId=${encodeURIComponent(memberId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await response.json() as LedgerPayload;
      if (!response.ok || !payload.member) throw new Error(payload.message ?? "회원 원장을 불러오지 못했습니다.");
      setLedger(payload);
    } catch (error) {
      setLedger(null);
      setNotice(error instanceof Error ? error.message : "회원 원장을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const searchMembers = async () => {
    if (!token || query.trim().length < 2) {
      setNotice("회원명, 전화번호 또는 UUID를 2자 이상 입력해 주세요.");
      return;
    }
    setLoading(true);
    setNotice("");
    try {
      const response = await fetch(`/api/admin/owner/ledger-repair?q=${encodeURIComponent(query.trim())}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await response.json() as LedgerPayload;
      if (!response.ok || !Array.isArray(payload.members)) throw new Error(payload.message ?? "회원을 찾지 못했습니다.");
      setMembers(payload.members);
      if (payload.members.length === 0) setNotice("검색 조건과 일치하는 회원이 없습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "회원 검색에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const openRepair = (next: RepairTarget) => {
    setTarget(next);
    setReason("");
    setConfirmation("");
    setDueAt("");
    setCourier("");
    setTrackingNumber("");
    setStorageDuration(String(next.payload?.storageDurationDays ?? 14));
    setNotice("");
  };

  const submitRepair = async () => {
    if (!token || !target || !selectedMemberId || busy) return;
    const requiredConfirmation = FORCE_ACTIONS.has(target.action) ? "강제철회" : "원장복구";
    if (reason.trim().length < 3 || confirmation !== requiredConfirmation) {
      setNotice(`사유를 3자 이상 입력하고 확인 문구 ‘${requiredConfirmation}’를 정확히 입력해 주세요.`);
      return;
    }
    const payload = { ...(target.payload ?? {}) };
    if (target.action === "update_auction_due_at") {
      const parsed = new Date(dueAt);
      if (!dueAt || Number.isNaN(parsed.getTime())) return setNotice("새 결제 마감 시각을 입력해 주세요.");
      payload.dueAt = parsed.toISOString();
    }
    if (target.action === "correct_shipment_tracking") {
      if (!courier.trim() || !trackingNumber.trim()) return setNotice("택배사와 운송장 번호를 입력해 주세요.");
      payload.courier = courier.trim();
      payload.trackingNumber = trackingNumber.trim();
    }
    if (target.action === "update_storage_duration") payload.storageDurationDays = Number(storageDuration);
    const requestScope = `${target.action}:${target.entityId}:${target.expectedVersion}:${JSON.stringify(payload)}`;
    const idempotencyKey = requestKeys.current.get(requestScope) ?? crypto.randomUUID();
    requestKeys.current.set(requestScope, idempotencyKey);
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/owner/ledger-repair", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: target.action,
          entityId: target.entityId,
          expectedVersion: target.expectedVersion,
          expectedReceivedAmount: target.expectedReceivedAmount,
          expectedLedgerEntryCount: target.expectedLedgerEntryCount,
          payload,
          reason: reason.trim(),
          confirmation,
          idempotencyKey,
        }),
      });
      const responsePayload = await response.json() as LedgerPayload;
      if (!response.ok) throw new Error(responsePayload.message ?? "원장 복구 작업을 처리하지 못했습니다.");
      requestKeys.current.delete(requestScope);
      setTarget(null);
      setNotice(`${ACTION_LABELS[target.action]} 처리가 완료되고 감사 로그에 기록됐습니다.`);
      await loadMember(selectedMemberId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "원장 복구 작업을 처리하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const linkedGroups = useMemo(() => buildLinkedLedgerGroups(ledger), [ledger]);
  const summary = useMemo(() => ({
    transactions: linkedGroups.length,
    bids: ledger?.bids?.length ?? 0,
    payments: (ledger?.auctionPayments?.length ?? 0) + (ledger?.commerceOrders?.length ?? 0) + (ledger?.legacyPayments?.length ?? 0),
    inventory: ledger?.inventory?.length ?? 0,
    shipments: ledger?.shipments?.length ?? 0,
  }), [ledger, linkedGroups.length]);

  return (
    <div className="space-y-8 text-zinc-100">
      <header className="border-b border-zinc-800 pb-6">
        <p className="text-[10px] font-black uppercase tracking-[.18em] text-amber-400">Owner / audited recovery</p>
        <h1 className="mt-3 text-3xl font-black tracking-[-.07em]">운영 데이터 복구 원장</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
          회원별 입찰·낙찰·결제·보관·배송을 소유자 권한으로 원자적으로 철회하거나 감사 스냅샷에서 복구합니다. 금전 원장은 삭제하지 않고 반대 분개로 잔액을 되돌립니다.
        </p>
      </header>

      <section className="border border-amber-500/30 bg-amber-500/10 p-4 text-xs leading-5 text-amber-100">
        <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 shrink-0" size={18} /><p><strong>강제 철회는 상태 제한과 무관하게 구매자·판매자 권리, 결제 잔액, 보관·배송 투영을 한 트랜잭션에서 되돌립니다.</strong><br />실제 은행 송금이나 이미 이동한 택배는 시스템 밖의 사실이므로 감사 기록의 외부 조치 표시에 따라 반환·회수해야 하며, 시스템 기록은 삭제되지 않습니다.</p></div>
      </section>

      <section className="border border-zinc-800 bg-zinc-950 p-4">
        <label className="text-xs font-black" htmlFor="ledger-member-search">회원 검색</label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input id="ledger-member-search" className="min-h-11 min-w-0 flex-1 border border-zinc-700 bg-zinc-900 px-3 text-sm outline-none focus:border-amber-500" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchMembers(); }} placeholder="회원명 · 전화번호 · 회원 UUID" value={query} />
          <button className="inline-flex min-h-11 items-center justify-center gap-2 bg-amber-500 px-5 text-xs font-black text-zinc-950 disabled:opacity-40" disabled={loading} onClick={() => void searchMembers()} type="button"><Search size={15} /> 검색</button>
        </div>
        {members.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{members.map((member) => <button className={`border p-3 text-left text-xs ${selectedMemberId === member.id ? "border-amber-500 bg-amber-500/10" : "border-zinc-800 bg-zinc-900"}`} key={member.id} onClick={() => { setSelectedMemberId(member.id); void loadMember(member.id); }} type="button"><strong className="block text-sm">{member.displayName}</strong><span className="mt-1 block text-zinc-400">{member.phone ?? "전화번호 없음"} · {member.accountStatus ?? "상태 없음"}</span><span className="mt-1 block truncate font-mono text-[10px] text-zinc-500">{member.id}</span></button>)}</div>}
      </section>

      {notice && <div aria-live="polite" className="border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm">{notice}</div>}

      {ledger?.member && <>
        <section className="flex flex-col justify-between gap-4 border border-zinc-800 bg-zinc-950 p-5 sm:flex-row sm:items-center">
          <div><p className="text-xl font-black">{ledger.member.displayName}</p><p className="mt-2 font-mono text-[10px] text-zinc-500">{ledger.member.id}</p><p className="mt-2 text-xs text-zinc-400">{ledger.member.phone ?? "전화번호 없음"} · 배송권 {ledger.member.shippingCreditCount}장 · 입금자명 {ledger.member.lastDepositorName ?? "미입력"}</p></div>
          <button className="inline-flex min-h-11 items-center justify-center gap-2 border border-zinc-700 px-4 text-xs font-bold disabled:opacity-40" disabled={loading} onClick={() => void loadMember(ledger.member!.id)} type="button"><RefreshCw size={14} /> 새로고침</button>
        </section>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[["연결 거래",summary.transactions],["입찰",summary.bids],["결제",summary.payments],["보관",summary.inventory],["배송",summary.shipments]].map(([label,count]) => <div className="border border-zinc-800 bg-zinc-950 p-4" key={String(label)}><p className="text-xs text-zinc-500">{label}</p><p className="mt-3 font-mono text-2xl font-black">{count}</p></div>)}</div>

        <section className="space-y-3">
          <div className="flex items-center gap-2"><AlertTriangle size={18} className="text-amber-400" /><div><h2 className="text-lg font-black">상품별 연결 거래</h2><p className="mt-1 text-xs text-zinc-500">같은 상품의 결제·보관·배송을 중복 목록으로 나누지 않고 하나의 흐름으로 표시합니다.</p></div></div>
          {linkedGroups.map((group) => {
            const forceTarget = getGroupForceTarget(group);
            const paymentStatuses = [
              ...group.auctionPayments.map((item) => ({ key: `auction:${item.id}`, label: `낙찰결제 ${item.status}` })),
              ...group.commerceOrders.map((item) => ({ key: `order:${item.id}`, label: `주문 ${item.status}` })),
              ...group.legacyPayments.map((item) => ({ key: `legacy:${item.id}`, label: `과거결제 ${item.payment_status}` })),
            ];
            const inventoryStatuses = group.inventory.map((item) => ({ key: item.id, label: `보관 ${item.ownership_status} / ${item.fulfillment?.current_stage ?? "미투영"}` }));
            const shipmentStatuses = group.shipments.map((item) => ({ key: item.id, label: `배송 ${item.status}` }));
            const receivedAmount = group.auctionPayments.reduce((sum, item) => sum + item.receivedAmount, 0)
              + group.commerceOrders.reduce((sum, item) => sum + (item.transfer?.receivedAmount ?? 0), 0);
            return <article className="border border-zinc-800 bg-zinc-950 p-4 sm:p-5" key={group.id}>
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                <div className="min-w-0"><p className="text-sm font-black">{group.products.map((product) => product.title).join(", ") || group.productIds.join(", ") || group.id}</p><p className="mt-1 text-[11px] text-zinc-500">연결 상품 {group.productIds.length}개 · 입금 잔액 {formatWon(receivedAmount)}</p></div>
                <div className="flex flex-wrap gap-2">{paymentStatuses.map((status) => <span key={status.key}>{statusBadge(status.label)}</span>)}{inventoryStatuses.map((status) => <span key={`inventory:${status.key}`}>{statusBadge(status.label)}</span>)}{shipmentStatuses.map((status) => <span key={`shipment:${status.key}`}>{statusBadge(status.label)}</span>)}</div>
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                {group.auctionPayments.filter((item) => item.status === "awaiting_manual_transfer").map((payment) => <button className="min-h-10 border border-zinc-700 px-3 text-xs font-bold" key={`due:${payment.id}`} onClick={() => openRepair({action:"update_auction_due_at",entityId:payment.id,expectedVersion:payment.version,title:payment.product?.title ?? payment.order_name,description:"회원의 낙찰 결제 마감 시각을 수정합니다."})} type="button"><Clock3 className="mr-1 inline" size={13}/>결제 마감 수정</button>)}
                {group.inventory.filter((item) => item.storage_started_at && item.ownership_status === "active").map((item) => <button className="min-h-10 border border-zinc-700 px-3 text-xs font-bold" key={`storage:${item.id}`} onClick={() => openRepair({action:"update_storage_duration",entityId:item.id,expectedVersion:item.version,payload:{storageDurationDays:item.storage_duration_days},title:item.product?.title ?? "보관 상품",description:"보관 시작일을 기준으로 7일 또는 14일 만료일을 다시 계산합니다."})} type="button"><PackageCheck className="mr-1 inline" size={13}/>보관 기간 수정</button>)}
                {group.shipments.filter((item) => item.status === "shipped").map((shipment) => <button className="min-h-10 border border-zinc-700 px-3 text-xs font-bold" key={`tracking:${shipment.id}`} onClick={() => openRepair({action:"correct_shipment_tracking",entityId:shipment.id,expectedVersion:shipment.version,title:"운송장 정정",description:"발송 완료 배송의 택배사와 운송장 번호를 수정하고 감사 이벤트를 남깁니다."})} type="button"><Truck className="mr-1 inline" size={13}/>운송장 정정</button>)}
                {forceTarget ? <button className="min-h-10 border border-rose-500/50 px-3 text-xs font-black text-rose-300" onClick={() => openRepair(forceTarget)} type="button"><XCircle className="mr-1 inline" size={13}/>연결 거래 전체 강제 철회</button> : <span className="inline-flex min-h-10 items-center border border-emerald-500/30 px-3 text-xs font-black text-emerald-300">철회 완료</span>}
              </div>
            </article>;
          })}
          {linkedGroups.length === 0 && <p className="border border-zinc-800 py-8 text-center text-xs text-zinc-500">현재 연결 거래 원장이 없습니다.</p>}
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2"><History size={18} /><h2 className="text-lg font-black">최근 복구 감사 기록</h2></div>
          <div className="overflow-x-auto border border-zinc-800"><table className="w-full min-w-[860px] text-left text-xs"><thead className="bg-zinc-900 text-zinc-400"><tr><th className="p-3">시각</th><th className="p-3">작업</th><th className="p-3">대상</th><th className="p-3">사유·외부 조치</th><th className="p-3">복구</th></tr></thead><tbody className="divide-y divide-zinc-800">{(ledger.audits ?? []).map((audit) => <tr key={audit.id}><td className="p-3">{formatAt(audit.occurred_at)}</td><td className="p-3 font-black">{ACTION_LABELS[audit.action as RepairAction] ?? audit.action}</td><td className="p-3 font-mono text-[10px]">{audit.entity_type} · {audit.entity_id}</td><td className="p-3">{audit.reason}{audit.result?.externalActionsRequired?.bankRefund && <span className="mt-1 block text-amber-300">실제 입금 반환 확인 필요</span>}{audit.result?.externalActionsRequired?.physicalShipmentRecall && <span className="mt-1 block text-amber-300">실물 배송 회수 확인 필요</span>}</td><td className="p-3">{audit.restorable ? <button className="min-h-9 whitespace-nowrap border border-emerald-500/50 px-3 text-[11px] font-black text-emerald-300" onClick={() => openRepair({action:"restore_audit_event",entityId:audit.id,expectedVersion:null,title:"강제 철회 복구",description:"이 감사 기록의 변경 전 스냅샷으로 플랫폼 원장을 복구하고, 복구 자체도 새 감사 기록으로 남깁니다."})} type="button"><Undo2 className="mr-1 inline" size={13}/>복구</button> : <span className="text-zinc-600">—</span>}</td></tr>)}</tbody></table>{(ledger.audits?.length ?? 0) === 0 && <p className="py-8 text-center text-xs text-zinc-500">아직 복구 감사 기록이 없습니다.</p>}</div>
        </section>
      </>}

      <PremiumDialog ariaLabel="운영 원장 복구 확인" closeDisabled={busy} onClose={() => { if (!busy) setTarget(null); }} open={target !== null} panelClassName="max-w-xl" zIndexClassName="z-[150]">
        {target && <div className="bg-zinc-950 p-5 text-zinc-100 sm:p-7"><p className="text-[10px] font-black uppercase tracking-[.16em] text-amber-400">Owner ledger repair</p><h2 className="mt-2 text-xl font-black">{ACTION_LABELS[target.action]}</h2><p className="mt-1 text-sm font-bold">{target.title}</p><p className="mt-3 text-xs leading-5 text-zinc-400">{target.description}</p>
          {target.action === "update_auction_due_at" && <label className="mt-5 block text-xs font-bold">새 결제 마감 시각<input className="mt-2 min-h-11 w-full border border-zinc-700 bg-zinc-900 px-3" min={new Date().toISOString().slice(0,16)} onChange={(event) => setDueAt(event.target.value)} type="datetime-local" value={dueAt}/></label>}
          {target.action === "correct_shipment_tracking" && <div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold">택배사<input className="mt-2 min-h-11 w-full border border-zinc-700 bg-zinc-900 px-3" maxLength={80} onChange={(event) => setCourier(event.target.value)} value={courier}/></label><label className="text-xs font-bold">운송장 번호<input className="mt-2 min-h-11 w-full border border-zinc-700 bg-zinc-900 px-3" maxLength={120} onChange={(event) => setTrackingNumber(event.target.value)} value={trackingNumber}/></label></div>}
          {target.action === "update_storage_duration" && <label className="mt-5 block text-xs font-bold">새 보관 기간<select className="mt-2 min-h-11 w-full border border-zinc-700 bg-zinc-900 px-3" onChange={(event) => setStorageDuration(event.target.value)} value={storageDuration}><option value="7">7일</option><option value="14">14일</option></select></label>}
          <label className="mt-5 block text-xs font-bold">조치 사유<textarea className="mt-2 min-h-24 w-full resize-y border border-zinc-700 bg-zinc-900 px-3 py-3 text-sm" maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="예: 운영 초반 중복 상품을 같은 상품으로 오인해 잘못 입찰한 건" value={reason}/></label>
          <label className="mt-4 block text-xs font-bold">확인 문구<input autoComplete="off" className="mt-2 min-h-11 w-full border border-rose-500/50 bg-zinc-900 px-3" onChange={(event) => setConfirmation(event.target.value)} placeholder={FORCE_ACTIONS.has(target.action) ? "강제철회" : "원장복구"} value={confirmation}/></label>
          {notice && <p aria-live="polite" className="mt-4 border border-zinc-700 bg-zinc-900 p-3 text-xs">{notice}</p>}
          <div className="mt-6 flex flex-col-reverse gap-2 border-t border-zinc-800 pt-5 sm:flex-row sm:justify-end"><button className="min-h-11 border border-zinc-700 px-5 text-xs font-bold" disabled={busy} onClick={() => setTarget(null)} type="button">닫기</button><button className="min-h-11 bg-rose-600 px-5 text-xs font-black text-white disabled:opacity-40" disabled={busy || reason.trim().length < 3 || confirmation !== (FORCE_ACTIONS.has(target.action) ? "강제철회" : "원장복구")} onClick={() => void submitRepair()} type="button">{busy ? "처리 중…" : FORCE_ACTIONS.has(target.action) ? "감사 기록 후 강제 철회" : "감사 기록 후 복구"}</button></div>
        </div>}
      </PremiumDialog>
    </div>
  );
}
