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

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

type InventoryOverviewItem = Record<string, unknown> & {
  productId: string;
  rolloutEnabled: boolean;
  itemSelectedShipmentsEnabled: boolean;
};

function isInventoryItem(value: unknown): value is InventoryOverviewItem {
  if (!isRecord(value) || !hasExactKeys(value, [
    "id", "productId", "title", "imageUrl", "sourceKind", "sourceReference",
    "originStoreId", "originStoreName", "ownershipStatus", "physicalStatus",
    "locationKind", "rolloutEnabled", "itemSelectedShipmentsEnabled", "requestEligible", "requestBlockReason", "storageStartedAt",
    "storageExpiresAt", "activeShipmentId", "exceptionKind", "exceptionStatus",
    "exceptionResolution", "exceptionPublicReason",
  ])) return false;

  return isUuid(value.id) && isUuid(value.productId) &&
    typeof value.title === "string" && typeof value.imageUrl === "string" &&
    typeof value.sourceKind === "string" && typeof value.sourceReference === "string" &&
    isNullableText(value.originStoreId) && isNullableText(value.originStoreName) &&
    typeof value.ownershipStatus === "string" && typeof value.physicalStatus === "string" &&
    typeof value.locationKind === "string" && typeof value.rolloutEnabled === "boolean" &&
    typeof value.itemSelectedShipmentsEnabled === "boolean" && typeof value.requestEligible === "boolean" &&
    isNullableText(value.requestBlockReason) && isTimestamp(value.storageStartedAt) &&
    isTimestamp(value.storageExpiresAt) && (value.activeShipmentId === null || isUuid(value.activeShipmentId)) &&
    isNullableText(value.exceptionKind) && isNullableText(value.exceptionStatus) &&
    isNullableText(value.exceptionResolution) &&
    isNullableText(value.exceptionPublicReason);
}

function isInventoryOverview(value: unknown): value is {
  rolloutEnabled: boolean;
  items: InventoryOverviewItem[];
  serverTime: string;
} {
  return isRecord(value) && hasExactKeys(value, ["rolloutEnabled", "items", "serverTime"]) &&
    typeof value.rolloutEnabled === "boolean" &&
    Array.isArray(value.items) && value.items.every(isInventoryItem) &&
    typeof value.serverTime === "string" && Number.isFinite(Date.parse(value.serverTime));
}

function isLegacyAuctionWin(value: unknown): value is {
  product_id: string;
  title: string;
  image_urls: string[];
  shipping_status: string;
} {
  return isRecord(value) && isUuid(value.product_id) && typeof value.title === "string" &&
    Array.isArray(value.image_urls) && value.image_urls.every((image) => typeof image === "string") &&
    typeof value.shipping_status === "string";
}

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "get_my_inventory_overview",
  );
  if (error || !isInventoryOverview(data)) {
    return commerceJson({ error: "inventory_unavailable" }, 503);
  }
  const legacy = await (auth.user as unknown as RpcClient).rpc("get_my_won_products");
  if (legacy.error || !Array.isArray(legacy.data) || !legacy.data.every(isLegacyAuctionWin)) {
    return commerceJson({ error: "inventory_unavailable" }, 503);
  }
  const itemSelectedProductIds = new Set(
    data.items
      .filter((item) => item.itemSelectedShipmentsEnabled)
      .map((item) => item.productId),
  );
  return commerceJson({
    ...data,
    legacyAuctionWins: legacy.data
      .filter((win) => !itemSelectedProductIds.has(win.product_id))
      .map((win) => ({
        product_id: win.product_id,
        title: win.title,
        image_urls: win.image_urls,
        shipping_status: win.shipping_status,
      })),
  });
}
