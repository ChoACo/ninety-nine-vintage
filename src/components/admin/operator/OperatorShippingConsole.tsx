"use client";

import {
  CheckCircle2,
  ChevronDown,
  PackageCheck,
  RefreshCw,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { CatalogImage } from "@/components/ui/CatalogImage";

type ShipmentAction = "pack" | "ship" | "tracking_update" | "tracking_delete";
type ShippingForm = { courier: string; trackingNumber: string };

interface StoreWork {
  id: string;
  storeId: string;
  storeName: string;
  status: string;
  version: number;
}

interface ShipmentItem {
  inventoryItemId: string;
  productId: string;
  title: string;
  imageUrl: string | null;
  lineStatus: string;
  released: boolean;
  originStoreId: string;
  originStoreName: string;
  isBlocked: boolean;
}

interface AddressSnapshot {
  label: string;
  recipientName: string;
  phone: string;
  postalCode: string | null;
  address: string;
}

interface InventoryShipment {
  id: string;
  memberId: string;
  memberName: string;
  businessId: string;
  status: string;
  version: number;
  settlementMethod: string;
  shippingFeeStatus: string;
  requestedAt: string;
  packedAt: string | null;
  shippedAt: string | null;
  courier: string | null;
  trackingNumber: string | null;
  addressSnapshot: AddressSnapshot;
  itemCount: number;
  activeItemCount: number;
  releasedItemCount: number;
  unreleasedItemCount: number;
  heldItemCount: number;
  storeWorks: StoreWork[];
  items: ShipmentItem[];
}

interface CompletedDelivery {
  shipmentId: string;
  memberId: string;
  memberName: string;
  courier: string;
  trackingNumber: string;
  itemCount: number;
  products: Array<{
    productId: string;
    title: string;
    imageUrl: string;
  }>;
  shippedAt: string;
  completedAt: string;
  purgeAfter: string;
}

const PAGE_SIZE = 50;
const SESSION_KEY_PREFIX = "ninety-nine:inventory-shipment-command:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTextOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isStoreWork(value: unknown): value is StoreWork {
  return isRecord(value) && Object.keys(value).length === 5 &&
    typeof value.id === "string" && typeof value.storeId === "string" &&
    typeof value.storeName === "string" && typeof value.status === "string" &&
    isInteger(value.version);
}

function isShipmentItem(value: unknown): value is ShipmentItem {
  return isRecord(value) && Object.keys(value).length === 9 &&
    typeof value.inventoryItemId === "string" && typeof value.productId === "string" &&
    typeof value.title === "string" && isTextOrNull(value.imageUrl) &&
    typeof value.lineStatus === "string" && typeof value.released === "boolean" &&
    typeof value.originStoreId === "string" &&
    typeof value.originStoreName === "string" && typeof value.isBlocked === "boolean";
}

function isAddressSnapshot(value: unknown): value is AddressSnapshot {
  return isRecord(value) && Object.keys(value).length === 5 &&
    typeof value.label === "string" && typeof value.recipientName === "string" &&
    typeof value.phone === "string" && isTextOrNull(value.postalCode) &&
    typeof value.address === "string";
}

function isShipment(value: unknown): value is InventoryShipment {
  return isRecord(value) && Object.keys(value).length === 21 &&
    typeof value.id === "string" && typeof value.memberId === "string" &&
    typeof value.memberName === "string" && typeof value.businessId === "string" &&
    typeof value.status === "string" && isInteger(value.version) &&
    typeof value.settlementMethod === "string" && typeof value.shippingFeeStatus === "string" &&
    typeof value.requestedAt === "string" && isTextOrNull(value.packedAt) &&
    isTextOrNull(value.shippedAt) && isTextOrNull(value.courier) &&
    isTextOrNull(value.trackingNumber) && isAddressSnapshot(value.addressSnapshot) && isInteger(value.itemCount) &&
    isInteger(value.activeItemCount) && isInteger(value.releasedItemCount) &&
    isInteger(value.unreleasedItemCount) &&
    isInteger(value.heldItemCount) && Array.isArray(value.storeWorks) &&
    value.storeWorks.every(isStoreWork) && Array.isArray(value.items) && value.items.every(isShipmentItem);
}

