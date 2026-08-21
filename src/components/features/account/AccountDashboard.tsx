"use client";

import Link from "next/link";
import {
  Copy,
  ExternalLink,
  Heart,
  LogIn,
  LogOut,
  PackageCheck,
  ReceiptText,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { CombinedAuctionPayment } from "@/components/features/account/CombinedAuctionPayment";
import type { AuctionPaymentCenterGroup } from "@/components/features/account/CombinedAuctionPayment";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
import { logoutBrowserSession } from "@/lib/auth/logout";
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
  auctionPaymentQuote?: AuctionPaymentQuote;
  centerShippingTokens?: CenterShippingToken[];
}
interface AuctionPaymentQuote {
  groups: AuctionPaymentCenterGroup[];
  itemSubtotal: number;
  shippingFeeTotal: number;
  expectedTotal: number;
  serverTime: string;
}
interface CenterShippingToken {
  businessId: string;
  businessName: string;
  availableCount: number;
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
  active_payment_mode: "manual_transfer";
  shipping_status: string;
  storage_class: "small" | "large";
  storage_expires_at: string | null;
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
  purchaseConfirmationDueAt: string | null;
  purchaseConfirmedAt: string | null;
  purchaseConfirmedBy: "member" | "automatic" | null;
  requestedAt: string | null;
  addressSnapshot: Record<string, unknown> | null;
  items: InventoryShipmentItem[];
}
interface ShipmentsPayload {
  shipments?: InventoryShipment[];
}
interface LegacyEligibleOrderItem {
  orderItemId: string;
  productId: string;
  title: string;
  imageUrl: string;
  storageExpiresAt: string | null;
}
interface LegacyEligibleOrder {
  sourceKind: "canonical_commerce";
  sourceId: string;
  status: string;
  requestEligible: boolean;
  requestBlockReason: string | null;
  storageExpiresAt: string | null;
  items: LegacyEligibleOrderItem[];
}
interface LegacyEligibleOrdersPayload {
  orders?: LegacyEligibleOrder[];
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
export type AccountDashboardView =
  | "full"
  | "overview"
  | "simple"
  | "payments"
  | "storage"
  | "shipping-request"
  | "shipping"
  | "addresses"
  | "refunds"
  | "saved";

type HomeAction = {
  description: string;
  label: string;
  value: number;
  view: "payments" | "storage" | "shipping";
  Icon: typeof ReceiptText;
};

function refundKey(refund: ManualRefund) {
  return `${refund.refundKind}:${refund.id}`;
}

function refundTitle(refund: ManualRefund) {
  return refund.refundKind === "item" ? refund.title : "배송비 환불";
}

function AccountDashboardForSession({
  basePath,
  homeOnly,
  loading,
  onNavigate,
  session,
  surface,
  view,
}: {
  basePath: "" | "/m";
  homeOnly?: boolean;
  loading: boolean;
  onNavigate?: (view: AccountDashboardView) => void;
  session: Session | null;
  surface: "desktop" | "mobile";
  view: AccountDashboardView;
}) {
  const token = session?.access_token ?? null;
  const userName =
    session?.user.user_metadata?.name ??
    session?.user.user_metadata?.full_name ??
    "빈티지 피플";
  const [storage, setStorage] = useState<InventoryItem[]>([]);
  const [shipments, setShipments] = useState<InventoryShipment[]>([]);
  const [legacyEligibleOrders, setLegacyEligibleOrders] = useState<LegacyEligibleOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [refunds, setRefunds] = useState<ManualRefund[]>([]);
  const [liked, setLiked] = useState<ProductSummary[]>([]);
  const [likedCount, setLikedCount] = useState(0);
  const [now, setNow] = useState(0);
  const [paymentServerTime, setPaymentServerTime] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressManagerOpen, setAddressManagerOpen] = useState(false);
  const [addressEditorOpen, setAddressEditorOpen] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [pendingDeleteAddressId, setPendingDeleteAddressId] = useState<string | null>(null);
  const [legacyAuctionWins, setLegacyAuctionWins] = useState<LegacyAuctionWin[]>([]);
  const [deadlineEnforcementExempt, setDeadlineEnforcementExempt] = useState(false);
  const [rememberedDepositorName, setRememberedDepositorName] = useState<string | null>(null);
  const [paymentGroups, setPaymentGroups] = useState<AuctionPaymentCenterGroup[]>([]);
  const [centerShippingTokens, setCenterShippingTokens] = useState<CenterShippingToken[]>([]);
  const [selectedInventoryItemIds, setSelectedInventoryItemIds] = useState<string[]>([]);
  const [shippingRequestOpen, setShippingRequestOpen] = useState(false);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [addressForm, setAddressForm] = useState({
    label: "집",
    recipientName: "",
    phone: "",
    postalCode: "",
    address: "",
  });
const [shippingMessage, setShippingMessage] = useState("");
    const [logoutBusy, setLogoutBusy] = useState(false);
    const [memberAccessRequired, setMemberAccessRequired] = useState(false);
  const [trackingShipment, setTrackingShipment] = useState<InventoryShipment | null>(null);
  const [purchaseConfirmationShipment, setPurchaseConfirmationShipment] = useState<InventoryShipment | null>(null);
  const [purchaseConfirmationBusy, setPurchaseConfirmationBusy] = useState(false);
  const [showAllStorage, setShowAllStorage] = useState(false);
  const [refundMessage, setRefundMessage] = useState("");
  const [refundBusyId, setRefundBusyId] = useState<string | null>(null);
  const [refundDrafts, setRefundDrafts] = useState<Record<string, RefundAccountDraft>>({});
  const [dataStatus, setDataStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >(token ? "loading" : "idle");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!token) {
        setDataStatus("idle");
        setMemberAccessRequired(false);
        return;
      }
      setDataStatus("loading");
      setNotice("");
      const headers = { Authorization: `Bearer ${token}` };
      try {
        const [
          storageResponse,
          shipmentResponse,
          refundResponse,
          wishlistResponse,
          addressResponse,
          legacyOrdersResponse,
        ] = await Promise.all([
          fetch("/api/account/storage", { headers, cache: "no-store" }),
          fetch("/api/account/shipments", { headers, cache: "no-store" }),
          fetch("/api/account/refunds", { headers, cache: "no-store" }),
          fetch("/api/wishlist", { headers, cache: "no-store" }),
          fetch("/api/account/addresses", { headers, cache: "no-store" }),
          fetch("/api/account/legacy-eligible-orders", { headers, cache: "no-store" }),
        ]);
        const problemPayloads = await Promise.all(
          [
            storageResponse,
            shipmentResponse,
            refundResponse,
            wishlistResponse,
            addressResponse,
            legacyOrdersResponse,
          ].map(async (response) => response.ok
            ? null
            : await response.json().catch(() => null) as { code?: string; error?: string } | null),
        );
        const requiresMemberAccess = problemPayloads.some((payload) =>
          payload?.code === "member_required" || payload?.error === "member_required",
        );
        const storageData = storageResponse.ok
          ? await storageResponse.json() as StoragePayload
          : {};
        const shipmentData = shipmentResponse.ok
          ? await shipmentResponse.json() as ShipmentsPayload
          : {};
        const refundData = refundResponse.ok
          ? await refundResponse.json() as { refunds?: ManualRefund[] }
          : {};
        const wishlistData = wishlistResponse.ok
          ? await wishlistResponse.json() as { productIds?: string[] }
          : {};
        const addressData = addressResponse.ok
          ? await addressResponse.json() as { addresses?: Address[] }
          : {};
        const legacyOrdersData = legacyOrdersResponse.ok
          ? await legacyOrdersResponse.json() as LegacyEligibleOrdersPayload
          : {};
        const ids = wishlistData.productIds ?? [];
        const [auctionResponse, fixedResponse] = ids.length > 0
          ? await Promise.all([
              fetch("/api/products?saleType=auction&limit=100", {
                cache: "no-store",
              }),
              fetch("/api/products?saleType=fixed&limit=100", {
                cache: "no-store",
              }),
            ])
          : [null, null];
        const auctionData = auctionResponse?.ok
          ? await auctionResponse.json() as { products?: ProductSummary[] }
          : {};
        const fixedData = fixedResponse?.ok
          ? await fixedResponse.json() as { products?: ProductSummary[] }
          : {};
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
            storageData.rememberedDepositorName ?? null,
          );
          setPaymentGroups(storageData.auctionPaymentQuote?.groups ?? []);
          setCenterShippingTokens(storageData.centerShippingTokens ?? []);
          setSelectedInventoryItemIds([]);
          setShipments(shipmentData.shipments ?? []);
          setLegacyEligibleOrders(legacyOrdersData.orders ?? []);
          setSelectedOrderId("");
          setRefunds(refundData.refunds ?? []);
          setLiked(allProducts.filter((product) => ids.includes(product.id)));
          setLikedCount(ids.length);
          setAddresses(addressData.addresses ?? []);
          setSelectedAddressId(
            addressData.addresses?.find((address) => address.is_default)?.id ??
              addressData.addresses?.[0]?.id ??
              "",
          );
          const unavailableCount = [
            storageResponse,
            shipmentResponse,
            refundResponse,
            wishlistResponse,
            addressResponse,
            legacyOrdersResponse,
          ].filter((response) => !response.ok).length +
            [auctionResponse, fixedResponse].filter((response) => response && !response.ok).length;
          setMemberAccessRequired(requiresMemberAccess);
          if (requiresMemberAccess) {
            setNotice("현재 로그인한 계정은 일반 회원 계정이 아닙니다. 회원 계정으로 다시 로그인해 주세요.");
          } else if (unavailableCount > 0) {
            setNotice("일부 계정 정보를 불러오지 못했습니다. 다른 메뉴는 계속 이용할 수 있습니다.");
          }
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
  }, [token, view]);

  const v2Storage = useMemo(
    () => storage.filter((item) => item.rolloutEnabled),
    [storage],
  );
  const selectedLegacyOrder = useMemo(
    () => legacyEligibleOrders.find((order) => order.sourceId === selectedOrderId) ?? null,
    [legacyEligibleOrders, selectedOrderId],
  );
  const legacyEligibleItemCount = useMemo(
    () => legacyEligibleOrders.reduce(
      (count, order) => count + order.items.length,
      0,
    ),
    [legacyEligibleOrders],
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
  const accountPath = `${basePath}/account`;
  const cards = [
    [
      "낙찰품 결제",
      String(pendingAuctionWins.length).padStart(2, "0"),
      "결제 마감 전 입금 진행",
      `${accountPath}/payments`,
      ReceiptText,
    ],
    [
      "보관 중인 상품",
      String(visibleStorageItemCount).padStart(2, "0"),
      "합배송 가능한 상품",
      `${accountPath}/storage`,
      PackageCheck,
    ],
    [
      "배송 내역",
      String(shipments.length).padStart(2, "0"),
      "요청·발송 현황",
      `${accountPath}/shipping`,
      Truck,
    ],
    [
      "찜한 상품",
      String(likedCount).padStart(2, "0"),
      "다시 보고 싶은 아이템",
      `${basePath}/saved`,
      Heart,
    ],
  ] as const;
  const visibleCards = view === "simple" ? cards.slice(0, 3) : cards;
  const showOverview = view === "full" || view === "simple" || view === "overview";
  const showPayments =
    view === "full" || view === "simple" || view === "payments";
  const showStorage =
    view === "full" || view === "simple" || view === "storage";
  const showShippingRequest =
    view === "full" || view === "simple" || view === "shipping-request" ||
    (view === "storage" && shippingRequestOpen);
  const showRefunds = view === "full" || view === "refunds";
  const showShipments =
    view === "full" || view === "simple" || view === "shipping";
  const showLikes = view === "saved";
  const showAddresses = view === "addresses";
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
    setPendingDeleteAddressId(null);
    resetAddressEditor();
    setAddressEditorOpen(true);
    setAddressManagerOpen(true);
  };
  const openAddressEdit = (address: Address) => {
    setPendingDeleteAddressId(null);
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
    if (!token) return;
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
      setPendingDeleteAddressId(null);
      setShippingMessage("배송지를 삭제했습니다.");
    } catch (error) {
      setShippingMessage(
        error instanceof Error ? error.message : "배송지를 삭제하지 못했습니다.",
      );
    }
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
    const shippingSettlement = "manual_transfer";
    const useV2 = selectedShippingMode === "v2";
    if (
      !token ||
      !selectedAddressId ||
      (!useV2 && selectedShippingMode !== "legacy")
    ) {
      setShippingMessage(
        "배송 신청 상품과 배송지를 선택해 주세요.",
      );
      return;
    }
    const selectedIds = [...selectedInventoryItemIds].sort();
    const idempotencyScope = useV2
      ? `v2:${selectedIds.join(",")}:${selectedAddressId}:${shippingSettlement}`
      : `legacy:${selectedLegacyOrder?.sourceId}:${selectedAddressId}:${shippingSettlement}`;
    const idempotencyKey =
      shippingRequestKeys.current.get(idempotencyScope) ?? crypto.randomUUID();
    shippingRequestKeys.current.set(idempotencyScope, idempotencyKey);
    const response = await fetch(
      useV2 ? "/api/shipping/requests" : "/api/shipping/requests/legacy-order",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(useV2
          ? {
              inventoryItemIds: selectedIds,
              addressId: selectedAddressId,
              applyShippingCredit: false,
              idempotencyKey,
            }
          : {
              orderId: selectedLegacyOrder?.sourceId,
              addressId: selectedAddressId,
              applyShippingCredit: false,
              idempotencyKey,
            }),
      },
    );
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
    shippingRequestKeys.current.delete(idempotencyScope);
    const shipment = payload.shipment;
    if (useV2) {
      setStorage((current) => current.map((item) => selectedIds.includes(item.id)
        ? { ...item, activeShipmentId: shipment.shipment_id, requestEligible: false, requestBlockReason: "배송 요청 처리 중" }
        : item));
      setSelectedInventoryItemIds([]);
    } else {
      setLegacyEligibleOrders((current) => current.filter((order) => order.sourceId !== selectedLegacyOrder?.sourceId));
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
          productId: item.productId,
          title: item.title,
          imageUrl: item.imageUrl,
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
      purchaseConfirmationDueAt: null,
      purchaseConfirmedAt: null,
      purchaseConfirmedBy: null,
      requestedAt: new Date().toISOString(),
      addressSnapshot: null,
      items: requestedItems,
    }, ...current.filter((currentShipment) => currentShipment.id !== shipment.shipment_id)]);
    const payment = shipment.payment as ShipmentPayment | null;
    const expectedAmount = payment?.expectedAmount ?? payment?.expected_amount;
    const bankName = payment?.bankNameSnapshot ?? payment?.bank_name_snapshot;
    const accountNumber = payment?.accountNumberSnapshot ?? payment?.account_number_snapshot;
    setShippingMessage(
      payment && typeof expectedAmount === "number" && Number.isSafeInteger(expectedAmount) && bankName && accountNumber
        ? `배송 신청을 접수했습니다. ${expectedAmount.toLocaleString("ko-KR")}원 · ${bankName} ${accountNumber}로 입금해 주세요.`
        : shipment.settlement_method === "waiver"
          ? "배송 신청을 접수했습니다. 보유한 무료 배송 권한이 자동 적용되었습니다."
          : "배송 신청을 접수했습니다. 배송비 입금 확인 후 출고됩니다.",
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
  const logout = () => {
    if (logoutBusy || !token) return;
    setLogoutBusy(true);
    void (async () => {
      try {
        await logoutBrowserSession(token, basePath);
      } finally {
        setLogoutBusy(false);
      }
    })();
  };
  const openShippingRequest = () => {
    setShippingRequestOpen(true);
    window.requestAnimationFrame(() => {
      document.getElementById("shipping-request")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const homeActions: Array<HomeAction | null> = [
    pendingAuctionWins.length > 0 ? { description: "결제 마감 전 입금을 진행해 주세요.", label: "낙찰품 결제", value: pendingAuctionWins.length, view: "payments", Icon: ReceiptText } : null,
    visibleStorageItemCount > 0 ? { description: "배송 신청 전 보관 상품을 확인해 주세요.", label: "보관 상품 확인", value: visibleStorageItemCount, view: "storage", Icon: PackageCheck } : null,
    shipments.length > 0 ? { description: "요청·발송 중인 배송 상태를 확인해 주세요.", label: "배송 현황 확인", value: shipments.length, view: "shipping", Icon: Truck } : null,
  ];
  const actionableHomeItems = homeActions.filter((item): item is HomeAction => item !== null);
  return (
    <div className={surface === "desktop" ? "space-y-14" : "space-y-10"} data-account-dashboard-view={view}>
      <div hidden={!showOverview} className={`flex justify-between gap-5 border-b border-ink pb-8 ${surface === "desktop" ? "flex-row items-end" : "flex-col"}`}>
        <div className="min-w-0">
          <p className="eyebrow text-muted">MY / 지금 할 일</p>
          <h1 className={`mt-3 break-keep font-black tracking-[-0.08em] ${surface === "desktop" ? "text-4xl" : "text-3xl"}`}>
            안녕하세요, {userName}.
          </h1>
          <p className="mt-3 text-sm text-muted">
            결제부터 배송까지 지금 확인할 일을 먼저 보여드려요.
          </p>
        </div>
        {token ? (
          <div className="flex w-fit flex-wrap items-center gap-2">
            <button aria-label="로그아웃하기" className="inline-flex items-center gap-2 border border-line bg-paper px-4 py-3 text-xs font-bold disabled:opacity-40" disabled={logoutBusy} onClick={logout} type="button"><LogOut size={15} /> 로그아웃하기</button>
            <span className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
              <UserRound size={15} /> 로그인 상태
            </span>
          </div>
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
      {showOverview && !loading && !token && (
        <div className="border border-dashed border-line bg-surface p-6 text-sm">
          입찰, 장바구니, 보관 상품은 카카오 로그인 후 확인할 수 있습니다.
        </div>
      )}
      {notice && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {notice}
        </div>
      )}
      {homeOnly && showOverview && !loading && token && (
        <section aria-labelledby="my-home-actions-title" className="border border-line bg-paper p-5 sm:p-7">
          <div className="border-b border-line pb-4">
            <p className="eyebrow text-muted">MY / 지금 할 일</p>
            <h2 className="mt-2 text-xl font-black" id="my-home-actions-title">지금 처리해야 할 항목</h2>
            <p className="mt-2 text-xs leading-5 text-muted">확인이 필요한 작업만 모아 보여드려요.</p>
          </div>
          <div className="mt-5 divide-y divide-line border-y border-line">
            {actionableHomeItems.map(({ description, label, value, view: actionView, Icon }) => (
              <button className="flex w-full items-center gap-4 py-4 text-left transition-colors hover:bg-surface" key={label} onClick={() => onNavigate?.(actionView)} type="button">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface"><Icon size={17} /></span>
                <span className="min-w-0 flex-1"><strong className="block text-sm font-black">{label}</strong><span className="mt-1 block text-xs text-muted">{description}</span></span>
                <span className="font-mono text-lg font-bold">{value}</span>
              </button>
            ))}
            {actionableHomeItems.length === 0 && <p className="py-10 text-center text-sm text-muted">지금 처리할 일이 없습니다.</p>}
          </div>
        </section>
      )}
      <div hidden={!showOverview || homeOnly} className={`grid gap-px border border-line bg-line ${surface === "desktop" ? "grid-cols-4" : "grid-cols-2"}`}>
        {visibleCards.map(([label, value, description, href, Icon]) => {
          const cardView: AccountDashboardView = label === "낙찰품 결제" ? "payments" : label === "보관 중인 상품" ? "storage" : label === "배송 내역" ? "shipping" : "saved";
          const cardClassName = `group bg-paper text-left transition-colors hover:bg-surface ${surface === "desktop" ? "p-5" : "p-4"}`;
          const cardContent = <>
            <Icon size={17} />
            <p className={`text-xs text-muted ${surface === "desktop" ? "mt-8" : "mt-6"}`}>{label}</p>
            <p className="mt-2 font-mono text-3xl font-bold">{memberAccessRequired ? "—" : value}</p>
            <p className="mt-2 text-[11px] text-muted group-hover:text-ink">
              {description}
            </p>
          </>;
          return onNavigate ? <button className={`w-full ${cardClassName}`} key={label} onClick={() => onNavigate(cardView)} type="button">{cardContent}</button> : <Link className={cardClassName} href={href} key={label}>{cardContent}</Link>;
        })}
      </div>
      <section hidden={!showPayments} id="auction-payments">
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
              groups={paymentGroups}
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
      <div hidden={!showStorage && !showShippingRequest} className={`grid gap-10 ${surface === "desktop" && showStorage && showShippingRequest ? "grid-cols-[1.4fr_.8fr]" : "grid-cols-1"}`}>
        <section className="contents">
          <div
            className={surface === "desktop" && showShippingRequest ? "col-start-2 row-start-1" : ""}
            hidden={!showStorage}
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
            <div className="flex flex-wrap justify-end gap-2">
              {(hasHiddenStorage || showAllStorage) && (
                <button
                  className="text-xs font-bold underline"
                  onClick={() => setShowAllStorage((current) => !current)}
                  type="button"
                >
                  {showAllStorage ? "간략히 보기" : "전체보기"}
                </button>
              )}
              <Link className="border border-line bg-paper px-3 py-2 text-xs font-bold hover:bg-surface" href={`${basePath}/chat`}>
                배송 상담
              </Link>
              {view === "storage" && <button className="bg-ink px-3 py-2 text-xs font-bold text-paper disabled:opacity-40" onClick={openShippingRequest} type="button">배송 신청</button>}
            </div>
          </div>
          {centerShippingTokens.length > 0 && (
            <div className="mb-4 border border-line bg-surface p-3">
              <p className="text-xs font-bold">센터별 배송비 결제 현황</p>
              <p className="mt-1 text-[11px] leading-5 text-muted">
                배송비를 결제한 센터에는 보이지 않는 배송 토큰이 부여됩니다. 토큰이 남아 있는 센터는 추가 결제 없이 배송 신청할 수 있으며, 토큰을 모두 사용하면 해당 센터에 배송비만 따로 결제해 주세요.
              </p>
              <ul className="mt-2 space-y-1">
                {centerShippingTokens.map((token) => (
                  <li
                    className="flex items-center justify-between gap-3 text-[11px]"
                    key={token.businessId}
                  >
                    <span className="min-w-0 truncate font-bold">{token.businessName}</span>
                    <span className="shrink-0 font-bold text-emerald-700">
                      배송비 결제 {token.availableCount}회 완료
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="divide-y divide-line border-y border-line">
            {v2Storage.length === 0 &&
              settledLegacyAuctionWins.length === 0 &&
              legacyEligibleOrders.length === 0 && (
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
                        setSelectedInventoryItemIds(event.target.checked
                          ? requestEligibleItems.map((item) => item.id)
                          : []);
                        setSelectedOrderId("");
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
                              setSelectedInventoryItemIds((current) => event.target.checked
                                ? [...current, item.id]
                                : current.filter((id) => id !== item.id));
                              setSelectedOrderId("");
                            }}
                            type="checkbox"
                          />
                        </label>
                        <CatalogImage alt="" className="aspect-square w-full object-cover" sizes={surface === "desktop" ? "220px" : "50vw"} src={item.imageUrl} />
                        <div className="p-3">
                          <p className="line-clamp-2 min-h-10 text-sm font-bold">{item.title}</p>
                          <p className="mt-2 text-[11px] text-muted">{item.originStoreName ?? "매장 상품"}</p>
                          <p className={`mt-1 text-[11px] font-bold ${expires && expires.getTime() <= now ? "text-red-600" : "text-muted"}`}>
                            {item.storageClass === "large" ? "대형 · 1주 보관" : "소형 · 2주 보관"}
                            {expires
                              ? expires.getTime() <= now
                                ? " · 보관 만료"
                                : ` · ${expires.toLocaleDateString("ko-KR")}까지`
                              : ""}
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
                  <p className="mt-1 text-[11px] text-muted">전환 전 결제 완료 상품은 주문 단위로 전체 배송을 신청할 수 있습니다.</p>
                </div>
                {visibleLegacyEligibleOrders.map((order) => (
                  <label className="block cursor-pointer px-1 py-5" key={order.sourceId}>
                    <span className="flex items-start gap-3">
                      <input
                        aria-label={`주문 ${order.sourceId} 배송 선택`}
                        checked={selectedOrderId === order.sourceId}
                        name="legacy-shipping-order"
                        onChange={() => {
                          setSelectedInventoryItemIds([]);
                          setSelectedOrderId(order.sourceId);
                        }}
                        type="radio"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block break-all text-sm font-bold">주문 {order.sourceId}</span>
                        <span className="mt-1 block text-[11px] text-muted">
                          상품 {order.items.length}개 전체 · 보관 만료{" "}
                          {order.storageExpiresAt
                            ? new Date(order.storageExpiresAt).toLocaleDateString("ko-KR")
                            : "-"}
                        </span>
                      </span>
                    </span>
                    <span className={`mt-4 grid gap-3 ${surface === "desktop" ? "grid-cols-2" : "grid-cols-1"}`}>
                      {order.items.map((item) => (
                        <span className="flex min-w-0 items-center gap-3 border border-line p-3" key={item.orderItemId}>
                          <CatalogImage
                            alt=""
                            className="size-12 shrink-0 object-cover"
                            sizes="48px"
                            src={item.imageUrl}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-bold">{item.title}</span>
                            <span className="mt-1 block text-[10px] text-muted">
                              결제 완료 · 주문 전체 배송
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
            className={surface === "desktop" && showStorage ? "col-start-1 row-start-1" : ""}
            hidden={!showShippingRequest}
            id="shipping-request"
          >
          <div className="border border-line bg-surface p-4">
            <p className="eyebrow text-muted">상품 배송 / 합배송 신청</p>
            <h2 className="mt-2 text-xl font-black tracking-[-0.05em]">
              배송 신청
            </h2>
            <p className="text-xs font-bold">{selectedShippingMode === "legacy" ? "기존 주문 전체 배송 신청" : "선택 상품 배송 신청"}</p>
            <p className="mt-2 text-[11px] leading-5 text-muted">
              전환 완료 상품은 부분 선택해서, 전환 전 상품은 기존 주문 전체 단위로 신청합니다. 두 방식을 동시에 선택해서 신청할 수는 없습니다.
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
            <p className="mt-3 text-[11px] text-muted">배송지 변경·추가·삭제는 통합 작업공간의 설정 → 배송지에서 관리합니다.</p>
            <div className="mt-3 hidden grid grid-cols-3 gap-2">
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
              !selectedShippingMode ||
              !selectedAddressId
            }
            onClick={() => void requestShipping()}
            type="button"
          >
            {selectedShippingMode === "legacy" ? "선택 주문 전체 배송 신청" : "선택 상품 배송 신청"}
          </button>
          {shippingMessage && (
            <p aria-live="polite" className="mt-3 text-xs text-emerald-700">
              {shippingMessage}
            </p>
          )}
          </div>
        </section>
      </div>
      <details
        className="group border-y border-line py-1"
        hidden={!showRefunds}
        id="refunds"
        open={view === "refunds" ? true : undefined}
      >
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
      <section hidden={!showShipments} id="shipments">
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
                {shipment.trackingNumber && shipment.courier && <div className="flex flex-wrap gap-2">
                  <button className="inline-flex w-fit items-center gap-1 border border-ink px-3 py-2 text-xs font-bold" onClick={() => setTrackingShipment(shipment)} type="button">택배사 조회 <ExternalLink size={12} /></button>
                  {!shipment.purchaseConfirmedAt && shipment.purchaseConfirmationDueAt && <button className="bg-ink px-3 py-2 text-xs font-bold text-paper" onClick={() => setPurchaseConfirmationShipment(shipment)} type="button">구매 확정하기</button>}
                  {shipment.purchaseConfirmedAt && <span className="px-3 py-2 text-xs font-bold text-emerald-700">구매 확정 완료</span>}
                </div>}
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
      <section hidden={!showAddresses} id="addresses">
        <div className="mb-5 flex items-end justify-between border-b border-ink pb-4">
          <div>
            <p className="eyebrow text-muted">수령 정보 / 배송지</p>
            <h2 className="mt-2 text-xl font-black tracking-[-0.05em]">배송지 관리</h2>
          </div>
          <span className="text-xs text-muted">{addresses.length}곳</span>
        </div>
        <div className="divide-y divide-line border-y border-line">
          {addresses.map((address) => (
            <article className="py-5" key={address.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-black">
                    {address.label} · {address.recipient_name}
                    {address.is_default && <span className="ml-2 border border-line px-2 py-0.5 text-[9px]">기본</span>}
                  </p>
                  <p className="mt-2 text-xs text-muted">{address.phone}</p>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    {address.postal_code ? `[${address.postal_code}] ` : ""}{address.address}
                  </p>
                </div>
                <button className="shrink-0 border border-line px-3 py-2 text-xs font-bold" onClick={() => openAddressEdit(address)} type="button">
                  수정
                </button>
              </div>
            </article>
          ))}
          {addresses.length === 0 && <p className="py-12 text-center text-sm text-muted">등록된 배송지가 없습니다.</p>}
        </div>
        <button className="mt-4 min-h-12 w-full bg-ink px-4 text-sm font-black text-paper" onClick={openAddressCreate} type="button">
          새 배송지 추가
        </button>
      </section>
      <section hidden={!showLikes} id="likes">
        <div className="mb-5 flex items-end justify-between border-b border-ink pb-4">
          <div>
            <p className="eyebrow text-muted">찜 목록</p>
            <h2 className="mt-2 text-xl font-black tracking-[-0.05em]">
              찜한 상품
            </h2>
          </div>
          <span className="text-xs text-muted">{likedCount}개</span>
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
                          aria-pressed={pendingDeleteAddressId === address.id}
                          className={`min-h-11 border px-3 py-2 text-[10px] font-bold ${
                            pendingDeleteAddressId === address.id
                              ? "border-rose-700 bg-rose-700 text-white"
                              : "border-rose-300 text-rose-700"
                          }`}
                          onClick={() => {
                            if (pendingDeleteAddressId === address.id) {
                              void deleteAddress(address);
                              return;
                            }
                            setPendingDeleteAddressId(address.id);
                          }}
                          type="button"
                        >
                          {pendingDeleteAddressId === address.id ? "삭제 확인" : "삭제"}
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
      <PremiumDialog labelledBy="purchase-confirmation-title" onClose={() => !purchaseConfirmationBusy && setPurchaseConfirmationShipment(null)} open={Boolean(purchaseConfirmationShipment)} panelClassName="max-w-md">
        <div className="p-6">
          <p className="eyebrow text-muted">배송 상품 확인</p>
          <h2 className="mt-2 text-xl font-black" id="purchase-confirmation-title">구매를 확정할까요?</h2>
          <p className="mt-4 text-sm leading-6">상품을 확인하고 구매 확정을 눌러주세요. 확정하면 거래가 완료되고 판매자 정산 절차가 시작되며 되돌릴 수 없습니다.</p>
          <div className="mt-6 grid grid-cols-2 gap-2">
            <button className="h-11 border border-ink text-xs font-bold" disabled={purchaseConfirmationBusy} onClick={() => setPurchaseConfirmationShipment(null)} type="button">취소</button>
            <button className="h-11 bg-ink text-xs font-bold text-paper disabled:opacity-50" disabled={purchaseConfirmationBusy} onClick={async () => {
              if (!token || !purchaseConfirmationShipment) return;
              setPurchaseConfirmationBusy(true);
              const targetId = purchaseConfirmationShipment.id;
              try {
                const response = await fetch("/api/account/shipments", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ shipmentId: targetId }) });
                const payload = await response.json().catch(() => null) as { error?: string } | null;
                if (!response.ok) throw new Error(payload?.error ?? "구매를 확정하지 못했습니다.");
                setShipments((current) => current.map((item) => item.id === targetId ? { ...item, purchaseConfirmedAt: new Date().toISOString(), purchaseConfirmedBy: "member" } : item));
                setPurchaseConfirmationShipment(null);
                setShippingMessage("구매가 확정되었습니다.");
              } catch (error) { setShippingMessage(error instanceof Error ? error.message : "구매를 확정하지 못했습니다."); }
              finally { setPurchaseConfirmationBusy(false); }
            }} type="button">{purchaseConfirmationBusy ? "확정 중..." : "확정하기"}</button>
          </div>
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

export function AccountDashboard({
  basePath = "",
  homeOnly = false,
  onNavigate,
  surface = "mobile",
  view = "full",
}: {
  basePath?: "" | "/m";
  homeOnly?: boolean;
  onNavigate?: (view: AccountDashboardView) => void;
  surface?: "desktop" | "mobile";
  view?: AccountDashboardView;
}) {
  const { identityRevision, loading, session } = useSupabaseSession();
  const identityKey = loading
    ? "loading"
    : `${session?.user.id ?? "guest"}:${identityRevision}`;
  return (
    <AccountDashboardForSession
      basePath={basePath}
      homeOnly={homeOnly}
      key={identityKey}
      loading={loading}
      onNavigate={onNavigate}
      session={session}
      surface={surface}
      view={view}
    />
  );
}
