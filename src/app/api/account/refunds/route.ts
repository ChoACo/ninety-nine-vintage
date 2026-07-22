import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RpcClient {
  rpc(
    functionName: string,
    parameters?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isItemRefund(value: unknown) {
  return isRecord(value) &&
    hasExactKeys(value, [
      "id", "refundKind", "inventoryItemId", "productId", "title", "status", "amount",
      "accountSubmitted", "accountExpiresAt", "approvedAt", "completedAt", "publicReason",
    ]) &&
    isUuid(value.id) &&
    value.refundKind === "item" &&
    isUuid(value.inventoryItemId) &&
    isUuid(value.productId) &&
    typeof value.title === "string" &&
    typeof value.status === "string" &&
    Number.isSafeInteger(value.amount) &&
    Number(value.amount) > 0 &&
    typeof value.accountSubmitted === "boolean" &&
    isNullableText(value.accountExpiresAt) &&
    isNullableText(value.approvedAt) &&
    isNullableText(value.completedAt) &&
    typeof value.publicReason === "string";
}

function isShippingFeeRefund(value: unknown) {
  return isRecord(value) &&
    hasExactKeys(value, [
      "id", "refundKind", "shipmentId", "status", "amount", "accountSubmitted",
      "accountExpiresAt", "createdAt",
    ]) &&
    isUuid(value.id) &&
    value.refundKind === "shipping_fee" &&
    isUuid(value.shipmentId) &&
    typeof value.status === "string" &&
    Number.isSafeInteger(value.amount) &&
    Number(value.amount) > 0 &&
    typeof value.accountSubmitted === "boolean" &&
    isNullableText(value.accountExpiresAt) &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt));
}

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "get_my_manual_refunds",
  );
  if (error) {
    if (error.code === "42501") {
      return commerceJson({ error: "refund_forbidden" }, 403);
    }
    return commerceJson({ error: "refund_unavailable" }, 503);
  }
  if (
    !isRecord(data) ||
    !Array.isArray(data.refunds) ||
    data.refunds.some((refund) => !isItemRefund(refund)) ||
    !Array.isArray(data.shippingFeeRefunds) ||
    data.shippingFeeRefunds.some((refund) => !isShippingFeeRefund(refund))
  ) {
    return commerceJson({ error: "refund_unavailable" }, 503);
  }

  return commerceJson({
    refunds: [...data.shippingFeeRefunds, ...data.refunds],
  });
}
