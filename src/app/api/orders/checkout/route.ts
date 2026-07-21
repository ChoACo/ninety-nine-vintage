import {
  authenticateMemberCommerceRequest,
  commerceJson,
  normalizeIds,
} from "@/lib/commerce/server";
import {
  ACTIVE_COMMERCE_PAYMENT_MODE,
  paymentModeMatches,
  PORTONE_COMMERCE_ENABLED,
  readCommercePaymentMode,
  type CommercePaymentMode,
} from "@/lib/commerce/paymentMode";
import { getManualTransferAccount } from "@/lib/manualTransferConfig";
import {
  createCommercePortOnePaymentId,
  getPortOneChannelMode,
  getPortOneClient,
  getPortOnePublicConfiguration,
  getPortOneWebhookSecret,
  isPortOnePayMethod,
  isValidPaymentId,
  logPortOneServerError,
  PortOneIntegrationError,
  truncateUtf8Bytes,
  verifyAndSyncPortOnePayment,
  type PortOnePayMethod,
} from "@/lib/portone/server";
import { getPaymentRuntimeMode } from "@/lib/portone/runtimeMode";

interface CommerceCheckoutBody {
  productIds?: unknown;
  idempotencyKey?: unknown;
  payMethod?: unknown;
  expectedPaymentMode?: unknown;
}

interface PreparedCommercePaymentRow {
  payment_id: string;
  commerce_order_id: string;
  order_name: string;
  expected_amount: number;
  payment_status: string;
  portone_status: string | null;
  can_retry_payment: boolean;
}

type MemberCommerceAuth = Extract<
  Awaited<ReturnType<typeof authenticateMemberCommerceRequest>>,
  { ok: true }
>;

function firstRow(data: unknown): PreparedCommercePaymentRow | null {
  if (Array.isArray(data)) {
    return (data[0] as PreparedCommercePaymentRow | undefined) ?? null;
  }
  return data && typeof data === "object"
    ? (data as PreparedCommercePaymentRow)
    : null;
}

function isConsistentPreparedPaymentState(
  prepared: PreparedCommercePaymentRow,
): boolean {
  if (prepared.portone_status === null) {
    return prepared.payment_status === "대기중" && !prepared.can_retry_payment;
  }
  if (
    prepared.portone_status === "READY" ||
    prepared.portone_status === "PAY_PENDING"
  ) {
    return prepared.payment_status === "대기중" && !prepared.can_retry_payment;
  }
  if (prepared.portone_status === "VIRTUAL_ACCOUNT_ISSUED") {
    return (
      prepared.payment_status === "가상계좌발급" &&
      !prepared.can_retry_payment
    );
  }
  if (prepared.portone_status === "PAID") {
    return prepared.payment_status === "결제완료" && !prepared.can_retry_payment;
  }
  if (prepared.portone_status === "FAILED") {
    return prepared.payment_status === "대기중" && prepared.can_retry_payment;
  }
  if (prepared.portone_status === "PARTIAL_CANCELLED") {
    return prepared.payment_status === "결제완료" && !prepared.can_retry_payment;
  }
  return (
    prepared.portone_status === "CANCELLED" &&
    prepared.payment_status === "대기중"
  );
}

function rpcFailureStatus(code: string | undefined): number {
  return ["22023"].includes(code ?? "")
    ? 400
    : ["42501"].includes(code ?? "")
      ? 403
      : ["22000", "23505", "55000", "P0001", "P0002", "PT409"].includes(
            code ?? "",
          )
        ? 409
        : 503;
}

async function paymentModeChangedResponse(
  auth: MemberCommerceAuth,
  knownMode?: CommercePaymentMode,
) {
  let paymentMode = knownMode;
  if (!paymentMode) {
    try {
      paymentMode = await getPaymentRuntimeMode(auth.admin);
    } catch {
      // The mismatch remains authoritative even if the follow-up display read
      // fails. Omit the new mode so the browser fails closed until refreshed.
    }
  }
  return commerceJson(
    {
      error: "payment_mode_changed",
      ...(paymentMode ? { paymentMode } : {}),
    },
    409,
  );
}