function isCompletedDelivery(value: unknown): value is CompletedDelivery {
  return isRecord(value) && Object.keys(value).length === 10 &&
    typeof value.shipmentId === "string" && typeof value.memberId === "string" &&
    typeof value.memberName === "string" && typeof value.courier === "string" &&
    typeof value.trackingNumber === "string" && isInteger(value.itemCount) &&
    typeof value.shippedAt === "string" && typeof value.completedAt === "string" &&
    typeof value.purgeAfter === "string" && Array.isArray(value.products) &&
    value.products.every((product) =>
      isRecord(product) && Object.keys(product).length === 3 &&
      typeof product.productId === "string" && typeof product.title === "string" &&
      typeof product.imageUrl === "string"
    );
}

function isQueue(value: unknown): value is {
  completedDeliveries: CompletedDelivery[];
  shipments: InventoryShipment[];
} {
  return isRecord(value) && Object.keys(value).length === 2 &&
    Array.isArray(value.shipments) && value.shipments.every(isShipment) &&
    Array.isArray(value.completedDeliveries) &&
    value.completedDeliveries.every(isCompletedDelivery);
}

function isCommandResult(value: unknown, id: string, action: ShipmentAction): boolean {
  const expectedStatus = action === "pack" || action === "tracking_delete"
    ? "packed"
    : "shipped";
  return isRecord(value) && Object.keys(value).length === 4 && value.id === id &&
    typeof value.version === "number" && typeof value.idempotent_replay === "boolean" &&
    value.status === expectedStatus;
}

function formatAt(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ko-KR");
}

function statusLabel(value: string) {
  return {
    requested: "요청됨",
    collecting: "매장 집합 중",
    ready_to_pack: "포장 가능",
    packed: "포장 완료",
    shipped: "발송 완료",
    cancelled: "취소됨",
    reconciliation_required: "정합성 확인 필요",
    outbound_complete: "출고 완료",
    ready: "출고 준비 완료",
    held: "보류",
    excluded: "다음 배송 제외",
  }[value] ?? value;
}

function activeItems(shipment: InventoryShipment) {
  return shipment.items.filter((item) => item.lineStatus !== "excluded" && item.lineStatus !== "cancelled");
}

function groupShipmentsByMember(shipments: InventoryShipment[]) {
  const grouped = new Map<string, {
    memberId: string;
    memberName: string;
    shipments: InventoryShipment[];
  }>();
  for (const shipment of shipments) {
    const group = grouped.get(shipment.memberId) ?? {
      memberId: shipment.memberId,
      memberName: shipment.memberName,
      shipments: [],
    };
    group.shipments.push(shipment);
    grouped.set(shipment.memberId, group);
  }
  return [...grouped.values()];
}

function groupCompletedByMember(deliveries: CompletedDelivery[]) {
  const grouped = new Map<string, {
    deliveries: CompletedDelivery[];
    memberId: string;
    memberName: string;
  }>();
  for (const delivery of deliveries) {
    const group = grouped.get(delivery.memberId) ?? {
      deliveries: [],
      memberId: delivery.memberId,
      memberName: delivery.memberName,
    };
    group.deliveries.push(delivery);
    grouped.set(delivery.memberId, group);
  }
  return [...grouped.values()];
}

function packGate(shipment: InventoryShipment) {
  const active = activeItems(shipment);
  const allStoresReleased = shipment.storeWorks.every((work) => work.status === "outbound_complete");
  const everyActiveItemReady = active.every((item) =>
    item.lineStatus === "ready" && item.released && !item.isBlocked,
  );
  const ready = shipment.status === "ready_to_pack" &&
    shipment.shippingFeeStatus === "confirmed" && active.length > 0 &&
    shipment.activeItemCount === active.length && allStoresReleased && everyActiveItemReady;
  return {
    ready,
    reason: ready
      ? null
      : shipment.shippingFeeStatus !== "confirmed"
        ? "배송비 입금 확인이 필요합니다."
        : "미 출고된 상품이 존재합니다",
  };
}

