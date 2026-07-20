import * as PortOne from "@portone/server-sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

export const PORTONE_PAY_METHODS = [
  "CARD",
  "EASY_PAY",
  "VIRTUAL_ACCOUNT",
] as const;

export type PortOnePayMethod = (typeof PORTONE_PAY_METHODS)[number];
export type PortOneChannelMode = "TEST" | "LIVE";

interface PaymentOrderRow {
  buyer_id: string | null;
  product_id: string | null;
  commerce_order_id: string | null;
  currency: string;
  expected_amount: number;
  payment_status: string;
  paid_at: string | null;
}

interface PaymentAttemptRow {
  currency: string;
  expected_amount: number;
  payment_id: string;
  requested_method: PortOnePayMethod;
  store_id: string;
  payment_orders: PaymentOrderRow | PaymentOrderRow[];
}

interface SyncedPaymentRpcRow {
  payment_status: string;
  portone_status: string | null;
  paid_at: string | null;
}

type SyncedPaymentRow = SyncedPaymentRpcRow;

export class PortOneIntegrationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PortOneIntegrationError";
    this.code = code;
    this.status = status;
  }
}

export function logPortOneServerError(
  context: string,
  error: unknown,
  paymentId?: string,
): void {
  const code =
    error instanceof PortOneIntegrationError ? error.code : "unexpected_error";
  console.error("[PortOne] server operation failed", {
    context,
    code,
    paymentId: paymentId ?? null,
  });
}

function readRequiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new PortOneIntegrationError(
      "portone_configuration_missing",
      `Missing required PortOne environment variable: ${name}`,
      503,
    );
  }
  return value;
}

export function getPortOnePublicConfiguration(
  payMethod: PortOnePayMethod = "CARD",
): {
  storeId: string;
  channelKey: string;
} {
  const storeId =
    process.env.PORTONE_STORE_ID?.trim() ||
    readRequiredEnvironment("VITE_PORTONE_STORE_ID");
  const fallbackChannelKey = readRequiredEnvironment(
    "VITE_PORTONE_CHANNEL_KEY",
  );
  const cardChannelKey =
    process.env.VITE_PORTONE_CARD_CHANNEL_KEY?.trim() || fallbackChannelKey;
  const channelKey =
    payMethod === "EASY_PAY"
      ? process.env.VITE_PORTONE_KAKAOPAY_CHANNEL_KEY?.trim() ||
        fallbackChannelKey
      : payMethod === "VIRTUAL_ACCOUNT"
        ? process.env.VITE_PORTONE_VIRTUAL_ACCOUNT_CHANNEL_KEY?.trim() ||
          cardChannelKey
        : cardChannelKey;

  // PortOne V2 Store IDs are issued separately from a PG merchant ID (MID).
  // Reject common test MIDs such as iamporttest_3 before opening a broken UI.
  if (!/^store-[A-Za-z0-9_-]+$/.test(storeId)) {
    throw new PortOneIntegrationError(
      "portone_store_id_invalid",
      "VITE_PORTONE_STORE_ID must be the PortOne V2 store-... value, not a PG MID.",
      503,
    );
  }
  if (!/^channel-key-[A-Za-z0-9-]+$/.test(channelKey)) {
    throw new PortOneIntegrationError(
      "portone_channel_key_invalid",
      "VITE_PORTONE_CHANNEL_KEY is not a valid PortOne V2 channel key.",
      503,
    );
  }
  return { storeId, channelKey };
}

export function getPortOneClient(): ReturnType<typeof PortOne.PortOneClient> {
  return PortOne.PortOneClient({
    secret: readRequiredEnvironment("PORTONE_API_SECRET"),
  });
}

export function getPortOneChannelMode(): PortOneChannelMode {
  const mode = readRequiredEnvironment("PORTONE_CHANNEL_MODE");
  if (mode !== "TEST" && mode !== "LIVE") {
    throw new PortOneIntegrationError(
      "portone_channel_mode_invalid",
      "PORTONE_CHANNEL_MODE must be explicitly set to TEST or LIVE.",
      503,
    );
  }
  return mode;
}

export function isPortOnePayMethod(value: unknown): value is PortOnePayMethod {
  return (
    typeof value === "string" &&
    (PORTONE_PAY_METHODS as readonly string[]).includes(value)
  );
}

export function isValidPaymentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 6 &&
    value.length <= 40 &&
    /^[A-Za-z0-9]+$/.test(value)
  );
}

/**
 * Commerce checkout never accepts a PortOne payment ID from the browser. The
 * database RPC resolves idempotent retries to the current persisted attempt.
 */
export function createCommercePortOnePaymentId(): string {
  return `C${crypto.randomUUID().replaceAll("-", "")}`;
}

/**
 * PG order-name limits are measured in UTF-8 bytes, not JavaScript code units.
 * Iterate by Unicode code point so a multi-byte character is never split.
 */
export function truncateUtf8Bytes(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) return value;

  let result = "";
  let usedBytes = 0;
  for (const character of value) {
    const characterBytes = encoder.encode(character).byteLength;
    if (usedBytes + characterBytes > maxBytes) break;
    result += character;
    usedBytes += characterBytes;
  }
  return result;
}

