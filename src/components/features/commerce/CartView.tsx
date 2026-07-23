"use client";

import Link from "next/link";
import { ArrowRight, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { persistCart } from "@/lib/commerce/client";
import { COMMERCE_CHECKOUT_STORAGE_KEY } from "@/lib/commerce/checkoutStorage";
import {
  readCommercePaymentMode,
  type CommercePaymentMode,
} from "@/lib/commerce/paymentMode";
import { useCommerceStore } from "@/store/useCommerceStore";
import { CatalogImage } from "@/components/ui/CatalogImage";

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
  conditionGrade?: "S" | "A+" | "A" | "B";
  reservationExpiresAt?: string | null;
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
        : grade === "A+"
          ? "EXCELLENT"
          : grade === "B"
            ? "FAIR"
            : "GOOD",
    saleType: "fixed",
    price: product.fixedPrice ?? product.currentPrice,
    closesAt: product.closesAt,
    store: { name: "NINETY-NINE VINTAGE" },
    imageUrls: product.imageUrls,
    reservationExpiresAt: product.reservationExpiresAt ?? null,
  };
}

function reservationRemainingLabel(
  expiresAt: string | null | undefined,
  now: number,
) {
  const remaining = expiresAt ? Date.parse(expiresAt) - now : 0;
  if (!Number.isFinite(remaining) || remaining <= 0) return "재고 점유 만료";
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `재고 점유 ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")} 남음`;
}