function sessionKey(shipment: InventoryShipment, action: ShipmentAction, form?: ShippingForm) {
  const shipmentScope = `${shipment.id}:${action}:${shipment.version}`;
  return action === "ship" || action === "tracking_update"
    ? `${SESSION_KEY_PREFIX}${shipmentScope}:${form?.courier.trim() ?? ""}:${form?.trackingNumber.trim() ?? ""}`
    : `${SESSION_KEY_PREFIX}${shipmentScope}`;
}

export function OperatorShippingConsole({
  staffLabel = "운영자",
}: Readonly<{ staffLabel?: string }>) {
  const [token, setToken] = useState<string | null>(null);
  const [shipments, setShipments] = useState<InventoryShipment[]>([]);
  const [completedDeliveries, setCompletedDeliveries] = useState<CompletedDelivery[]>([]);
  const includeShipped = true;
  const [offset, setOffset] = useState(0);
  const [forms, setForms] = useState<Record<string, ShippingForm>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (accessToken: string | null, shipped: boolean, nextOffset: number) => {
    if (!accessToken) return;
    const query = new URLSearchParams({
      includeShipped: String(shipped),
      limit: String(PAGE_SIZE),
      offset: String(nextOffset),
    });
    const response = await fetch(`/api/admin/operator/shipping?${query}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok || !isQueue(payload)) {
      const message = isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : "배송 대기열을 불러오지 못했습니다.";
      throw new Error(message);
    }
    setShipments(payload.shipments);
    setCompletedDeliveries(payload.completedDeliveries);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
        const accessToken = session?.access_token ?? null;
        setToken(accessToken);
        if (accessToken) await load(accessToken, true, 0);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "배송 대기열을 불러오지 못했습니다.");
      }
    })();
  }, [load]);

  const refresh = () => {
    void load(token, includeShipped, offset).catch((error) => {
      setNotice(error instanceof Error ? error.message : "새로고침에 실패했습니다.");
    });
  };
  const changePage = (nextOffset: number) => {
    setOffset(nextOffset);
    void load(token, includeShipped, nextOffset).catch((error) => {
      setNotice(error instanceof Error ? error.message : "배송 대기열을 불러오지 못했습니다.");
    });
  };
  const updateForm = (shipmentId: string, field: keyof ShippingForm, value: string) => {
    setForms((current) => ({
      ...current,
      [shipmentId]: { ...(current[shipmentId] ?? { courier: "", trackingNumber: "" }), [field]: value },
    }));
  };

  const mutateShipment = async (shipment: InventoryShipment, action: ShipmentAction) => {
    if (!token || busyKey) return;
    const gate = packGate(shipment);
    const form = forms[shipment.id] ?? { courier: "", trackingNumber: "" };
    if (action === "pack" && !gate.ready) {
      setNotice(gate.reason ?? "미 출고된 상품이 존재합니다");
      return;
    }
    if (action === "ship" && shipment.status !== "packed") {
      setNotice("포장 완료 후에만 송장을 등록할 수 있습니다.");
      return;
    }
    if (
      (action === "tracking_update" || action === "tracking_delete") &&
      shipment.status !== "shipped"
    ) {
      setNotice("발송 완료된 배송만 송장을 수정하거나 삭제할 수 있습니다.");
      return;
    }
    if (
      (action === "ship" || action === "tracking_update") &&
      (!form.courier.trim() || !form.trackingNumber.trim())
    ) {
      setNotice("택배사와 송장번호를 입력해 주세요.");
      return;
    }
    if (
      action === "tracking_delete" &&
      !window.confirm("송장을 삭제하고 포장 완료 단계로 되돌릴까요?")
    ) return;
    const key = sessionKey(shipment, action, form);
    const idempotencyKey = sessionStorage.getItem(key) ?? crypto.randomUUID();
    sessionStorage.setItem(key, idempotencyKey);
    setBusyKey(key);
    setNotice("");
    try {
      const response = await fetch("/api/admin/operator/shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          shipmentId: shipment.id,
          expectedVersion: shipment.version,
          action,
          idempotencyKey,
          ...(action === "ship" || action === "tracking_update"
            ? { courier: form.courier.trim(), trackingNumber: form.trackingNumber.trim() }
            : {}),
        }),
      });
      const payload = await response.json().catch(() => null) as unknown;
      if (response.status === 409) {
        await load(token, includeShipped, offset);
        throw new Error("배송 상태가 변경되었습니다. 최신 목록을 확인해 주세요.");
      }
      if (!response.ok || !isRecord(payload) || !isCommandResult(payload.shipment, shipment.id, action)) {
        const message = isRecord(payload) && typeof payload.message === "string"
          ? payload.message
          : "배송 처리 결과를 검증하지 못했습니다.";
        throw new Error(message);
      }
      sessionStorage.removeItem(key);
      setNotice({
        pack: "합포장을 완료했습니다.",
        ship: "송장을 등록하고 발송 완료 처리했습니다.",
        tracking_update: "송장 정보를 수정했습니다.",
        tracking_delete: "송장을 삭제하고 포장 완료 단계로 되돌렸습니다.",
      }[action]);
      await load(token, includeShipped, offset);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "배송 상태를 변경하지 못했습니다.");
    } finally {
      setBusyKey(null);
    }
  };

  const summary = useMemo(() => ({
    collecting: shipments.filter((shipment) => shipment.status === "collecting" || shipment.status === "requested").length,
    packed: shipments.filter((shipment) => shipment.status === "packed").length,
    shipped: shipments.filter((shipment) => shipment.status === "shipped").length,
  }), [shipments]);
  const activeShipments = useMemo(
    () => shipments.filter((shipment) => shipment.status !== "shipped"),
    [shipments],
  );
  const shippedShipments = useMemo(
    () => shipments.filter((shipment) => shipment.status === "shipped"),
    [shipments],
  );
  const activeMemberGroups = useMemo(
    () => groupShipmentsByMember(activeShipments),
    [activeShipments],
  );
  const shippedMemberGroups = useMemo(
    () => groupShipmentsByMember(shippedShipments),
    [shippedShipments],
  );
  const completedMemberGroups = useMemo(
    () => groupCompletedByMember(completedDeliveries),
    [completedDeliveries],
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-stretch justify-between gap-5 border-b border-ink pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow text-muted">{staffLabel} / 매장 통합 배송</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-.06em] sm:text-4xl sm:tracking-[-.08em]">배송 업무</h1>
          <p className="mt-3 text-sm text-muted">모든 매장의 배송 신청을 함께 확인합니다. 상품 사진과 매장별 출고 여부를 확인한 뒤 합포장과 송장을 처리하세요.</p>
        </div>
        <button className="flex items-center justify-center gap-2 border border-line px-4 py-3 text-xs font-bold" onClick={refresh} type="button"><RefreshCw size={13} /> 새로고침</button>
      </div>

      {notice && <div aria-live="polite" className="border border-line bg-surface px-4 py-3 text-xs">{notice}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="border border-line p-5"><p className="text-xs text-muted">매장 출고 대기 신청</p><p className="mt-3 font-mono text-3xl font-bold">{summary.collecting}</p></div>
        <div className="border border-line p-5"><PackageCheck size={17} /><p className="mt-7 text-xs text-muted">송장 등록 대기</p><p className="mt-3 font-mono text-3xl font-bold">{summary.packed}</p></div>
        <div className="border border-line bg-ink p-5 text-paper"><Truck size={17} /><p className="mt-7 text-xs text-zinc-400">발송 완료</p><p className="mt-3 font-mono text-3xl font-bold">{summary.shipped}</p></div>
      </div>

      <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
        <p className="text-xs font-bold">처리 중과 발송 완료 내역을 분리해 표시합니다.</p>
        <p className="text-xs text-muted">현재 페이지 {shipments.length}건</p>
      </div>

      <div className="border border-line">
        {[
          {
            groups: activeMemberGroups,
            key: "active",
            title: `처리 중 배송 · ${activeShipments.length}건`,
          },
          {
            groups: shippedMemberGroups,
            key: "shipped",
            title: `발송 완료 내역 · ${shippedShipments.length}건`,
          },
        ].map((section) => (
          <section className="border-b border-ink last:border-b-0" key={section.key}>
            <div className="bg-surface px-5 py-3 text-sm font-black">
              {section.title}
            </div>
            {section.groups.map((group) => (
              <details className="group border-t border-line" key={`${section.key}:${group.memberId}`}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black">{group.memberName}</span>
                    <span className="mt-1 block font-mono text-[10px] text-muted">
                      {group.memberId}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-xs font-bold">
                    신청 {group.shipments.length}건 · 상품{" "}
                    {group.shipments.reduce((sum, shipment) => sum + shipment.activeItemCount, 0)}개
                    <ChevronDown className="transition-transform group-open:rotate-180" size={15} />
                  </span>
                </summary>
                <div className="border-t border-line">
                  {group.shipments.map((shipment) => {
          const gate = packGate(shipment);
          const active = activeItems(shipment);
          const canShip = shipment.status === "packed" && active.length > 0 && active.every((item) => item.lineStatus === "packed" && !item.isBlocked);
          const form = forms[shipment.id] ?? {
            courier: shipment.courier ?? "",
            trackingNumber: shipment.trackingNumber ?? "",
          };
          return (
            <article className="border-b border-line px-4 py-5 last:border-b-0 sm:px-5" key={shipment.id}>
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2"><span className="border border-line px-2 py-1 text-[10px] font-bold">{statusLabel(shipment.status)}</span><span className="border border-line px-2 py-1 text-[10px] font-bold">배송비 {statusLabel(shipment.shippingFeeStatus)}</span></div>
                  <p className="mt-3 text-sm font-bold">{shipment.memberName}</p>
                  <p className="mt-1 break-all font-mono text-[10px] text-muted">구매자 {shipment.memberId}</p>
                  <p className="mt-1 break-all font-mono text-[10px] text-muted">배송 {shipment.id} · 요청 {formatAt(shipment.requestedAt)} · 버전 {shipment.version}</p>
                </div>
                <div className="text-xs text-muted">상품 {shipment.activeItemCount}/{shipment.itemCount} · 출고 완료 {shipment.releasedItemCount} · 매장 출고 대기 {shipment.unreleasedItemCount}</div>
              </div>

              <div className="mt-5 border-t border-line pt-4">
                <p className="text-xs font-bold">배송지</p>
                <p className="mt-2 text-xs leading-5">
                  {shipment.addressSnapshot.recipientName} · {shipment.addressSnapshot.phone}
                </p>
                <p className="text-xs leading-5 text-muted">
                  {shipment.addressSnapshot.postalCode ? `[${shipment.addressSnapshot.postalCode}] ` : ""}
                  {shipment.addressSnapshot.address}
                </p>
              </div>

              <div className="mt-5 border-t border-line pt-4">
                <p className="text-xs font-bold">매장별 출고 현황</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {shipment.storeWorks.map((work) => <span className="border border-line px-2 py-1 text-[10px]" key={work.id}>{work.storeName} · {statusLabel(work.status)}</span>)}
                </div>
              </div>

              <div className="mt-5 border-t border-line pt-4">
                <p className="text-xs font-bold">신청 상품</p>
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
                  {shipment.items.map((item) => (
                    <div className={`border p-2 ${item.released ? "border-line" : "border-amber-400 bg-amber-50"}`} key={item.inventoryItemId}>
                      <div className="aspect-square bg-surface">
                        {item.imageUrl
                          ? <CatalogImage alt="" className="h-full w-full object-cover" loading="lazy" sizes="160px" src={item.imageUrl} />
                          : <div className="grid h-full place-items-center text-[10px] text-muted">사진 없음</div>}
                      </div>
                      <p className="mt-2 line-clamp-2 min-h-8 font-bold">{item.title}</p>
                      <p className="mt-2 text-[10px] text-muted">{item.originStoreName}</p>
                      <p className={`mt-1 text-[10px] font-bold ${item.released ? "text-emerald-700" : "text-amber-700"}`}>
                        {item.released ? "출고 완료" : "매장 출고 대기"}
                        {item.isBlocked ? " · 확인 필요" : ""}
                      </p>
                      <Link className="mt-2 inline-block text-[10px] font-bold underline" href={`/auction/${item.productId}`}>상품 상세보기</Link>
                    </div>
                  ))}
                </div>
              </div>

              {shipment.status !== "packed" && shipment.status !== "shipped" && (
                <div className="mt-5 border-t border-line pt-4">
                  {!gate.ready && <p className="mb-3 text-xs text-amber-700">{gate.reason}</p>}
                  <button className="h-10 bg-ink px-4 text-xs font-bold text-paper disabled:opacity-40" disabled={!gate.ready || busyKey !== null} onClick={() => void mutateShipment(shipment, "pack")} type="button">합포장 완료</button>
                </div>
              )}

              {shipment.status === "packed" && (
                <div className="mt-5 grid grid-cols-1 gap-2 border-t border-line pt-4 sm:grid-cols-[minmax(0,160px)_minmax(0,220px)_auto]">
                  <input aria-label={`${shipment.id} 택배사`} className="h-10 border border-line px-3 text-xs" disabled={!canShip} onChange={(event) => updateForm(shipment.id, "courier", event.target.value)} placeholder="택배사" value={form.courier} />
                  <input aria-label={`${shipment.id} 송장번호`} className="h-10 border border-line px-3 text-xs" disabled={!canShip} onChange={(event) => updateForm(shipment.id, "trackingNumber", event.target.value)} placeholder="송장번호" value={form.trackingNumber} />
                  <button className="h-10 bg-ink px-4 text-xs font-bold text-paper disabled:opacity-40" disabled={!canShip || busyKey !== null} onClick={() => void mutateShipment(shipment, "ship")} type="button">송장 등록 · 발송 완료</button>
                  {!canShip && <p className="text-xs text-amber-700 sm:col-span-3">미 출고된 상품이 존재합니다</p>}
                </div>
              )}

              {shipment.status === "shipped" && (
                <div className="mt-5 border-t border-line pt-4">
                  <p className="flex items-center gap-2 text-xs font-bold">
                    <CheckCircle2 size={14} /> 발송 완료 · {formatAt(shipment.shippedAt)}
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,160px)_minmax(0,240px)_auto_auto]">
                    <input
                      aria-label={`${shipment.id} 수정할 택배사`}
                      className="h-10 border border-line px-3 text-xs"
                      onChange={(event) => updateForm(shipment.id, "courier", event.target.value)}
                      value={form.courier}
                    />
                    <input
                      aria-label={`${shipment.id} 수정할 송장번호`}
                      className="h-10 border border-line px-3 font-mono text-xs"
                      onChange={(event) => updateForm(shipment.id, "trackingNumber", event.target.value)}
                      value={form.trackingNumber}
                    />
                    <button
                      className="h-10 border border-ink px-4 text-xs font-bold disabled:opacity-40"
                      disabled={busyKey !== null}
                      onClick={() => void mutateShipment(shipment, "tracking_update")}
                      type="button"
                    >
                      송장 수정
                    </button>
                    <button
                      className="h-10 border border-rose-300 px-4 text-xs font-bold text-rose-700 disabled:opacity-40"
                      disabled={busyKey !== null}
                      onClick={() => void mutateShipment(shipment, "tracking_delete")}
                      type="button"
                    >
                      송장 삭제
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
                  })}
                </div>
              </details>
            ))}
            {section.groups.length === 0 && (
              <p className="border-t border-line py-10 text-center text-xs text-muted">
                표시할 {section.key === "active" ? "처리 중 배송" : "발송 완료 내역"}이 없습니다.
              </p>
            )}
          </section>
        ))}
        {shipments.length === 0 && completedDeliveries.length === 0 && (
          <p className="py-16 text-center text-sm text-muted">표시할 배송 요청이 없습니다.</p>
        )}
      </div>

      <section className="border border-line">
        <div className="flex items-center justify-between gap-4 bg-ink px-5 py-3 text-paper">
          <p className="text-sm font-black">배송 완료 · {completedDeliveries.length}건</p>
          <p className="text-[10px] text-zinc-400">완료 후 30일 보관</p>
        </div>
        {completedMemberGroups.map((group) => (
          <details className="group border-t border-line" key={`completed:${group.memberId}`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
              <span className="min-w-0">
                <span className="block truncate text-sm font-black">{group.memberName}</span>
                <span className="mt-1 block font-mono text-[10px] text-muted">{group.memberId}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3 text-xs font-bold">
                배송 {group.deliveries.length}건 · 상품{" "}
                {group.deliveries.reduce((sum, delivery) => sum + delivery.itemCount, 0)}개
                <ChevronDown className="transition-transform group-open:rotate-180" size={15} />
              </span>
            </summary>
            <div className="divide-y divide-line border-t border-line">
              {group.deliveries.map((delivery) => (
                <article className="px-5 py-5" key={delivery.shipmentId}>
                  <div className="flex flex-col justify-between gap-3 sm:flex-row">
                    <div>
                      <p className="flex items-center gap-2 text-xs font-black text-emerald-700">
                        <CheckCircle2 size={14} /> 배송 완료 · {formatAt(delivery.completedAt)}
                      </p>
                      <p className="mt-2 font-mono text-xs">
                        {delivery.courier} · {delivery.trackingNumber}
                      </p>
                    </div>
                    <p className="text-[10px] text-muted">
                      기록 정리 예정 {formatAt(delivery.purgeAfter)}
                    </p>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                    {delivery.products.map((product) => (
                      <Link
                        className="flex min-w-0 items-center gap-2 border border-line p-2"
                        href={`/auction/${product.productId}`}
                        key={`${delivery.shipmentId}:${product.productId}`}
                      >
                        {product.imageUrl
                          ? <CatalogImage alt="" className="size-10 shrink-0 object-cover" sizes="40px" src={product.imageUrl} />
                          : <span className="size-10 shrink-0 bg-surface" />}
                        <span className="line-clamp-2 text-[10px] font-bold">{product.title}</span>
                      </Link>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </details>
        ))}
        {completedMemberGroups.length === 0 && (
          <p className="border-t border-line py-10 text-center text-xs text-muted">
            최근 30일 이내 배송 완료 기록이 없습니다.
          </p>
        )}
      </section>

      <div className="flex items-center justify-between gap-4">
        <button className="border border-line px-4 py-2 text-xs font-bold disabled:opacity-40" disabled={offset === 0} onClick={() => changePage(Math.max(0, offset - PAGE_SIZE))} type="button">이전</button>
        <p className="font-mono text-[11px] text-muted">{offset + 1}–{offset + shipments.length}</p>
        <button className="border border-line px-4 py-2 text-xs font-bold disabled:opacity-40" disabled={shipments.length < PAGE_SIZE} onClick={() => changePage(offset + PAGE_SIZE)} type="button">다음</button>
      </div>
    </div>
  );
}