function readPaymentMethod(method: PortOne.Payment.PaymentMethod | undefined): {
  paymentMethod: string | null;
  vbankNum: string | null;
  vbankBank: string | null;
  vbankDue: string | null;
} {
  if (!method) {
    return {
      paymentMethod: null,
      vbankNum: null,
      vbankBank: null,
      vbankDue: null,
    };
  }

  switch (method.type) {
    case "PaymentMethodCard":
      return {
        paymentMethod: "CARD",
        vbankNum: null,
        vbankBank: null,
        vbankDue: null,
      };
    case "PaymentMethodEasyPay":
      return {
        paymentMethod: method.provider
          ? `EASY_PAY:${method.provider}`
          : "EASY_PAY",
        vbankNum: null,
        vbankBank: null,
        vbankDue: null,
      };
    case "PaymentMethodVirtualAccount":
      return {
        paymentMethod: "VIRTUAL_ACCOUNT",
        vbankNum: method.accountNumber,
        vbankBank: method.bank ?? null,
        vbankDue: method.expiredAt ?? null,
      };
    default:
      return {
        paymentMethod:
          typeof method.type === "string" ? method.type : "UNKNOWN",
        vbankNum: null,
        vbankBank: null,
        vbankDue: null,
      };
  }
}

type PortOnePaymentStatus = PortOne.Payment.Payment["status"];

const METHOD_REQUIRED_STATUSES = new Set<PortOnePaymentStatus>([
  "PAID",
  "VIRTUAL_ACCOUNT_ISSUED",
  "PARTIAL_CANCELLED",
  "CANCELLED",
]);

/**
 * READY/PAY_PENDING responses can precede payment-method selection, and a
 * FAILED response can also be emitted before PortOne has method details. When
 * a method is present, however, it must always match the immutable attempt.
 */
export function readVerifiedPortOnePaymentMethod(
  status: PortOnePaymentStatus,
  method: PortOne.Payment.PaymentMethod | undefined,
  requestedMethod: PortOnePayMethod,
): ReturnType<typeof readPaymentMethod> {
  const parsed = readPaymentMethod(method);
  const methodBase = parsed.paymentMethod?.split(":", 1)[0] ?? null;
  const missingRequiredMethod =
    methodBase === null && METHOD_REQUIRED_STATUSES.has(status);
  const easyPayProviderInvalid =
    requestedMethod === "EASY_PAY" &&
    method !== undefined &&
    (method.type !== "PaymentMethodEasyPay" ||
      method.provider !== "KAKAOPAY");

  if (
    missingRequiredMethod ||
    (methodBase !== null && methodBase !== requestedMethod) ||
    easyPayProviderInvalid
  ) {
    throw new PortOneIntegrationError(
      "payment_method_verification_failed",
      "PortOne payment method did not match the server-side attempt.",
      409,
    );
  }

  return parsed;
}

/**
 * READY and pre-selection FAILED responses may not have a selected channel.
 * Once present, the channel must be the exact mode/key prepared for this
 * attempt rather than merely another channel configured for the same store.
 */
export function isExpectedPortOnePaymentChannel(
  status: PortOnePaymentStatus,
  channel: { type: string; key?: string } | undefined,
  expectedMode: PortOneChannelMode,
  expectedKey: string,
): boolean {
  if (!channel) return status === "READY" || status === "FAILED";
  return channel.type === expectedMode && channel.key === expectedKey;
}

function firstRpcRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  return data && typeof data === "object" ? (data as T) : null;
}

/**
 * A product already started through manual transfer must never enter PortOne
 * preparation or reconciliation. The DB trigger applies the same invariant
 * inside the transaction to close races.
 */
export async function requireProductAvailableForPortOne(
  admin: SupabaseClient,
  productId: string,
): Promise<void> {
  const { data, error } = await admin.rpc(
    "get_manual_transfer_status_for_service",
    { p_product_id: productId },
  );

  if (error) {
    throw new PortOneIntegrationError(
      "manual_settlement_lookup_failed",
      "The manual settlement state could not be verified.",
      503,
      error,
    );
  }
  if (data === "awaiting_manual_transfer" || data === "confirmed") {
    throw new PortOneIntegrationError(
      "payment_already_in_manual_transfer",
      "This product is already being settled by manual bank transfer.",
      409,
    );
  }
}

