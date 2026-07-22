"use client";

import Link from "next/link";
import {
  Heart,
  LogIn,
  PackageCheck,
  ReceiptText,
  Truck,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

interface ProductSummary {
  id: string;
  title: string;
  image_urls?: string[];
  imageUrls?: string[];
  storage_class?: string;
  storageClass?: string;
}
interface InventoryItem {
  id: string;
  productId: string;
  title: string;
  imageUrl: string;
  sourceKind: string;
  sourceReference: string;
  originStoreId: string | null;
  originStoreName: string | null;
  ownershipStatus: string;
  physicalStatus: string;
  locationKind: string;
  rolloutEnabled: boolean;
  itemSelectedShipmentsEnabled: boolean;
  requestEligible: boolean;
  requestBlockReason: string | null;
  storageStartedAt: string | null;
  storageExpiresAt: string | null;
  activeShipmentId: string | null;
  exceptionKind: string | null;
  exceptionStatus: string | null;
  exceptionResolution: string | null;
  exceptionPublicReason: string | null;
}
interface StoragePayload {
  items?: InventoryItem[];
  legacyAuctionWins?: LegacyAuctionWin[];
  rolloutEnabled?: boolean;
  serverTime?: string;
}
interface LegacyAuctionWin {
  product_id: string;
  title: string;
  image_urls: string[];
  shipping_status: string;
}
interface LegacyCommerceOrderItem {
  id: string;
  product_id: string;
  unit_price: number;
  payment_status: string;
  paid_at: string | null;
  storage_expires_at: string | null;
  products?: ProductSummary | null;
}
interface LegacyCommerceOrder {
  id: string;
  status: string;
  commerce_order_items?: LegacyCommerceOrderItem[];
}
interface LegacyEligibleOrder {
  id: string;
  items: LegacyCommerceOrderItem[];
  storageExpiresAt: string;
}
interface ShipmentPayment {
  id?: string;
  expected_amount?: number;
  expectedAmount?: number;
  status?: string;
  bank_name_snapshot?: string;
  bankNameSnapshot?: string;
  account_number_snapshot?: string;
  accountNumberSnapshot?: string;
}
interface ShipmentResponse {
  shipment_id: string;
  shipping_request_id?: string;
  order_id?: string;
  readiness_status?: string;
  block_reason?: string | null;
  status: string;
  settlement_method: "shipping_credit" | "manual_transfer" | "waiver";
  version: number;
  payment: ShipmentPayment | null | Record<string, unknown>;
  idempotent_replay: boolean;
}
interface InventoryShipmentItem {
  inventoryItemId: string | null;
  productId: string;
  title: string;
  imageUrl: string;
  lineStatus: string;
  physicalStatus: string;
}
interface InventoryShipment {
  id: string;
  sourceKind: "inventory_v2" | "canonical_commerce";
  sourceId: string;
  status: string;
  settlementMethod: string;
  shippingFeeStatus: string;
  itemCount: number;
  activeItemCount: number;
  courier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  requestedAt: string | null;
  packedAt: string | null;
  shippedAt: string | null;
  addressSnapshot: Record<string, unknown> | null;
  items: InventoryShipmentItem[];
}
interface ShipmentsPayload {
  shipments?: InventoryShipment[];
}
interface ItemManualRefund {
  id: string;
  refundKind: "item";
  inventoryItemId: string;
  productId: string;
  title: string;
  status: string;
  amount: number;
  accountSubmitted: boolean;
  accountExpiresAt?: string | null;
  approvedAt: string | null;
  completedAt: string | null;
  publicReason: string;
}
interface ShippingFeeManualRefund {
  id: string;
  refundKind: "shipping_fee";
  shipmentId: string;
  status: string;
  amount: number;
  accountSubmitted: boolean;
  accountExpiresAt?: string | null;
  createdAt: string;
}
type ManualRefund = ItemManualRefund | ShippingFeeManualRefund;
interface RefundAccountDraft {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}
interface Address {
  id: string;
  label: string;
  recipient_name: string;
  phone: string;
  postal_code: string | null;
  address: string;
  is_default: boolean;
}

const physicalStatusLabels: Record<string, string> = {
  entitled: "보관 준비 중",
  preparing: "매장 준비 중",
  in_transit_to_center: "중앙센터 이동 중",
  center_received: "중앙센터 입고 완료",
  center_stored: "중앙센터 보관 완료",
  packed: "포장 완료",
  shipped: "발송 완료",
  cancelled: "처리 취소",
  reconciliation_required: "위치 확인 필요",
  legacy_in_progress: "기존 배송 처리 중",
};

const shipmentStatusLabels: Record<string, string> = {
  requested: "요청 접수",
  collecting: "상품 집합 중",
  ready_to_pack: "포장 대기",
  packed: "포장 완료",
  shipped: "발송 완료",
  cancelled: "요청 취소",
  reconciliation_required: "정합성 확인 중",
};

const feeStatusLabels: Record<string, string> = {
  awaiting_transfer: "입금 대기 중",
  confirmed: "확정",
  cancelled: "취소",
};

const lineStatusLabels: Record<string, string> = {
  requested: "집합 대기",
  held: "상품 확인 중",
  ready: "출고 완료",
  excluded: "일시 보류",
  packed: "포장 완료",
  shipped: "발송 완료",
  cancelled: "취소",
};

function physicalStatusLabel(status: string) {
  return physicalStatusLabels[status] ?? status;
}

function shipmentIsLegacy(shipment: ShipmentResponse): shipment is ShipmentResponse & {
  shipping_request_id: string;
  order_id: string;
} {
  return typeof shipment.shipping_request_id === "string" &&
    typeof shipment.order_id === "string";
}

function refundKey(refund: ManualRefund) {
  return `${refund.refundKind}:${refund.id}`;
}

function refundTitle(refund: ManualRefund) {
  return refund.refundKind === "item" ? refund.title : "배송비 환불";
}

function AccountDashboardForSession({
  loading,
  session,
}: {
  loading: boolean;
  session: Session | null;
}) {
  const token = session?.access_token ?? null;
  const userName =
    session?.user.user_metadata?.name ??
    session?.user.user_metadata?.full_name ??
    "빈티지 피플";
  const [storage, setStorage] = useState<InventoryItem[]>([]);
  const [shipments, setShipments] = useState<InventoryShipment[]>([]);
  const [refunds, setRefunds] = useState<ManualRefund[]>([]);
  const [liked, setLiked] = useState<ProductSummary[]>([]);
  const [credits, setCredits] = useState(0);
  const [now, setNow] = useState(0);
  const [notice, setNotice] = useState("");
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [legacyAuctionWins, setLegacyAuctionWins] = useState<LegacyAuctionWin[]>([]);
  const [orders, setOrders] = useState<LegacyCommerceOrder[]>([]);
  const [selectedInventoryItemIds, setSelectedInventoryItemIds] = useState<string[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [addressForm, setAddressForm] = useState({
    label: "집",
    recipientName: "",
    phone: "",
    postalCode: "",
    address: "",
  });
  const [shippingMessage, setShippingMessage] = useState("");
  const [refundMessage, setRefundMessage] = useState("");
  const [refundBusyId, setRefundBusyId] = useState<string | null>(null);
  const [refundDrafts, setRefundDrafts] = useState<Record<string, RefundAccountDraft>>({});
  const [applyShippingCredit, setApplyShippingCredit] = useState(true);
  const [dataStatus, setDataStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >(token ? "loading" : "idle");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!token) {
        setDataStatus("idle");
        return;
      }
      setDataStatus("loading");
      setNotice("");
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const [
          storageResponse,
          shipmentResponse,
          refundResponse,
          creditResponse,
          wishlistResponse,
          addressResponse,
          ordersResponse,
        ] = await Promise.all([
          fetch("/api/account/storage", { headers, cache: "no-store" }),
          fetch("/api/account/shipments", { headers, cache: "no-store" }),
          fetch("/api/account/refunds", { headers, cache: "no-store" }),
          fetch("/api/shipping/credits", { headers, cache: "no-store" }),
          fetch("/api/wishlist", { headers, cache: "no-store" }),
          fetch("/api/account/addresses", { headers, cache: "no-store" }),
          fetch("/api/orders", { headers, cache: "no-store" }),
        ]);
        if (
          !storageResponse.ok ||
          !shipmentResponse.ok ||
          !refundResponse.ok ||
          !creditResponse.ok ||
          !wishlistResponse.ok ||
          !addressResponse.ok
        ) {
          throw new Error("account_data_unavailable");
        }
        const storageData = (await storageResponse.json()) as StoragePayload;
        if (!ordersResponse.ok) {
          throw new Error("legacy_orders_unavailable");
        }
        const shipmentData = (await shipmentResponse.json()) as ShipmentsPayload;
        const refundData = (await refundResponse.json()) as { refunds?: ManualRefund[] };
        const creditData = (await creditResponse.json()) as {
          credits?: number;
        };
        const wishlistData = (await wishlistResponse.json()) as {
          productIds?: string[];
        };
        const addressData = (await addressResponse.json()) as {
          addresses?: Address[];
        };
        const ordersData = ordersResponse.ok
          ? await ordersResponse.json() as { orders?: LegacyCommerceOrder[] }
          : { orders: [] };
        const ids = wishlistData.productIds ?? [];
        const [auctionResponse, fixedResponse] = await Promise.all([
          fetch("/api/products?saleType=auction&limit=100", {
            cache: "no-store",
          }),
          fetch("/api/products?saleType=fixed&limit=100", {
            cache: "no-store",
          }),
        ]);
        if (!auctionResponse.ok || !fixedResponse.ok) {
          throw new Error("catalog_data_unavailable");
        }
        const auctionData = (await auctionResponse.json()) as {
          products?: ProductSummary[];
        };
        const fixedData = (await fixedResponse.json()) as {
          products?: ProductSummary[];
        };
        const allProducts = [
          ...(auctionData.products ?? []),
          ...(fixedData.products ?? []),
        ];
        if (!cancelled) {
          setNow(Date.now());
          setStorage(storageData.items ?? []);
          setLegacyAuctionWins(storageData.legacyAuctionWins ?? []);
          setOrders(ordersData.orders ?? []);
          setSelectedInventoryItemIds([]);
          setSelectedOrderId("");
          setShipments(shipmentData.shipments ?? []);
          setRefunds(refundData.refunds ?? []);
          setCredits(Number(creditData.credits ?? 0));
          setApplyShippingCredit(Number(creditData.credits ?? 0) > 0);
          setLiked(allProducts.filter((product) => ids.includes(product.id)));
          setAddresses(addressData.addresses ?? []);
          setSelectedAddressId(
            addressData.addresses?.find((address) => address.is_default)?.id ??
              addressData.addresses?.[0]?.id ??
              "",
          );
          setDataStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setNotice(
            "계정 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
          );
          setDataStatus("error");
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const itemSelectedCommerceOrderItemIds = useMemo(
    () => new Set(
      storage
        .filter((item) => item.sourceKind === "commerce" && item.itemSelectedShipmentsEnabled)
        .map((item) => item.sourceReference),
    ),
    [storage],
  );
  const v2Storage = useMemo(
    () => storage.filter((item) => item.rolloutEnabled),
    [storage],
  );
  const legacyEligibleOrders = useMemo<LegacyEligibleOrder[]>(() => {
    if (now === 0) return [];
    return orders.flatMap((order) => {
      const items = order.commerce_order_items ?? [];
      const expirationTimes = items.map((item) =>
        item.storage_expires_at ? Date.parse(item.storage_expires_at) : Number.NaN
      );
      if (
        order.status !== "paid" ||
        items.length === 0 ||
        !items.every((item) => item.payment_status === "paid") ||
        items.some((item) => itemSelectedCommerceOrderItemIds.has(item.id)) ||
        expirationTimes.some((expiresAt) => !Number.isFinite(expiresAt) || expiresAt <= now)
      ) {
        return [];
      }
      return [{
        id: order.id,
        items,
        storageExpiresAt: new Date(Math.min(...expirationTimes)).toISOString(),
      }];
    });
  }, [itemSelectedCommerceOrderItemIds, now, orders]);
  const selectedLegacyOrder = legacyEligibleOrders.find((order) => order.id === selectedOrderId) ?? null;
  const legacyEligibleItemCount = legacyEligibleOrders.reduce(
    (count, order) => count + order.items.length,
    0,
  );
  const visibleStorageItemCount = v2Storage.length + legacyEligibleItemCount;
  const totalOwnedItemCount = visibleStorageItemCount + legacyAuctionWins.length;
  const cards = [
    [
      "결제 완료 보관",
      String(totalOwnedItemCount).padStart(2, "0"),
      "전환 단계별 통합·기존 상품",
      "#storage",
      ReceiptText,
    ],
    [
      "보관 중인 상품",
      String(visibleStorageItemCount).padStart(2, "0"),
      "합배송 가능한 상품",
      "#storage",
      PackageCheck,
    ],
    [
      "배송 내역",
      String(shipments.length).padStart(2, "0"),
      "요청·발송 현황",
      "#shipments",
      Truck,
    ],
    [
      "찜한 상품",
      String(liked.length).padStart(2, "0"),
      "다시 보고 싶은 아이템",
      "#likes",
      Heart,
    ],
  ] as const;
  const requestEligibleItems = useMemo(
    () => v2Storage.filter((item) => item.requestEligible && !item.activeShipmentId),
    [v2Storage],
  );
  const selectedInventoryItems = useMemo(
    () => v2Storage.filter((item) => selectedInventoryItemIds.includes(item.id)),
    [selectedInventoryItemIds, v2Storage],
  );
  const selectedShippingMode = selectedInventoryItems.length > 0
    ? "v2"
    : selectedLegacyOrder
      ? "legacy"
      : null;
  const allRequestEligibleSelected = requestEligibleItems.length > 0 &&
    requestEligibleItems.every((item) => selectedInventoryItemIds.includes(item.id));
  const saveAddress = async () => {
    if (!token) return;
    const response = await fetch("/api/account/addresses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...addressForm,
        isDefault: addresses.length === 0,
      }),
    });
    const payload = (await response.json()) as {
      address?: Address;
      error?: string;
    };
    if (!response.ok || !payload.address) {
      setShippingMessage(payload.error ?? "배송지를 저장하지 못했습니다.");
      return;
    }
    setAddresses((current) => [...current, payload.address as Address]);
    setSelectedAddressId(payload.address.id);
    setAddressForm({
      label: "집",
      recipientName: "",
      phone: "",
      postalCode: "",
      address: "",
    });
    setShippingMessage("배송지를 저장했습니다.");
  };
  const shippingRequestKeys = useRef(new Map<string, string>());
  const refundAccountKeys = useRef(new Map<string, string>());
  if (loading || (token && dataStatus === "loading")) {
    return (
      <div
        className="grid min-h-[50vh] place-items-center border border-dashed border-line bg-surface px-6 text-center"
        role="status"
      >
        <div>
          <p className="text-sm font-bold">계정 정보를 불러오는 중입니다.</p>
          <p className="mt-2 text-xs text-muted">
            로그인 세션과 장바구니·배송 정보를 확인하고 있습니다.
          </p>
        </div>
      </div>
    );
  }
  if (token && dataStatus === "error") {
    return (
      <div className="grid min-h-[50vh] place-items-center border border-red-200 bg-red-50 px-6 text-center">
        <div>
          <p className="text-sm font-bold text-red-800">
            계정 정보를 표시하지 못했습니다.
          </p>
          <p className="mt-2 text-xs text-red-700">{notice}</p>
          <button
            className="mt-5 border border-red-800 px-4 py-2 text-xs font-bold text-red-800"
            onClick={() => window.location.reload()}
            type="button"
          >
            다시 불러오기
          </button>
        </div>
      </div>
    );
  }
  const requestShipping = async () => {
    if (
      !token ||
      !selectedAddressId ||
      !selectedShippingMode
    ) {
      setShippingMessage(
        "배송 신청 상품 또는 기존 주문과 배송지를 선택해 주세요.",
      );
      return;
    }
    const useV2 = selectedShippingMode === "v2";
    const selectedIds = [...selectedInventoryItemIds].sort();
    const selectedSubject = useV2
      ? selectedIds.join(",")
      : selectedLegacyOrder?.id ?? "";
    const idempotencyScope = `${useV2 ? "v2" : "legacy"}:${selectedSubject}:${selectedAddressId}:${applyShippingCredit ? "shipping_credit" : "manual_transfer"}`;
    const idempotencyKey =
      shippingRequestKeys.current.get(idempotencyScope) ?? crypto.randomUUID();
    shippingRequestKeys.current.set(idempotencyScope, idempotencyKey);
    const response = await fetch("/api/shipping/requests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(useV2
        ? {
            inventoryItemIds: selectedIds,
            addressId: selectedAddressId,
            applyShippingCredit,
            idempotencyKey,
          }
        : {
            orderId: selectedLegacyOrder?.id,
            addressId: selectedAddressId,
            applyShippingCredit,
            idempotencyKey,
          }),
    });
    const payload = (await response.json()) as {
      error?: string;
      message?: string;
      shipment?: ShipmentResponse;
    };
    if (!response.ok || !payload.shipment) {
      setShippingMessage(
        payload.message ?? payload.error ?? "배송 요청을 만들지 못했습니다.",
      );
      return;
    }
    if (
      !useV2 &&
      (!shipmentIsLegacy(payload.shipment) || payload.shipment.order_id !== selectedLegacyOrder?.id)
    ) {
      setShippingMessage("배송 요청 결과의 주문 정보를 확인하지 못했습니다.");
      return;
    }
    shippingRequestKeys.current.delete(idempotencyScope);
    const shipment = payload.shipment;
    if (useV2) {
      setStorage((current) => current.map((item) => selectedIds.includes(item.id)
        ? { ...item, activeShipmentId: shipment.shipment_id, requestEligible: false, requestBlockReason: "배송 요청 처리 중" }
        : item));
      setSelectedInventoryItemIds([]);
    } else {
      setOrders((current) => current.filter((order) => order.id !== selectedLegacyOrder?.id));
      setSelectedOrderId("");
    }
    const requestedItems: InventoryShipmentItem[] = useV2
      ? selectedInventoryItems.map((item) => ({
          inventoryItemId: item.id,
          productId: item.productId,
          title: item.title,
          imageUrl: item.imageUrl,
          lineStatus: "requested",
          physicalStatus: item.physicalStatus,
        }))
      : (selectedLegacyOrder?.items ?? []).map((item) => ({
          inventoryItemId: null,
          productId: item.product_id,
          title: item.products?.title ?? item.product_id,
          imageUrl: item.products?.image_urls?.[0] ?? "",
          lineStatus: "requested",
          physicalStatus: "legacy_in_progress",
        }));
    setShipments((current) => [{
      id: shipment.shipment_id,
      sourceKind: useV2 ? "inventory_v2" : "canonical_commerce",
      sourceId: shipment.shipment_id,
      status: shipment.status,
      settlementMethod: shipment.settlement_method,
      shippingFeeStatus: shipment.payment ? "awaiting_transfer" : "confirmed",
      itemCount: requestedItems.length,
      activeItemCount: requestedItems.length,
      courier: null,
      trackingNumber: null,
      trackingUrl: null,
      requestedAt: new Date().toISOString(),
      packedAt: null,
      shippedAt: null,
      addressSnapshot: null,
      items: requestedItems,
    }, ...current.filter((currentShipment) => currentShipment.id !== shipment.shipment_id)]);
    if (shipment.settlement_method === "shipping_credit") {
      setCredits((current) => Math.max(0, current - 1));
      setApplyShippingCredit(credits > 1);
    }
    const payment = shipment.payment as ShipmentPayment | null;
    const expectedAmount = payment?.expectedAmount ?? payment?.expected_amount;
    const bankName = payment?.bankNameSnapshot ?? payment?.bank_name_snapshot;
    const accountNumber = payment?.accountNumberSnapshot ?? payment?.account_number_snapshot;
    setShippingMessage(
      payment && typeof expectedAmount === "number" && Number.isSafeInteger(expectedAmount) && bankName && accountNumber
        ? `배송 신청${shipment.shipping_request_id ? ` ${shipment.shipping_request_id}` : ""}을 접수했습니다. ${expectedAmount.toLocaleString("ko-KR")}원 · ${bankName} ${accountNumber}로 입금해 주세요.`
        : shipment.settlement_method === "waiver"
          ? "배송 신청을 접수했습니다. 보유한 무료 배송 권한이 자동 적용되었습니다."
          : shipment.settlement_method === "shipping_credit"
            ? "배송 신청을 접수했습니다. 배송 크레딧이 적용되었습니다."
            : "배송 신청을 접수했습니다. 배송비 결제 상태를 확인해 주세요.",
    );
  };
  const updateRefundDraft = (
    refundId: string,
    field: keyof RefundAccountDraft,
    value: string,
  ) => {
    setRefundDrafts((current) => ({
      ...current,
      [refundId]: {
        ...(current[refundId] ?? {
          bankName: "",
          accountNumber: "",
          accountHolder: "",
        }),
        [field]: value,
      },
    }));
  };
  const submitRefundAccount = async (refund: ManualRefund) => {
    if (!token || refundBusyId) return;
    const subjectKey = refundKey(refund);
    const draft = refundDrafts[subjectKey];
    if (
      !draft?.bankName.trim() ||
      !draft.accountNumber.trim() ||
      !draft.accountHolder.trim()
    ) {
      setRefundMessage("은행, 계좌번호, 예금주를 모두 입력해 주세요.");
      return;
    }
    const scope = `${subjectKey}:${refund.status}:${refund.accountSubmitted ? refund.accountExpiresAt ?? "submitted" : "new"}`;
    const idempotencyKey = refundAccountKeys.current.get(scope) ?? crypto.randomUUID();
    refundAccountKeys.current.set(scope, idempotencyKey);
    setRefundBusyId(subjectKey);
    setRefundMessage("");
    try {
      const response = await fetch(`/api/account/refunds/${refund.id}/account`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...draft, refundKind: refund.refundKind, idempotencyKey }),
      });
      const payload = await response.json() as {
        refund?: {
          id: string;
          refundKind: "item" | "shipping_fee";
          status: string;
          accountExpiresAt: string;
          accountSubmitted: boolean;
        };
        error?: string;
        message?: string;
      };
      if (!response.ok || !payload.refund || payload.refund.id !== refund.id || payload.refund.refundKind !== refund.refundKind) {
        throw new Error(payload.message ?? "환불 계좌를 등록하지 못했습니다.");
      }
      refundAccountKeys.current.delete(scope);
      setRefunds((current) => current.map((item) => item.id === refund.id && item.refundKind === refund.refundKind
        ? {
            ...item,
            accountSubmitted: payload.refund?.accountSubmitted === true,
            accountExpiresAt: payload.refund?.accountExpiresAt ?? null,
          }
        : item));
      setRefundDrafts((current) => {
        const next = { ...current };
        delete next[subjectKey];
        return next;
      });
      setRefundMessage("환불 계좌를 안전하게 등록했습니다. 운영자의 실제 송금 확인을 기다려 주세요.");
    } catch (error) {
      setRefundMessage(error instanceof Error ? error.message : "환불 계좌를 등록하지 못했습니다.");
    } finally {
      setRefundBusyId(null);
    }
  };
  return (
    <div className="space-y-10 md:space-y-14">
      <div className="flex flex-col justify-between gap-5 border-b border-ink pb-8 md:flex-row md:items-end">
        <div className="min-w-0">
          <p className="eyebrow text-muted">내 계정 / 이용 현황</p>
          <h1 className="mt-3 break-keep text-3xl font-black tracking-[-0.08em] md:text-4xl">
            안녕하세요, {userName}.
          </h1>
          <p className="mt-3 text-sm text-muted">
            나의 경매와 보관, 배송을 한 곳에서 관리하세요.
          </p>
        </div>
        {token ? (
          <span className="flex w-fit items-center gap-2 border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
            <UserRound size={15} /> 로그인 상태
          </span>
        ) : loading ? (
          <span
            aria-label="로그인 상태 확인 중"
            className="inline-flex h-10 w-[130px] border border-line"
            role="status"
          />
        ) : (
          <Link
            className="inline-flex w-fit items-center gap-2 border border-line px-4 py-3 text-xs font-bold"
            href="/account/login?next=%2Faccount"
          >
            <LogIn size={15} /> 카카오로 로그인하기
          </Link>
        )}
      </div>
      {!loading && !token && (
        <div className="border border-dashed border-line bg-surface p-6 text-sm">
          입찰, 장바구니, 보관 상품은 카카오 로그인 후 확인할 수 있습니다.
        </div>
      )}
      {notice && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {notice}
        </div>
      )}
      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
        {cards.map(([label, value, description, href, Icon]) => (
          <Link
            className="group bg-paper p-4 transition-colors hover:bg-surface sm:p-5"
            href={href}
            key={label}
          >
            <Icon size={17} />
            <p className="mt-6 text-xs text-muted sm:mt-8">{label}</p>
            <p className="mt-2 font-mono text-3xl font-bold">{value}</p>
            <p className="mt-2 text-[11px] text-muted group-hover:text-ink">
              {description}
            </p>
          </Link>
        ))}
      </div>
      <div className="grid gap-10 lg:grid-cols-[1.4fr_.8fr]">
        <section id="storage">
          <div className="mb-5 flex flex-col items-start gap-3 border-b border-ink pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow text-muted">상품 보관 / 합배송</p>
              <h2 className="mt-2 text-xl font-black tracking-[-0.05em]">
                보관 중인 상품
              </h2>
            </div>
            <Link className="text-xs font-bold underline" href="/chat">
              배송 상담
            </Link>
          </div>
          <div className="divide-y divide-line border-y border-line">
            {v2Storage.length === 0 &&
              legacyEligibleOrders.length === 0 &&
              legacyAuctionWins.length === 0 && (
                <p className="py-12 text-center text-sm text-muted">
                  결제 완료 후 보관 상품이 표시됩니다.
                </p>
              )}
            {v2Storage.length > 0 && (
              <div>
                <div className="bg-surface px-3 py-3">
                  <p className="text-xs font-bold">선택 상품 배송</p>
                  <p className="mt-1 text-[11px] text-muted">전환이 완료된 매장의 상품은 필요한 상품만 골라 함께 신청할 수 있습니다.</p>
                </div>
                {requestEligibleItems.length > 0 && (
                  <label className="flex cursor-pointer items-center gap-2 border-b border-line bg-surface px-3 py-3 text-xs font-bold">
                    <input
                      checked={allRequestEligibleSelected}
                      onChange={(event) => {
                        setSelectedOrderId("");
                        setSelectedInventoryItemIds(event.target.checked
                          ? requestEligibleItems.map((item) => item.id)
                          : []);
                      }}
                      type="checkbox"
                    />
                    배송 가능 상품 전체 선택 · {requestEligibleItems.length}개
                  </label>
                )}
                {v2Storage.map((item) => {
                  const expires = item.storageExpiresAt
                    ? new Date(item.storageExpiresAt)
                    : null;
                  const disabled = !item.requestEligible || Boolean(item.activeShipmentId);
                  const isSelected = selectedInventoryItemIds.includes(item.id);
                  return (
                    <div
                      className={`flex gap-3 px-1 py-4 sm:gap-4 ${disabled ? "opacity-60" : ""}`}
                      key={item.id}
                    >
                      <input
                        aria-label={`${item.title} 배송 선택`}
                        checked={isSelected}
                        disabled={disabled}
                        onChange={(event) => {
                          if (event.target.checked) setSelectedOrderId("");
                          setSelectedInventoryItemIds((current) => event.target.checked
                            ? [...current, item.id]
                            : current.filter((id) => id !== item.id));
                        }}
                        type="checkbox"
                      />
                      <CatalogImage
                        alt=""
                        className="size-16 shrink-0 object-cover sm:size-20"
                        src={item.imageUrl}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between gap-3 sm:gap-4">
                          <p className="truncate text-sm font-bold">
                            {item.title}
                          </p>
                          <span
                            className={`shrink-0 text-[10px] font-bold ${item.requestEligible ? "text-emerald-700" : "text-amber-700"}`}
                          >
                            {item.requestEligible && expires && now
                              ? `만료 ${Math.max(0, Math.ceil((expires.getTime() - now) / 86400000))}일 전`
                              : physicalStatusLabel(item.physicalStatus)}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-muted">
                          {item.originStoreName ? `${item.originStoreName} · ` : ""}{physicalStatusLabel(item.physicalStatus)}
                          {item.storageStartedAt ? " · 보관 처리됨" : " · 보관 준비 중"}
                        </p>
                        {disabled && <p className="mt-1 text-[11px] text-amber-700">{item.requestBlockReason ?? (item.activeShipmentId ? "이미 배송 요청에 포함되어 있습니다." : "현재 배송 요청할 수 없습니다.")}</p>}
                        {item.exceptionResolution === "exclude_for_later" && <p className="mt-1 text-[11px] font-bold text-amber-700">이번 배송에서 일시 보류되었습니다. 상품 상태가 정리되면 다음 배송으로 다시 신청할 수 있습니다.</p>}
                        {item.exceptionPublicReason && <p className="mt-1 text-[11px] text-rose-700">{item.exceptionPublicReason}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {legacyEligibleOrders.length > 0 && (
              <div>
                <div className="bg-surface px-3 py-3">
                  <p className="text-xs font-bold">기존 주문 전체 배송</p>
                  <p className="mt-1 text-[11px] text-muted">전환 전 매장의 결제 완료 상품은 주문 한 건 전체를 선택합니다.</p>
                </div>
                {legacyEligibleOrders.map((order) => (
                  <label className="block cursor-pointer px-1 py-5" key={order.id}>
                    <span className="flex items-start gap-3">
                      <input
                        aria-label={`주문 ${order.id} 배송 선택`}
                        checked={selectedOrderId === order.id}
                        name="legacy-shipping-order"
                        onChange={() => {
                          setSelectedInventoryItemIds([]);
                          setSelectedOrderId(order.id);
                        }}
                        type="radio"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block break-all text-sm font-bold">주문 {order.id}</span>
                        <span className="mt-1 block text-[11px] text-muted">
                          상품 {order.items.length}개 전체 · 보관 만료 {new Date(order.storageExpiresAt).toLocaleDateString("ko-KR")}
                        </span>
                      </span>
                    </span>
                    <span className="mt-4 grid gap-3 sm:grid-cols-2">
                      {order.items.map((item) => (
                        <span className="flex min-w-0 items-center gap-3 border border-line p-3" key={item.id}>
                          <CatalogImage
                            alt=""
                            className="size-12 shrink-0 object-cover"
                            src={item.products?.image_urls?.[0] ?? ""}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-bold">{item.products?.title ?? item.product_id}</span>
                            <span className="mt-1 block text-[10px] text-muted">결제 완료 · 보관 가능</span>
                          </span>
                        </span>
                      ))}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {legacyAuctionWins.length > 0 && (
              <div className="bg-surface px-3 py-5">
                <p className="text-xs font-bold">기존 낙찰 보관 현황</p>
                <p className="mt-1 text-[11px] text-muted">전환 전 낙찰 상태를 읽기 전용으로 보존하며, 기존 주문 배송 선택에는 포함하지 않습니다.</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {legacyAuctionWins.map((win) => (
                    <div className="flex min-w-0 items-center gap-3 border border-line bg-paper p-3" key={win.product_id}>
                      <CatalogImage
                        alt=""
                        className="size-12 shrink-0 object-cover"
                        src={win.image_urls[0] ?? ""}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold">{win.title}</p>
                        <p className="mt-1 text-[10px] text-muted">{win.shipping_status}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="mt-4 border border-line bg-surface p-4">
            <p className="text-xs font-bold">{selectedShippingMode === "legacy" ? "기존 주문 전체 배송 신청" : "선택 상품 배송 신청"}</p>
            <p className="mt-2 text-[11px] leading-5 text-muted">
              전환 완료 상품은 부분 선택할 수 있고, 전환 전 상품은 기존 주문 한 건 전체로 신청합니다. 두 방식 중 한 번에 하나에만 집중할 수 있습니다.
            </p>
            <p className="mt-3 text-[11px] font-bold text-muted">
              {selectedShippingMode === "v2"
                ? `선택 ${selectedInventoryItems.length}개 · 배송 가능 ${requestEligibleItems.length}개`
                : selectedLegacyOrder
                  ? `선택 주문 상품 ${selectedLegacyOrder.items.length}개 전체`
                  : `선택 가능 상품 ${requestEligibleItems.length}개 · 기존 주문 ${legacyEligibleOrders.length}건`}
            </p>
            <p className="mt-4 text-xs font-bold">배송지 선택</p>
            <select
              aria-label="배송지"
              className="mt-3 h-10 w-full border border-line bg-paper px-3 text-xs"
              disabled={!token}
              onChange={(event) => setSelectedAddressId(event.target.value)}
              value={selectedAddressId}
            >
              <option value="">배송지를 선택하세요</option>
              {addresses.map((address) => (
                <option key={address.id} value={address.id}>
                  {address.label} · {address.recipient_name} · {address.address}
                </option>
              ))}
            </select>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input
                aria-label="배송지 이름"
                className="border border-line bg-paper px-3 py-2 text-xs"
                onChange={(event) =>
                  setAddressForm({ ...addressForm, label: event.target.value })
                }
                placeholder="배송지 이름"
                value={addressForm.label}
              />
              <input
                aria-label="수령인"
                className="border border-line bg-paper px-3 py-2 text-xs"
                onChange={(event) =>
                  setAddressForm({
                    ...addressForm,
                    recipientName: event.target.value,
                  })
                }
                placeholder="수령인"
                value={addressForm.recipientName}
              />
              <input
                aria-label="연락처"
                className="border border-line bg-paper px-3 py-2 text-xs"
                onChange={(event) =>
                  setAddressForm({ ...addressForm, phone: event.target.value })
                }
                placeholder="연락처"
                value={addressForm.phone}
              />
              <input
                aria-label="주소"
                className="border border-line bg-paper px-3 py-2 text-xs sm:col-span-2"
                onChange={(event) =>
                  setAddressForm({
                    ...addressForm,
                    address: event.target.value,
                  })
                }
                placeholder="주소"
                value={addressForm.address}
              />
            </div>
            <button
              className="mt-3 border border-ink px-4 py-2 text-xs font-bold disabled:opacity-40"
              disabled={!token}
              onClick={() => void saveAddress()}
              type="button"
            >
              배송지 저장
            </button>
          </div>
          <button
            className="mt-4 h-11 w-full bg-ink text-xs font-bold text-paper disabled:opacity-40"
            disabled={
              !token ||
              !selectedShippingMode ||
              !selectedAddressId
            }
            onClick={() => void requestShipping()}
            type="button"
          >
            {selectedShippingMode === "legacy"
              ? "선택 주문 전체 배송 신청"
              : "선택 상품 배송 신청"}
          </button>
          {shippingMessage && (
            <p aria-live="polite" className="mt-3 text-xs text-emerald-700">
              {shippingMessage}
            </p>
          )}
        </section>
        <section
          id="shipping-credit"
          className="border border-line bg-surface p-5 sm:p-6"
        >
          <p className="eyebrow text-muted">배송 크레딧</p>
          <p className="mt-6 font-mono text-5xl font-bold">{credits}</p>
          <h2 className="mt-2 text-lg font-black">배송 요청 가능 횟수</h2>
          <p className="mt-3 text-xs leading-5 text-muted">
            배송 크레딧이 없으면 배송 신청 시 계좌이체 안내가 표시됩니다.
          </p>
        </section>
      </div>
      <section id="refunds">
        <div className="mb-5 flex items-end justify-between border-b border-ink pb-4">
          <div>
            <p className="eyebrow text-muted">상품 확인 / 수동 환불</p>
            <h2 className="mt-2 text-xl font-black tracking-[-0.05em]">환불 진행 상황</h2>
          </div>
          <span className="text-xs text-muted">{refunds.length}건</span>
        </div>
        {refundMessage && <p aria-live="polite" className="mb-4 border border-line bg-surface px-4 py-3 text-xs">{refundMessage}</p>}
        <div className="divide-y divide-line border-y border-line">
          {refunds.length === 0 && <p className="py-12 text-center text-sm text-muted">진행 중인 수동 환불이 없습니다.</p>}
          {refunds.map((refund) => {
            const subjectKey = refundKey(refund);
            const title = refundTitle(refund);
            const draft = refundDrafts[subjectKey] ?? {
              bankName: "",
              accountNumber: "",
              accountHolder: "",
            };
            const accountExpired = Boolean(
              refund.accountExpiresAt && now && Date.parse(refund.accountExpiresAt) <= now,
            );
            const needsAccount = refund.status === "requested" &&
              (!refund.accountSubmitted || accountExpired);
            return (
              <article className="grid gap-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]" key={subjectKey}>
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="text-sm font-bold">{title}</p>
                    <span className="border border-line px-2 py-1 text-[10px] font-bold">
                      {refund.status === "requested" ? "환불 계좌 확인 중" : refund.status === "approved" ? "송금 승인" : refund.status === "completed" ? "환불 완료" : "환불 취소"}
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-sm font-bold">{refund.amount.toLocaleString("ko-KR")}원</p>
                  <p className="mt-3 text-xs leading-5 text-rose-700">{refund.refundKind === "item" ? refund.publicReason : "배송 요청 상품이 모두 제외되어 결제한 배송비를 돌려드립니다."}</p>
                  {refund.accountSubmitted && !accountExpired && <p className="mt-2 text-[11px] text-muted">환불 계좌가 안전하게 등록되었습니다. 운영자가 계좌를 열람하면 감사 기록이 남습니다.</p>}
                  {accountExpired && <p className="mt-2 text-[11px] font-bold text-amber-700">보호를 위해 계좌 등록 기간이 만료되었습니다. 다시 입력해 주세요.</p>}
                </div>
                {needsAccount && (
                  <div className="grid gap-2 border border-line bg-surface p-4 sm:grid-cols-2">
                    <input aria-label={`${title} 환불 은행`} className="border border-line bg-paper px-3 py-2 text-xs" maxLength={40} onChange={(event) => updateRefundDraft(subjectKey, "bankName", event.target.value)} placeholder="은행" value={draft.bankName} />
                    <input aria-label={`${title} 환불 예금주`} className="border border-line bg-paper px-3 py-2 text-xs" maxLength={80} onChange={(event) => updateRefundDraft(subjectKey, "accountHolder", event.target.value)} placeholder="예금주" value={draft.accountHolder} />
                    <input aria-label={`${title} 환불 계좌번호`} className="border border-line bg-paper px-3 py-2 text-xs sm:col-span-2" inputMode="numeric" maxLength={50} onChange={(event) => updateRefundDraft(subjectKey, "accountNumber", event.target.value)} placeholder="계좌번호" value={draft.accountNumber} />
                    <button className="bg-ink px-4 py-3 text-xs font-bold text-paper disabled:opacity-40 sm:col-span-2" disabled={Boolean(refundBusyId)} onClick={() => void submitRefundAccount(refund)} type="button">{refundBusyId === subjectKey ? "암호화 저장 중" : "환불 계좌 등록"}</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
      <section id="shipments">
        <div className="mb-5 flex items-end justify-between border-b border-ink pb-4">
          <div>
            <p className="eyebrow text-muted">배송 내역 / 송장 조회</p>
            <h2 className="mt-2 text-xl font-black tracking-[-0.05em]">신청한 배송</h2>
          </div>
          <span className="text-xs text-muted">{shipments.length}건</span>
        </div>
        <div className="divide-y divide-line border-y border-line">
          {shipments.length === 0 && <p className="py-12 text-center text-sm text-muted">배송 신청 내역이 없습니다.</p>}
          {shipments.map((shipment) => (
            <article className="py-5" key={shipment.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-bold">배송 {shipmentStatusLabels[shipment.status] ?? shipment.status} · 상품 {shipment.activeItemCount}/{shipment.itemCount}개</p>
                  <p className="mt-2 text-[11px] text-muted">{shipment.requestedAt ? new Date(shipment.requestedAt).toLocaleString("ko-KR") : "요청 시각 확인 중"} · 배송비 {feeStatusLabels[shipment.shippingFeeStatus] ?? shipment.shippingFeeStatus}</p>
                </div>
                {shipment.trackingNumber && shipment.courier && (
                  <a className="w-fit border border-ink px-3 py-2 text-xs font-bold" href={shipment.trackingUrl ?? `https://www.google.com/search?q=${encodeURIComponent(`${shipment.courier} ${shipment.trackingNumber} 배송조회`)}`} rel="noreferrer" target="_blank">
                    {shipment.courier} · {shipment.trackingNumber} 조회
                  </a>
                )}
              </div>
              <p className="mt-3 text-xs text-muted">{shipment.items.map((item) => `${item.title} (${lineStatusLabels[item.lineStatus] ?? item.lineStatus})`).join(", ")}</p>
            </article>
          ))}
        </div>
      </section>
      <section id="likes">
        <div className="mb-5 flex items-end justify-between border-b border-ink pb-4">
          <div>
            <p className="eyebrow text-muted">찜 목록</p>
            <h2 className="mt-2 text-xl font-black tracking-[-0.05em]">
              찜한 상품
            </h2>
          </div>
          <span className="text-xs text-muted">{liked.length}개</span>
        </div>
        {liked.length === 0 ? (
          <div className="border border-dashed border-line py-16 text-center text-sm text-muted">
            로그인 후 찜한 상품이 표시됩니다.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {liked.map((product) => (
              <Link href={`/auction/${product.id}`} key={product.id}>
                <CatalogImage
                  alt=""
                  className="aspect-[4/5] w-full object-cover"
                  src={product.image_urls?.[0] ?? product.imageUrls?.[0] ?? ""}
                />
                <p className="mt-3 truncate text-xs font-bold">
                  {product.title}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function AccountDashboard() {
  const { identityRevision, loading, session } = useSupabaseSession();
  const identityKey = loading
    ? "loading"
    : `${session?.user.id ?? "guest"}:${identityRevision}`;
  return (
    <AccountDashboardForSession
      key={identityKey}
      loading={loading}
      session={session}
    />
  );
}