export function CartView({ basePath = "", selectedProductId, surface = "mobile" }: { basePath?: "" | "/m"; selectedProductId?: string; surface?: "desktop" | "mobile" }) {
  const hydrate = useCommerceStore((state) => state.hydrate);
  const cartIds = useCommerceStore((state) => state.cartIds);
  const removeFromCart = useCommerceStore((state) => state.removeFromCart);
  const removePurchasedFromCart = useCommerceStore(
    (state) => state.removePurchasedFromCart,
  );
  const clearCart = useCommerceStore((state) => state.clearCart);
  const replaceCart = useCommerceStore((state) => state.replaceCart);
  const [liveProducts, setLiveProducts] = useState<CartProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [cartLoading, setCartLoading] = useState(true);
  const [access, setAccess] = useState<CartAccess>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">(
    "success",
  );
  const [staleCount, setStaleCount] = useState(0);
  const [serverClockOffset, setServerClockOffset] = useState(0);
  const [reservationClock, setReservationClock] = useState(() => Date.now());
  const [paymentMode, setPaymentMode] = useState<CartPaymentMode>("loading");
  const [shippingFee, setShippingFee] = useState(0);
  const [includeShippingFee, setIncludeShippingFee] = useState(true);
  const [heldCheckoutIds, setHeldCheckoutIds] = useState<string[]>([]);
  const [releaseCheckoutAllowed, setReleaseCheckoutAllowed] = useState(false);
  const [restoredCheckoutProducts, setRestoredCheckoutProducts] = useState<
    CartProduct[]
  >([]);
  const checkoutRequest = useRef<StoredCheckoutRequest | null>(null);
  const authGeneration = useRef(0);
  const authUserId = useRef<string | null>(null);
  const cartOwnerId = useRef<string | null>(null);
  const checkoutOperationSequence = useRef(0);
  const activeCheckoutOperation = useRef<number | null>(null);
  const invalidateCheckoutRequest = () => {
    checkoutRequest.current = null;
    setHeldCheckoutIds([]);
    setRestoredCheckoutProducts([]);
    setReleaseCheckoutAllowed(false);
    clearStoredCheckoutRequest();
  };

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (liveProducts.length === 0) return;
    const timer = window.setInterval(
      () => setReservationClock(Date.now()),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [liveProducts.length]);

  useEffect(() => {
    let disposed = false;
    let loadSequence = 0;
    let authEventSequence = 0;
    let lastSessionKey: string | null = null;

    const clearMemberState = (clearRecovery = true) => {
      activeCheckoutOperation.current = null;
      checkoutOperationSequence.current += 1;
      checkoutRequest.current = null;
      cartOwnerId.current = null;
      setHeldCheckoutIds([]);
      setRestoredCheckoutProducts([]);
      setReleaseCheckoutAllowed(false);
      if (clearRecovery) clearStoredCheckoutRequest();
      setLiveProducts([]);
      replaceCart([]);
      setStaleCount(0);
      setServerClockOffset(0);
      setPaymentMode("loading");
      setShippingFee(0);
      setIncludeShippingFee(true);
      setMessage("");
      setMessageKind("success");
      setBusy(false);
    };

    const loadSession = async (session: Session | null) => {
      const sequence = ++loadSequence;
      const nextUserId = session?.user.id ?? null;
      const identityChanged = authUserId.current !== nextUserId;
      if (identityChanged) authGeneration.current += 1;
      authUserId.current = nextUserId;

      if (!session?.access_token) {
        clearMemberState();
        setAccess("guest");
        setProductsLoading(false);
        setCartLoading(false);
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
          setRestoredCheckoutProducts(activeRequest.productSnapshots);
          setReleaseCheckoutAllowed(!activeRequest.ledgerMayExist);
          setIncludeShippingFee(activeRequest.includeShippingFee);
          setShippingFee(activeRequest.shippingFeeQuote);
        } else {
          checkoutRequest.current = null;
          setHeldCheckoutIds([]);
          setRestoredCheckoutProducts([]);
          setReleaseCheckoutAllowed(false);
          clearStoredCheckoutRequest();
        }

        const requestedResumeOrder = new URLSearchParams(
          window.location.search,
        ).get("resumeOrder");
        if (requestedResumeOrder) {
          setMessageKind("error");
          setMessage(
            "PortOne 테스트 결제 재개는 중단되었습니다. 내 주문에서 기존 주문 상태를 확인해 주세요.",
          );
        }
        if (!isCurrent()) return;
        setAccess("member");
        const response = await fetch("/api/cart", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
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
            setPaymentMode("unavailable");
            setMessageKind("error");
            setMessage(
              "장바구니 서버 응답을 확인하지 못했습니다. 잠시 후 새로고침해 주세요.",
            );
          }
          return;
        }
        const payload = (await response.json()) as {
          paymentMode?: unknown;
          productIds?: string[];
          serverTime?: string | null;
          staleProductIds?: string[];
          items?: PublishedFixedProduct[];
          shippingFee?: unknown;
        };
        if (!isCurrent()) return;
        if (payload.paymentMode !== "manual_transfer") {
          setPaymentMode("unavailable");
          setMessageKind("error");
          setMessage(
            "결제 운영 모드를 확인하지 못했습니다. 잠시 후 새로고침해 주세요.",
          );
        } else {
          setPaymentMode(payload.paymentMode);
        }
        const cartProducts = (payload.items ?? []).map(toCartProduct);
        const nextShippingFee = Number(payload.shippingFee);
        if (
          cartProducts.length > 0 &&
          (!Number.isSafeInteger(nextShippingFee) || nextShippingFee < 1)
        ) {
          throw new Error("배송비 설정을 확인하지 못했습니다.");
        }
        if (!activeRequest) setShippingFee(cartProducts.length > 0 ? nextShippingFee : 0);
        const serverTime =
          typeof payload.serverTime === "string"
            ? Date.parse(payload.serverTime)
            : Number.NaN;
        setServerClockOffset(
          Number.isFinite(serverTime) ? serverTime - Date.now() : 0,
        );
        setReservationClock(Date.now());
        const ids =
          payload.productIds ?? cartProducts.map((product) => product.id);
        setLiveProducts(cartProducts);
        replaceCart(ids);
        setStaleCount(payload.staleProductIds?.length ?? 0);
      } catch {
        if (!isCurrent()) return;
        // A transient cart/API failure must not masquerade as logout or expose
        // anonymous fallback data over an authenticated member snapshot.
        setAccess("member");
        setPaymentMode("unavailable");
        setMessageKind("error");
        setMessage(
          "장바구니 정보를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.",
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
        loadSequence += 1;
        authGeneration.current += 1;
        listener.subscription.unsubscribe();
      };
    } catch {
      handleUnconfirmedSessionReadFailure();
      return () => {
        disposed = true;
        loadSequence += 1;
        authGeneration.current += 1;
      };
    }
  }, [replaceCart]);

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
    if (heldCheckoutIds.length > 0 || !selectedProductId) return visibleProducts;
    return visibleProducts.filter((product) => product.id === selectedProductId);
  }, [cartIds, heldCheckoutIds, liveProducts, restoredCheckoutProducts, selectedProductId]);
  const productTotal = products.reduce((sum, product) => sum + product.price, 0);
  const expectedTotal =
    productTotal + (includeShippingFee ? shippingFee : 0);
  const hasPendingCheckout = heldCheckoutIds.length > 0;
  const reservationNow = reservationClock + serverClockOffset;
  const reservationExpired =
    !hasPendingCheckout &&
    products.some((product) => {
      const expiresAt = product.reservationExpiresAt
        ? Date.parse(product.reservationExpiresAt)
        : Number.NaN;
      return Number.isFinite(expiresAt) && expiresAt <= reservationNow;
    });

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
        pendingRequest?.shippingFeeQuote ??
        (requestIncludesShipping ? shippingFee : 0);
      // The order RPC reserves products and removes the server cart. Retain the
      // current rows locally until payment is actually verified or abandoned.
      setHeldCheckoutIds(productIds);
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

  const releaseCheckout = () => {
    if (busy || !releaseCheckoutAllowed) return;
    invalidateCheckoutRequest();
    setMessageKind("success");
    setMessage("서버에 주문 원장이 생성되지 않은 결제 요청을 해제했습니다.");
  };

  const checkoutDisabled =
    busy ||
    reservationExpired ||
    paymentMode !== "manual_transfer";
  const checkoutButtonLabel = busy
    ? "결제 준비 중..."
    : reservationExpired
      ? "재고 점유 만료"
      : paymentMode === "manual_transfer"
        ? "주문하고 입금계좌 확인"
        : "결제 설정 확인 중";

  return (
    <div className="space-y-10">
      <div className={`flex items-start gap-3 border-b border-ink pb-6 ${surface === "desktop" ? "flex-row items-end justify-between" : "flex-col"}`}>
        <div>
          <p className="eyebrow text-muted">{selectedProductId ? "즉시구매 / 단일 상품" : "장바구니 / 즉시구매"}</p>
          <h1 className={`mt-3 font-black tracking-[-0.08em] ${surface === "desktop" ? "text-4xl" : "text-3xl"}`}>
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
          className="border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"
        >
          판매가 완료되었거나 공개가 종료된 상품 {staleCount}개를 장바구니에서
          제외했습니다.
        </div>
      )}
      {products.length > 0 && !hasPendingCheckout && (
        <div className="border border-sky-200 bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-900">
          장바구니에 담은 한 점 상품은 서버 시간을 기준으로 15분 동안 내
          계정에만 임시 점유됩니다. 시간이 끝나기 전에 결제를 시작해 주세요.
        </div>
      )}
      {reservationExpired && (
        <div
          aria-live="assertive"
          className="border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold text-red-800"
        >
          재고 점유 시간이 만료되었습니다. 새로고침 후 아직 구매 가능한 상품을
          다시 담아 주세요.
        </div>
      )}
      {hasPendingCheckout && !busy && (
        <div
          aria-live="polite"
          className="border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900"
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
            <Link className="font-bold underline" href={`${basePath}/account/orders`}>
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
              : "border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-900"
          }
        >
          {message}{" "}
          {messageKind === "success" && (
            <Link className="ml-2 font-bold underline" href={`${basePath}/account/orders`}>
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
      ) : access !== "member" ? (
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
        <div className="border border-dashed border-line py-24 text-center">
          <p className="text-sm font-bold">장바구니가 비어 있습니다.</p>
          <Link
            className="mt-5 inline-flex items-center gap-2 text-xs font-bold underline"
            href={`${basePath}/shop`}
          >
            상품 둘러보기 <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <div className={`grid gap-10 ${surface === "desktop" ? "grid-cols-[1fr_360px]" : "grid-cols-1"}`}>
          <div className="divide-y divide-line border-y border-line">
            {products.map((product) => (
              <div className={`flex py-5 ${surface === "desktop" ? "gap-5" : "gap-4"}`} key={product.id}>
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
                      {!hasPendingCheckout && (
                        <p
                          className={`mt-2 font-mono text-[10px] font-bold ${product.reservationExpiresAt && Date.parse(product.reservationExpiresAt) <= reservationNow ? "text-red-700" : "text-sky-700"}`}
                        >
                          {reservationRemainingLabel(
                            product.reservationExpiresAt,
                            reservationNow,
                          )}
                        </p>
                      )}
                    </div>
                    <button
                      aria-label="장바구니에서 삭제"
                      className="text-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={busy || hasPendingCheckout}
                      onClick={() => {
                        if (busy || hasPendingCheckout) return;
                        const buyerId = cartOwnerId.current;
                        invalidateCheckoutRequest();
                        removeFromCart(product.id);
                        if (buyerId)
                          void persistCart(product.id, false, buyerId);
                      }}
                      type="button"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="mt-6 flex items-center justify-between">
                    <div className="border border-line px-3 py-2 text-xs text-muted">
                      <span aria-label="수량">단일 상품 · 1점</span>
                    </div>
                    <span className="font-mono text-sm font-bold">
                      {product.price.toLocaleString("ko-KR")}원
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <aside className={`h-fit border-t-2 border-ink bg-surface p-6 ${surface === "desktop" ? "sticky top-28" : ""}`}>
            <div className="flex justify-between text-xs">
              <span>상품 금액</span>
              <strong className="font-mono">
                {productTotal.toLocaleString("ko-KR")}원
              </strong>
            </div>
            <div className="mt-4 flex items-start justify-between gap-4 text-xs">
              <label className="flex items-start gap-2 font-bold">
                <input
                  checked={includeShippingFee}
                  className="mt-0.5"
                  disabled={busy || hasPendingCheckout || shippingFee < 1}
                  onChange={(event) => setIncludeShippingFee(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  배송비 함께 결제
                  <small className="mt-1 block font-normal text-muted">
                    기본 선택 · 이후 배송 신청 시 다시 청구하지 않습니다.
                  </small>
                </span>
              </label>
              <strong className="shrink-0 font-mono">
                {includeShippingFee
                  ? `${shippingFee.toLocaleString("ko-KR")}원`
                  : "나중에 결제"}
              </strong>
            </div>
            <div className="mt-6 flex justify-between border-t border-line pt-5">
              <span className="text-sm font-bold">예상 결제 금액</span>
              <strong className="font-mono text-xl">
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
              <div className="mt-6 border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] text-amber-900">
                결제 운영 모드를 확인하고 있습니다.
              </div>
            )}
            <button
              className="mt-4 h-13 w-full bg-ink text-xs font-bold text-paper disabled:opacity-50"
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
      )}
    </div>
  );
}
