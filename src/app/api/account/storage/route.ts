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

function inventoryUnavailable(stage: string) {
  console.error("[api/account/storage] inventory unavailable", { stage });
  return commerceJson({
    error: "inventory_unavailable",
    code: "inventory_unavailable",
    ...(process.env.NODE_ENV === "development" ? { stage } : {}),
  }, 503);
}

type InventoryOverviewItem = Record<string, unknown> & {
  id: string;
  productId: string;
  rolloutEnabled: boolean;
  itemSelectedShipmentsEnabled: boolean;
};

function isInventoryItem(value: unknown): value is InventoryOverviewItem {
  if (!isRecord(value) || !hasExactKeys(value, [
    "id", "productId", "title", "imageUrl", "sourceKind", "sourceReference",
    "originStoreId", "originStoreName", "ownershipStatus",
    "rolloutEnabled", "itemSelectedShipmentsEnabled", "requestEligible", "requestBlockReason",
    "storageStartedAt", "storageExpiresAt", "activeShipmentId",
  ])) return false;

  return isUuid(value.id) && isUuid(value.productId) &&
    typeof value.title === "string" && typeof value.imageUrl === "string" &&
    typeof value.sourceKind === "string" && typeof value.sourceReference === "string" &&
    isNullableText(value.originStoreId) && isNullableText(value.originStoreName) &&
    typeof value.ownershipStatus === "string" && typeof value.rolloutEnabled === "boolean" &&
    typeof value.itemSelectedShipmentsEnabled === "boolean" && typeof value.requestEligible === "boolean" &&
    isNullableText(value.requestBlockReason) && isTimestamp(value.storageStartedAt) &&
    isTimestamp(value.storageExpiresAt) && (value.activeShipmentId === null || isUuid(value.activeShipmentId));
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

interface LegacyAuctionWinRow {
  product_id: string;
  title: string;
  image_urls: string[];
  closed_at: string;
  final_bid_amount: number;
  manual_transfer_order_id: string | null;
  manual_transfer_status: string | null;
  purchase_offer_id: string | null;
  purchase_offer_status: string | null;
  payment_due_at: string | null;
  is_payment_settled: boolean;
  active_payment_mode: "manual_transfer" | "portone";
  shipping_status: string;
}

function isLegacyAuctionWin(value: unknown): value is LegacyAuctionWinRow {
  return isRecord(value) && isUuid(value.product_id) && typeof value.title === "string" &&
    Array.isArray(value.image_urls) && value.image_urls.every((image) => typeof image === "string") &&
    typeof value.closed_at === "string" && Number.isFinite(Date.parse(value.closed_at)) &&
    Number.isSafeInteger(Number(value.final_bid_amount)) && Number(value.final_bid_amount) >= 0 &&
    (value.manual_transfer_order_id === null || isUuid(value.manual_transfer_order_id)) &&
    isNullableText(value.manual_transfer_status) &&
    (value.purchase_offer_id === null || isUuid(value.purchase_offer_id)) &&
    isNullableText(value.purchase_offer_status) &&
    isTimestamp(value.payment_due_at) &&
    typeof value.is_payment_settled === "boolean" &&
    (value.active_payment_mode === "manual_transfer" || value.active_payment_mode === "portone") &&
    typeof value.shipping_status === "string";
}

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "get_my_inventory_overview",
  );
  if (error || !isInventoryOverview(data)) {
    return inventoryUnavailable(
      error ? `overview_rpc:${error.code ?? "unknown"}` : "overview_shape",
    );
  }
  const legacy = await (auth.user as unknown as RpcClient).rpc("get_my_won_products");
  if (legacy.error || !Array.isArray(legacy.data) || !legacy.data.every(isLegacyAuctionWin)) {
    return inventoryUnavailable(
      legacy.error
        ? `legacy_rpc:${legacy.error.code ?? "unknown"}`
        : "legacy_shape",
    );
  }
  const legacyWins = legacy.data as LegacyAuctionWinRow[];
  const [roleResult, accountResult] = await Promise.all([
    auth.admin
      .from("account_access_roles")
      .select("role_code")
      .eq("user_id", auth.userId)
      .maybeSingle(),
    auth.admin
      .from("member_accounts")
      .select("last_depositor_name")
      .eq("member_id", auth.userId)
      .maybeSingle(),
  ]);
  if (roleResult.error || accountResult.error) {
    return inventoryUnavailable("member_context");
  }
  const role = roleResult.data;

  const manualTransferIds = legacyWins.flatMap((win) =>
    win.manual_transfer_order_id ? [win.manual_transfer_order_id] : []
  );
  const manualTransfers = new Map<
    string,
    { confirmedAt: string | null; dueAt: string | null }
  >();
  if (manualTransferIds.length > 0) {
    const { data: transfers, error: transferError } = await auth.admin
      .from("manual_transfer_orders")
      .select("id, display_due_at, due_at, confirmed_at")
      .in("id", manualTransferIds);
    if (transferError) return inventoryUnavailable("manual_transfers");
    for (const transfer of transfers ?? []) {
      manualTransfers.set(transfer.id, {
        confirmedAt: transfer.confirmed_at,
        dueAt: transfer.display_due_at ?? transfer.due_at,
      });
    }
  }
  const [
    inventoryDetailsResult,
    productDetailsResult,
    inventoryProductIdsResult,
  ] = await Promise.all([
    data.items.length === 0
      ? Promise.resolve({ data: [], error: null })
      : auth.admin
          .from("customer_inventory_items")
          .select("id, storage_class_snapshot, storage_duration_days")
          .in("id", data.items.map((item) => item.id)),
    legacyWins.length === 0
      ? Promise.resolve({ data: [], error: null })
      : auth.admin
          .from("products")
          .select("id, storage_class")
          .in("id", legacyWins.map((win) => win.product_id)),
    legacyWins.length === 0
      ? Promise.resolve({ data: [], error: null })
      : auth.admin
          .from("customer_inventory_items")
          .select("product_id")
          .eq("member_id", auth.userId)
          .in("product_id", legacyWins.map((win) => win.product_id)),
  ]);
  if (
    inventoryDetailsResult.error ||
    productDetailsResult.error ||
    inventoryProductIdsResult.error
  ) {
    return inventoryUnavailable("inventory_details");
  }
  const inventoryDetails = new Map(
    (inventoryDetailsResult.data ?? []).map((item) => [item.id, item]),
  );
  const productStorageClasses = new Map(
    (productDetailsResult.data ?? []).map((product) => [
      product.id,
      product.storage_class,
    ]),
  );
  const itemSelectedProductIds = new Set(
    (inventoryProductIdsResult.data ?? []).map((item) => item.product_id),
  );
  return commerceJson({
    ...data,
    items: data.items.map((item) => {
      const details = inventoryDetails.get(item.id);
      return {
        ...item,
        storageClass: details?.storage_class_snapshot ?? "small",
        storageDurationDays: details?.storage_duration_days ?? 14,
      };
    }),
    legacyAuctionWins: legacyWins
      .filter((win) => !itemSelectedProductIds.has(win.product_id))
      .map((win) => ({
        product_id: win.product_id,
        title: win.title,
        image_urls: win.image_urls,
        closed_at: win.closed_at,
        final_bid_amount: Number(win.final_bid_amount),
        manual_transfer_status: win.manual_transfer_status,
        purchase_offer_status: win.purchase_offer_status,
        payment_due_at:
          (win.manual_transfer_order_id
            ? manualTransfers.get(win.manual_transfer_order_id)?.dueAt
            : null) ??
          win.payment_due_at,
        is_payment_settled: win.is_payment_settled,
        active_payment_mode: win.active_payment_mode,
        shipping_status: win.shipping_status,
        storage_class:
          productStorageClasses.get(win.product_id) === "large"
            ? "large"
            : "small",
        storage_expires_at: (() => {
          const confirmedAt = win.manual_transfer_order_id
            ? manualTransfers.get(win.manual_transfer_order_id)?.confirmedAt
            : null;
          if (!confirmedAt) return null;
          const duration =
            productStorageClasses.get(win.product_id) === "large" ? 7 : 14;
          return new Date(
            Date.parse(confirmedAt) + duration * 86_400_000,
          ).toISOString();
        })(),
      })),
    deadlineEnforcementExempt: role?.role_code === "band_member",
    rememberedDepositorName:
      accountResult.data?.last_depositor_name ?? null,
  });
}
