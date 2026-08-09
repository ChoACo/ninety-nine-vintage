import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>;
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

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function isCompatItem(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, ["orderItemId", "productId"]) &&
    isUuid(value.orderItemId) && isUuid(value.productId);
}

function isCompatContract(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, [
    "sourceKind", "sourceId", "status", "settlementMethod", "courier", "trackingNumber",
    "requestedAt", "packedAt", "shippedAt", "memberId", "businessId", "immutable",
    "linkedInventoryShipmentIds", "items",
  ])) return false;
  return value.sourceKind === "canonical_commerce" &&
    isUuid(value.sourceId) &&
    typeof value.status === "string" &&
    typeof value.settlementMethod === "string" &&
    isNullableText(value.courier) &&
    isNullableText(value.trackingNumber) &&
    isTimestamp(value.requestedAt) &&
    isTimestamp(value.packedAt) &&
    isTimestamp(value.shippedAt) &&
    isUuid(value.memberId) &&
    isUuid(value.businessId) &&
    value.immutable === true &&
    Array.isArray(value.linkedInventoryShipmentIds) &&
    value.linkedInventoryShipmentIds.every(isUuid) &&
    Array.isArray(value.items) &&
    value.items.every(isCompatItem);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return commerceJson({ error: "invalid_shipment_id" }, 400);
  }

  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "get_my_commerce_shipment_compat",
    { p_shipment_id: id },
  );
  if (error) {
    return commerceJson({ error: "shipment_history_unavailable" }, 503);
  }
  if (data === null || !isCompatContract(data)) {
    return commerceJson({ error: "shipment_not_found" }, 404);
  }
  return commerceJson(data);
}
