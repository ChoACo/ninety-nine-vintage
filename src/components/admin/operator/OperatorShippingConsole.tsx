"use client";

import { CheckCircle2, PackageCheck, RefreshCw, Truck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type ShipmentAction = "pack" | "ship";
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
  physicalStatus: string;
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
  businessId: string;
  centerId: string;
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
  storedItemCount: number;
  heldItemCount: number;
  storeWorks: StoreWork[];
  items: ShipmentItem[];
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
  return isRecord(value) && Object.keys(value).length === 8 &&
    typeof value.inventoryItemId === "string" && typeof value.productId === "string" &&
    typeof value.title === "string" && isTextOrNull(value.imageUrl) &&
    typeof value.lineStatus === "string" && typeof value.physicalStatus === "string" &&
    typeof value.originStoreName === "string" && typeof value.isBlocked === "boolean";
}

function isAddressSnapshot(value: unknown): value is AddressSnapshot {
  return isRecord(value) && Object.keys(value).length === 5 &&
    typeof value.label === "string" && typeof value.recipientName === "string" &&
    typeof value.phone === "string" && isTextOrNull(value.postalCode) &&
    typeof value.address === "string";
}

function isShipment(value: unknown): value is InventoryShipment {
  return isRecord(value) && Object.keys(value).length === 20 &&
    typeof value.id === "string" && typeof value.memberId === "string" &&
    typeof value.businessId === "string" && typeof value.centerId === "string" &&
    typeof value.status === "string" && isInteger(value.version) &&
    typeof value.settlementMethod === "string" && typeof value.shippingFeeStatus === "string" &&
    typeof value.requestedAt === "string" && isTextOrNull(value.packedAt) &&
    isTextOrNull(value.shippedAt) && isTextOrNull(value.courier) &&
    isTextOrNull(value.trackingNumber) && isAddressSnapshot(value.addressSnapshot) && isInteger(value.itemCount) &&
    isInteger(value.activeItemCount) && isInteger(value.storedItemCount) &&
    isInteger(value.heldItemCount) && Array.isArray(value.storeWorks) &&
    value.storeWorks.every(isStoreWork) && Array.isArray(value.items) && value.items.every(isShipmentItem);
}

function isQueue(value: unknown): value is { shipments: InventoryShipment[] } {
  return isRecord(value) && Object.keys(value).length === 1 &&
    Array.isArray(value.shipments) && value.shipments.every(isShipment);
}

function isCommandResult(value: unknown, id: string, action: ShipmentAction): boolean {
  return isRecord(value) && Object.keys(value).length === 4 && value.id === id &&
    typeof value.version === "number" && typeof value.idempotent_replay === "boolean" &&
    value.status === (action === "pack" ? "packed" : "shipped");
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
    center_stored: "중앙 보관 완료",
  }[value] ?? value;
}

function activeItems(shipment: InventoryShipment) {
  return shipment.items.filter((item) => item.lineStatus !== "excluded" && item.lineStatus !== "cancelled");
}

