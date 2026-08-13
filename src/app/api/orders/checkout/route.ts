import {
  authenticateMemberCommerceRequest,
  commerceJson,
  normalizeIds,
} from "@/lib/commerce/server";
import { getManualTransferAccount } from "@/lib/manualTransferConfig";

interface CommerceCheckoutBody {
  productIds?: unknown;
  idempotencyKey?: unknown;
  expectedPaymentMode?: unknown;
  includeShippingFee?: unknown;
  shippingRegion?: unknown;
}

interface ManualTransferCheckoutResult {
  order: Record<string, unknown> & { id: string; total: number };
  transfer: Record<string, unknown> & {
    order_id: string;
    expected_amount: number;
    bank_name_snapshot: string;
    account_number_snapshot: string;
    status: "awaiting_transfer" | "partially_paid" | "confirmed";
  };
}

type MemberCommerceAuth = Extract<
  Awaited<ReturnType<typeof authenticateMemberCommerceRequest>>,
  { ok: true }
>;

function readManualTransferCheckout(
  value: unknown,
): ManualTransferCheckoutResult | null {
  if (!value || typeof value !== "object") return null;
  const checkout = value as Record<string, unknown>;
  if (!checkout.order || typeof checkout.order !== "object") return null;
  if (!checkout.transfer || typeof checkout.transfer !== "object") return null;
  const order = checkout.order as Record<string, unknown>;
  const transfer = checkout.transfer as Record<string, unknown>;
  if (
    typeof order.id !== "string" || !order.id ||
    !Number.isSafeInteger(order.total) || (order.total as number) < 1 ||
    transfer.order_id !== order.id || transfer.expected_amount !== order.total ||
    typeof transfer.bank_name_snapshot !== "string" || !transfer.bank_name_snapshot.trim() ||
    typeof transfer.account_number_snapshot !== "string" || !transfer.account_number_snapshot.trim() ||
    !["awaiting_transfer", "partially_paid", "confirmed"].includes(transfer.status as string)
  ) return null;
  return { order, transfer } as ManualTransferCheckoutResult;
}

function rpcFailureStatus(code: string | undefined): number {
  if (code === "22023") return 400;
  if (code === "42501") return 403;
  if (["22000", "23505", "55000", "P0001", "P0002", "PT409"].includes(code ?? "")) {
    return 409;
  }
  return 503;
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
  includeShippingFee: boolean,
  shippingRegion: "regular" | "remote_area",
) {
  try {
    await getManualTransferAccount(auth.admin);
  } catch {
    return commerceJson({ error: "manual_transfer_configuration_missing" }, 503);
  }

  const { data: paymentRows, error: paymentStatusError } = await auth.user.rpc(
    "get_commerce_payment_status",
  );
  const paymentStatus = Array.isArray(paymentRows) ? paymentRows[0] : paymentRows;
  if (paymentStatusError || !paymentStatus) {
    return commerceJson({ error: "payment_status_unavailable" }, 503);
  }
  if (paymentStatus.active_mode !== "manual_transfer") {
    return commerceJson({ error: "manual_transfer_policy_mismatch" }, 503);
  }
  if (!paymentStatus.configured) {
    return commerceJson({ error: "manual_transfer_configuration_missing" }, 503);
  }

  const { data, error } = await auth.user.rpc(
    "create_commerce_manual_transfer_checkout",
    {
      p_product_ids: productIds,
      p_idempotency_key: idempotencyKey,
      p_apply_shipping_credit: false,
      p_include_shipping_fee: includeShippingFee,
      p_shipping_region: shippingRegion,
    },
  );
  if (error) {
    const status = rpcFailureStatus(error.code);
    return checkoutRpcErrorResponse(
      auth,
      idempotencyKey,
      status < 500 ? "payment_not_available" : "order_creation_failed",
      status,
    );
  }

  const checkout = readManualTransferCheckout(data);
  if (!checkout) return commerceJson({ error: "checkout_invalid_response" }, 500);
  return commerceJson({
    mode: "manual_transfer",
    order: checkout.order,
    transfer: checkout.transfer,
  }, 201);
}

export async function POST(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as CommerceCheckoutBody | null;
  const productIds = normalizeIds(body?.productIds);
  const idempotencyKey = typeof body?.idempotencyKey === "string"
    ? body.idempotencyKey.trim()
    : "";
  const includeShippingFee = body?.includeShippingFee === true;
  const shippingRegion = body?.shippingRegion === "remote_area" ? "remote_area" : "regular";

  if (productIds.length === 0 || !idempotencyKey || idempotencyKey.length > 128) {
    return commerceJson({ error: "상품과 주문 요청 키가 필요합니다." }, 400);
  }
  if (body?.expectedPaymentMode !== "manual_transfer") {
    return commerceJson({ error: "manual_transfer_required" }, 409);
  }
  return checkoutWithManualTransfer(
    auth,
    productIds,
    idempotencyKey,
    includeShippingFee,
    shippingRegion,
  );
}
