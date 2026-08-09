import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcClient = {
  rpc: (name: string, args?: Record<string, never>) => Promise<{ data: unknown; error: { code?: string } | null }>;
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

function isTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function isLegacyOrderItem(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, [
    "orderItemId", "productId", "title", "imageUrl", "storageExpiresAt",
  ]) && isUuid(value.orderItemId) && isUuid(value.productId) &&
    typeof value.title === "string" && typeof value.imageUrl === "string" &&
    isTimestamp(value.storageExpiresAt);
}

function isLegacyEligibleOrder(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, [
    "sourceKind", "sourceId", "status", "requestEligible", "requestBlockReason",
    "storageExpiresAt", "items",
  ]) && value.sourceKind === "canonical_commerce" && isUuid(value.sourceId) &&
    value.status === "paid" && value.requestEligible === true &&
    value.requestBlockReason === null && isTimestamp(value.storageExpiresAt) &&
    Array.isArray(value.items) && value.items.every(isLegacyOrderItem);
}

function isLegacyEligibleOrders(value: unknown): value is { orders: Record<string, unknown>[] } {
  return isRecord(value) && hasExactKeys(value, ["orders"]) &&
    Array.isArray(value.orders) && value.orders.every(isLegacyEligibleOrder);
}

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;
  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "get_my_legacy_eligible_orders",
  );
  if (error || !isLegacyEligibleOrders(data)) {
    return commerceJson({ error: "legacy_orders_unavailable" }, 503);
  }
  return commerceJson(data);
}