function packGate(shipment: InventoryShipment) {
  const active = activeItems(shipment);
  const allStoresReleased = shipment.storeWorks.every((work) => work.status === "outbound_complete");
  const everyActiveItemReady = active.every((item) =>
    item.lineStatus === "ready" && item.physicalStatus === "center_stored" && !item.isBlocked,
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
  return action === "ship"
    ? `${SESSION_KEY_PREFIX}${shipmentScope}:${form?.courier.trim() ?? ""}:${form?.trackingNumber.trim() ?? ""}`
    : `${SESSION_KEY_PREFIX}${shipmentScope}`;
}

export function OperatorShippingConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [shipments, setShipments] = useState<InventoryShipment[]>([]);
  const [includeShipped, setIncludeShipped] = useState(false);
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
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
        const accessToken = session?.access_token ?? null;
        setToken(accessToken);
        if (accessToken) await load(accessToken, false, 0);
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
  const toggleHistory = (next: boolean) => {
    setIncludeShipped(next);
    setOffset(0);
    void load(token, next, 0).catch((error) => {
      setNotice(error instanceof Error ? error.message : "배송 대기열을 불러오지 못했습니다.");
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
    if (action === "ship" && (!form.courier.trim() || !form.trackingNumber.trim())) {
      setNotice("택배사와 송장번호를 입력해 주세요.");
      return;
    }
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
          ...(action === "ship" ? { courier: form.courier.trim(), trackingNumber: form.trackingNumber.trim() } : {}),
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
      setNotice(action === "pack" ? "합포장을 완료했습니다." : "송장을 등록하고 발송 완료 처리했습니다.");
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

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-stretch justify-between gap-5 border-b border-ink pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow text-muted">운영자 / 중앙 출고</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-.06em] sm:text-4xl sm:tracking-[-.08em]">배송 업무</h1>
          <p className="mt-3 text-sm text-muted">구매자별 배송 요청을 확인하고, 모든 활성 상품이 준비된 경우에만 포장과 송장을 처리합니다.</p>
        </div>
        <button className="flex items-center justify-center gap-2 border border-line px-4 py-3 text-xs font-bold" onClick={refresh} type="button"><RefreshCw size={13} /> 새로고침</button>
      </div>

      {notice && <div aria-live="polite" className="border border-line bg-surface px-4 py-3 text-xs">{notice}</div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="border border-line p-5"><p className="text-xs text-muted">매장 작업·입고 대기</p><p className="mt-3 font-mono text-3xl font-bold">{summary.collecting}</p></div>
        <div className="border border-line p-5"><PackageCheck size={17} /><p className="mt-7 text-xs text-muted">송장 등록 대기</p><p className="mt-3 font-mono text-3xl font-bold">{summary.packed}</p></div>
        <div className="border border-line bg-ink p-5 text-paper"><Truck size={17} /><p className="mt-7 text-xs text-zinc-400">발송 완료</p><p className="mt-3 font-mono text-3xl font-bold">{summary.shipped}</p></div>
      </div>

      <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
        <label className="flex items-center gap-2 text-xs font-bold"><input checked={includeShipped} onChange={(event) => toggleHistory(event.target.checked)} type="checkbox" /> 발송 완료 내역 보기</label>
        <p className="text-xs text-muted">현재 페이지 {shipments.length}건</p>
      </div>

      <div className="border border-line">
        {shipments.map((shipment) => {
          const gate = packGate(shipment);
          const active = activeItems(shipment);
          const canShip = shipment.status === "packed" && active.length > 0 && active.every((item) => item.lineStatus === "packed" && !item.isBlocked);
          const form = forms[shipment.id] ?? { courier: "", trackingNumber: "" };
          return (
            <article className="border-b border-line px-4 py-5 last:border-b-0 sm:px-5" key={shipment.id}>
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2"><span className="border border-line px-2 py-1 text-[10px] font-bold">{statusLabel(shipment.status)}</span><span className="border border-line px-2 py-1 text-[10px] font-bold">배송비 {statusLabel(shipment.shippingFeeStatus)}</span></div>
                  <p className="mt-3 break-all text-sm font-bold">구매자 {shipment.memberId}</p>
                  <p className="mt-1 break-all font-mono text-[10px] text-muted">배송 {shipment.id} · 요청 {formatAt(shipment.requestedAt)} · 버전 {shipment.version}</p>
                </div>
                <div className="text-xs text-muted">활성 {shipment.activeItemCount}/{shipment.itemCount} · 중앙 보관 {shipment.storedItemCount} · 보류 {shipment.heldItemCount}</div>
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
                <p className="text-xs font-bold">원산지 매장 작업</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {shipment.storeWorks.map((work) => <span className="border border-line px-2 py-1 text-[10px]" key={work.id}>{work.storeName} · {statusLabel(work.status)}</span>)}
                </div>
              </div>

              <div className="mt-5 border-t border-line pt-4">
                <p className="text-xs font-bold">상품 상태</p>
                <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                  {shipment.items.map((item) => <div className="border border-line p-3" key={item.inventoryItemId}><p className="font-bold">{item.title}</p><p className="mt-1 text-muted">{item.originStoreName} · {statusLabel(item.lineStatus)} · {statusLabel(item.physicalStatus)}{item.isBlocked ? " · 작업 보류" : ""}</p></div>)}
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

              {shipment.status === "shipped" && <p className="mt-5 flex items-center gap-2 border-t border-line pt-4 text-xs text-muted"><CheckCircle2 size={14} /> {shipment.courier} · {shipment.trackingNumber} · {formatAt(shipment.shippedAt)}</p>}
            </article>
          );
        })}
        {shipments.length === 0 && <p className="py-16 text-center text-sm text-muted">표시할 배송 요청이 없습니다.</p>}
      </div>

      <div className="flex items-center justify-between gap-4">
        <button className="border border-line px-4 py-2 text-xs font-bold disabled:opacity-40" disabled={offset === 0} onClick={() => changePage(Math.max(0, offset - PAGE_SIZE))} type="button">이전</button>
        <p className="font-mono text-[11px] text-muted">{offset + 1}–{offset + shipments.length}</p>
        <button className="border border-line px-4 py-2 text-xs font-bold disabled:opacity-40" disabled={shipments.length < PAGE_SIZE} onClick={() => changePage(offset + PAGE_SIZE)} type="button">다음</button>
      </div>
    </div>
  );
}
