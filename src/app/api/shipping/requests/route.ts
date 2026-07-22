import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";
import { getManualTransferAccount } from "@/lib/manualTransferConfig";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RpcError {
  code?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isShipmentPayment(value: unknown): value is Record<string, unknown> {
  return isRecord(value) &&
    isUuid(value.id) &&
    Number.isSafeInteger(value.expected_amount) &&
    Number(value.expected_amount) > 0 &&
    typeof value.status === "string" &&
    typeof value.bank_name_snapshot === "string" &&
    value.bank_name_snapshot.length > 0 &&
    typeof value.account_number_snapshot === "string" &&
    value.account_number_snapshot.length > 0;
}

function isShipmentResult(value: unknown): value is Record<string, unknown> {
  return isRecord(value) &&
    isUuid(value.shipment_id) &&
    isUuid(value.shipping_request_id) &&
    isUuid(value.order_id) &&
    typeof value.status === "string" &&
    typeof value.readiness_status === "string" &&
    (value.block_reason === null || typeof value.block_reason === "string") &&
    (value.settlement_method === "shipping_credit" || value.settlement_method === "manual_transfer") &&
    Number.isSafeInteger(value.version) && Number(value.version) >= 0 &&
    (value.settlement_method === "shipping_credit"
      ? value.payment === null
      : isShipmentPayment(value.payment)) &&
    typeof value.idempotent_replay === "boolean";
}

function rpcFailure(error: RpcError) {
  if (error.code === "22023") {
    return commerceJson({ error: "invalid_shipping_request", message: "배송 요청 내용을 확인해 주세요." }, 400);
  }
  if (error.code === "P0002") {
    return commerceJson({ error: "shipping_order_not_found", message: "배송 요청할 주문 또는 배송지를 찾지 못했습니다." }, 404);
  }
  if (error.code === "22000" || error.code === "23505" || error.code === "55000") {
    return commerceJson({ error: "shipping_request_conflict", message: "배송 요청 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, 409);
  }
  // This RPC is intentionally service-role-only. A permission error here is an
  // infrastructure configuration issue, not a member authorization failure.
  return commerceJson({ error: "shipping_request_unavailable" }, 503);
}

export async function POST(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as {
    orderId?: unknown;
    addressId?: unknown;
    applyShippingCredit?: unknown;
    idempotencyKey?: unknown;
  } | null;
  if (
    !body ||
    !isUuid(body.orderId) ||
    !isUuid(body.addressId) ||
    typeof body.applyShippingCredit !== "boolean" ||
    !isUuid(body.idempotencyKey)
  ) {
    return commerceJson({ error: "invalid_shipping_request", message: "주문, 배송지, 요청 키를 확인해 주세요." }, 400);
  }

  const settlement = body.applyShippingCredit ? "shipping_credit" : "manual_transfer";
  let shippingFeeAmount: number | null = null;
  let bankNameSnapshot: string | null = null;
  let accountNumberSnapshot: string | null = null;

  if (settlement === "manual_transfer") {
    const configuredAmount = Number(process.env.SHIPPING_FEE_AMOUNT ?? "3500");
    if (!Number.isSafeInteger(configuredAmount) || configuredAmount <= 0) {
      return commerceJson({ error: "shipping_request_unavailable" }, 503);
    }
    try {
      const account = await getManualTransferAccount(auth.admin);
      shippingFeeAmount = configuredAmount;
      bankNameSnapshot = account.bankName;
      accountNumberSnapshot = account.accountNumber;
    } catch {
      return commerceJson({ error: "shipping_request_unavailable" }, 503);
    }
  }

  const { data, error } = await auth.admin.rpc(
    "request_commerce_order_shipment",
    {
      p_member_id: auth.userId,
      p_order_id: body.orderId,
      p_address_id: body.addressId,
      p_settlement_method: settlement,
      p_shipping_fee_amount: shippingFeeAmount,
      p_bank_name_snapshot: bankNameSnapshot,
      p_account_number_snapshot: accountNumberSnapshot,
      p_idempotency_key: body.idempotencyKey,
    },
  );
  if (error) return rpcFailure(error);
  if (!isShipmentResult(data)) {
    return commerceJson({ error: "shipping_request_unavailable" }, 503);
  }

  return commerceJson(
    { shipment: data, request: { id: data.shipping_request_id } },
    data.idempotent_replay ? 200 : 201,
  );
}
