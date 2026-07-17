import * as PortOne from "@portone/server-sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

export const PORTONE_PAY_METHODS = [
  "CARD",
  "EASY_PAY",
  "VIRTUAL_ACCOUNT",
] as const;

export type PortOnePayMethod = (typeof PORTONE_PAY_METHODS)[number];

interface PaymentOrderRow {
  buyer_id: string | null;
  product_id: string;
  currency: string;
  expected_amount: number;
  payment_status: string;
}

interface PaymentAttemptRow {
  currency: string;
  expected_amount: number;
  payment_id: string;
  requested_method: PortOnePayMethod;
  store_id: string;
  payment_orders: PaymentOrderRow | PaymentOrderRow[];
}

interface SyncedPaymentRow {
  payment_status: string;
  portone_status: string;
}

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

export function getAllowedPortOneChannelKeys(): ReadonlySet<string> {
  return new Set(
    PORTONE_PAY_METHODS.map(
      (payMethod) => getPortOnePublicConfiguration(payMethod).channelKey,
    ),
  );
}

export function getPortOneClient(): ReturnType<typeof PortOne.PortOneClient> {
  return PortOne.PortOneClient({
    secret: readRequiredEnvironment("PORTONE_API_SECRET"),
  });
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

function firstRpcRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  return data && typeof data === "object" ? (data as T) : null;
}

export async function verifyAndSyncPortOnePayment(
  admin: SupabaseClient,
  paymentId: string,
  options: { expectedBuyerId?: string } = {},
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
      "payment_id, requested_method, store_id, expected_amount, currency, payment_orders!payment_attempts_order_id_fkey!inner(buyer_id, product_id, expected_amount, currency, payment_status)",
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
  if (
    options.expectedBuyerId &&
    order.buyer_id !== options.expectedBuyerId
  ) {
    throw new PortOneIntegrationError(
      "payment_order_forbidden",
      "The payment order belongs to another member.",
      403,
    );
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

  const configuredStoreId = getPortOnePublicConfiguration(
    attempt.requested_method,
  ).storeId;
  const allowedChannelKeys = getAllowedPortOneChannelKeys();
  const expectedChannelType =
    process.env.PORTONE_CHANNEL_MODE?.trim().toUpperCase() || "TEST";
  const channelRequired = !(
    payment.status === "READY" || payment.status === "FAILED"
  );
  const channelInvalid = payment.channel
    ? payment.channel.type !== expectedChannelType ||
      typeof payment.channel.key !== "string" ||
      !allowedChannelKeys.has(payment.channel.key)
    : channelRequired;
  const amount = Number(payment.amount.total);
  const attemptAmount = Number(attempt.expected_amount);
  const orderAmount = Number(order.expected_amount);
  if (
    payment.id !== paymentId ||
    payment.version !== "V2" ||
    payment.storeId !== attempt.store_id ||
    payment.storeId !== configuredStoreId ||
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

  const method = readPaymentMethod(payment.method);
  const methodBase = method.paymentMethod?.split(":", 1)[0] ?? null;
  if (
    (methodBase !== null && !isPortOnePayMethod(methodBase)) ||
    ((payment.status === "PAID" ||
      payment.status === "VIRTUAL_ACCOUNT_ISSUED") &&
      methodBase === null)
  ) {
    throw new PortOneIntegrationError(
      "payment_method_verification_failed",
      "PortOne returned an unsupported payment method.",
      409,
    );
  }
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

  const synced = firstRpcRow<SyncedPaymentRow>(data);
  if (!synced) {
    throw new PortOneIntegrationError(
      "payment_sync_invalid_response",
      "The payment synchronization result was invalid.",
      500,
    );
  }
  return synced;
}

export function getPortOneWebhookSecret(): string {
  return readRequiredEnvironment("PORTONE_WEBHOOK_SECRET");
}