export async function verifyAndSyncPortOnePayment(
  admin: SupabaseClient,
  paymentId: string,
  options: {
    expectedBuyerId?: string;
    allowedBuyerIds?: readonly string[];
  } = {},
): Promise<SyncedPaymentRow> {
  if (!isValidPaymentId(paymentId)) {
    throw new PortOneIntegrationError(
      "invalid_payment_id",
      "Invalid payment ID.",
      400,
    );
  }

  // Resolve through the immutable attempt ledger. payment_orders.payment_id is
  // only the current attempt and may change after a verified failed retry.
  const { data: rawAttempt, error: orderError } = await admin
    .from("payment_attempts")
    .select(
      "payment_id, requested_method, store_id, expected_amount, currency, payment_orders!payment_attempts_order_id_fkey!inner(buyer_id, product_id, commerce_order_id, expected_amount, currency, payment_status, paid_at)",
    )
    .eq("payment_id", paymentId)
    .maybeSingle();
  if (orderError) {
    throw new PortOneIntegrationError(
      "payment_order_lookup_failed",
      "The payment order could not be loaded.",
      500,
      orderError,
    );
  }
  if (!rawAttempt) {
    throw new PortOneIntegrationError(
      "payment_order_not_found",
      "The payment order does not exist.",
      404,
    );
  }

  const attempt = rawAttempt as unknown as PaymentAttemptRow;
  const order = Array.isArray(attempt.payment_orders)
    ? attempt.payment_orders[0]
    : attempt.payment_orders;
  if (!order) {
    throw new PortOneIntegrationError(
      "payment_order_not_found",
      "The payment order does not exist.",
      404,
    );
  }
  const allowedBuyerIds = options.allowedBuyerIds ??
    (options.expectedBuyerId ? [options.expectedBuyerId] : []);
  if (
    allowedBuyerIds.length > 0 &&
    (!order.buyer_id || !allowedBuyerIds.includes(order.buyer_id))
  ) {
    throw new PortOneIntegrationError(
      "payment_order_forbidden",
      "The payment order belongs to another member.",
      403,
    );
  }

  // Manual settlement is an auction-product invariant. Fixed-price commerce
  // attempts are tied to commerce_order_id and have no product_id.
  if (Boolean(order.product_id) === Boolean(order.commerce_order_id)) {
    throw new PortOneIntegrationError(
      "payment_order_reference_invalid",
      "The payment order is not linked to exactly one purchasable order.",
      500,
    );
  }
  if (order.product_id) {
    await requireProductAvailableForPortOne(admin, order.product_id);
  }

  let payment: PortOne.Payment.Payment;
  try {
    payment = await getPortOneClient().payment.getPayment({
      paymentId,
      storeId: attempt.store_id,
    });
  } catch (error) {
    throw new PortOneIntegrationError(
      "portone_payment_lookup_failed",
      "PortOne payment lookup failed.",
      502,
      error,
    );
  }

  if (!("id" in payment)) {
    throw new PortOneIntegrationError(
      "portone_status_unrecognized",
      "PortOne returned an unrecognized payment status.",
      502,
    );
  }

  const configuredPayment = getPortOnePublicConfiguration(
    attempt.requested_method,
  );
  const expectedChannelType = getPortOneChannelMode();
  const channelInvalid = !isExpectedPortOnePaymentChannel(
    payment.status,
    payment.channel,
    expectedChannelType,
    configuredPayment.channelKey,
  );
  const amount = Number(payment.amount.total);
  const attemptAmount = Number(attempt.expected_amount);
  const orderAmount = Number(order.expected_amount);
  if (
    payment.id !== paymentId ||
    payment.version !== "V2" ||
    payment.storeId !== attempt.store_id ||
    payment.storeId !== configuredPayment.storeId ||
    channelInvalid ||
    !Number.isSafeInteger(amount) ||
    amount !== attemptAmount ||
    amount !== orderAmount ||
    attempt.currency !== order.currency ||
    payment.currency !== order.currency ||
    payment.currency !== "KRW"
  ) {
    throw new PortOneIntegrationError(
      "payment_verification_failed",
      "PortOne payment data did not match the server-side order.",
      409,
    );
  }

  const method = readVerifiedPortOnePaymentMethod(
    payment.status,
    payment.method,
    attempt.requested_method,
  );
  const paidAt =
    "paidAt" in payment && typeof payment.paidAt === "string"
      ? payment.paidAt
      : null;
  const rpcClient = admin as unknown as SupabaseClient;
  const { data, error } = await rpcClient.rpc("sync_portone_payment", {
    p_amount: amount,
    p_currency: payment.currency,
    p_paid_at: paidAt,
    p_payment_id: paymentId,
    p_payment_method: method.paymentMethod,
    p_portone_status: payment.status,
    p_status_changed_at: payment.statusChangedAt,
    p_store_id: payment.storeId,
    p_vbank_bank: method.vbankBank,
    p_vbank_due: method.vbankDue,
    p_vbank_num: method.vbankNum,
  });
  if (error) {
    throw new PortOneIntegrationError(
      "payment_sync_failed",
      "The verified payment could not be synchronized.",
      500,
      error,
    );
  }

  const synced = firstRpcRow<SyncedPaymentRpcRow>(data);
  if (
    !synced ||
    (synced.paid_at !== null && typeof synced.paid_at !== "string")
  ) {
    throw new PortOneIntegrationError(
      "payment_sync_invalid_response",
      "The payment synchronization result was invalid.",
      500,
    );
  }
  // paid_at is returned from the same row lock and transaction that selected
  // the status. Do not reconstruct it from the pre-RPC lookup: a concurrent
  // paid-then-cancelled webhook may have advanced the persisted audit trail.
  return synced;
}

export function getPortOneWebhookSecret(): string {
  return readRequiredEnvironment("PORTONE_WEBHOOK_SECRET");
}
