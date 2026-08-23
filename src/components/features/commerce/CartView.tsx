"use client";

import Link from "next/link";
import { ArrowRight, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { persistCart } from "@/lib/commerce/client";
import { COMMERCE_CHECKOUT_STORAGE_KEY } from "@/lib/commerce/checkoutStorage";
import { deriveCartPricing } from "@/lib/commerce/cartPricing";
import {
  readCommercePaymentMode,
  type CommercePaymentMode,
} from "@/lib/commerce/paymentMode";
import { useCommerceStore } from "@/store/useCommerceStore";
import { useCartStore } from "@/store/useCartStore";
import { useToastStore } from "@/store/useToastStore";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { PostcodeSearchButton } from "@/components/features/account/PostcodeSearchButton";
import { usePlatformConfig } from "@/hooks/usePlatformConfig";

interface PublishedFixedProduct {
  id: string;
  title: string;
  description: string;
  category: string;
  publishAt: string;
  closesAt: string;
  startingPrice: number;
  currentPrice: number;
  fixedPrice: number | null;
  imageUrls: string[];
  storageClass?: "small" | "large";
  sizeLabel?: string;
  conditionGrade?: "S" | "A" | "B" | "C";
  reservationExpiresAt?: string | null;
  storeName?: string;
}

interface ShippingCharge {
  chargeKey: string;
  mode: "per_store" | "per_group";
  groupId: string | null;
  groupName: string | null;
  unitKind: "store" | "fulfillment_group";
  unitName: string;
  billingStoreId: string;
  billingStoreName: string;
  amount: number;
  vaultAmount?: number;
  productSubtotal: number;
  productIds: string[];
  products: Array<{ id: string; title: string; amount: number }>;
  storeIds: string[];
  storeNames: string[];
}

interface CartProduct {
  id: string;
  title: string;
  category: string;
  size: string;
  condition: "NEW" | "EXCELLENT" | "GOOD" | "FAIR";
  saleType: "fixed";
  price: number;
  closesAt: string;
  store: { name: string };
  imageUrls: string[];
  reservationExpiresAt?: string | null;
}

type CartAccess = "loading" | "member" | "guest";
type CartPaymentMode = "loading" | CommercePaymentMode | "unavailable";

function formatPhoneNumber(value: string): string {
  const digits = value.replace(/\D/gu, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

class CheckoutSessionChangedError extends Error {
  constructor() {
    super("인증 세션이 변경되었습니다.");
    this.name = "CheckoutSessionChangedError";
  }
}

interface CheckoutOrder {
  id: string;
  total: number;
}

interface CheckoutTransfer {
  order_id: string;
  bank_name_snapshot: string;
  account_number_snapshot: string;
  expected_amount: number;
  status: "awaiting_transfer" | "partially_paid" | "confirmed";
}

interface StoredCheckoutRequest {
  idempotencyKey: string;
  buyerId: string;
  productSignature: string;
  productIds: string[];
  productSnapshots: CartProduct[];
  ledgerMayExist: boolean;
  includeShippingFee: boolean;
  shippingFeeQuote: number;
  shippingRegion: "regular" | "remote_area";
  shippingAddressId: string;
}

interface ShippingAddress {
  address: string;
  id: string;
  is_default: boolean;
  label: string;
  phone: string;
  postal_code: string;
  recipient_name: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFINITELY_PRE_LEDGER_ERRORS = new Set([
  "unauthorized",
  "forbidden",
  "member_required",
  "member_unavailable",
  "service_unavailable",
  "manual_transfer_configuration_missing",
  "payment_status_unavailable",
  "invalid_expected_payment_mode",
  "payment_mode_changed",
  "checkout_request_releasable",
]);
const conditionLabels: Record<CartProduct["condition"], string> = {
  NEW: "새 상품 수준",
  EXCELLENT: "매우 좋음",
  GOOD: "좋음",
  FAIR: "사용감 있음",
};

function createProductSignature(productIds: readonly string[]): string {
  return [...productIds].sort().join(",");
}

function isSafeImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 2048) return false;
  if (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
  ) {
    return true;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeProductSnapshot(value: unknown): CartProduct | null {
  if (!value || typeof value !== "object") return null;
  const product = value as Record<string, unknown>;
  const store = product.store;
  const imageUrls = product.imageUrls;
  if (
    typeof product.id !== "string" ||
    !UUID_PATTERN.test(product.id) ||
    typeof product.title !== "string" ||
    !product.title.trim() ||
    product.title.length > 300 ||
    typeof product.category !== "string" ||
    product.category.length > 100 ||
    typeof product.size !== "string" ||
    product.size.length > 100 ||
    !["NEW", "EXCELLENT", "GOOD", "FAIR"].includes(
      typeof product.condition === "string" ? product.condition : "",
    ) ||
    product.saleType !== "fixed" ||
    !Number.isSafeInteger(product.price) ||
    (product.price as number) <= 0 ||
    (product.price as number) > 1_000_000_000 ||
    typeof product.closesAt !== "string" ||
    !Number.isFinite(Date.parse(product.closesAt)) ||
    !store ||
    typeof store !== "object" ||
    typeof (store as Record<string, unknown>).name !== "string" ||
    !(store as Record<string, string>).name.trim() ||
    (store as Record<string, string>).name.length > 150 ||
    !Array.isArray(imageUrls) ||
    imageUrls.length > 20 ||
    !imageUrls.every(isSafeImageUrl)
  ) {
    return null;
  }

  return {
    id: product.id,
    title: product.title.trim(),
    category: product.category,
    size: product.size,
    condition: product.condition as CartProduct["condition"],
    saleType: "fixed",
    price: product.price as number,
    closesAt: product.closesAt,
    store: { name: (store as Record<string, string>).name.trim() },
    imageUrls: [...imageUrls],
  };
}

function createProductSnapshot(product: CartProduct): CartProduct {
  return {
    ...product,
    store: { name: product.store.name },
    imageUrls: [...product.imageUrls],
  };
}

const checkoutErrorMessages: Record<string, string> = {
  unauthorized: "로그인이 만료되었습니다. 카카오로 다시 로그인해 주세요.",
  forbidden:
    "안전한 주문 요청을 확인하지 못했습니다. 페이지를 새로고침해 주세요.",
  member_required: "카카오 회원 계정으로 로그인한 뒤 다시 시도해 주세요.",
  member_unavailable:
    "회원 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  service_unavailable:
    "주문 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  member_payment_required:
    "카카오 회원 상태와 필수 프로필을 확인한 뒤 다시 시도해 주세요.",
  payment_not_available:
    "현재 장바구니 상품을 결제할 수 없습니다. 상품 상태를 다시 확인해 주세요.",
  checkout_failed: "주문을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  order_creation_failed:
    "주문 원장을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
  transfer_creation_failed:
    "입금 안내를 만들지 못했습니다. 주문 내역을 확인하거나 운영팀에 문의해 주세요.",
  manual_transfer_configuration_missing:
    "운영자가 입금 계좌를 설정한 후 주문할 수 있습니다.",
  payment_status_unavailable:
    "결제 설정을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  invalid_expected_payment_mode:
    "결제 방식 확인 정보가 올바르지 않습니다. 페이지를 새로고침해 주세요.",
  payment_mode_changed:
    "결제 방식이 변경되었습니다. 변경된 내용을 확인한 뒤 결제 버튼을 다시 눌러 주세요.",
  checkout_request_releasable:
    "주문 원장이 생성되지 않았습니다. 결제 요청을 해제한 뒤 장바구니를 수정하거나 다시 시도할 수 있습니다.",
};

function isCheckoutOrder(value: unknown): value is CheckoutOrder {
  if (!value || typeof value !== "object") return false;
  const order = value as Record<string, unknown>;
  return (
    typeof order.id === "string" &&
    order.id.length > 0 &&
    Number.isSafeInteger(order.total) &&
    (order.total as number) > 0
  );
}

function isCheckoutTransfer(
  value: unknown,
  order: CheckoutOrder,
): value is CheckoutTransfer {
  if (!value || typeof value !== "object") return false;
  const transfer = value as Record<string, unknown>;
  return (
    transfer.order_id === order.id &&
    transfer.expected_amount === order.total &&
    typeof transfer.bank_name_snapshot === "string" &&
    transfer.bank_name_snapshot.trim().length > 0 &&
    typeof transfer.account_number_snapshot === "string" &&
    transfer.account_number_snapshot.trim().length > 0 &&
    ["awaiting_transfer", "partially_paid", "confirmed"].includes(
      transfer.status as string,
    )
  );
}

function readCheckoutError(value: unknown): string {
  if (!value || typeof value !== "object") return "주문을 만들지 못했습니다.";
  const error = (value as Record<string, unknown>).error;
  if (typeof error !== "string" || !error.trim()) {
    return "주문을 만들지 못했습니다.";
  }
  const normalized = error.trim();
  if (checkoutErrorMessages[normalized]) {
    return checkoutErrorMessages[normalized];
  }
  // Preserve intentional Korean server messages, but never expose an
  // unrecognized internal snake_case code to a shopper.
  return /^[a-z0-9_]+$/i.test(normalized)
    ? "주문을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."
    : normalized;
}

function readCheckoutErrorCode(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" && /^[a-z0-9_]+$/i.test(error.trim())
    ? error.trim()
    : null;
}

function readStoredCheckoutRequest(options?: {
  buyerId?: string;
  productSignature?: string;
}): StoredCheckoutRequest | null {
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(COMMERCE_CHECKOUT_STORAGE_KEY) ?? "null",
    ) as Record<string, unknown> | null;
    const productIds = parsed?.productIds;
    const rawSnapshots = parsed?.productSnapshots;
    const snapshots = Array.isArray(rawSnapshots)
      ? rawSnapshots.map(normalizeProductSnapshot)
      : [];
    if (
      parsed &&
      typeof parsed.buyerId === "string" &&
      UUID_PATTERN.test(parsed.buyerId) &&
      (!options?.buyerId || parsed.buyerId === options.buyerId) &&
      parsed.paymentId === undefined &&
      parsed.commerceOrderId === undefined &&
      typeof parsed.idempotencyKey === "string" &&
      IDEMPOTENCY_KEY_PATTERN.test(parsed.idempotencyKey) &&
      Array.isArray(productIds) &&
      productIds.length > 0 &&
      productIds.length <= 50 &&
      productIds.every(
        (productId): productId is string =>
          typeof productId === "string" && UUID_PATTERN.test(productId),
      ) &&
      new Set(productIds).size === productIds.length &&
      snapshots.length === productIds.length &&
      snapshots.every(
        (snapshot): snapshot is CartProduct => snapshot !== null,
      ) &&
      typeof parsed.productSignature === "string" &&
      createProductSignature(productIds) === parsed.productSignature &&
      (!options?.productSignature ||
        parsed.productSignature === options.productSignature) &&
      createProductSignature(snapshots.map((snapshot) => snapshot.id)) ===
        parsed.productSignature &&
      (parsed.includeShippingFee === undefined ||
        typeof parsed.includeShippingFee === "boolean") &&
      (parsed.shippingFeeQuote === undefined ||
        (Number.isSafeInteger(parsed.shippingFeeQuote) &&
          Number(parsed.shippingFeeQuote) >= 0 &&
          Number(parsed.shippingFeeQuote) <= 50_000_000))
    ) {
      return {
        buyerId: parsed.buyerId,
        idempotencyKey: parsed.idempotencyKey,
        productSignature: parsed.productSignature,
        productIds: [...productIds],
        productSnapshots: snapshots,
        // Older saved requests may already have reached the server. Treat an
        // absent marker as ambiguous and only permit an explicit resume.
        ledgerMayExist: parsed.ledgerMayExist !== false,
        // A request persisted by the previous UI had no shipping selector and
        // therefore represents a product-only order.
        includeShippingFee: parsed.includeShippingFee === true,
        shippingFeeQuote: Number(parsed.shippingFeeQuote ?? 0),
        shippingRegion:
          parsed.shippingRegion === "remote_area" ? "remote_area" : "regular",
        shippingAddressId:
          typeof parsed.shippingAddressId === "string"
            ? parsed.shippingAddressId
            : "",
      };
    }
  } catch {
    // Session storage is an optimization; the in-memory key still protects a retry.
  }
  return null;
}

function storeCheckoutRequest(request: StoredCheckoutRequest): void {
  try {
    window.sessionStorage.setItem(
      COMMERCE_CHECKOUT_STORAGE_KEY,
      JSON.stringify(request),
    );
  } catch {
    // The current page still retains the request key in memory.
  }
}

function clearStoredCheckoutRequest(): void {
  try {
    window.sessionStorage.removeItem(COMMERCE_CHECKOUT_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in a restricted browser context.
  }
}

function toCartProduct(product: PublishedFixedProduct): CartProduct {
  const grade = product.conditionGrade ?? "A";
  return {
    id: product.id,
    title: product.title,
    category: product.category,
    size: product.sizeLabel || "사이즈 미등록",
    condition:
      grade === "S"
        ? "NEW"
        : grade === "A"
          ? "EXCELLENT"
          : grade === "B"
            ? "GOOD"
            : "FAIR",
    saleType: "fixed",
    price: product.fixedPrice ?? product.currentPrice,
    closesAt: product.closesAt,
    store: { name: product.storeName || "NINETY-NINE VINTAGE" },
    imageUrls: product.imageUrls,
    reservationExpiresAt: product.reservationExpiresAt ?? null,
  };
}

export function CartView({
  basePath = "",
  selectedProductId,
  surface = "mobile",
}: {
  basePath?: "" | "/m";
  selectedProductId?: string;
  surface?: "desktop" | "mobile";
}) {
  const hydrate = useCommerceStore((state) => state.hydrate);
  const cartIds = useCommerceStore((state) => state.cartIds);
  const removeFromCart = useCommerceStore((state) => state.removeFromCart);
  const addToCart = useCommerceStore((state) => state.addToCart);
  const removePurchasedFromCart = useCommerceStore(
    (state) => state.removePurchasedFromCart,
  );
  const clearCart = useCommerceStore((state) => state.clearCart);
  const replaceCart = useCommerceStore((state) => state.replaceCart);
  const pushToast = useToastStore((state) => state.pushToast);
  const platformConfig = usePlatformConfig();
  const [liveProducts, setLiveProducts] = useState<CartProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [cartLoading, setCartLoading] = useState(true);
  const [access, setAccess] = useState<CartAccess>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<
    "success" | "warning" | "error"
  >("success");
  const [staleCount, setStaleCount] = useState(0);
  const [paymentMode, setPaymentMode] = useState<CartPaymentMode>("loading");
  const [shippingCharges, setShippingCharges] = useState<ShippingCharge[]>([]);
  const [shippingAvailable, setShippingAvailable] = useState(true);
  const shippingMode = useCartStore(
    (state) => state.shippingModes.checkout ?? "ship",
  );
  const setShippingMode = useCartStore((state) => state.setShippingMode);
  const reconcileCartIds = useCartStore((state) => state.reconcileCartIds);
  const includeShippingFee = shippingMode === "ship";
  const setIncludeShippingFee = useCallback(
    (include: boolean) =>
      setShippingMode("checkout", include ? "ship" : "vault"),
    [setShippingMode],
  );
  const [shippingRegion, setShippingRegion] = useState<
    "regular" | "remote_area"
  >("regular");
  const [shippingAddresses, setShippingAddresses] = useState<ShippingAddress[]>(
    [],
  );
  const [shippingAddressId, setShippingAddressId] = useState("");
  const [addressEditorOpen, setAddressEditorOpen] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [addressBusy, setAddressBusy] = useState(false);
  const [pendingDeleteAddressId, setPendingDeleteAddressId] = useState<
    string | null
  >(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [mobileSummaryExpanded, setMobileSummaryExpanded] = useState(false);
  const [addressForm, setAddressForm] = useState({
    label: "집",
    recipientName: "",
    phone: "",
    postalCode: "",
    address: "",
    isDefault: false,
  });
  const [heldCheckoutIds, setHeldCheckoutIds] = useState<string[]>([]);
  const [pendingShippingFee, setPendingShippingFee] = useState<number | null>(
    null,
  );
  const [releaseCheckoutAllowed, setReleaseCheckoutAllowed] = useState(false);
  const [restoredCheckoutProducts, setRestoredCheckoutProducts] = useState<
    CartProduct[]
  >([]);
  const checkoutRequest = useRef<StoredCheckoutRequest | null>(null);
  const authGeneration = useRef(0);
  const authUserId = useRef<string | null>(null);
  const cartOwnerId = useRef<string | null>(null);
  const cartIdsRef = useRef<string[]>([]);
  const cartRefreshRef = useRef<(() => void) | null>(null);
  const checkoutOperationSequence = useRef(0);
  const activeCheckoutOperation = useRef<number | null>(null);
  const invalidateCheckoutRequest = () => {
    checkoutRequest.current = null;
    setHeldCheckoutIds([]);
    setPendingShippingFee(null);
    setRestoredCheckoutProducts([]);
    setReleaseCheckoutAllowed(false);
    clearStoredCheckoutRequest();
  };

  const openAddressCreate = () => {
    setEditingAddressId(null);
    setPendingDeleteAddressId(null);
    setAddressForm({
      label: "집",
      recipientName: "",
      phone: "",
      postalCode: "",
      address: "",
      isDefault: shippingAddresses.length === 0,
    });
    setAddressEditorOpen(true);
  };

  const openAddressEdit = (address: ShippingAddress) => {
    setEditingAddressId(address.id);
    setPendingDeleteAddressId(null);
    setAddressForm({
      label: address.label,
      recipientName: address.recipient_name,
      phone: address.phone,
      postalCode: address.postal_code,
      address: address.address,
      isDefault: address.is_default,
    });
    setAddressEditorOpen(true);
  };

  const reloadCheckoutAddresses = async (preferredId?: string) => {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    if (!data.session?.access_token)
      throw new Error("로그인 후 배송지를 관리할 수 있습니다.");
    const response = await fetch("/api/account/addresses", {
      headers: { Authorization: `Bearer ${data.session.access_token}` },
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as {
      addresses?: ShippingAddress[];
      error?: string;
    } | null;
    if (!response.ok)
      throw new Error(payload?.error ?? "배송지 목록을 불러오지 못했습니다.");
    const addresses = Array.isArray(payload?.addresses)
      ? payload.addresses
      : [];
    setShippingAddresses(addresses);
    setShippingAddressId((current) =>
      preferredId && addresses.some((address) => address.id === preferredId)
        ? preferredId
        : addresses.some((address) => address.id === current)
          ? current
          : (addresses.find((address) => address.is_default)?.id ??
            addresses[0]?.id ??
            ""),
    );
  };

  const saveCheckoutAddress = async () => {
    if (addressBusy) return;
    if (!/^010-\d{4}-\d{4}$/u.test(addressForm.phone)) {
      setMessageKind("error");
      setMessage("연락처를 010-0000-0000 형식으로 입력해 주세요.");
      return;
    }
    setAddressBusy(true);
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session?.access_token)
        throw new Error("로그인 후 배송지를 관리할 수 있습니다.");
      const response = await fetch("/api/account/addresses", {
        method: editingAddressId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({
          id: editingAddressId ?? undefined,
          ...addressForm,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        address?: ShippingAddress;
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.error ?? "배송지를 저장하지 못했습니다.");
      invalidateCheckoutRequest();
      await reloadCheckoutAddresses(payload?.address?.id);
      setAddressEditorOpen(false);
      setMessageKind("success");
      setMessage("배송지를 저장하고 결제 배송지로 선택했습니다.");
    } catch (error) {
      setMessageKind("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "배송지를 저장하지 못했습니다.",
      );
    } finally {
      setAddressBusy(false);
    }
  };

  const deleteCheckoutAddress = async (address: ShippingAddress) => {
    if (addressBusy) return;
    if (pendingDeleteAddressId !== address.id) {
      setPendingDeleteAddressId(address.id);
      return;
    }
    setAddressBusy(true);
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session?.access_token)
        throw new Error("로그인 후 배송지를 관리할 수 있습니다.");
      const response = await fetch("/api/account/addresses", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({ id: address.id }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.error ?? "배송지를 삭제하지 못했습니다.");
      if (shippingAddressId === address.id) invalidateCheckoutRequest();
      setPendingDeleteAddressId(null);
      await reloadCheckoutAddresses();
      setMessageKind("success");
      setMessage("배송지를 삭제했습니다.");
    } catch (error) {
      setMessageKind("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "배송지를 삭제하지 못했습니다.",
      );
    } finally {
      setAddressBusy(false);
    }
  };

  useEffect(() => {
    cartIdsRef.current = cartIds;
  }, [cartIds]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    let disposed = false;
    let loadSequence = 0;
    let authEventSequence = 0;
    let lastSessionKey: string | null = null;

    const loadCachedCartProducts = async (productIds: readonly string[]) => {
      if (productIds.length === 0) {
        return { authoritative: true, products: [] as CartProduct[] };
      }
      const response = await fetch("/api/products?saleType=fixed&limit=100", {
        cache: "no-store",
      });
      if (!response.ok) {
        return { authoritative: false, products: [] as CartProduct[] };
      }
      const payload = (await response.json()) as {
        products?: PublishedFixedProduct[];
      };
      const wanted = new Set(productIds);
      const publishedProducts = Array.isArray(payload.products)
        ? payload.products
        : [];
      return {
        authoritative: true,
        products: publishedProducts
          .filter((product) => wanted.has(product.id))
          .map(toCartProduct),
      };
    };

    const clearMemberState = (clearRecovery = true, preserveCart = false) => {
      activeCheckoutOperation.current = null;
      checkoutOperationSequence.current += 1;
      checkoutRequest.current = null;
      cartOwnerId.current = null;
      setHeldCheckoutIds([]);
      setPendingShippingFee(null);
      setRestoredCheckoutProducts([]);
      setReleaseCheckoutAllowed(false);
      if (clearRecovery) clearStoredCheckoutRequest();
      if (!preserveCart) {
        setLiveProducts([]);
        replaceCart([]);
      }
      setStaleCount(0);
      setPaymentMode("loading");
      setShippingCharges([]);
      setShippingAvailable(true);
      setShippingAddresses([]);
      setShippingAddressId("");
      setIncludeShippingFee(true);
      setMessage("");
      setMessageKind("success");
      setBusy(false);
    };

    const loadSession = async (session: Session | null) => {
      cartRefreshRef.current = () => {
        void loadSession(session);
      };
      const sequence = ++loadSequence;
      const nextUserId = session?.user.id ?? null;
      const identityChanged = authUserId.current !== nextUserId;
      if (identityChanged) authGeneration.current += 1;
      authUserId.current = nextUserId;

      if (!session?.access_token) {
        cartRefreshRef.current = null;
        const guestCartIds = useCommerceStore.getState().cartIds;
        clearMemberState(true, true);
        setAccess("guest");
        setProductsLoading(guestCartIds.length > 0);
        setCartLoading(false);
        const cachedResult = await loadCachedCartProducts(guestCartIds);
        if (!disposed && authUserId.current === null) {
          setLiveProducts(cachedResult.products);
          if (cachedResult.authoritative) {
            const liveIds = cachedResult.products.map((product) => product.id);
            replaceCart(liveIds);
            reconcileCartIds(liveIds);
          }
          setProductsLoading(false);
        }
        return;
      }

      if (identityChanged) {
        clearMemberState();
        setAccess("loading");
        setProductsLoading(true);
        setCartLoading(true);
      }

      const token = session.access_token;
      const buyerId = session.user.id;
      cartOwnerId.current = buyerId;
      const isCurrent = () =>
        !disposed &&
        sequence === loadSequence &&
        authUserId.current === buyerId;

      try {
        const stored = readStoredCheckoutRequest({ buyerId });
        const activeRequest = stored;
        if (activeRequest) {
          checkoutRequest.current = activeRequest;
          setHeldCheckoutIds(activeRequest.productIds);
          setPendingShippingFee(activeRequest.shippingFeeQuote);
          setRestoredCheckoutProducts(activeRequest.productSnapshots);
          setReleaseCheckoutAllowed(!activeRequest.ledgerMayExist);
          setIncludeShippingFee(activeRequest.includeShippingFee);
        } else {
          checkoutRequest.current = null;
          setHeldCheckoutIds([]);
          setPendingShippingFee(null);
          setRestoredCheckoutProducts([]);
          setReleaseCheckoutAllowed(false);
          clearStoredCheckoutRequest();
        }

        if (!isCurrent()) return;
        setAccess("member");
        const addressResponse = await fetch("/api/account/addresses", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const addressPayload = addressResponse.ok
          ? ((await addressResponse.json()) as {
              addresses?: ShippingAddress[];
            })
          : { addresses: [] };
        if (isCurrent()) {
          const addresses = Array.isArray(addressPayload.addresses)
            ? addressPayload.addresses
            : [];
          setShippingAddresses(addresses);
          setShippingAddressId((current) =>
            addresses.some((address) => address.id === current)
              ? current
              : (addresses.find((address) => address.is_default)?.id ??
                addresses[0]?.id ??
                ""),
          );
        }
        const response = await fetch(
          `/api/cart?shippingRegion=${shippingRegion}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          },
        );
        if (!isCurrent()) return;
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            authGeneration.current += 1;
            authUserId.current = null;
            clearMemberState();
            setAccess("guest");
            setProductsLoading(false);
            setCartLoading(false);
          } else {
            throw new Error(`장바구니 API 응답 오류 (${response.status})`);
          }
          return;
        }
        const payload = (await response.json()) as {
          paymentMode?: unknown;
          productIds?: string[];
          staleProductIds?: string[];
          items?: PublishedFixedProduct[];
          shippingFee?: unknown;
          shippingCharges?: ShippingCharge[];
          shippingAvailable?: boolean;
        };
        if (!isCurrent()) return;
        if (payload.paymentMode !== "manual_transfer") {
          setPaymentMode("unavailable");
          setMessageKind("warning");
          setMessage(
            "상품은 정상적으로 불러왔지만 결제 설정을 확인하고 있습니다.",
          );
        } else {
          setPaymentMode(payload.paymentMode);
        }
        const cartProducts = Array.isArray(payload.items)
          ? payload.items.map(toCartProduct)
          : [];
        const nextShippingFee = Number(payload.shippingFee);
        const nextShippingAvailable = payload.shippingAvailable !== false;
        if (
          cartProducts.length > 0 &&
          nextShippingAvailable &&
          (!Number.isSafeInteger(nextShippingFee) || nextShippingFee < 1)
        ) {
          throw new Error("배송비 설정을 확인하지 못했습니다.");
        }
        setShippingAvailable(nextShippingAvailable);
        if (!activeRequest) {
          setShippingCharges(
            nextShippingAvailable && Array.isArray(payload.shippingCharges)
              ? payload.shippingCharges
              : [],
          );
          if (!nextShippingAvailable) setIncludeShippingFee(false);
        }
        const ids = Array.isArray(payload.productIds)
          ? payload.productIds.filter(
              (id): id is string => typeof id === "string" && Boolean(id),
            )
          : cartProducts.map((product) => product.id);
        setLiveProducts(cartProducts);
        replaceCart(ids);
        reconcileCartIds(ids);
        setStaleCount(
          Array.isArray(payload.staleProductIds)
            ? payload.staleProductIds.length
            : 0,
        );
      } catch (loadError) {
        if (!isCurrent()) return;
        // A transient cart/API failure must not masquerade as logout or expose
        // anonymous fallback data over an authenticated member snapshot.
        setAccess("member");
        setPaymentMode("unavailable");
        const cachedIds = useCommerceStore.getState().cartIds;
        const cachedResult = await loadCachedCartProducts(cachedIds);
        if (!isCurrent()) return;
        setLiveProducts((current) =>
          current.length > 0 ? current : cachedResult.products,
        );
        setMessageKind("warning");
        setMessage(
          "장바구니 결제 정보를 갱신하지 못했습니다. 상품 목록은 임시 저장된 정보로 표시합니다.",
        );
        console.error(
          "[cart] server refresh failed; rendered cached products",
          loadError,
        );
      } finally {
        if (!isCurrent()) return;
        setProductsLoading(false);
        setCartLoading(false);
      }
    };

    const scheduleSession = (session: Session | null) => {
      const sessionKey = session
        ? `${session.user.id}:${session.access_token}`
        : "guest";
      if (sessionKey === lastSessionKey) return;
      lastSessionKey = sessionKey;
      void loadSession(session);
    };

    const handleUnconfirmedSessionReadFailure = () => {
      // A storage/auth read failure is not proof of logout. Hide all member
      // data, but preserve the buyer-bound idempotency/payment recovery record
      // until an explicit null session or account transition is observed.
      clearMemberState(false);
      setAccess("guest");
      setProductsLoading(false);
      setCartLoading(false);
    };

    try {
      const client = getSupabaseBrowserClient();
      const eventSequenceAtRead = authEventSequence;
      void client.auth
        .getSession()
        .then(({ data }) => {
          if (!disposed && authEventSequence === eventSequenceAtRead) {
            scheduleSession(data.session);
          }
        })
        .catch(() => {
          if (!disposed && authEventSequence === eventSequenceAtRead) {
            handleUnconfirmedSessionReadFailure();
          }
        });
      const { data: listener } = client.auth.onAuthStateChange(
        (_event, session) => {
          authEventSequence += 1;
          scheduleSession(session);
        },
      );
      return () => {
        disposed = true;
        cartRefreshRef.current = null;
        loadSequence += 1;
        authGeneration.current += 1;
        listener.subscription.unsubscribe();
      };
    } catch {
      handleUnconfirmedSessionReadFailure();
      return () => {
        disposed = true;
        cartRefreshRef.current = null;
        loadSequence += 1;
        authGeneration.current += 1;
      };
    }
  }, [reconcileCartIds, replaceCart, setIncludeShippingFee, shippingRegion]);

  useEffect(() => {
    if (access !== "member") return;
    let client: ReturnType<typeof getSupabaseBrowserClient>;
    try {
      client = getSupabaseBrowserClient();
    } catch {
      return;
    }
    const channel = client
      .channel("member-cart-product-events")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        (payload) => {
          const record =
            payload.new && typeof payload.new === "object"
              ? (payload.new as Record<string, unknown>)
              : payload.old && typeof payload.old === "object"
                ? (payload.old as Record<string, unknown>)
                : null;
          const productId = typeof record?.id === "string" ? record.id : null;
          if (productId && cartIdsRef.current.includes(productId)) {
            cartRefreshRef.current?.();
          }
        },
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [access]);

  const products = useMemo(() => {
    // A prepared order is immutable. While it is pending, show and retry only
    // that persisted item set; newly added cart items belong to a later order.
    const visibleIds = [
      ...new Set(heldCheckoutIds.length > 0 ? heldCheckoutIds : cartIds),
    ];
    const productById = new Map(
      restoredCheckoutProducts.map((product) => [product.id, product]),
    );
    for (const product of liveProducts) productById.set(product.id, product);
    const visibleProducts = visibleIds
      .map((productId) => productById.get(productId))
      .filter((product): product is CartProduct => Boolean(product));
    if (heldCheckoutIds.length > 0 || !selectedProductId)
      return visibleProducts;
    return visibleProducts.filter(
      (product) => product.id === selectedProductId,
    );
  }, [
    cartIds,
    heldCheckoutIds,
    liveProducts,
    restoredCheckoutProducts,
    selectedProductId,
  ]);
  const hasPendingCheckout = heldCheckoutIds.length > 0;
  const pricing = useMemo(
    () =>
      deriveCartPricing(
        products,
        shippingCharges,
        includeShippingFee ? "ship" : "vault",
      ),
    [includeShippingFee, products, shippingCharges],
  );
  const {
    activeCharges: activeShippingCharges,
    activeProductIds,
    productTotal,
    shippingFee: derivedShippingFee,
  } = pricing;
  const selectedShippingFee = hasPendingCheckout
    ? (pendingShippingFee ?? derivedShippingFee)
    : derivedShippingFee;
  const expectedTotal =
    products.length === 0 ? 0 : productTotal + selectedShippingFee;
  const activeImmediateShippingFee = useMemo(
    () => activeShippingCharges.reduce((total, charge) => total + charge.amount, 0),
    [activeShippingCharges],
  );
  const activeVaultShippingFee = useMemo(
    () =>
      activeShippingCharges.reduce(
        (total, charge) => total + (charge.vaultAmount ?? charge.amount),
        0,
      ),
    [activeShippingCharges],
  );
  const checkout = async () => {
    if (
      busy ||
      activeCheckoutOperation.current !== null ||
      products.length === 0
    )
      return;
    if (paymentMode !== "manual_transfer") {
      setMessageKind("error");
      setMessage(
        "수동 계좌이체 설정을 확인하지 못했습니다. 잠시 후 새로고침해 주세요.",
      );
      return;
    }
    if (!shippingAddressId) {
      setMessageKind("error");
      setMessage("즉시구매는 결제와 함께 배송지를 선택해야 합니다.");
      return;
    }
    const expectedPaymentMode = paymentMode;
    setBusy(true);
    setMessage("");
    setMessageKind("success");
    const checkoutOperation = ++checkoutOperationSequence.current;
    activeCheckoutOperation.current = checkoutOperation;
    const checkoutGeneration = authGeneration.current;
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      const session = data.session;
      if (!session?.access_token) {
        throw new Error("카카오 로그인 후 주문할 수 있습니다.");
      }
      const token = session.access_token;
      const buyerId = session.user.id;
      if (
        authGeneration.current !== checkoutGeneration ||
        authUserId.current !== buyerId
      ) {
        throw new CheckoutSessionChangedError();
      }
      const pendingRequest =
        checkoutRequest.current?.buyerId === buyerId
          ? checkoutRequest.current
          : null;
      const checkoutProducts = pendingRequest?.productSnapshots ?? products;
      const productIds =
        pendingRequest?.productIds ??
        checkoutProducts.map((product) => product.id);
      const productSnapshots = checkoutProducts.map(createProductSnapshot);
      const requestIncludesShipping =
        pendingRequest?.includeShippingFee ?? includeShippingFee;
      const requestShippingFee =
        pendingRequest?.shippingFeeQuote ?? selectedShippingFee;
      // The order RPC reserves products and removes the server cart. Retain the
      // current rows locally until payment is actually verified or abandoned.
      setHeldCheckoutIds(productIds);
      setPendingShippingFee(requestShippingFee);
      setRestoredCheckoutProducts(productSnapshots);
      const productSignature = createProductSignature(productIds);
      const currentRequest: StoredCheckoutRequest = {
        ...(pendingRequest ?? {
          buyerId,
          productSignature,
          idempotencyKey: crypto.randomUUID(),
          ledgerMayExist: false,
          includeShippingFee: requestIncludesShipping,
          shippingFeeQuote: requestShippingFee,
          shippingRegion,
          shippingAddressId,
        }),
        productIds,
        productSnapshots,
      };
      const wasLedgerUncertain = currentRequest.ledgerMayExist;
      const dispatchedRequest = { ...currentRequest, ledgerMayExist: true };
      checkoutRequest.current = dispatchedRequest;
      storeCheckoutRequest(dispatchedRequest);
      setReleaseCheckoutAllowed(false);
      const response = await fetch("/api/orders/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          productIds,
          idempotencyKey: currentRequest.idempotencyKey,
          expectedPaymentMode,
          includeShippingFee: currentRequest.includeShippingFee,
          shippingRegion: currentRequest.shippingRegion,
          shippingAddressId: currentRequest.shippingAddressId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (
        authGeneration.current !== checkoutGeneration ||
        authUserId.current !== buyerId
      ) {
        throw new CheckoutSessionChangedError();
      }
      if (!response.ok) {
        const errorCode = readCheckoutErrorCode(payload);
        if (errorCode === "payment_mode_changed") {
          const refreshedMode = readCommercePaymentMode(
            payload && typeof payload === "object"
              ? (payload as Record<string, unknown>).paymentMode
              : null,
          );
          setPaymentMode(refreshedMode ?? "unavailable");
          if (!wasLedgerUncertain) {
            invalidateCheckoutRequest();
          }
          setMessageKind("error");
          setMessage(
            refreshedMode
              ? "결제 방식은 수동 계좌이체로 고정되어 있습니다. 새로고침 후 다시 주문해 주세요."
              : checkoutErrorMessages.payment_mode_changed,
          );
          return;
        }
        if (
          errorCode &&
          DEFINITELY_PRE_LEDGER_ERRORS.has(errorCode) &&
          (!wasLedgerUncertain || errorCode === "checkout_request_releasable")
        ) {
          const releasableRequest = {
            ...dispatchedRequest,
            ledgerMayExist: false,
          };
          checkoutRequest.current = releasableRequest;
          storeCheckoutRequest(releasableRequest);
          setReleaseCheckoutAllowed(true);
        }
        throw new Error(readCheckoutError(payload));
      }
      if (!payload || typeof payload !== "object") {
        throw new Error("주문 서버의 응답을 확인하지 못했습니다.");
      }
      const checkout = payload as Record<string, unknown>;
      if (checkout.mode !== expectedPaymentMode) {
        setPaymentMode("unavailable");
        throw new Error(
          "확인한 결제 방식과 서버 응답이 일치하지 않습니다. 페이지를 새로고침해 주세요.",
        );
      }
      if (!isCheckoutOrder(checkout.order)) {
        throw new Error("주문 서버의 주문 정보를 확인하지 못했습니다.");
      }

      if (checkout.mode !== "manual_transfer") {
        throw new Error("현재 지원하지 않는 결제 응답입니다.");
      }

      if (!isCheckoutTransfer(checkout.transfer, checkout.order)) {
        throw new Error("주문 서버의 입금 요청 정보를 확인하지 못했습니다.");
      }
      const transfer = checkout.transfer;
      removePurchasedFromCart(productIds);
      productIds.forEach(
        (productId) => void persistCart(productId, false, buyerId),
      );
      setHeldCheckoutIds([]);
      setPendingShippingFee(null);
      setRestoredCheckoutProducts([]);
      checkoutRequest.current = null;
      clearStoredCheckoutRequest();
      setMessage(
        transfer.status === "confirmed"
          ? `주문 ${checkout.order.id}의 입금 확인이 완료되었습니다.`
          : transfer.status === "partially_paid"
            ? `주문 ${checkout.order.id}의 일부 입금이 확인되었습니다. 내 정보에서 남은 금액을 확인해 주세요.`
            : `입금 대기 중 · 주문 ${checkout.order.id} · ${transfer.expected_amount.toLocaleString("ko-KR")}원 · ${transfer.bank_name_snapshot} ${transfer.account_number_snapshot}로 입금해 주세요.`,
      );
    } catch (error) {
      if (
        error instanceof CheckoutSessionChangedError ||
        authGeneration.current !== checkoutGeneration
      ) {
        return;
      }
      setMessageKind("error");
      setMessage(
        error instanceof Error ? error.message : "주문을 만들지 못했습니다.",
      );
    } finally {
      if (activeCheckoutOperation.current === checkoutOperation) {
        activeCheckoutOperation.current = null;
        setBusy(false);
      }
    }
  };

  const clear = () => {
    if (busy || hasPendingCheckout) return;
    invalidateCheckoutRequest();
    const buyerId = cartOwnerId.current;
    if (buyerId) {
      products.forEach(
        (product) => void persistCart(product.id, false, buyerId),
      );
    }
    clearCart();
    setMessage("");
  };

  const removeProduct = async (productId: string) => {
    if (busy || hasPendingCheckout) return;
    const buyerId = cartOwnerId.current;
    invalidateCheckoutRequest();
    removeFromCart(productId);
    pushToast("success", "상품이 장바구니에서 삭제되었습니다.");
    if (!buyerId) return;

    const persisted = await persistCart(productId, false, buyerId);
    const commerceState = useCommerceStore.getState();
    if (
      !persisted &&
      cartOwnerId.current === buyerId &&
      commerceState.ownerUserId === buyerId
    ) {
      addToCart(productId);
      pushToast(
        "error",
        "장바구니 삭제를 저장하지 못해 상품을 다시 복원했습니다.",
      );
      return;
    }
    if (cartOwnerId.current === buyerId) cartRefreshRef.current?.();
  };

  const releaseCheckout = () => {
    if (busy || !releaseCheckoutAllowed) return;
    invalidateCheckoutRequest();
    setMessageKind("success");
    setMessage("서버에 주문 원장이 생성되지 않은 결제 요청을 해제했습니다.");
  };

  const checkoutDisabled =
    busy ||
    products.length === 0 ||
    paymentMode !== "manual_transfer" ||
    !shippingAddressId ||
    !termsAccepted;
  const checkoutButtonLabel = busy
    ? "결제 준비 중..."
    : paymentMode === "manual_transfer"
      ? "주문하고 입금계좌 확인"
      : "결제 설정 확인 중";

  return (
    <div className={`space-y-10 ${surface === "mobile" ? "pb-24 md:pb-0" : ""}`}>
      <div
        className={`flex items-start gap-3 border-b border-ink pb-6 ${surface === "desktop" ? "flex-row items-end justify-between" : "flex-col"}`}
      >
        <div>
          <p className="eyebrow text-muted">
            {selectedProductId ? "즉시구매 / 단일 상품" : "장바구니 / 즉시구매"}
          </p>
          <h1
            className={`mt-3 font-black tracking-[-0.08em] ${surface === "desktop" ? "text-4xl" : "text-3xl"}`}
          >
            {selectedProductId ? "바로 결제" : "장바구니"}
          </h1>
        </div>
        <span className="font-mono text-xs text-muted">
          {productsLoading || cartLoading ? "—" : `${products.length}개`}
        </span>
      </div>
      {staleCount > 0 && (
        <div
          aria-live="polite"
          className="border border-amber-200 bg-amber-500/10 px-4 py-3 text-xs text-amber-900"
        >
          판매가 완료·공개 종료되었거나 현재 계정으로 구매할 수 없는 상품{" "}
          {staleCount}개를 장바구니에서 제외했습니다.
        </div>
      )}
      {hasPendingCheckout && !busy && (
        <div
          aria-live="polite"
          className="border border-amber-200 bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-900"
        >
          <p>
            진행 중인 주문 요청이 있습니다. 결제 재개는 저장된 동일 주문 키와
            결제 번호만 사용합니다. 결제가 확인될 때까지 해당 상품 삭제,
            장바구니 비우기, 결제 방법 변경은 잠깁니다.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              className="font-bold underline"
              onClick={() => void checkout()}
              type="button"
            >
              결제 재개
            </button>
            {releaseCheckoutAllowed && (
              <button
                className="font-bold underline"
                onClick={releaseCheckout}
                type="button"
              >
                결제 요청 해제
              </button>
            )}
            <Link
              className="font-bold underline"
              href={`${basePath}/account/orders`}
            >
              주문 상태 확인
            </Link>
          </div>
        </div>
      )}
      {message && (
        <div
          aria-live="polite"
          className={
            messageKind === "error"
              ? "border border-red-200 bg-red-50 px-4 py-3 text-xs leading-5 text-red-900"
              : messageKind === "warning"
                ? "border border-amber-200 bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-900"
                : "border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-900"
          }
        >
          {message}{" "}
          {messageKind === "success" && (
            <Link
              className="ml-2 font-bold underline"
              href={`${basePath}/account/orders`}
            >
              내 주문 확인
            </Link>
          )}
        </div>
      )}
      {access === "loading" || productsLoading || cartLoading ? (
        <div className="border border-dashed border-line py-24 text-center">
          <p className="text-sm font-bold">장바구니를 불러오는 중입니다.</p>
          <p className="mt-2 text-[11px] text-muted">잠시만 기다려 주세요.</p>
        </div>
      ) : access !== "member" && products.length === 0 ? (
        <div className="border border-dashed border-line bg-surface py-24 text-center">
          <p className="text-sm font-bold">
            카카오 로그인 후 장바구니를 이용할 수 있습니다.
          </p>
          <Link
            className="mt-5 inline-flex border border-ink px-5 py-3 text-xs font-bold"
            href={`${basePath}/account/login?next=${encodeURIComponent(selectedProductId ? `${basePath}/checkout?productId=${selectedProductId}` : `${basePath}/cart`)}`}
          >
            카카오 로그인
          </Link>
        </div>
      ) : products.length === 0 ? (
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 items-start gap-6 sm:grid-cols-12 sm:gap-8 md:grid-cols-5 lg:grid-cols-[minmax(0,65fr)_minmax(320px,35fr)] lg:gap-10">
          <div className="border border-dashed border-line py-24 text-center sm:col-span-7 md:col-span-3 lg:col-auto">
            <p className="text-sm font-bold">장바구니가 비어 있습니다.</p>
            <Link
              className="mt-5 inline-flex items-center gap-2 text-xs font-bold underline"
              href={`${basePath}/home`}
            >
              오늘의 빈티지 둘러보기 <ArrowRight size={14} />
            </Link>
          </div>
          <aside className="sticky top-20 h-fit self-start rounded-2xl border border-line/40 bg-card p-5 shadow-sm sm:col-span-5 md:col-span-2 md:top-24 lg:col-auto lg:p-6">
            <div className="flex justify-between text-xs">
              <span>상품 금액</span>
              <strong className="font-mono">0원</strong>
            </div>
            <div className="mt-5 flex justify-between text-xs">
              <span>배송비</span>
              <strong className="font-mono">0원</strong>
            </div>
            <div className="mt-6 flex justify-between border-t border-line pt-5">
              <span className="text-sm font-bold">예상 결제 금액</span>
              <strong className="font-mono text-xl" aria-live="polite">
                0원
              </strong>
            </div>
            <button
              className="mt-4 h-13 w-full bg-ink text-xs font-bold text-paper disabled:opacity-50"
              disabled
              type="button"
            >
              상품을 담아주세요
            </button>
          </aside>
        </div>
      ) : (
        <>
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 items-start gap-6 sm:grid-cols-12 sm:gap-8 md:grid-cols-5 lg:grid-cols-[minmax(0,65fr)_minmax(320px,35fr)] lg:gap-10">
          <div className="divide-y divide-line border-y border-line sm:col-span-7 md:col-span-3 lg:col-auto">
            {products.map((product) => (
              <div
                className={`flex py-5 ${surface === "desktop" ? "gap-5" : "gap-4"}`}
                key={product.id}
              >
                <CatalogImage
                  alt={product.title}
                  className={`${surface === "desktop" ? "size-28" : "size-24"} shrink-0 object-cover`}
                  loading="lazy"
                  sizes="112px"
                  src={product.imageUrls[0]}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-muted">
                        {product.store.name}
                      </p>
                      <h2 className="mt-2 truncate text-base font-bold">
                        {product.title}
                      </h2>
                      <p className="mt-2 text-xs text-muted">
                        {product.size} · {conditionLabels[product.condition]}
                      </p>
                    </div>
                    <button
                      aria-label="장바구니에서 삭제"
                      className="text-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={busy || hasPendingCheckout}
                      onClick={() => void removeProduct(product.id)}
                      type="button"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="mt-6 flex items-center justify-between">
                    <div className="border border-line px-3 py-2 text-xs text-muted">
                      <span aria-label="수량">수량: 1개 (단일 빈티지)</span>
                    </div>
                    <span className="font-mono text-sm font-bold">
                      {product.price.toLocaleString("ko-KR")}원
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <aside className="sticky top-20 h-fit self-start rounded-2xl border border-line/40 bg-card p-5 shadow-sm sm:col-span-5 md:col-span-2 md:top-24 lg:col-auto lg:p-6">
            <div className="flex justify-between text-xs">
              <span>상품 금액</span>
              <strong className="font-mono">
                {productTotal.toLocaleString("ko-KR")}원
              </strong>
            </div>
            <fieldset className="mt-5 grid gap-2">
              <legend className="mb-2 text-xs font-bold">상품 수령 방법</legend>
              <label
                className={`cursor-pointer rounded-xl border p-3 text-xs ${!includeShippingFee ? "border-ink bg-paper shadow-sm" : "border-line"}`}
              >
                <span className="flex items-start gap-3">
                  <input
                    checked={!includeShippingFee}
                    disabled={busy || hasPendingCheckout}
                    name="shipping-mode"
                    onChange={() => {
                      invalidateCheckoutRequest();
                      setIncludeShippingFee(false);
                    }}
                    type="radio"
                  />
                  <span>
                    <strong className="block">보관함 보관 후 묶음 배송</strong>
                    <small className="mt-1 block leading-5 text-muted">
                      {activeVaultShippingFee > 0
                        ? `잔여 배송권이 없는 센터 배송비 ${activeVaultShippingFee.toLocaleString("ko-KR")}원이 포함되며, 결제 완료 후 1회권이 적립됩니다.`
                        : `선결제 배송권 적용 · 최대 ${platformConfig.storageDurationDays}일 무료 보관 후 추가 배송비 없이 묶음 배송할 수 있습니다.`}
                    </small>
                  </span>
                </span>
              </label>
              <label
                className={`cursor-pointer rounded-xl border p-3 text-xs ${includeShippingFee ? "border-ink bg-paper shadow-sm" : "border-line"}`}
              >
                <span className="flex items-start gap-3">
                  <input
                    checked={includeShippingFee}
                    disabled={
                      busy ||
                      hasPendingCheckout ||
                      !shippingAvailable ||
                      activeImmediateShippingFee < 1
                    }
                    name="shipping-mode"
                    onChange={() => {
                      invalidateCheckoutRequest();
                      setIncludeShippingFee(true);
                    }}
                    type="radio"
                  />
                  <span className="flex-1">
                    <strong className="flex justify-between gap-2">
                      <span>즉시 발송 · 배송비 함께 결제</span>
                      <span className="font-mono">
                        {shippingAvailable
                          ? `${activeImmediateShippingFee.toLocaleString("ko-KR")}원`
                          : "견적 확인 중"}
                      </span>
                    </strong>
                    <small className="mt-1 block leading-5 text-muted">
                      {shippingAvailable
                        ? "결제 확인 후 선택한 배송지로 택배 접수합니다."
                        : "보관함 보관은 계속 선택할 수 있습니다."}
                    </small>
                  </span>
                </span>
              </label>
            </fieldset>
            <label className="mt-3 block text-xs font-bold">
              배송 지역
              <select
                className="mt-1 h-11 w-full border border-line bg-paper px-3"
                disabled={busy || hasPendingCheckout}
                onChange={(event) => {
                  invalidateCheckoutRequest();
                  setShippingRegion(
                    event.target.value === "remote_area"
                      ? "remote_area"
                      : "regular",
                  );
                }}
                value={shippingRegion}
              >
                <option value="regular">일반 택배</option>
                <option value="remote_area">제주 및 도서산간 지역 택배</option>
              </select>
            </label>
            <div className="mt-3 block text-xs font-bold">
              배송지 선택{" "}
              <span className="font-normal text-red-600">(필수)</span>
              <div className="mt-2 space-y-2">
                {shippingAddresses.length > 0 ? (
                  shippingAddresses.map((address) => (
                    <div
                      className={`flex items-start gap-3 border p-3 ${shippingAddressId === address.id ? "border-ink bg-surface" : "border-line bg-paper"}`}
                      key={address.id}
                    >
                      <input
                        aria-label={`${address.label} 배송지 선택`}
                        checked={shippingAddressId === address.id}
                        className="mt-1"
                        disabled={busy || hasPendingCheckout || addressBusy}
                        name="checkout-shipping-address"
                        onChange={() => {
                          invalidateCheckoutRequest();
                          setShippingAddressId(address.id);
                        }}
                        type="radio"
                      />
                      <button
                        className="min-w-0 flex-1 text-left"
                        disabled={busy || hasPendingCheckout || addressBusy}
                        onClick={() => {
                          invalidateCheckoutRequest();
                          setShippingAddressId(address.id);
                        }}
                        type="button"
                      >
                        <span className="block text-xs font-black">
                          {address.label} · {address.recipient_name}
                          {address.is_default && (
                            <span className="ml-2 border border-line px-1.5 py-0.5 text-[9px]">
                              기본
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block text-[11px] font-normal leading-5 text-muted">
                          {address.phone} ·{" "}
                          {address.postal_code
                            ? `[${address.postal_code}] `
                            : ""}
                          {address.address}
                        </span>
                      </button>
                      <div className="flex shrink-0 gap-1">
                        <button
                          className="border border-line px-2 py-2 text-[10px] font-bold"
                          disabled={busy || hasPendingCheckout || addressBusy}
                          onClick={() => openAddressEdit(address)}
                          type="button"
                        >
                          수정
                        </button>
                        <button
                          className={`border px-2 py-2 text-[10px] font-bold ${pendingDeleteAddressId === address.id ? "border-rose-700 bg-rose-700 text-white" : "border-rose-300 text-rose-700"}`}
                          disabled={busy || hasPendingCheckout || addressBusy}
                          onClick={() => void deleteCheckoutAddress(address)}
                          type="button"
                        >
                          {pendingDeleteAddressId === address.id
                            ? "삭제 확인"
                            : "삭제"}
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <span className="block border border-amber-200 bg-amber-500/10 px-3 py-3 text-[11px] font-normal leading-5 text-amber-900">
                    저장된 배송지가 없습니다. 아래에서 바로 추가해 주세요.
                  </span>
                )}
                {!hasPendingCheckout && (
                  <button
                    className="min-h-11 w-full border border-ink px-3 py-2 text-xs font-bold"
                    disabled={busy || addressBusy}
                    onClick={openAddressCreate}
                    type="button"
                  >
                    {shippingAddresses.length > 0
                      ? "배송지 추가"
                      : "배송지 추가하고 선택"}
                  </button>
                )}
              </div>
            </div>
            {addressEditorOpen && (
              <div className="mt-3 border border-ink bg-surface p-4">
                <p className="text-xs font-black">
                  {editingAddressId ? "배송지 수정" : "새 배송지 추가"}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <input
                    aria-label="배송지 이름"
                    className="border border-line bg-paper px-3 py-3 text-xs"
                    disabled={addressBusy}
                    onChange={(event) =>
                      setAddressForm({
                        ...addressForm,
                        label: event.target.value,
                      })
                    }
                    placeholder="배송지 이름"
                    value={addressForm.label}
                  />
                  <input
                    aria-label="수령인"
                    className="border border-line bg-paper px-3 py-3 text-xs"
                    disabled={addressBusy}
                    onChange={(event) =>
                      setAddressForm({
                        ...addressForm,
                        recipientName: event.target.value,
                      })
                    }
                    placeholder="수령인"
                    value={addressForm.recipientName}
                  />
                  <label className="grid gap-1 text-[10px] font-bold">
                    연락처
                    <input
                      aria-label="연락처"
                      className="border border-line bg-paper px-3 py-3 text-xs font-normal"
                      disabled={addressBusy}
                      inputMode="tel"
                      onChange={(event) =>
                        setAddressForm({
                          ...addressForm,
                          phone: formatPhoneNumber(event.target.value),
                        })
                      }
                      placeholder="010-0000-0000"
                      value={addressForm.phone}
                    />
                    <span
                      className={
                        /^010-\d{4}-\d{4}$/u.test(addressForm.phone) ||
                        !addressForm.phone
                          ? "sr-only"
                          : "text-red-600"
                      }
                    >
                      010-0000-0000 형식으로 입력해 주세요.
                    </span>
                  </label>
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <input
                      aria-label="우편번호"
                      className="min-w-0 border border-line bg-paper px-3 py-3 text-xs"
                      disabled={addressBusy}
                      inputMode="numeric"
                      maxLength={5}
                      onChange={(event) =>
                        setAddressForm({
                          ...addressForm,
                          postalCode: event.target.value.replace(/\D/gu, ""),
                        })
                      }
                      placeholder="우편번호 5자리"
                      value={addressForm.postalCode}
                    />
                    <PostcodeSearchButton
                      disabled={addressBusy}
                      onSelect={(result) =>
                        setAddressForm((current) => ({ ...current, ...result }))
                      }
                    />
                  </div>
                  <input
                    aria-label="주소"
                    className="border border-line bg-paper px-3 py-3 text-xs sm:col-span-2"
                    disabled={addressBusy}
                    onChange={(event) =>
                      setAddressForm({
                        ...addressForm,
                        address: event.target.value,
                      })
                    }
                    placeholder="주소"
                    value={addressForm.address}
                  />
                  <label className="flex items-center gap-2 text-xs sm:col-span-2">
                    <input
                      checked={addressForm.isDefault}
                      disabled={addressBusy}
                      onChange={(event) =>
                        setAddressForm({
                          ...addressForm,
                          isDefault: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    기본 배송지로 저장
                  </label>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    className="min-h-11 flex-1 border border-line px-3 py-2 text-xs font-bold"
                    disabled={addressBusy}
                    onClick={() => setAddressEditorOpen(false)}
                    type="button"
                  >
                    취소
                  </button>
                  <button
                    className="min-h-11 flex-1 bg-ink px-3 py-2 text-xs font-bold text-paper"
                    disabled={addressBusy}
                    onClick={() => void saveCheckoutAddress()}
                    type="button"
                  >
                    {addressBusy
                      ? "저장 중…"
                      : editingAddressId
                        ? "수정 저장"
                        : "추가하고 선택"}
                  </button>
                </div>
              </div>
            )}
            <p className="mt-3 border border-amber-200 bg-amber-500/10 px-3 py-3 text-[11px] leading-5 text-amber-900">
              즉시구매는 구매 시 선택한 배송지로 결제 확인 후 바로 배송
              접수됩니다. 입금은 주문 후 최대 6시간 이내에 완료해야 하며, 미입금
              취소가 반복되면 구매·입찰 이용이 제한될 수 있습니다.
            </p>
            {activeShippingCharges.length > 0 ? (
              <div className="mt-3 space-y-2 border border-line bg-paper p-3 text-[11px]">
                <p className="font-bold">배송비 {activeShippingCharges.length}건</p>
                {activeShippingCharges.map((charge) => (
                  <div
                    className="border-t border-line pt-2 first:border-t-0 first:pt-0"
                    key={charge.chargeKey}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span>
                        <strong className="block">{charge.unitName}</strong>
                        <span className="text-muted">
                          {charge.storeNames.join(", ")} · 처리{" "}
                          {charge.billingStoreName}
                        </span>
                      </span>
                      <strong className="shrink-0 font-mono">
                        {Number(charge.amount).toLocaleString("ko-KR")}원
                      </strong>
                    </div>
                    <p className="mt-1 text-muted">
                      {charge.products
                        .filter((product) => activeProductIds.has(product.id))
                        .map((product) => product.title)
                        .join(" · ")}{" "}
                      · 상품{" "}
                      {charge.products
                        .filter((product) => activeProductIds.has(product.id))
                        .reduce((total, product) => total + product.amount, 0)
                        .toLocaleString("ko-KR")}원
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="mt-5 flex justify-between text-xs">
              <span>
                {includeShippingFee
                  ? "즉시 발송 배송비"
                  : "보관함 선결제 배송비"}
              </span>
              <strong className="font-mono">
                {selectedShippingFee > 0
                  ? `${selectedShippingFee.toLocaleString("ko-KR")}원`
                  : "배송권 적용 · 0원"}
              </strong>
            </div>
            <div className="mt-6 flex justify-between border-t border-line pt-5">
              <span className="text-sm font-bold">예상 결제 금액</span>
              <strong
                className="font-mono text-xl transition-all duration-200"
                aria-live="polite"
              >
                {expectedTotal.toLocaleString("ko-KR")}원
              </strong>
            </div>
            {paymentMode === "manual_transfer" ? (
              <div className="mt-6 border border-line bg-paper px-3 py-3 text-xs">
                <p className="font-bold">수동 계좌이체</p>
                <p className="mt-1 text-[11px] text-muted">
                  주문 생성 후 서버가 입금계좌를 안내합니다.
                </p>
              </div>
            ) : (
              <div className="mt-6 border border-amber-200 bg-amber-500/10 px-3 py-3 text-[11px] text-amber-900">
                결제 운영 모드를 확인하고 있습니다.
              </div>
            )}
            <div
              className="mt-3 grid grid-cols-2 gap-2 text-[11px]"
              aria-label="결제 수단"
            >
              <span className="border border-ink bg-paper px-3 py-3 font-bold">
                계좌이체{" "}
                <small className="block font-normal text-muted">
                  현재 이용 가능
                </small>
              </span>
              {["토스페이먼츠", "카카오페이", "신용카드"].map((method) => (
                <span
                  aria-disabled="true"
                  className="border border-line px-3 py-3 text-muted opacity-60"
                  key={method}
                >
                  {method}
                  <small className="block">준비 중</small>
                </span>
              ))}
            </div>
            <label className="mt-4 flex items-start gap-2 border border-line bg-paper p-3 text-[11px] leading-5">
              <input
                checked={termsAccepted}
                className="mt-1"
                onChange={(event) => setTermsAccepted(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong className="block">필수 약관 전체 동의</strong>구매 조건,
                결제 및 배송·보관 정책을 확인하고 동의합니다.
              </span>
            </label>
            <button
              className={`mt-4 h-13 w-full bg-ink text-xs font-bold text-paper disabled:opacity-50 ${surface === "mobile" ? "hidden sm:block" : ""}`}
              disabled={checkoutDisabled}
              onClick={() => void checkout()}
              type="button"
            >
              {checkoutButtonLabel}
            </button>
            <button
              className="mt-3 w-full text-[11px] text-muted underline disabled:cursor-not-allowed disabled:opacity-40"
              disabled={busy || hasPendingCheckout}
              onClick={clear}
              type="button"
            >
              장바구니 비우기
            </button>
          </aside>
        </div>
        {surface === "mobile" ? (
          <section className="fixed inset-x-3 bottom-[calc(6.5rem+env(safe-area-inset-bottom,16px))] z-30 rounded-2xl border border-line bg-paper/95 px-3 py-2 shadow-2xl backdrop-blur-md sm:hidden" aria-label="모바일 결제 요약">
            {mobileSummaryExpanded ? (
              <div className="mx-auto mb-2 max-w-lg space-y-2 rounded-xl border border-line bg-surface p-3 text-xs" id="mobile-payment-breakdown">
                <div className="flex justify-between gap-3"><span>상품 금액</span><strong className="font-mono">{productTotal.toLocaleString("ko-KR")}원</strong></div>
                {activeShippingCharges.map((charge) => (
                  <div className="flex justify-between gap-3 text-muted" key={charge.chargeKey}><span className="min-w-0 truncate">{charge.unitName} 배송비</span><strong className="shrink-0 font-mono text-ink">{(includeShippingFee ? charge.amount : charge.vaultAmount ?? charge.amount).toLocaleString("ko-KR")}원</strong></div>
                ))}
                <div className="flex justify-between gap-3 text-muted"><span>할인</span><strong className="font-mono text-ink">0원</strong></div>
                <div className="flex justify-between gap-3 border-t border-line pt-2"><span className="font-bold">최종 결제 금액</span><strong className="font-mono">{expectedTotal.toLocaleString("ko-KR")}원</strong></div>
              </div>
            ) : null}
            <div className="mx-auto grid max-w-lg grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <button aria-controls="mobile-payment-breakdown" aria-expanded={mobileSummaryExpanded} className="min-h-[44px] min-w-0 rounded-xl px-2 text-left" onClick={() => setMobileSummaryExpanded((expanded) => !expanded)} type="button"><span className="block text-[10px] text-muted">총 {products.length}개 · 결제 예정 금액</span><strong className="block truncate font-mono text-lg">{expectedTotal.toLocaleString("ko-KR")}원</strong></button>
              <button className="min-h-[44px] rounded-xl bg-ink px-5 text-sm font-black text-paper disabled:opacity-50" disabled={checkoutDisabled} onClick={() => void checkout()} type="button">결제하기</button>
            </div>
          </section>
        ) : null}
        </>
      )}
    </div>
  );
}
