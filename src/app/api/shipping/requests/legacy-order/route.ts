import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_ORDER_BODY_KEYS = [
  "orderId",
  "addressId",
  "applyShippingCredit",
  "idempotencyKey",
] as const;

interface RpcError {
  code?: string;
}

type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: RpcError | null }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isPositiveMoney(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isShipmentPayment(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, [
    "id",
    "expected_amount",
    "status",
    "bank_name_snapshot",
    "account_number_snapshot",
  ]) &&
    isUuid(value.id) &&
    isPositiveMoney(value.expected_amount) &&
    value.status === "awaiting_transfer" &&
    typeof value.bank_name_snapshot === "string" &&
    value.bank_name_snapshot.trim().length > 0 &&
    typeof value.account_number_snapshot === "string" &&
    value.account_number_snapshot.trim().length > 0;
}

function isShipmentResult(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !hasExactKeys(value, [
    "shipment_id",
    "status",
    "version",
    "settlement_method",
    "payment",
    "idempotent_replay",
  ])) return false;

  const settlementIsValid = value.settlement_method === "shipping_credit" ||
    value.settlement_method === "manual_transfer" ||
    value.settlement_method === "waiver";
  const paymentIsValid = value.settlement_method === "manual_transfer"
    ? isShipmentPayment(value.payment)
    : value.payment === null;
  return isUuid(value.shipment_id) &&
    typeof value.status === "string" &&
    Number.isSafeInteger(value.version) && Number(value.version) >= 0 &&
    settlementIsValid &&
    paymentIsValid &&
    typeof value.idempotent_replay === "boolean";
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") {
    return commerceJson(
      { error: "shipment_forbidden", message: "배송 요청 권한이 없습니다." },
      403,
    );
  }
  if (error.code === "P0002") {
    return commerceJson(
      { error: "shipping_order_not_found", message: "배송 요청할 주문, 상품 또는 배송지를 찾지 못했습니다." },
      404,
    );
  }
  if (["22000", "22023", "23514"].includes(error.code ?? "")) {
    return commerceJson(
      { error: "invalid_shipping_request", message: "배송 요청 내용을 확인해 주세요." },
      422,
    );
  }
  if (["PT409", "23505", "40001"].includes(error.code ?? "")) {
    return commerceJson(
      { error: "shipping_request_conflict", message: "배송 요청 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." },
      409,
    );
  }
  if (error.code === "55000") {
    return commerceJson(
      { error: "shipping_request_not_ready", message: "현재 상태에서는 배송 요청을 진행할 수 없습니다." },
      422,
    );
  }
  return commerceJson({ error: "shipping_request_unavailable" }, 503);
}

export async function POST(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  if (
    !isRecord(body) ||
    !hasExactKeys(body, LEGACY_ORDER_BODY_KEYS) ||
    !isUuid(body.orderId) ||
    !isUuid(body.addressId) ||
    typeof body.applyShippingCredit !== "boolean" ||
    !isUuid(body.idempotencyKey)
  ) {
    return commerceJson(
      { error: "invalid_shipping_request", message: "기존 주문과 배송지, 요청 키를 확인해 주세요." },
      422,
    );
  }

  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "request_legacy_order_shipment",
    {
      p_order_id: body.orderId,
      p_address_id: body.addressId,
      p_apply_shipping_credit: body.applyShippingCredit,
      p_idempotency_key: body.idempotencyKey,
    },
  );
  if (error) return rpcFailure(error);
  if (!isShipmentResult(data)) {
    return commerceJson({ error: "shipping_request_unavailable" }, 503);
  }
  return commerceJson({ shipment: data }, data.idempotent_replay ? 200 : 201);
}