async function checkoutRpcErrorResponse(
  auth: MemberCommerceAuth,
  idempotencyKey: string,
  fallbackError: string,
  status: number,
) {
  const { data, error } = await auth.admin
    .from("commerce_orders")
    .select("id")
    .eq("member_id", auth.userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  // Only a successful, post-rollback lookup proving that no order exists may
  // unlock the browser request. An existing row or an uncertain lookup keeps
  // the same idempotency key so a payment ledger can never be abandoned.
  if (!error && !data) {
    return commerceJson(
      { error: "checkout_request_releasable", reason: fallbackError },
      status,
    );
  }
  return commerceJson({ error: fallbackError }, status);
}

async function checkoutWithManualTransfer(
  auth: MemberCommerceAuth,
  productIds: string[],
  idempotencyKey: string,
) {
  try {
    await getManualTransferAccount(auth.admin);
  } catch {
    return commerceJson(
      { error: "manual_transfer_configuration_missing" },
      503,
    );
  }

  const { data: paymentRows, error: paymentStatusError } = await auth.user.rpc(
    "get_commerce_payment_status",
  );
  const paymentStatus = Array.isArray(paymentRows)
    ? paymentRows[0]
    : paymentRows;
  if (paymentStatusError || !paymentStatus) {
    return commerceJson(
      { error: "payment_status_unavailable" },
      503,
    );
  }
  if (paymentStatus.active_mode !== "manual_transfer") {
    return paymentModeChangedResponse(
      auth,
      readCommercePaymentMode(paymentStatus.active_mode) ?? undefined,
    );
  }
  if (!paymentStatus.configured) {
    return commerceJson(
      { error: "manual_transfer_configuration_missing" },
      503,
    );
  }

  const { data, error } = await auth.user.rpc("create_commerce_order", {
    p_product_ids: productIds,
    p_idempotency_key: idempotencyKey,
    p_apply_shipping_credit: false,
  });
  if (error) {
    if (error.code === "PT409") {
      return paymentModeChangedResponse(auth);
    }
    const status = rpcFailureStatus(error.code);
    return checkoutRpcErrorResponse(
      auth,
      idempotencyKey,
      status < 500 ? "payment_not_available" : "order_creation_failed",
      status,
    );
  }

  const order = data as { id?: string; total?: number } | null;
  let transfer: Record<string, unknown> | null = null;
  if (order?.id) {
    const { data: createdTransfer, error: transferError } =
      await auth.user.rpc("create_commerce_order_transfer", {
        p_order_id: order.id,
      });
    if (transferError || !createdTransfer) {
      return commerceJson(
        { error: "transfer_creation_failed" },
        503,
      );
    }
    transfer = createdTransfer as Record<string, unknown>;
  }
  return commerceJson(
    { mode: "manual_transfer", order: data, transfer },
    201,
  );
}

async function checkoutWithPortOne(
  auth: MemberCommerceAuth,
  productIds: string[],
  idempotencyKey: string,
  payMethod: PortOnePayMethod,
) {
  // Read every required credential before the stock-locking transaction. A
  // partially configured deployment must not create an unpayable order.
  const { storeId, channelKey } = getPortOnePublicConfiguration(payMethod);
  getPortOneChannelMode();
  const portOneClient = getPortOneClient();
  getPortOneWebhookSecret();

  const proposedPaymentId = createCommercePortOnePaymentId();
  const { data, error } = await auth.admin.rpc(
    "prepare_commerce_portone_checkout",
    {
      p_idempotency_key: idempotencyKey,
      p_member_id: auth.userId,
      p_payment_id: proposedPaymentId,
      p_product_ids: productIds,
      p_requested_method: payMethod,
      p_store_id: storeId,
    },
  );
  if (error) {
    if (error.code === "PT409") {
      return paymentModeChangedResponse(auth);
    }
    const errorCode =
      error.code === "42501"
        ? "member_payment_required"
        : rpcFailureStatus(error.code) < 500
          ? "payment_not_available"
          : "prepare_failed";
    return checkoutRpcErrorResponse(
      auth,
      idempotencyKey,
      errorCode,
      rpcFailureStatus(error.code),
    );
  }

  const prepared = firstRow(data);
  const amount = Number(prepared?.expected_amount);
  if (
    !prepared ||
    !prepared.commerce_order_id ||
    !isValidPaymentId(prepared.payment_id) ||
    typeof prepared.order_name !== "string" ||
    !prepared.order_name.trim() ||
    !["대기중", "가상계좌발급", "결제완료"].includes(
      prepared.payment_status,
    ) ||
    (prepared.portone_status !== null &&
      ![
        "READY",
        "PAY_PENDING",
        "VIRTUAL_ACCOUNT_ISSUED",
        "PAID",
        "FAILED",
        "PARTIAL_CANCELLED",
        "CANCELLED",
      ].includes(prepared.portone_status)) ||
    typeof prepared.can_retry_payment !== "boolean" ||
    !isConsistentPreparedPaymentState(prepared) ||
    !Number.isSafeInteger(amount) ||
    amount <= 0
  ) {
    return commerceJson({ error: "prepare_invalid_response" }, 500);
  }

  let paymentStatus = prepared.payment_status;
  let portoneStatus = prepared.portone_status;
  let canRetryPayment = prepared.can_retry_payment;
  if (portoneStatus === null) {
    try {
      await portOneClient.payment.preRegisterPayment({
        paymentId: prepared.payment_id,
        storeId,
        totalAmount: amount,
        currency: "KRW",
      });
    } catch (error) {
      logPortOneServerError("commerce_preregister", error, prepared.payment_id);
      try {
        const recovered = await verifyAndSyncPortOnePayment(
          auth.admin,
          prepared.payment_id,
          { expectedBuyerId: auth.userId },
        );
        paymentStatus = recovered.payment_status;
        portoneStatus = recovered.portone_status;
        // This recovery branch is entered only from a never-paid NULL provider
        // state. A first observed pre-payment failure/cancellation may reopen
        // the same persisted paymentId; paid/refunded states remain blocked.
        canRetryPayment =
          recovered.paid_at === null &&
          (recovered.portone_status === "FAILED" ||
            recovered.portone_status === "CANCELLED");
      } catch (recoveryError) {
        logPortOneServerError(
          "commerce_preregister_recovery",
          recoveryError,
          prepared.payment_id,
        );
        if (
          recoveryError instanceof PortOneIntegrationError &&
          recoveryError.code === "portone_payment_lookup_failed"
        ) {
          return commerceJson({ error: "portone_preregister_failed" }, 502);
        }
        throw recoveryError;
      }
    }
  }

  return commerceJson(
    {
      mode: "portone",
      order: {
        id: prepared.commerce_order_id,
        status:
          portoneStatus === "PARTIAL_CANCELLED"
            ? "partially_paid"
            : portoneStatus === "CANCELLED" && !canRetryPayment
              ? "cancelled"
              : paymentStatus === "결제완료"
                ? "paid"
                : "awaiting_payment",
        total: amount,
      },
      payment: {
        storeId,
        channelKey,
        paymentId: prepared.payment_id,
        orderName: truncateUtf8Bytes(prepared.order_name, 100),
        totalAmount: amount,
        currency: "KRW",
        payMethod,
        paymentStatus,
        portoneStatus,
        canRetryPayment,
      },
    },
    201,
  );
}

export async function POST(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as
    | CommerceCheckoutBody
    | null;
  const productIds = normalizeIds(body?.productIds);
  const idempotencyKey =
    typeof body?.idempotencyKey === "string"
      ? body.idempotencyKey.trim()
      : "";
  const expectedPaymentMode = readCommercePaymentMode(
    body?.expectedPaymentMode,
  );
  if (
    productIds.length === 0 ||
    !idempotencyKey ||
    idempotencyKey.length > 128
  ) {
    return commerceJson(
      { error: "상품과 주문 요청 키가 필요합니다." },
      400,
    );
  }
  if (!expectedPaymentMode) {
    return commerceJson({ error: "invalid_expected_payment_mode" }, 400);
  }
  if (expectedPaymentMode !== ACTIVE_COMMERCE_PAYMENT_MODE) {
    return commerceJson(
      {
        error: "portone_archived",
        paymentMode: ACTIVE_COMMERCE_PAYMENT_MODE,
      },
      409,
    );
  }

  try {
    if (PORTONE_COMMERCE_ENABLED) {
      const mode = await getPaymentRuntimeMode(auth.admin);
      if (!paymentModeMatches(expectedPaymentMode, mode)) {
        return paymentModeChangedResponse(auth, mode);
      }
      if (mode === "portone") {
        if (!isPortOnePayMethod(body?.payMethod)) {
          return commerceJson({ error: "지원하지 않는 결제수단입니다." }, 400);
        }
        return checkoutWithPortOne(
          auth,
          productIds,
          idempotencyKey,
          body.payMethod,
        );
      }
    }
    return checkoutWithManualTransfer(
      auth,
      productIds,
      idempotencyKey,
    );
  } catch (error) {
    logPortOneServerError("commerce_checkout", error);
    if (error instanceof PortOneIntegrationError) {
      return commerceJson({ error: error.code }, error.status);
    }
    return commerceJson({ error: "checkout_failed" }, 500);
  }
}
