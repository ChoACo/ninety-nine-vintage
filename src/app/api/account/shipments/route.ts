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

function isTrackingUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "trace.cjlogistics.com";
  } catch {
    return false;
  }
}

function isShipmentItem(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, [
    "inventoryItemId", "productId", "title", "imageUrl", "lineStatus", "physicalStatus",
  ]) && (value.inventoryItemId === null || isUuid(value.inventoryItemId)) && isUuid(value.productId) &&
    typeof value.title === "string" && typeof value.imageUrl === "string" &&
    typeof value.lineStatus === "string" && typeof value.physicalStatus === "string";
}

function isShipment(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, [
    "id", "sourceKind", "sourceId", "status", "settlementMethod", "shippingFeeStatus",
    "itemCount", "activeItemCount", "courier", "trackingNumber", "trackingUrl",
    "requestedAt", "packedAt", "shippedAt", "addressSnapshot", "items",
  ]) && isUuid(value.id) && typeof value.status === "string" &&
    (value.sourceKind === "inventory_v2" || value.sourceKind === "canonical_commerce") &&
    isUuid(value.sourceId) &&
    typeof value.settlementMethod === "string" && typeof value.shippingFeeStatus === "string" &&
    Number.isSafeInteger(value.itemCount) && Number(value.itemCount) >= 0 &&
    Number.isSafeInteger(value.activeItemCount) && Number(value.activeItemCount) >= 0 &&
    (value.courier === null || typeof value.courier === "string") &&
    (value.trackingNumber === null || typeof value.trackingNumber === "string") &&
    isTrackingUrl(value.trackingUrl) &&
    isTimestamp(value.requestedAt) && isTimestamp(value.packedAt) && isTimestamp(value.shippedAt) &&
    (value.addressSnapshot === null || isRecord(value.addressSnapshot)) &&
    Array.isArray(value.items) && value.items.every(isShipmentItem);
}

function isShipmentOverview(value: unknown): value is { shipments: Record<string, unknown>[] } {
  return isRecord(value) && hasExactKeys(value, ["shipments"]) &&
    Array.isArray(value.shipments) && value.shipments.every(isShipment);
}

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;
  const { data, error } = await (auth.user as unknown as RpcClient).rpc("get_my_inventory_shipments");
  if (error || !isShipmentOverview(data)) return commerceJson({ error: "shipment_history_unavailable" }, 503);
  return commerceJson(data);
}
