"use client";

import {
  CheckCircle2,
  ChevronDown,
  PackageCheck,
  RefreshCw,
  Truck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { useOperatorOptimisticStore } from "@/store/useOperatorOptimisticStore";
import {
  formatStorageDday,
  getKstCalendarDaysUntil,
  storageClassLabel,
  storageUrgencyClass,
  storageUrgencySurfaceClass,
} from "@/src/utils/shipping";

type ShipmentAction = "complete" | "pack" | "ship" | "tracking_update" | "tracking_delete";
type ShippingForm = { courier: string; customCourier: string; trackingNumber: string; note: string };
type AddressReveal = { address: AddressSnapshot; expiresAt: string };
type ShippingConsoleView = "requests" | "completed" | "history";
type StorageExpiryFilter = "all" | "today" | "within_2" | "past";
type ShipmentSortOrder = "recent" | "expiry";

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
  storageExpiresAt: string | null;
  storageDurationDays: number | null;
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
const COURIER_PRESETS = ["CJ대한통운", "우체국택배", "로젠택배", "한진택배", "롯데택배", "기타 / 직접입력"] as const;

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
  return isRecord(value) && Object.keys(value).length === 23 &&
    typeof value.id === "string" && typeof value.memberId === "string" &&
    typeof value.memberName === "string" && typeof value.businessId === "string" &&
    typeof value.status === "string" && isInteger(value.version) &&
    typeof value.settlementMethod === "string" && typeof value.shippingFeeStatus === "string" &&
    typeof value.requestedAt === "string" && isTextOrNull(value.packedAt) &&
    isTextOrNull(value.shippedAt) && isTextOrNull(value.courier) &&
    isTextOrNull(value.trackingNumber) && isAddressSnapshot(value.addressSnapshot) && isInteger(value.itemCount) &&
    isInteger(value.activeItemCount) && isInteger(value.releasedItemCount) &&
    isInteger(value.unreleasedItemCount) &&
    isInteger(value.heldItemCount) && isTextOrNull(value.storageExpiresAt) &&
    (value.storageDurationDays === null || isInteger(value.storageDurationDays)) &&
    Array.isArray(value.storeWorks) &&
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
  totalCount: number;
} {
  return isRecord(value) && Object.keys(value).length === 3 &&
    isInteger(value.totalCount) && value.totalCount >= 0 &&
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

function shipmentDaysLeft(shipment: InventoryShipment): number | null {
  if (!shipment.storageExpiresAt) return null;
  const parsed = Date.parse(shipment.storageExpiresAt);
  if (!Number.isFinite(parsed)) return null;
  return getKstCalendarDaysUntil(parsed);
}

function expiryMatches(filter: StorageExpiryFilter, daysLeft: number | null): boolean {
  if (filter === "all") return true;
  if (daysLeft === null) return false;
  if (filter === "today") return daysLeft === 0;
  if (filter === "within_2") return daysLeft >= 0 && daysLeft <= 2;
  return daysLeft < 0;
}

const STORAGE_EXPIRY_OPTIONS: Array<{ label: string; value: StorageExpiryFilter }> = [
  { label: "전체", value: "all" },
  { label: "D-Day", value: "today" },
  { label: "D-2 이내", value: "within_2" },
  { label: "만료 지남", value: "past" },
];

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

function dispatchGate(shipment: InventoryShipment) {
  const active = activeItems(shipment);
  const eligibleStatus = ["requested", "collecting", "ready_to_pack", "packed"].includes(shipment.status);
  const ready = eligibleStatus && shipment.shippingFeeStatus === "confirmed" &&
    active.length > 0 && shipment.activeItemCount === active.length &&
    active.every((item) => !item.isBlocked && item.lineStatus !== "held");
  return {
    ready,
    reason: ready
      ? null
      : shipment.shippingFeeStatus !== "confirmed"
        ? "배송비 입금 확인이 필요합니다."
        : "분쟁·취소·보류 상태의 상품이 있는지 확인해 주세요.",
  };
}

function sessionKey(shipment: InventoryShipment, action: ShipmentAction, form?: ShippingForm) {
  const shipmentScope = `${shipment.id}:${action}:${shipment.version}`;
  const courier = form?.courier === "기타 / 직접입력" ? form.customCourier : form?.courier;
  return action === "complete" || action === "ship" || action === "tracking_update"
    ? `${SESSION_KEY_PREFIX}${shipmentScope}:${courier?.trim() ?? ""}:${form?.trackingNumber.trim() ?? ""}:${form?.note.trim() ?? ""}`
    : `${SESSION_KEY_PREFIX}${shipmentScope}`;
}

export function OperatorShippingConsole({
  staffLabel = "운영자",
  view = "requests",
}: Readonly<{
  staffLabel?: string;
  view?: ShippingConsoleView;
}>) {
  const [token, setToken] = useState<string | null>(null);
  const [shipments, setShipments] = useState<InventoryShipment[]>([]);
  const [completedDeliveries, setCompletedDeliveries] = useState<CompletedDelivery[]>([]);
  const includeShipped = view !== "requests";
  const [offset, setOffset] = useState(0);
  const [forms, setForms] = useState<Record<string, ShippingForm>>({});
  const [addressReasons, setAddressReasons] = useState<Record<string, string>>({});
  const [addressReveals, setAddressReveals] = useState<Record<string, AddressReveal>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [trackingModalShipment, setTrackingModalShipment] = useState<InventoryShipment | null>(null);
  const [expiryFilter, setExpiryFilter] = useState<StorageExpiryFilter>("all");
  const [sortOrder, setSortOrder] = useState<ShipmentSortOrder>("recent");
  const setOptimisticShipmentStatus = useOperatorOptimisticStore((state) => state.setShipmentStatus);

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
        setOffset(0);
        setShipments([]);
        setCompletedDeliveries([]);
        setNotice("");
        const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
        const accessToken = session?.access_token ?? null;
        setToken(accessToken);
        if (accessToken) await load(accessToken, includeShipped, 0);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "배송 대기열을 불러오지 못했습니다.");
      }
    })();
  }, [includeShipped, load, view]);

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
      [shipmentId]: { ...(current[shipmentId] ?? { courier: "CJ대한통운", customCourier: "", trackingNumber: "", note: "" }), [field]: value },
    }));
  };
  const openTrackingModal = (shipment: InventoryShipment) => {
    setForms((current) => current[shipment.id] ? current : {
      ...current,
      [shipment.id]: { courier: shipment.courier ?? "CJ대한통운", customCourier: "", trackingNumber: shipment.trackingNumber ?? "", note: "" },
    });
    setTrackingModalShipment(shipment);
  };

  const revealAddress = async (shipment: InventoryShipment) => {
    if (!token || busyKey) return;
    const reason = (addressReasons[shipment.id] ?? "").trim();
    if (reason.length < 3) {
      setNotice("배송정보 열람 사유를 3자 이상 입력해 주세요.");
      return;
    }
    const key = `address:${shipment.id}`;
    setBusyKey(key);
    setNotice("");
    try {
      const response = await fetch(`/api/admin/operator/shipping/${shipment.id}/address`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason, idempotencyKey: crypto.randomUUID() }),
      });
      const payload = await response.json().catch(() => null) as unknown;
      const reveal = isRecord(payload) && isRecord(payload.reveal) ? payload.reveal : null;
      if (!response.ok || !reveal || reveal.shipmentId !== shipment.id ||
        !isAddressSnapshot(reveal.address) || typeof reveal.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(reveal.expiresAt))) {
        const message = isRecord(payload) && typeof payload.message === "string"
          ? payload.message
          : "배송정보 열람 결과를 검증하지 못했습니다.";
        throw new Error(message);
      }
      setAddressReveals((current) => ({
        ...current,
        [shipment.id]: { address: reveal.address as unknown as AddressSnapshot, expiresAt: reveal.expiresAt as string },
      }));
      setAddressReasons((current) => ({ ...current, [shipment.id]: "" }));
      const revealedExpiresAt = reveal.expiresAt as string;
      window.setTimeout(() => {
        setAddressReveals((current) => {
          if (current[shipment.id]?.expiresAt !== revealedExpiresAt) return current;
          const next = { ...current };
          delete next[shipment.id];
          return next;
        });
      }, 5 * 60 * 1000);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "배송정보를 열람하지 못했습니다.");
    } finally {
      setBusyKey(null);
    }
  };

  const mutateShipment = async (shipment: InventoryShipment, action: ShipmentAction) => {
    if (!token || busyKey) return;
    const gate = dispatchGate(shipment);
    const form = forms[shipment.id] ?? { courier: "CJ대한통운", customCourier: "", trackingNumber: "", note: "" };
    const resolvedCourier = form.courier === "기타 / 직접입력" ? form.customCourier.trim() : form.courier.trim();
    if (action === "complete" && !gate.ready) {
      setNotice(gate.reason ?? "현재 상태에서는 출고할 수 없습니다.");
      return;
    }
    if (action === "pack" && !gate.ready) {
      setNotice(gate.reason ?? "현재 상태에서는 포장할 수 없습니다.");
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
      (action === "complete" || action === "ship" || action === "tracking_update") &&
      (!resolvedCourier || !form.trackingNumber.trim())
    ) {
      setNotice("택배사와 송장번호를 입력해 주세요.");
      return;
    }
    if ((action === "tracking_update" || action === "tracking_delete") && !form.note.trim()) {
      setNotice("송장 정정 사유를 입력해 주세요.");
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
    const previousShipments = shipments;
    const optimisticStatus = action === "pack" || action === "tracking_delete" ? "packed" : "shipped";
    setOptimisticShipmentStatus(shipment.id, optimisticStatus);
    setShipments((current) => current.map((item) => item.id === shipment.id ? { ...item, status: optimisticStatus } : item));
    try {
      const response = await fetch("/api/admin/operator/shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          shipmentId: shipment.id,
          expectedVersion: shipment.version,
          action,
          idempotencyKey,
          note: form.note.trim() || null,
          ...(action === "complete" || action === "ship" || action === "tracking_update"
            ? { courier: resolvedCourier, trackingNumber: form.trackingNumber.trim() }
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
        complete: "출고 및 송장 등록이 완료되었습니다.",
        pack: "합포장을 완료했습니다.",
        ship: "송장을 등록하고 발송 완료 처리했습니다.",
        tracking_update: "송장 정보를 수정했습니다.",
        tracking_delete: "송장을 삭제하고 포장 완료 단계로 되돌렸습니다.",
      }[action]);
      await load(token, includeShipped, offset);
    } catch (error) {
      setShipments(previousShipments);
      setNotice(error instanceof Error ? error.message : "배송 상태를 변경하지 못했습니다.");
    } finally {
      setOptimisticShipmentStatus(shipment.id, null);
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
  const visibleActiveShipments = useMemo(() => {
    if (view !== "requests") return activeShipments;
    const filtered = activeShipments.filter((shipment) =>
      expiryMatches(expiryFilter, shipmentDaysLeft(shipment)),
    );
    if (sortOrder !== "expiry") return filtered;
    return [...filtered].sort((left, right) =>
      (shipmentDaysLeft(left) ?? Number.MAX_SAFE_INTEGER) -
      (shipmentDaysLeft(right) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [activeShipments, expiryFilter, sortOrder, view]);
  const expiryCounts = useMemo(() => ({
    all: activeShipments.length,
    past: activeShipments.filter((shipment) => expiryMatches("past", shipmentDaysLeft(shipment))).length,
    today: activeShipments.filter((shipment) => expiryMatches("today", shipmentDaysLeft(shipment))).length,
    within_2: activeShipments.filter((shipment) => expiryMatches("within_2", shipmentDaysLeft(shipment))).length,
  }), [activeShipments]);
  const shippedShipments = useMemo(
    () => shipments.filter((shipment) => shipment.status === "shipped"),
    [shipments],
  );
  const activeMemberGroups = useMemo(() => {
    const groups = groupShipmentsByMember(visibleActiveShipments);
    if (sortOrder !== "expiry") return groups;
    const minDaysLeft = (group: { shipments: InventoryShipment[] }) =>
      Math.min(...group.shipments.map((shipment) => shipmentDaysLeft(shipment) ?? Number.MAX_SAFE_INTEGER));
    return [...groups].sort((left, right) => minDaysLeft(left) - minDaysLeft(right));
  }, [sortOrder, visibleActiveShipments]);
  const shippedMemberGroups = useMemo(
    () => groupShipmentsByMember(shippedShipments),
    [shippedShipments],
  );
  const completedMemberGroups = useMemo(
    () => groupCompletedByMember(completedDeliveries),
    [completedDeliveries],
  );
  const shipmentSections = view === "requests"
    ? [{
        groups: activeMemberGroups,
        key: "active",
        title: `택배 요청 · ${visibleActiveShipments.length}건`,
      }]
    : view === "completed"
      ? [{
          groups: shippedMemberGroups,
          key: "shipped",
          title: `택배 발송 완료 · ${shippedShipments.length}건`,
        }]
      : [];
  const viewHeading = {
    completed: {
      description: "발송 완료된 택배의 송장 정보를 확인하고 필요한 경우 수정하거나 삭제합니다.",
      title: "택배 발송 완료",
    },
    history: {
      description: "배송까지 완료된 택배 기록을 최근 30일 범위에서 확인합니다.",
      title: "지난 택배 기록",
    },
    requests: {
      description: "배송 신청을 확인하고 합포장, 택배사와 송장 등록까지 처리합니다.",
      title: "택배 요청",
    },
  }[view];

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-stretch justify-between gap-5 border-b border-ink pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow text-muted">{staffLabel} / 택배</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-.06em] sm:text-4xl sm:tracking-[-.08em]">{viewHeading.title}</h1>
          <p className="mt-3 text-sm text-muted">{viewHeading.description}</p>
        </div>
        <button className="flex items-center justify-center gap-2 border border-line px-4 py-3 text-xs font-bold" onClick={refresh} type="button"><RefreshCw size={13} /> 새로고침</button>
      </div>

      {notice && <div aria-live="polite" className="border border-line bg-surface px-4 py-3 text-xs">{notice}</div>}

      {view === "requests" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="border border-line p-5"><p className="text-xs text-muted">매장 출고 대기 신청</p><p className="mt-3 font-mono text-3xl font-bold">{summary.collecting}</p></div>
          <div className="border border-line p-5"><PackageCheck size={17} /><p className="mt-7 text-xs text-muted">송장 등록 대기</p><p className="mt-3 font-mono text-3xl font-bold">{summary.packed}</p></div>
        </div>
      )}
      {view === "completed" && (
        <div className="border border-line bg-ink p-5 text-paper">
          <Truck size={17} />
          <p className="mt-7 text-xs text-zinc-400">송장 등록·발송 완료</p>
          <p className="mt-3 font-mono text-3xl font-bold">{summary.shipped}</p>
        </div>
      )}
      {view === "history" && (
        <div className="border border-line p-5">
          <CheckCircle2 size={17} />
          <p className="mt-7 text-xs text-muted">최근 30일 배송 완료 기록</p>
          <p className="mt-3 font-mono text-3xl font-bold">{completedDeliveries.length}</p>
        </div>
      )}

      {view === "requests" && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line pb-4">
          <span className="text-[10px] font-bold tracking-[.12em] text-muted">보관 만료</span>
          {STORAGE_EXPIRY_OPTIONS.map((option) => (
            <button
              className={`border px-3 py-2 text-[10px] font-bold ${expiryFilter === option.value ? "border-ink bg-ink text-paper" : "border-line"}`}
              key={option.value}
              onClick={() => setExpiryFilter(option.value)}
              type="button"
            >
              {option.label} · {expiryCounts[option.value]}
            </button>
          ))}
          <select
            aria-label="배송 요청 정렬 순서"
            className="ml-auto h-9 border border-line bg-paper px-2 text-xs"
            onChange={(event) => setSortOrder(event.target.value as ShipmentSortOrder)}
            value={sortOrder}
          >
            <option value="recent">최근 요청순</option>
            <option value="expiry">보관 만료 임박순</option>
          </select>
        </div>
      )}

      {view !== "history" && (
        <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
          <p className="text-xs font-bold">{view === "requests" ? "처리가 필요한 택배 요청만 표시합니다." : "발송 완료된 택배와 송장 정보만 표시합니다."}</p>
          <p className="text-xs text-muted">현재 페이지 {view === "requests" ? visibleActiveShipments.length : shippedShipments.length}건</p>
        </div>
      )}

      {view !== "history" && <div className="border border-line">
        {shipmentSections.map((section) => (
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
          const gate = dispatchGate(shipment);
          const addressReveal = addressReveals[shipment.id];
          const daysLeft = shipmentDaysLeft(shipment);
          const showStorageUrgency = daysLeft !== null && shipment.status !== "shipped";
          return (
            <article className={`border-b border-line px-4 py-5 last:border-b-0 sm:px-5 ${showStorageUrgency ? storageUrgencySurfaceClass(daysLeft) : ""}`} key={shipment.id}>
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2"><span className="border border-line px-2 py-1 text-[10px] font-bold">{statusLabel(shipment.status)}</span><span className="border border-line px-2 py-1 text-[10px] font-bold">배송비 {statusLabel(shipment.shippingFeeStatus)}</span>{showStorageUrgency && (<span className={`border px-2 py-1 text-[10px] font-black ${storageUrgencyClass(daysLeft)}`} title={`보관 만료 ${formatAt(shipment.storageExpiresAt)}`}>{formatStorageDday(daysLeft)} · {storageClassLabel(shipment.storageDurationDays)}{daysLeft < 0 ? " · 만료 지남" : ""}</span>)}</div>
                  <p className="mt-3 text-sm font-bold">{shipment.memberName}</p>
                  <p className="mt-1 break-all font-mono text-[10px] text-muted">구매자 {shipment.memberId}</p>
                  <p className="mt-1 break-all font-mono text-[10px] text-muted">배송 {shipment.id} · 요청 {formatAt(shipment.requestedAt)}{showStorageUrgency ? ` · 보관 만료 ${formatAt(shipment.storageExpiresAt)}` : ""} · 버전 {shipment.version}</p>
                </div>
                <div className="text-xs text-muted">상품 {shipment.activeItemCount}/{shipment.itemCount} · 출고 완료 {shipment.releasedItemCount} · 매장 출고 대기 {shipment.unreleasedItemCount}</div>
              </div>

              <div className="mt-5 border-t border-line pt-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-bold">배송지 {addressReveal ? "(원문 임시 열람)" : "(마스킹)"}</p>
                  {addressReveal && (
                    <button className="text-[10px] font-bold underline" onClick={() => setAddressReveals((current) => {
                      const next = { ...current };
                      delete next[shipment.id];
                      return next;
                    })} type="button">원문 닫기</button>
                  )}
                </div>
                {addressReveal ? (
                  <>
                    <p className="mt-2 text-xs leading-5">{addressReveal.address.recipientName} · {addressReveal.address.phone}</p>
                    <p className="text-xs leading-5 text-muted">
                      {addressReveal.address.postalCode ? `[${addressReveal.address.postalCode}] ` : ""}
                      {addressReveal.address.address}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-xs leading-5">{shipment.addressSnapshot.recipientName} · {shipment.addressSnapshot.phone}</p>
                    <p className="text-xs leading-5 text-muted">
                      {shipment.addressSnapshot.postalCode ? `[${shipment.addressSnapshot.postalCode}] ` : ""}
                      {shipment.addressSnapshot.address}
                    </p>
                  </>
                )}
                {!addressReveal && (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      className="min-w-0 flex-1 border border-line bg-white px-3 py-2 text-xs"
                      maxLength={500}
                      onChange={(event) => setAddressReasons((current) => ({ ...current, [shipment.id]: event.target.value }))}
                      placeholder="열람 사유 (예: 송장 출력)"
                      type="text"
                      value={addressReasons[shipment.id] ?? ""}
                    />
                    <button
                      className="border border-ink px-3 py-2 text-xs font-bold disabled:opacity-40"
                      disabled={busyKey !== null || (addressReasons[shipment.id] ?? "").trim().length < 3}
                      onClick={() => void revealAddress(shipment)}
                      type="button"
                    >{busyKey === `address:${shipment.id}` ? "열람 중" : "원문 5분 열람"}</button>
                  </div>
                )}
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

              {shipment.status !== "shipped" && (
                <div className="mt-5 border-t border-line pt-4">
                  {!gate.ready && <p className="mb-3 text-xs text-amber-700">{gate.reason}</p>}
                  <button className="h-11 bg-ink px-4 text-xs font-bold text-paper disabled:opacity-40" disabled={!gate.ready || busyKey !== null} onClick={() => openTrackingModal(shipment)} type="button">원스톱 패킹 &amp; 송장 입력</button>
                </div>
              )}

              {shipment.status === "shipped" && (
                <div className="mt-5 border-t border-line pt-4">
                  <p className="flex items-center gap-2 text-xs font-bold">
                    <CheckCircle2 size={14} /> 발송 완료 · 송장 1개 · {formatAt(shipment.shippedAt)}
                  </p>
                  <button className="mt-3 h-10 border border-ink px-4 text-xs font-bold disabled:opacity-40" disabled={busyKey !== null} onClick={() => openTrackingModal(shipment)} type="button">송장 수정</button>
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
                {view === "requests" && expiryFilter !== "all"
                  ? "선택한 보관 만료 조건에 맞는 배송이 없습니다."
                  : `표시할 ${section.key === "active" ? "처리 중 배송" : "발송 완료 내역"}이 없습니다.`}
              </p>
            )}
          </section>
        ))}
      </div>}

      {view === "history" && <section className="border border-line">
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
      </section>}

      {view !== "history" && <div className="flex items-center justify-between gap-4">
        <button className="border border-line px-4 py-2 text-xs font-bold disabled:opacity-40" disabled={offset === 0} onClick={() => changePage(Math.max(0, offset - PAGE_SIZE))} type="button">이전</button>
        <p className="font-mono text-[11px] text-muted">{offset + 1}–{offset + shipments.length}</p>
        <button className="border border-line px-4 py-2 text-xs font-bold disabled:opacity-40" disabled={shipments.length < PAGE_SIZE} onClick={() => changePage(offset + PAGE_SIZE)} type="button">다음</button>
      </div>}

      {trackingModalShipment && (
        <div aria-modal="true" className="fixed inset-0 z-[120] grid place-items-center bg-black/55 p-4" role="dialog">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto border border-line bg-paper p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div>
                <p className="eyebrow text-muted">배송 관리</p>
                <h2 className="mt-1 text-lg font-black">{trackingModalShipment.status === "shipped" ? "송장 수정" : "원스톱 패킹 & 송장 입력"}</h2>
              </div>
              <button aria-label="송장 모달 닫기" className="grid size-11 place-items-center" onClick={() => setTrackingModalShipment(null)} type="button"><X size={17} /></button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <section className="border border-line p-4 text-xs leading-5">
                <p className="font-black">구매자 및 배송지</p>
                <p className="mt-2">{trackingModalShipment.memberName}</p>
                <p className="text-muted">{trackingModalShipment.addressSnapshot.recipientName} · {trackingModalShipment.addressSnapshot.phone}</p>
                <p className="text-muted">{trackingModalShipment.addressSnapshot.postalCode ? `[${trackingModalShipment.addressSnapshot.postalCode}] ` : ""}{trackingModalShipment.addressSnapshot.address}</p>
              </section>
              <section className="border border-line p-4">
                <p className="text-xs font-black">합포장 상품 {activeItems(trackingModalShipment).length}개</p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {activeItems(trackingModalShipment).map((item) => (
                    <div className="min-w-0" key={item.inventoryItemId}>
                      <div className="aspect-square bg-surface">{item.imageUrl ? <CatalogImage alt="" className="h-full w-full object-cover" sizes="96px" src={item.imageUrl} /> : null}</div>
                      <p className="mt-1 truncate text-[10px] font-bold">{item.title}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
            <div className="mt-5 space-y-3">
              <select aria-label="택배사" className="h-11 w-full border border-line bg-paper px-3 text-xs" onChange={(event) => updateForm(trackingModalShipment.id, "courier", event.target.value)} value={forms[trackingModalShipment.id]?.courier ?? "CJ대한통운"}>
                {COURIER_PRESETS.map((courier) => <option key={courier} value={courier}>{courier}</option>)}
              </select>
              {forms[trackingModalShipment.id]?.courier === "기타 / 직접입력" && <input aria-label="택배사 직접입력" className="h-11 w-full border border-line px-3 text-xs" maxLength={80} onChange={(event) => updateForm(trackingModalShipment.id, "customCourier", event.target.value)} placeholder="택배사 이름" value={forms[trackingModalShipment.id]?.customCourier ?? ""} />}
              <input aria-label="송장번호" className="h-11 w-full border border-line px-3 font-mono text-xs" onChange={(event) => updateForm(trackingModalShipment.id, "trackingNumber", event.target.value)} placeholder="운송장 번호 입력" value={forms[trackingModalShipment.id]?.trackingNumber ?? ""} />
              {trackingModalShipment.status === "shipped" && <input aria-label="송장 정정 사유" className="h-11 w-full border border-line px-3 text-xs" maxLength={500} onChange={(event) => updateForm(trackingModalShipment.id, "note", event.target.value)} placeholder="정정 사유" value={forms[trackingModalShipment.id]?.note ?? ""} />}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button className="min-h-11 w-full bg-ink px-3 text-xs font-bold text-paper disabled:opacity-40" disabled={busyKey !== null} onClick={async () => { const action = trackingModalShipment.status === "shipped" ? "tracking_update" : "complete"; await mutateShipment(trackingModalShipment, action); setTrackingModalShipment(null); }} type="button">{trackingModalShipment.status === "shipped" ? "송장 정보 수정" : "🚚 송장 등록 및 즉시 출고 완료"}</button>
                {trackingModalShipment.status === "shipped" && <button className="min-h-11 w-full border border-red-500 text-xs font-bold text-red-700 disabled:opacity-40" disabled={busyKey !== null} onClick={async () => { await mutateShipment(trackingModalShipment, "tracking_delete"); setTrackingModalShipment(null); }} type="button">송장 삭제</button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
