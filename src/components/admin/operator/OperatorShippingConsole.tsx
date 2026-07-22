"use client";

import { Download, PackageCheck, RefreshCw, Truck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface ShipmentItem {
  orderId: string;
  orderItemId: string;
  productId: string;
  title: string;
  stage: string;
  locationKind: string;
  storageLocationCode: string | null;
  isBlocked: boolean;
  blockReason: string | null;
  fulfillmentVersion: number;
}
interface ShipmentRow {
  shipment_id: string;
  shipping_request_id: string;
  member_id: string;
  order_ids: string[];
  address_snapshot: Record<string, unknown>;
  status: "requested" | "packed" | "shipped" | "cancelled" | "reconciliation_required";
  readiness_status: string;
  block_reason: string | null;
  settlement_method: string;
  version: number;
  item_count: number;
  center_stored_count: number;
  packed_item_count: number;
  courier: string | null;
  tracking_number: string | null;
  requested_at: string;
  packed_at: string | null;
  shipped_at: string | null;
  items: ShipmentItem[];
}
type ShippingForm = { courier: string; tracking: string };
type ShipmentAction = "pack" | "ship";

function csv(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function readinessLabel(status: string) {
  return {
    ready_to_pack: "포장 가능",
    ready_to_ship: "출고 가능",
    awaiting_payment: "결제 확인 대기",
    awaiting_center: "중앙 보관 도착 대기",
    reconciliation_required: "정합성 확인 필요",
    cancelled: "취소됨",
    shipped: "출고 완료",
  }[status] ?? status;
}

function blockReasonLabel(reason: string | null) {
  if (!reason) return null;
  return {
    order_payment_not_confirmed: "주문 또는 배송비 결제가 확정되지 않았습니다.",
    shipping_credit_not_settled: "배송 크레딧 정산을 확인할 수 없습니다.",
    shipping_fee_not_confirmed: "배송비 입금을 확인할 수 없습니다.",
    shipping_fee_ledger_mismatch: "배송비 입금 원장을 확인해 주세요.",
    store_work_not_center_complete: "모든 상품의 중앙 보관 도착을 기다리고 있습니다.",
    all_items_not_stored_at_center: "모든 상품의 중앙 보관 위치를 확인해 주세요.",
    packed_manifest_changed: "포장된 상품 구성이 변경되었습니다.",
    fulfillment_center_not_active: "활성 중앙 출고지를 확인해 주세요.",
    manifest_missing: "배송 주문 구성 정보를 확인할 수 없습니다.",
    manifest_mismatch: "배송 주문 구성 정보가 일치하지 않습니다.",
    shipment_not_packed: "포장 완료 후 출고할 수 있습니다.",
    shipment_not_requestable: "현재 배송 상태에서는 포장할 수 없습니다.",
  }[reason] ?? reason;
}

function addressValue(address: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = address[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "-";
}

export function OperatorShippingConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [includeShipped, setIncludeShipped] = useState(false);
  const [filter, setFilter] = useState("all");
  const [notice, setNotice] = useState("");
  const [forms, setForms] = useState<Record<string, ShippingForm>>({});
  const [busy, setBusy] = useState(false);
  const commandKeys = useRef(new Map<string, string>());

  const load = useCallback(
    async (accessToken: string | null, shipped = includeShipped) => {
      if (!accessToken) return;
      const response = await fetch(
        `/api/admin/operator/shipping?includeShipped=${shipped}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as {
        requests?: ShipmentRow[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "배송 목록을 불러오지 못했습니다.");
      }
      setShipments(payload.requests ?? []);
    },
    [includeShipped],
  );

  useEffect(() => {
    void (async () => {
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession()).data
          .session;
        setToken(session?.access_token ?? null);
        if (session) await load(session.access_token, false);
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : "배송 목록을 불러오지 못했습니다.",
        );
      }
    })();
  }, [load]);

  const visible = useMemo(
    () => shipments.filter((shipment) => filter === "all" || shipment.status === filter),
    [filter, shipments],
  );
  const updateForm = (
    shipmentId: string,
    key: keyof ShippingForm,
    value: string,
  ) => {
    setForms((current) => ({
      ...current,
      [shipmentId]: {
        ...(current[shipmentId] ?? { courier: "", tracking: "" }),
        [key]: value,
      },
    }));
  };
  const mutateShipment = async (shipment: ShipmentRow, action: ShipmentAction) => {
    if (!token || busy) return;
    const form = forms[shipment.shipment_id];
    if (
      action === "ship" &&
      (!form?.courier.trim() || !form.tracking.trim())
    ) {
      setNotice("택배사와 운송장 번호를 입력해 주세요.");
      return;
    }
    const commandScope = `${shipment.shipment_id}:${action}:${shipment.version}`;
    const idempotencyKey =
      commandKeys.current.get(commandScope) ?? crypto.randomUUID();
    commandKeys.current.set(commandScope, idempotencyKey);
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/operator/shipping", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action,
          shipmentId: shipment.shipment_id,
          expectedVersion: shipment.version,
          idempotencyKey,
          ...(action === "ship"
            ? {
                courier: form?.courier.trim(),
                trackingNumber: form?.tracking.trim(),
              }
            : {}),
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.message ?? payload.error ?? "배송 상태를 변경하지 못했습니다.",
        );
      }
      commandKeys.current.delete(commandScope);
      setNotice(action === "pack" ? "합포장을 완료했습니다." : "배송 송장을 저장했습니다.");
      await load(token, includeShipped);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "배송 상태를 변경하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    const rows = [
      "shipment_id,shipping_request_id,order_ids,member_id,item_count,status,readiness,block_reason,courier,tracking_number,recipient,phone,address,item_ids",
      ...visible.map((shipment) => {
        const address = shipment.address_snapshot ?? {};
        return [
          shipment.shipment_id,
          shipment.shipping_request_id,
          shipment.order_ids.join("|"),
          shipment.member_id,
          shipment.item_count,
          shipment.status,
          shipment.readiness_status,
          shipment.block_reason,
          shipment.courier,
          shipment.tracking_number,
          addressValue(address, ["recipientName", "recipient_name"]),
          addressValue(address, ["phone"]),
          addressValue(address, ["address"]),
          shipment.items.map((item) => item.orderItemId).join("|"),
        ]
          .map(csv)
          .join(",");
      }),
    ];
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${rows.join("\n")}`], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ninety-nine-shipping.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const requested = shipments.filter((shipment) => shipment.status === "requested");
  const packed = shipments.filter((shipment) => shipment.status === "packed");
  const shipped = shipments.filter((shipment) => shipment.status === "shipped");
  return (
    <div className="space-y-8">
      <div className="flex flex-col items-stretch justify-between gap-5 border-b border-ink pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow text-muted">운영자 / 배송 업무</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-.06em] sm:text-4xl sm:tracking-[-.08em]">
            배송 업무
          </h1>
          <p className="mt-3 text-sm text-muted">
            주문 전체 배송의 준비 상태를 확인한 뒤 포장과 출고를 처리합니다.
          </p>
        </div>
        <button
          className="flex items-center justify-center gap-2 border border-line px-4 py-3 text-xs font-bold"
          onClick={() =>
            void load(token).catch((error) =>
              setNotice(error instanceof Error ? error.message : "새로고침에 실패했습니다."),
            )
          }
          type="button"
        >
          <RefreshCw size={13} /> 새로고침
        </button>
      </div>
      {notice && (
        <div aria-live="polite" className="border border-line bg-surface px-4 py-3 text-xs">
          {notice}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="border border-line p-5">
          <p className="text-xs text-muted">포장 대기</p>
          <p className="mt-3 font-mono text-3xl font-bold">{requested.length}</p>
        </div>
        <div className="border border-line p-5">
          <PackageCheck size={17} />
          <p className="mt-7 text-xs text-muted">출고 대기</p>
          <p className="mt-3 font-mono text-3xl font-bold">{packed.length}</p>
        </div>
        <div className="border border-line bg-ink p-5 text-paper">
          <Truck size={17} />
          <p className="mt-7 text-xs text-zinc-400">발송 완료</p>
          <p className="mt-3 font-mono text-3xl font-bold">{shipped.length}</p>
        </div>
      </div>
      <div className="flex flex-col items-start justify-between gap-4 border-b border-line pb-4 sm:flex-row sm:items-center">
        <div className="flex gap-3 text-xs">
          <button className={filter === "all" ? "border-b-2 border-ink pb-2 font-bold" : "pb-2 text-muted"} onClick={() => setFilter("all")} type="button">전체 {shipments.length}</button>
          <button className={filter === "requested" ? "border-b-2 border-ink pb-2 font-bold" : "pb-2 text-muted"} onClick={() => setFilter("requested")} type="button">포장 대기 {requested.length}</button>
          <button className={filter === "packed" ? "border-b-2 border-ink pb-2 font-bold" : "pb-2 text-muted"} onClick={() => setFilter("packed")} type="button">출고 대기 {packed.length}</button>
          <button className={filter === "shipped" ? "border-b-2 border-ink pb-2 font-bold" : "pb-2 text-muted"} onClick={() => setFilter("shipped")} type="button">완료 {shipped.length}</button>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:justify-end sm:gap-4">
          <label className="flex items-center gap-2 text-xs"><input checked={includeShipped} onChange={(event) => { setIncludeShipped(event.target.checked); void load(token, event.target.checked); }} type="checkbox" /> 발송 완료 포함</label>
          <button className="flex items-center gap-2 border border-ink px-3 py-2 text-[10px] font-bold" onClick={download} type="button"><Download size={13} /> CSV 다운로드</button>
        </div>
      </div>
      <div className="border border-line">
        {visible.map((shipment) => {
          const address = shipment.address_snapshot ?? {};
          const canPack = shipment.status === "requested" && shipment.readiness_status === "ready_to_pack";
          const canShip = shipment.status === "packed" && shipment.readiness_status === "ready_to_ship";
          return (
            <article className="border-b border-line px-3 py-5 last:border-b-0 sm:px-5" key={shipment.shipment_id}>
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:gap-6">
                <div className="min-w-0">
                  <p className="break-all text-sm font-bold">배송 {shipment.shipment_id} · 주문 {shipment.order_ids.length}건 · {shipment.item_count}개 상품</p>
                  <p className="mt-1 break-all text-xs text-muted">회원 {shipment.member_id} · 요청 {new Date(shipment.requested_at).toLocaleString("ko-KR")} · 버전 {shipment.version}</p>
                  <p className="mt-3 break-words text-xs leading-5">{addressValue(address, ["recipientName", "recipient_name"])} · {addressValue(address, ["phone"])}<br />{addressValue(address, ["address"])}</p>
                  <p className="mt-2 break-all font-mono text-[10px] text-muted">주문 {shipment.order_ids.join(", ")}</p>
                </div>
                <span className="shrink-0 border border-line px-2 py-1 text-[10px] font-bold">{shipment.status}</span>
              </div>
              <div className="mt-4 border-t border-line pt-4 text-xs">
                <p><span className="text-muted">준비 상태</span> · {readinessLabel(shipment.readiness_status)} ({shipment.center_stored_count}/{shipment.item_count} 중앙 보관 · {shipment.packed_item_count}/{shipment.item_count} 포장)</p>
                {shipment.block_reason && <p className="mt-2 text-amber-700">차단 사유 · {blockReasonLabel(shipment.block_reason)}</p>}
                <p className="mt-2 text-muted">상품 {shipment.items.map((item) => item.title || item.productId).join(", ")}</p>
              </div>
              {canPack && (
                <div className="mt-5 border-t border-line pt-4">
                  <button className="h-10 bg-ink px-4 text-xs font-bold text-paper disabled:opacity-40" disabled={busy} onClick={() => void mutateShipment(shipment, "pack")} type="button">합포장 완료</button>
                </div>
              )}
              {canShip && (
                <div className="mt-5 grid grid-cols-1 gap-2 border-t border-line pt-4 sm:grid-cols-[minmax(0,160px)_minmax(0,220px)_auto]">
                  <input aria-label={`${shipment.shipment_id} 택배사`} className="h-10 w-full border border-line px-3 text-xs" onChange={(event) => updateForm(shipment.shipment_id, "courier", event.target.value)} placeholder="택배사" value={forms[shipment.shipment_id]?.courier ?? ""} />
                  <input aria-label={`${shipment.shipment_id} 운송장`} className="h-10 w-full border border-line px-3 text-xs" onChange={(event) => updateForm(shipment.shipment_id, "tracking", event.target.value)} placeholder="운송장 번호" value={forms[shipment.shipment_id]?.tracking ?? ""} />
                  <button className="h-10 bg-ink px-4 text-xs font-bold text-paper disabled:opacity-40" disabled={busy} onClick={() => void mutateShipment(shipment, "ship")} type="button">발송 완료 저장</button>
                </div>
              )}
              {shipment.status === "shipped" && <p className="mt-4 break-words border-t border-line pt-4 text-xs text-muted">{shipment.courier} · {shipment.tracking_number} · {shipment.shipped_at ? new Date(shipment.shipped_at).toLocaleString("ko-KR") : "발송일 미기록"}</p>}
            </article>
          );
        })}
        {visible.length === 0 && <p className="py-16 text-center text-sm text-muted">배송 요청이 없습니다.</p>}
      </div>
    </div>
  );
}
