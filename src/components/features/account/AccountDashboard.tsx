"use client";

import Link from "next/link";
import {
  Copy,
  ExternalLink,
  Heart,
  LogIn,
  PackageCheck,
  ReceiptText,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { CombinedAuctionPayment } from "@/components/features/account/CombinedAuctionPayment";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
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
  rolloutEnabled: boolean;
  itemSelectedShipmentsEnabled: boolean;
  requestEligible: boolean;
  requestBlockReason: string | null;
  storageClass: "small" | "large";
  storageDurationDays: number;
  storageStartedAt: string | null;
  storageExpiresAt: string | null;
  activeShipmentId: string | null;
}
interface StoragePayload {
  deadlineEnforcementExempt?: boolean;
  items?: InventoryItem[];
  legacyAuctionWins?: LegacyAuctionWin[];
  rememberedDepositorName?: string | null;
  rolloutEnabled?: boolean;
  serverTime?: string;
}
interface LegacyAuctionWin {
  product_id: string;
  title: string;
  image_urls: string[];
  closed_at: string;
  final_bid_amount: number;
  manual_transfer_status: string | null;
  purchase_offer_status: string | null;
  payment_due_at: string | null;
  is_payment_settled: boolean;
  active_payment_mode: "manual_transfer" | "portone";
  shipping_status: string;
  storage_class: "small" | "large";
  storage_expires_at: string | null;
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
}
interface InventoryShipment {
  id: string;
  sourceKind: "inventory_v2" | "canonical_commerce";
  sourceId: string;
  settlementMethod: string;
  shippingFeeStatus: string;
  publicStatus: "preparing" | "shipped";
  itemCount: number;
  activeItemCount: number;
  courier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  requestedAt: string | null;
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
interface ShippingCreditPayment {
  account_number_snapshot: string;
  bank_name_snapshot: string;
  credit_quantity: number;
  depositor_name: string | null;
  expected_amount: number;
  id: string;
  requested_at: string;
  status: string;
  unit_amount?: number;
  version: number;
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
  basePath,
  loading,
  session,
  surface,
}: {
  basePath: "" | "/m";
  loading: boolean;
  session: Session | null;
  surface: "desktop" | "mobile";
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
  const [paymentServerTime, setPaymentServerTime] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressManagerOpen, setAddressManagerOpen] = useState(false);
  const [addressEditorOpen, setAddressEditorOpen] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [legacyAuctionWins, setLegacyAuctionWins] = useState<LegacyAuctionWin[]>([]);
  const [deadlineEnforcementExempt, setDeadlineEnforcementExempt] = useState(false);
  const [rememberedDepositorName, setRememberedDepositorName] = useState<string | null>(null);
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
  const [trackingShipment, setTrackingShipment] = useState<InventoryShipment | null>(null);
  const [showAllStorage, setShowAllStorage] = useState(false);
  const [creditQuantity, setCreditQuantity] = useState(1);
  const [creditPayment, setCreditPayment] =
    useState<ShippingCreditPayment | null>(null);
  const [creditPayments, setCreditPayments] = useState<ShippingCreditPayment[]>([]);
  const [creditDepositorOpen, setCreditDepositorOpen] = useState(false);
  const [creditDepositorName, setCreditDepositorName] = useState("");
  const [creditCancelBusyId, setCreditCancelBusyId] = useState<string | null>(null);
  const [creditPurchaseBusy, setCreditPurchaseBusy] = useState(false);
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
          payments?: ShippingCreditPayment[];
          rememberedDepositorName?: string | null;
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
          const serverNow = Date.parse(storageData.serverTime ?? "");
          setNow(Number.isFinite(serverNow) ? serverNow : Date.now());
          setPaymentServerTime(storageData.serverTime ?? null);
          setStorage(storageData.items ?? []);
          setLegacyAuctionWins(storageData.legacyAuctionWins ?? []);
          setDeadlineEnforcementExempt(
            storageData.deadlineEnforcementExempt === true,
          );
          setRememberedDepositorName(
            storageData.rememberedDepositorName ??
              creditData.rememberedDepositorName ??
              null,
          );
          setCreditDepositorName(
            storageData.rememberedDepositorName ??
              creditData.rememberedDepositorName ??
              "",
          );
          setOrders(ordersData.orders ?? []);
          setSelectedInventoryItemIds([]);
          setSelectedOrderId("");
          setShipments(shipmentData.shipments ?? []);
          setRefunds(refundData.refunds ?? []);
          setCredits(Number(creditData.credits ?? 0));
          setCreditPayments(creditData.payments ?? []);
          setCreditPayment(creditData.payments?.[0] ?? null);
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
  const pendingAuctionWins = useMemo(
    () => legacyAuctionWins.filter((win) => !win.is_payment_settled),
    [legacyAuctionWins],
  );
  const settledLegacyAuctionWins = useMemo(
    () => legacyAuctionWins.filter((win) => win.is_payment_settled),
    [legacyAuctionWins],
  );
  const visibleStorageItemCount =
    v2Storage.length +
    legacyEligibleItemCount +
    settledLegacyAuctionWins.length;
  const cards = [
    [
      "낙찰품 결제",
      String(pendingAuctionWins.length).padStart(2, "0"),
      "결제 마감 전 입금 진행",
      "#auction-payments",
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
  const visibleV2Storage = showAllStorage ? v2Storage : v2Storage.slice(0, 4);
  const visibleLegacyEligibleOrders = showAllStorage
    ? legacyEligibleOrders
    : legacyEligibleOrders.slice(0, 4);
  const visibleSettledLegacyAuctionWins = showAllStorage
    ? settledLegacyAuctionWins
    : settledLegacyAuctionWins.slice(0, 4);
  const hasHiddenStorage =
    visibleV2Storage.length < v2Storage.length ||
    visibleLegacyEligibleOrders.length < legacyEligibleOrders.length ||
    visibleSettledLegacyAuctionWins.length <
      settledLegacyAuctionWins.length;
  const resetAddressEditor = () => {
    setEditingAddressId(null);
    setAddressForm({
      label: "집",
      recipientName: "",
      phone: "",
      postalCode: "",
      address: "",
    });
    setAddressEditorOpen(false);
  };
  const openAddressCreate = () => {
    resetAddressEditor();
    setAddressEditorOpen(true);
    setAddressManagerOpen(true);
  };
  const openAddressEdit = (address: Address) => {
    setEditingAddressId(address.id);
    setAddressForm({
      label: address.label,
      recipientName: address.recipient_name,
      phone: address.phone,
      postalCode: address.postal_code ?? "",
      address: address.address,
    });
    setAddressEditorOpen(true);
    setAddressManagerOpen(true);
  };
  const saveAddress = async () => {
    if (!token) return;
    setShippingMessage("");
    try {
      const response = await fetch("/api/account/addresses", {
        method: editingAddressId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...addressForm,
          id: editingAddressId,
          isDefault:
            addresses.length === 0 ||
            addresses.find((address) => address.id === editingAddressId)
              ?.is_default === true,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        address?: Address;
        error?: string;
      } | null;
      if (!response.ok || !payload?.address) {
        throw new Error(payload?.error ?? "배송지를 저장하지 못했습니다.");
      }
      const savedAddress = payload.address;
      setAddresses((current) => {
        const next = current
          .filter((address) => address.id !== savedAddress.id)
          .map((address) =>
            savedAddress.is_default
              ? { ...address, is_default: false }
              : address
          );
        return [savedAddress, ...next].sort(
          (left, right) => Number(right.is_default) - Number(left.is_default),
        );
      });
      setSelectedAddressId(savedAddress.id);
      resetAddressEditor();
      setShippingMessage(
        editingAddressId
          ? "배송지를 수정하고 선택했습니다."
          : "배송지를 저장하고 선택했습니다.",
      );
    } catch (error) {
      setShippingMessage(
        error instanceof Error
          ? error.message
          : "배송지를 저장하지 못했습니다.",
      );
    }
  };
  const deleteAddress = async (address: Address) => {
    if (!token || !window.confirm(`${address.label} 배송지를 삭제할까요?`)) return;
    setShippingMessage("");
    try {
      const response = await fetch("/api/account/addresses", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: address.id }),
      });
      const payload = await response.json().catch(() => null) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "배송지를 삭제하지 못했습니다.");
      }
      const next = addresses.filter((item) => item.id !== address.id);
      setAddresses(next);
      if (selectedAddressId === address.id) {
        setSelectedAddressId(next.find((item) => item.is_default)?.id ?? next[0]?.id ?? "");
      }
      if (editingAddressId === address.id) resetAddressEditor();
      setShippingMessage("배송지를 삭제했습니다.");
    } catch (error) {
      setShippingMessage(
        error instanceof Error ? error.message : "배송지를 삭제하지 못했습니다.",
      );
    }
  };
  const shippingRequestKeys = useRef(new Map<string, string>());
  const shippingCreditRequestKeys = useRef(new Map<number, string>());
  const shippingCreditCancelKeys = useRef(new Map<string, string>());
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
    if (credits < 1) {
      setShippingMessage("배송 크레딧이 없어 배송을 신청할 수 없습니다. 먼저 배송 크레딧을 결제해 주세요.");
      return;
    }
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
        }))
      : (selectedLegacyOrder?.items ?? []).map((item) => ({
          inventoryItemId: null,
          productId: item.product_id,
          title: item.products?.title ?? item.product_id,
          imageUrl: item.products?.image_urls?.[0] ?? "",
        }));
    setShipments((current) => [{
      id: shipment.shipment_id,
      sourceKind: useV2 ? "inventory_v2" : "canonical_commerce",
      sourceId: shipment.shipment_id,
      settlementMethod: shipment.settlement_method,
      shippingFeeStatus: shipment.payment ? "awaiting_transfer" : "confirmed",
      publicStatus: "preparing",
      itemCount: requestedItems.length,
      activeItemCount: requestedItems.length,
      courier: null,
      trackingNumber: null,
      trackingUrl: null,
      requestedAt: new Date().toISOString(),
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
  const requestShippingCredits = async () => {
    if (!token || creditPurchaseBusy) return;
    if (
      !Number.isSafeInteger(creditQuantity) ||
      creditQuantity < 1 ||
      creditQuantity > 20
    ) {
      setShippingMessage("배송 크레딧은 1~20개까지 신청할 수 있습니다.");
      return;
    }
    const depositorName = creditDepositorName.trim();
    if (depositorName.length < 1 || depositorName.length > 80) {
      setShippingMessage("입금자명을 확인해 주세요.");
      return;
    }
    const idempotencyKey =
      shippingCreditRequestKeys.current.get(creditQuantity) ??
      crypto.randomUUID();
    shippingCreditRequestKeys.current.set(creditQuantity, idempotencyKey);
    setCreditPurchaseBusy(true);
    setShippingMessage("");
    try {
      const response = await fetch("/api/shipping/credits", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          depositorName,
          idempotencyKey,
          quantity: creditQuantity,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        error?: string;
        payment?: ShippingCreditPayment;
      } | null;
      if (!response.ok || !payload?.payment) {
        throw new Error(
          payload?.error ?? "배송 크레딧 결제를 신청하지 못했습니다.",
        );
      }
      const requestedPayment = payload.payment;
      shippingCreditRequestKeys.current.delete(creditQuantity);
      setCreditPayment(requestedPayment);
      setCreditPayments((current) => [
        requestedPayment,
        ...current.filter((payment) => payment.id !== requestedPayment.id),
      ]);
      setRememberedDepositorName(depositorName);
      setCreditDepositorOpen(false);
      setShippingMessage(
        `배송 크레딧 ${requestedPayment.credit_quantity}개 결제를 신청했습니다.`,
      );
    } catch (error) {
      setShippingMessage(
        error instanceof Error
          ? error.message
          : "배송 크레딧 결제를 신청하지 못했습니다.",
      );
    } finally {
      setCreditPurchaseBusy(false);
    }
  };
  const cancelShippingCreditPayment = async (
    payment: ShippingCreditPayment,
  ) => {
    if (
      !token ||
      creditCancelBusyId ||
      !window.confirm("이 배송 크레딧 입금 신청을 취소할까요?")
    ) return;
    const idempotencyKey =
      shippingCreditCancelKeys.current.get(payment.id) ?? crypto.randomUUID();
    shippingCreditCancelKeys.current.set(payment.id, idempotencyKey);
    setCreditCancelBusyId(payment.id);
    setShippingMessage("");
    try {
      const response = await fetch("/api/shipping/credits", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expectedVersion: payment.version,
          idempotencyKey,
          paymentId: payment.id,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "배송 크레딧 입금 신청을 취소하지 못했습니다.");
      }
      shippingCreditCancelKeys.current.delete(payment.id);
      setCreditPayments((current) => current.filter((item) => item.id !== payment.id));
      setCreditPayment((current) => current?.id === payment.id ? null : current);
      setShippingMessage("배송 크레딧 입금 신청을 취소했습니다.");
    } catch (error) {
      setShippingMessage(
        error instanceof Error
          ? error.message
          : "배송 크레딧 입금 신청을 취소하지 못했습니다.",
      );
    } finally {
      setCreditCancelBusyId(null);
    }
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
    <div className={surface === "desktop" ? "space-y-14" : "space-y-10"}>
      <div className={`flex justify-between gap-5 border-b border-ink pb-8 ${surface === "desktop" ? "flex-row items-end" : "flex-col"}`}>
        <div className="min-w-0">
          <p className="eyebrow text-muted">내 계정 / 이용 현황</p>
          <h1 className={`mt-3 break-keep font-black tracking-[-0.08em] ${surface === "desktop" ? "text-4xl" : "text-3xl"}`}>
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
            href={`${basePath}/account/login?next=${encodeURIComponent(`${basePath}/account`)}`}
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
      <div className={`grid gap-px border border-line bg-line ${surface === "desktop" ? "grid-cols-4" : "grid-cols-2"}`}>
        {cards.map(([label, value, description, href, Icon]) => (
          <Link
            className={`group bg-paper transition-colors hover:bg-surface ${surface === "desktop" ? "p-5" : "p-4"}`}
            href={href}
            key={label}
          >
            <Icon size={17} />
            <p className={`text-xs text-muted ${surface === "desktop" ? "mt-8" : "mt-6"}`}>{label}</p>
            <p className="mt-2 font-mono text-3xl font-bold">{value}</p>
            <p className="mt-2 text-[11px] text-muted group-hover:text-ink">
              {description}
            </p>
          </Link>
        ))}
      </div>
      <section id="auction-payments">
        <div className="mb-5 border-b border-ink pb-4">
          <p className="eyebrow text-muted">경매 낙찰 / 결제</p>
          <h2 className="mt-2 text-xl font-black tracking-[-0.05em]">
            낙찰품 결제
          </h2>
          <p className="mt-2 text-[11px] leading-5 text-muted">
            낙찰품은 보관 상품이 되기 전에 결제를 진행해야 합니다. 결제 마감은
            서버가 확정한 경매 규칙을 따릅니다.
          </p>
        </div>
        {pendingAuctionWins.length === 0 ? (
          <p className="border-y border-line py-10 text-center text-sm text-muted">
            결제할 낙찰품이 없습니다.
          </p>
        ) : (
          <div className="border border-line bg-paper p-4 sm:p-5">
            <div className={`grid gap-3 ${surface === "desktop" ? "grid-cols-2" : "grid-cols-1"}`}>
              {pendingAuctionWins.map((win) => (
                <article className="border border-line p-3" key={win.product_id}>
                <div className="flex min-w-0 items-center gap-3">
                  <CatalogImage
                    alt=""
                    className="size-16 shrink-0 object-cover"
                    sizes="64px"
                    src={win.image_urls[0] ?? ""}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{win.title}</p>
                    <p className="mt-1 font-mono text-xs font-bold">
                      낙찰가 {win.final_bid_amount.toLocaleString("ko-KR")}원
                    </p>
                    <p className="mt-1 text-[10px] text-muted">
                      {win.manual_transfer_status === "awaiting_manual_transfer"
                        ? "입금 대기 중"
                        : "결제 시작 전"}
                    </p>
                  </div>
                </div>
              </article>
              ))}
            </div>
            <CombinedAuctionPayment
              deadlineEnforcementExempt={deadlineEnforcementExempt}
              rememberedDepositorName={rememberedDepositorName}
              serverTime={paymentServerTime}
              wins={pendingAuctionWins.map((win) => ({
                productId: win.product_id,
                title: win.title,
                amount: win.final_bid_amount,
                dueAt: win.payment_due_at,
              }))}
            />
          </div>
        )}
      </section>
      <div className={`grid gap-10 ${surface === "desktop" ? "grid-cols-[1.4fr_.8fr]" : "grid-cols-1"}`}>
        <section className="contents">
          <div
            className={surface === "desktop" ? "col-start-2 row-start-1" : ""}
            id="storage"
          >
          <div className={`mb-5 flex items-start gap-3 border-b border-ink pb-4 ${surface === "desktop" ? "flex-row items-end justify-between" : "flex-col"}`}>
            <div>
              <p className="eyebrow text-muted">상품 보관 / 합배송</p>
              <h2 className="mt-2 text-xl font-black tracking-[-0.05em]">
                보관 중인 상품
              </h2>
              <p className="mt-2 text-[11px] leading-5 text-muted">
                보관 기간은 매장 보관 시작일부터 소형 2주, 대형 1주입니다.
              </p>
            </div>
            <div className="flex gap-3">
              {(hasHiddenStorage || showAllStorage) && (
                <button
                  className="text-xs font-bold underline"
                  onClick={() => setShowAllStorage((current) => !current)}
                  type="button"
                >
                  {showAllStorage ? "간략히 보기" : "전체보기"}
                </button>
              )}
              <Link className="text-xs font-bold underline" href={`${basePath}/chat`}>
                배송 상담
              </Link>
            </div>
          </div>
          <div className="divide-y divide-line border-y border-line">
            {v2Storage.length === 0 &&
              legacyEligibleOrders.length === 0 &&
              settledLegacyAuctionWins.length === 0 && (
                <p className="py-12 text-center text-sm text-muted">
                  결제 완료 후 보관 상품이 표시됩니다.
                </p>
              )}
            {v2Storage.length > 0 && (
              <div>
                <div className="bg-surface px-3 py-3">
                  <p className="text-xs font-bold">선택 상품 배송</p>
                  <p className="mt-1 text-[11px] text-muted">결제 완료 상품은 매장 출고 전에도 선택할 수 있으며, 서로 다른 매장 상품도 한 번에 신청할 수 있습니다.</p>
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
                <div className={`grid gap-3 p-1 ${surface === "desktop" ? "grid-cols-3" : "grid-cols-2"}`}>
                  {visibleV2Storage.map((item) => {
                    const expires = item.storageExpiresAt ? new Date(item.storageExpiresAt) : null;
                    const disabled = !item.requestEligible || Boolean(item.activeShipmentId);
                    const isSelected = selectedInventoryItemIds.includes(item.id);
                    return (
                      <article className={`relative border border-line bg-paper ${disabled ? "opacity-60" : ""}`} key={item.id}>
                        <label className="absolute left-2 top-2 z-10 grid size-7 place-items-center bg-paper/95 shadow-sm">
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
                        </label>
                        <CatalogImage alt="" className="aspect-square w-full object-cover" sizes={surface === "desktop" ? "220px" : "50vw"} src={item.imageUrl} />
                        <div className="p-3">
                          <p className="line-clamp-2 min-h-10 text-sm font-bold">{item.title}</p>
                          <p className="mt-2 text-[11px] text-muted">{item.originStoreName ?? "매장 상품"}</p>
                          <p className="mt-1 text-[11px] font-bold text-muted">
                            {item.storageClass === "large" ? "대형 · 1주 보관" : "소형 · 2주 보관"}
                            {expires ? ` · ${expires.toLocaleDateString("ko-KR")}까지` : ""}
                          </p>
                          {disabled && (
                            <p className="mt-2 text-[11px] text-amber-700">
                              {item.activeShipmentId ? "이미 배송 신청에 포함된 상품입니다." : "현재 배송 신청할 수 없습니다."}
                            </p>
                          )}
                          <Link className="mt-3 inline-block text-[11px] font-bold underline" href={`${basePath}/auction/${item.productId}`}>상품 상세보기</Link>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}
            {legacyEligibleOrders.length > 0 && (
              <div>
                <div className="bg-surface px-3 py-3">
                  <p className="text-xs font-bold">기존 주문 전체 배송</p>
                  <p className="mt-1 text-[11px] text-muted">전환 전 매장의 결제 완료 상품은 주문 한 건 전체를 선택합니다.</p>
                </div>
                {visibleLegacyEligibleOrders.map((order) => (
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
                    <span className={`mt-4 grid gap-3 ${surface === "desktop" ? "grid-cols-2" : "grid-cols-1"}`}>
                      {order.items.map((item) => (
                        <span className="flex min-w-0 items-center gap-3 border border-line p-3" key={item.id}>
                          <CatalogImage
                            alt=""
                            className="size-12 shrink-0 object-cover"
                            sizes="48px"
                            src={item.products?.image_urls?.[0] ?? ""}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-bold">{item.products?.title ?? item.product_id}</span>
                            <span className="mt-1 block text-[10px] text-muted">
                              결제 완료 · {item.products?.storage_class === "large" ? "대형 1주" : "소형 2주"} 보관
                            </span>
                          </span>
                        </span>
                      ))}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {settledLegacyAuctionWins.length > 0 && (
              <div className="bg-surface px-3 py-5">
                <p className="text-xs font-bold">기존 결제 완료 낙찰품</p>
                <p className="mt-1 text-[11px] text-muted">결제 완료 낙찰품을 통합 보관 상품으로 전환하고 있습니다. 전환이 끝나면 위 선택 목록에서 배송 신청할 수 있습니다.</p>
                <div className={`mt-4 grid gap-3 ${surface === "desktop" ? "grid-cols-2" : "grid-cols-1"}`}>
                  {visibleSettledLegacyAuctionWins.map((win) => (
                    <div className="flex min-w-0 items-center gap-3 border border-line bg-paper p-3" key={win.product_id}>
                      <CatalogImage
                        alt=""
                        className="size-12 shrink-0 object-cover"
                        sizes="48px"
                        src={win.image_urls[0] ?? ""}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold">{win.title}</p>
                        <p className="mt-1 text-[10px] text-muted">
                          {win.shipping_status} · {win.storage_class === "large" ? "대형 1주" : "소형 2주"} 보관
                          {win.storage_expires_at
                            ? ` · ${new Date(win.storage_expires_at).toLocaleDateString("ko-KR")}까지`
                            : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          </div>
          <div
            className={surface === "desktop" ? "col-start-1 row-start-1" : ""}
            id="shipping-request"
          >
          <div className="border border-line bg-surface p-4">
            <p className="eyebrow text-muted">상품 배송 / 합배송 신청</p>
            <h2 className="mt-2 text-xl font-black tracking-[-0.05em]">
              배송 신청
            </h2>
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
            <div
              className="mt-5 border border-line bg-paper p-4"
              id="shipping-credit"
            >
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="eyebrow text-muted">배송 크레딧</p>
                  <h3 className="mt-1 text-sm font-black">현재 {credits}회</h3>
                </div>
                <p className="text-right text-[10px] leading-4 text-muted">
                  배송 신청에 사용하거나
                  <br />
                  필요한 만큼 충전
                </p>
              </div>
              <label
                className="mt-4 block text-xs font-bold"
                htmlFor="shipping-credit-quantity"
              >
                필요한 크레딧 수량
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  className="h-10 min-w-0 flex-1 border border-line px-3 text-sm"
                  id="shipping-credit-quantity"
                  inputMode="numeric"
                  max={20}
                  min={1}
                  onChange={(event) => {
                    setCreditQuantity(Number(event.target.value));
                    setCreditPayment(null);
                  }}
                  type="number"
                  value={creditQuantity}
                />
                <button
                  className="bg-ink px-4 text-xs font-bold text-paper disabled:opacity-40"
                  disabled={!token || creditPurchaseBusy}
                  onClick={() => {
                    setCreditDepositorName(
                      rememberedDepositorName ?? creditDepositorName,
                    );
                    setCreditDepositorOpen(true);
                  }}
                  type="button"
                >
                  결제 신청
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-muted">
                1~20개 중 필요한 만큼만 별도로 결제 신청할 수 있습니다.
              </p>
              {creditPayment && creditPayments.length === 0 && (
                <div className="mt-4 border border-ink bg-surface p-3 text-xs leading-6">
                  <p className="font-black">
                    {creditPayment.credit_quantity}개 · 총{" "}
                    {creditPayment.expected_amount.toLocaleString("ko-KR")}원
                  </p>
                  <p>
                    {creditPayment.bank_name_snapshot}{" "}
                    {creditPayment.account_number_snapshot}
                  </p>
                  <p className="text-muted">
                    개당 {Math.round(
                      creditPayment.expected_amount /
                        creditPayment.credit_quantity,
                    ).toLocaleString("ko-KR")}원 ·
                    입금 확인 후 적립
                  </p>
                </div>
              )}
              {creditPayments.length > 0 && (
                <div className="mt-4 divide-y divide-line border-y border-line">
                  {creditPayments.map((payment) => (
                    <article className="py-3 text-xs" key={payment.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-black">
                            {payment.credit_quantity}개 ·{" "}
                            {payment.expected_amount.toLocaleString("ko-KR")}원
                          </p>
                          <p className="mt-1 text-muted">
                            입금자명 {payment.depositor_name ?? "확인 필요"} ·{" "}
                            {payment.status === "partially_paid"
                              ? "일부 입금 확인"
                              : "입금 대기"}
                          </p>
                          <p className="mt-1">
                            {payment.bank_name_snapshot}{" "}
                            {payment.account_number_snapshot}
                          </p>
                        </div>
                        {payment.status === "awaiting_transfer" && (
                          <button
                            className="shrink-0 border border-rose-300 px-3 py-2 text-[10px] font-bold text-rose-700 disabled:opacity-40"
                            disabled={Boolean(creditCancelBusyId)}
                            onClick={() => void cancelShippingCreditPayment(payment)}
                            type="button"
                          >
                            {creditCancelBusyId === payment.id ? "취소 중" : "신청 취소"}
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
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
            {selectedAddressId && (
              <div className="mt-3 border border-line bg-paper p-3 text-xs leading-5">
                {(() => {
                  const selected = addresses.find((address) => address.id === selectedAddressId);
                  return selected ? (
                    <>
                      <p className="font-black">{selected.label} · {selected.recipient_name}</p>
                      <p className="mt-1 text-muted">{selected.phone}</p>
                      <p className="text-muted">
                        {selected.postal_code ? `[${selected.postal_code}] ` : ""}
                        {selected.address}
                      </p>
                    </>
                  ) : null;
                })()}
              </div>
            )}
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                className="border border-ink px-3 py-2 text-xs font-bold"
                onClick={openAddressCreate}
                type="button"
              >
                추가
              </button>
              <button
                className="border border-line px-3 py-2 text-xs font-bold disabled:opacity-40"
                disabled={!selectedAddressId}
                onClick={() => {
                  const selected = addresses.find((address) => address.id === selectedAddressId);
                  if (selected) openAddressEdit(selected);
                }}
                type="button"
              >
                수정
              </button>
              <button
                className="border border-line px-3 py-2 text-xs font-bold"
                onClick={() => {
                  resetAddressEditor();
                  setAddressManagerOpen(true);
                }}
                type="button"
              >
                삭제
              </button>
            </div>
          </div>
          <button
            className="mt-4 h-11 w-full bg-ink text-xs font-bold text-paper disabled:opacity-40"
            disabled={
              !token ||
              credits < 1 ||
              !selectedShippingMode ||
              !selectedAddressId
            }
            onClick={() => void requestShipping()}
            type="button"
          >
            {selectedShippingMode === "legacy"
              ? credits < 1 ? "배송 크레딧 필요" : "선택 주문 전체 배송 신청"
              : credits < 1 ? "배송 크레딧 필요" : "선택 상품 배송 신청"}
          </button>
          {shippingMessage && (
            <p aria-live="polite" className="mt-3 text-xs text-emerald-700">
              {shippingMessage}
            </p>
          )}
          </div>
        </section>
      </div>
      <details className="group border-y border-line py-1" id="refunds">
        <summary className="flex cursor-pointer list-none items-end justify-between gap-4 py-4">
          <div>
            <p className="eyebrow text-muted">상품 확인 / 수동 환불</p>
            <h2 className="mt-2 text-xl font-black tracking-[-0.05em]">환불 진행 상황</h2>
          </div>
          <span className="shrink-0 text-xs font-bold text-muted">
            {refunds.length}건 · 열기/닫기
          </span>
        </summary>
        <div className="pb-4">
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
              <article className={`grid gap-5 py-5 ${surface === "desktop" ? "grid-cols-[minmax(0,1fr)_minmax(280px,420px)]" : "grid-cols-1"}`} key={subjectKey}>
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
                  <div className={`grid gap-2 border border-line bg-surface p-4 ${surface === "desktop" ? "grid-cols-2" : "grid-cols-1"}`}>
                    <input aria-label={`${title} 환불 은행`} className="border border-line bg-paper px-3 py-2 text-xs" maxLength={40} onChange={(event) => updateRefundDraft(subjectKey, "bankName", event.target.value)} placeholder="은행" value={draft.bankName} />
                    <input aria-label={`${title} 환불 예금주`} className="border border-line bg-paper px-3 py-2 text-xs" maxLength={80} onChange={(event) => updateRefundDraft(subjectKey, "accountHolder", event.target.value)} placeholder="예금주" value={draft.accountHolder} />
                    <input aria-label={`${title} 환불 계좌번호`} className={`border border-line bg-paper px-3 py-2 text-xs ${surface === "desktop" ? "col-span-2" : ""}`} inputMode="numeric" maxLength={50} onChange={(event) => updateRefundDraft(subjectKey, "accountNumber", event.target.value)} placeholder="계좌번호" value={draft.accountNumber} />
                    <button className={`bg-ink px-4 py-3 text-xs font-bold text-paper disabled:opacity-40 ${surface === "desktop" ? "col-span-2" : ""}`} disabled={Boolean(refundBusyId)} onClick={() => void submitRefundAccount(refund)} type="button">{refundBusyId === subjectKey ? "암호화 저장 중" : "환불 계좌 등록"}</button>
                  </div>
                )}
              </article>
            );
          })}
          </div>
        </div>
      </details>
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
              <div className={`flex gap-3 ${surface === "desktop" ? "flex-row items-start justify-between" : "flex-col"}`}>
                <div>
                  <p className="text-sm font-bold">
                    {shipment.publicStatus === "shipped" ? "발송 완료" : "배송 신청"}
                    {" · "}상품 {shipment.activeItemCount}/{shipment.itemCount}개
                  </p>
                  <p className="mt-2 text-[11px] text-muted">
                    {shipment.requestedAt ? new Date(shipment.requestedAt).toLocaleString("ko-KR") : "요청 시각 확인 중"}
                    {" · "}{shipment.publicStatus === "shipped" ? "상품 발송" : "발송 준비중"}
                    {" · "}상품 {shipment.itemCount}개
                  </p>
                  {shipment.trackingNumber && shipment.courier && (
                    <div className="mt-4 border-l-4 border-ink pl-4">
                      <p className="text-base font-black">{shipment.courier}</p>
                      <p className="mt-1 break-all font-mono text-xl font-black tracking-tight sm:text-2xl">
                        {shipment.trackingNumber}
                      </p>
                      <button
                        className="mt-2 inline-flex items-center gap-1 text-xs font-bold underline"
                        onClick={() => void navigator.clipboard.writeText(shipment.trackingNumber ?? "")}
                        type="button"
                      >
                        <Copy size={12} /> 송장번호 복사
                      </button>
                    </div>
                  )}
                </div>
                {shipment.trackingNumber && shipment.courier && (
                  <button
                    className="inline-flex w-fit items-center gap-1 border border-ink px-3 py-2 text-xs font-bold"
                    onClick={() => setTrackingShipment(shipment)}
                    type="button"
                  >
                    택배사 조회 <ExternalLink size={12} />
                  </button>
                )}
              </div>
              <details className="mt-4 border border-line">
                <summary className="cursor-pointer px-4 py-3 text-xs font-bold">
                  신청 상품 {shipment.items.length}개 보기
                </summary>
                <div className="grid grid-cols-2 gap-2 border-t border-line p-3 sm:grid-cols-4">
                  {shipment.items.map((item) => (
                    <Link className="flex min-w-0 items-center gap-2 border border-line p-2" href={`${basePath}/auction/${item.productId}`} key={`${shipment.id}:${item.productId}`}>
                      <CatalogImage alt="" className="size-10 shrink-0 object-cover" sizes="40px" src={item.imageUrl} />
                      <span className="truncate text-[11px] font-bold">{item.title}</span>
                    </Link>
                  ))}
                </div>
              </details>
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
            {loading
              ? "로그인 상태를 확인하고 있습니다."
              : !token
                ? "로그인 후 찜한 상품이 표시됩니다."
                : dataStatus === "loading"
                  ? "찜한 상품을 불러오고 있습니다."
                  : dataStatus === "error"
                    ? "찜 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
                    : "찜한 상품이 없습니다."}
          </div>
        ) : (
          <div className={`grid grid-cols-2 gap-3 ${surface === "desktop" ? "grid-cols-4" : "min-[700px]:grid-cols-3"}`}>
            {liked.map((product) => (
              <Link href={`${basePath}/auction/${product.id}`} key={product.id}>
                <CatalogImage
                  alt=""
                  className="aspect-[4/5] w-full object-cover"
                  sizes={surface === "desktop" ? "270px" : "(max-width: 699px) 50vw, 33vw"}
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
      <PremiumDialog
        labelledBy="address-manager-title"
        onClose={() => {
          setAddressManagerOpen(false);
          resetAddressEditor();
        }}
        open={addressManagerOpen}
        panelClassName="max-w-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line p-5">
          <div>
            <p className="eyebrow text-muted">배송지 추가 / 수정 / 삭제</p>
            <h2 className="mt-2 text-xl font-black" id="address-manager-title">
              배송지 관리
            </h2>
          </div>
          <button
            aria-label="배송지 관리 창 닫기"
            className="p-2"
            onClick={() => {
              setAddressManagerOpen(false);
              resetAddressEditor();
            }}
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">
          {!addressEditorOpen ? (
            <>
              <div className="divide-y divide-line border-y border-line">
                {addresses.map((address) => (
                  <article className="py-4" key={address.id}>
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                      <button
                        className="min-w-0 text-left"
                        onClick={() => {
                          setSelectedAddressId(address.id);
                          setAddressManagerOpen(false);
                        }}
                        type="button"
                      >
                        <p className="text-sm font-black">
                          {address.label} · {address.recipient_name}
                          {address.is_default && (
                            <span className="ml-2 border border-line px-2 py-0.5 text-[9px]">기본</span>
                          )}
                        </p>
                        <p className="mt-1 text-xs text-muted">{address.phone}</p>
                        <p className="mt-1 text-xs leading-5 text-muted">
                          {address.postal_code ? `[${address.postal_code}] ` : ""}
                          {address.address}
                        </p>
                      </button>
                      <div className="flex shrink-0 gap-2">
                        <button
                          className="border border-line px-3 py-2 text-[10px] font-bold"
                          onClick={() => openAddressEdit(address)}
                          type="button"
                        >
                          수정
                        </button>
                        <button
                          className="border border-rose-300 px-3 py-2 text-[10px] font-bold text-rose-700"
                          onClick={() => void deleteAddress(address)}
                          type="button"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
                {addresses.length === 0 && (
                  <p className="py-10 text-center text-sm text-muted">등록된 배송지가 없습니다.</p>
                )}
              </div>
              <button
                className="mt-4 h-11 w-full bg-ink text-xs font-bold text-paper"
                onClick={openAddressCreate}
                type="button"
              >
                새 배송지 추가
              </button>
            </>
          ) : (
            <div>
              <p className="text-sm font-black">
                {editingAddressId ? "배송지 수정" : "새 배송지 추가"}
              </p>
              <div className={`mt-4 grid gap-3 ${surface === "desktop" ? "grid-cols-2" : "grid-cols-1"}`}>
                <input
                  aria-label="배송지 이름"
                  className="border border-line bg-paper px-3 py-3 text-xs"
                  onChange={(event) => setAddressForm({ ...addressForm, label: event.target.value })}
                  placeholder="배송지 이름"
                  value={addressForm.label}
                />
                <input
                  aria-label="수령인"
                  className="border border-line bg-paper px-3 py-3 text-xs"
                  onChange={(event) => setAddressForm({ ...addressForm, recipientName: event.target.value })}
                  placeholder="수령인"
                  value={addressForm.recipientName}
                />
                <input
                  aria-label="연락처"
                  className="border border-line bg-paper px-3 py-3 text-xs"
                  onChange={(event) => setAddressForm({ ...addressForm, phone: event.target.value })}
                  placeholder="연락처"
                  value={addressForm.phone}
                />
                <input
                  aria-label="우편번호"
                  className="border border-line bg-paper px-3 py-3 text-xs"
                  inputMode="numeric"
                  maxLength={5}
                  onChange={(event) => setAddressForm({
                    ...addressForm,
                    postalCode: event.target.value.replace(/\D/gu, ""),
                  })}
                  placeholder="우편번호 5자리"
                  value={addressForm.postalCode}
                />
                <input
                  aria-label="주소"
                  className={`border border-line bg-paper px-3 py-3 text-xs ${surface === "desktop" ? "col-span-2" : ""}`}
                  onChange={(event) => setAddressForm({ ...addressForm, address: event.target.value })}
                  placeholder="주소"
                  value={addressForm.address}
                />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  className="h-11 border border-line text-xs font-bold"
                  onClick={resetAddressEditor}
                  type="button"
                >
                  목록으로
                </button>
                <button
                  className="h-11 bg-ink text-xs font-bold text-paper"
                  onClick={() => void saveAddress()}
                  type="button"
                >
                  {editingAddressId ? "수정 저장" : "배송지 추가"}
                </button>
              </div>
            </div>
          )}
        </div>
      </PremiumDialog>
      <PremiumDialog
        closeDisabled={creditPurchaseBusy}
        labelledBy="shipping-credit-depositor-title"
        onClose={() => setCreditDepositorOpen(false)}
        open={creditDepositorOpen}
        panelClassName="max-w-md"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line p-5">
          <div>
            <p className="eyebrow text-muted">배송 크레딧 결제</p>
            <h2 className="mt-2 text-xl font-black" id="shipping-credit-depositor-title">
              입금자명 확인
            </h2>
          </div>
          <button
            aria-label="입금자명 확인 창 닫기"
            className="p-2"
            disabled={creditPurchaseBusy}
            onClick={() => setCreditDepositorOpen(false)}
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5">
          <p className="text-xs leading-5 text-muted">
            상품 결제와 같은 입금자명을 기억합니다. 실제 송금할 이름과 같은지 확인해 주세요.
          </p>
          <label className="mt-5 block text-xs font-black" htmlFor="shipping-credit-depositor-name">
            입금자명
          </label>
          <input
            autoFocus
            className="mt-2 h-11 w-full border border-line px-3 text-sm"
            id="shipping-credit-depositor-name"
            maxLength={80}
            onChange={(event) => setCreditDepositorName(event.target.value)}
            placeholder="입금자명"
            value={creditDepositorName}
          />
          <div className="mt-4 border border-line bg-surface p-4">
            <p className="text-xs text-muted">신청 수량 / 결제 예정 금액</p>
            <p className="mt-2 font-mono text-lg font-black">
              {creditQuantity}개
              {creditPayment?.unit_amount
                ? ` · ${(creditPayment.unit_amount * creditQuantity).toLocaleString("ko-KR")}원`
                : ""}
            </p>
          </div>
          <button
            className="mt-5 h-11 w-full bg-ink text-xs font-black text-paper disabled:opacity-40"
            disabled={creditPurchaseBusy || creditDepositorName.trim().length === 0}
            onClick={() => void requestShippingCredits()}
            type="button"
          >
            {creditPurchaseBusy ? "신청 중" : "입금자명 확인 후 결제 신청"}
          </button>
        </div>
      </PremiumDialog>
      <PremiumDialog
        labelledBy="hanjin-tracking-title"
        onClose={() => setTrackingShipment(null)}
        open={Boolean(trackingShipment)}
        panelClassName="max-w-md"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line p-5">
          <div>
            <p className="eyebrow text-muted">한진택배 배송 조회</p>
            <h2 className="mt-2 text-xl font-black" id="hanjin-tracking-title">택배사 사이트로 이동</h2>
          </div>
          <button aria-label="택배 조회 창 닫기" className="p-2" onClick={() => setTrackingShipment(null)} type="button">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 text-sm">
          <p className="font-bold">{trackingShipment?.courier} · {trackingShipment?.trackingNumber}</p>
          <p className="mt-2 text-xs leading-5 text-muted">
            한진택배 공식 배송조회 사이트를 새 창으로 엽니다.
          </p>
          <a
            className="mt-5 flex h-11 items-center justify-center gap-2 bg-ink px-4 text-xs font-bold text-paper"
            href={trackingShipment?.trackingUrl ?? "#"}
            onClick={() => setTrackingShipment(null)}
            rel="noreferrer"
            target="_blank"
          >
            한진택배 배송 조회 <ExternalLink size={13} />
          </a>
        </div>
      </PremiumDialog>
    </div>
  );
}

export function AccountDashboard({ basePath = "", surface = "mobile" }: { basePath?: "" | "/m"; surface?: "desktop" | "mobile" }) {
  const { identityRevision, loading, session } = useSupabaseSession();
  const identityKey = loading
    ? "loading"
    : `${session?.user.id ?? "guest"}:${identityRevision}`;
  return (
    <AccountDashboardForSession
      basePath={basePath}
      key={identityKey}
      loading={loading}
      session={session}
      surface={surface}
    />
  );
}
