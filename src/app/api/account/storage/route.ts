import {
  authenticateMemberCommerceRequest,
  commerceJson,
} from "@/lib/commerce/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcClient = {
  rpc: (
    name: string,
    args?: Record<string, never>,
  ) => Promise<{ data: unknown; error: { code?: string } | null }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasRequiredKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
) {
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isTimestamp(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" && Number.isFinite(Date.parse(value)))
  );
}

function inventoryUnavailable(stage: string) {
  console.error("[api/account/storage] inventory unavailable", { stage });
  return commerceJson(
    {
      error: "inventory_unavailable",
      code: "inventory_unavailable",
      ...(process.env.NODE_ENV === "development" ? { stage } : {}),
    },
    503,
  );
}

type InventoryOverviewItem = Record<string, unknown> & {
  id: string;
  productId: string;
  rolloutEnabled: boolean;
  itemSelectedShipmentsEnabled: boolean;
};

function isInventoryItem(value: unknown): value is InventoryOverviewItem {
  if (
    !isRecord(value) ||
    !hasRequiredKeys(value, [
      "id",
      "productId",
      "title",
      "imageUrl",
      "sourceKind",
      "sourceReference",
      "originStoreId",
      "originStoreName",
      "ownershipStatus",
      "rolloutEnabled",
      "itemSelectedShipmentsEnabled",
      "requestEligible",
      "requestBlockReason",
      "storageStartedAt",
      "storageExpiresAt",
      "activeShipmentId",
      "exceptionKind",
      "exceptionStatus",
      "exceptionResolution",
      "exceptionPublicReason",
    ])
  )
    return false;

  return (
    isUuid(value.id) &&
    isUuid(value.productId) &&
    typeof value.title === "string" &&
    typeof value.imageUrl === "string" &&
    typeof value.sourceKind === "string" &&
    typeof value.sourceReference === "string" &&
    isNullableText(value.originStoreId) &&
    isNullableText(value.originStoreName) &&
    typeof value.ownershipStatus === "string" &&
    typeof value.rolloutEnabled === "boolean" &&
    typeof value.itemSelectedShipmentsEnabled === "boolean" &&
    typeof value.requestEligible === "boolean" &&
    isNullableText(value.requestBlockReason) &&
    isTimestamp(value.storageStartedAt) &&
    isTimestamp(value.storageExpiresAt) &&
    (value.activeShipmentId === null || isUuid(value.activeShipmentId)) &&
    isNullableText(value.exceptionKind) &&
    isNullableText(value.exceptionStatus) &&
    isNullableText(value.exceptionResolution) &&
    isNullableText(value.exceptionPublicReason)
  );
}

function isInventoryOverview(value: unknown): value is {
  rolloutEnabled: boolean;
  items: InventoryOverviewItem[];
  serverTime: string;
} {
  return (
    isRecord(value) &&
    hasRequiredKeys(value, ["rolloutEnabled", "items", "serverTime"]) &&
    typeof value.rolloutEnabled === "boolean" &&
    Array.isArray(value.items) &&
    value.items.every(isInventoryItem) &&
    typeof value.serverTime === "string" &&
    Number.isFinite(Date.parse(value.serverTime))
  );
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
  active_payment_mode: "manual_transfer";
  shipping_status: string;
}

interface QuoteGroup {
  businessId: string;
  businessName: string;
  itemCount: number;
  itemSubtotal: number;
  earliestDueAt: string | null;
  items: Array<{
    productId: string;
    title: string;
    amount: number;
    dueAt: string | null;
  }>;
  hasStoredItems: boolean;
  shippingFeeAmount: number;
  shippingFeeCharged: number;
}

interface AuctionPaymentQuote {
  groups: QuoteGroup[];
  itemSubtotal: number;
  shippingFeeTotal: number;
  expectedTotal: number;
  serverTime: string;
}

interface CenterShippingToken {
  businessId: string;
  businessName: string;
  availableCount: number;
}

function isLegacyAuctionWin(value: unknown): value is LegacyAuctionWinRow {
  return (
    isRecord(value) &&
    isUuid(value.product_id) &&
    typeof value.title === "string" &&
    Array.isArray(value.image_urls) &&
    value.image_urls.every((image) => typeof image === "string") &&
    typeof value.closed_at === "string" &&
    Number.isFinite(Date.parse(value.closed_at)) &&
    Number.isSafeInteger(Number(value.final_bid_amount)) &&
    Number(value.final_bid_amount) >= 0 &&
    (value.manual_transfer_order_id === null ||
      isUuid(value.manual_transfer_order_id)) &&
    isNullableText(value.manual_transfer_status) &&
    (value.purchase_offer_id === null || isUuid(value.purchase_offer_id)) &&
    isNullableText(value.purchase_offer_status) &&
    isTimestamp(value.payment_due_at) &&
    typeof value.is_payment_settled === "boolean" &&
    value.active_payment_mode === "manual_transfer" &&
    typeof value.shipping_status === "string"
  );
}

function isQuoteGroup(value: unknown): value is QuoteGroup {
  if (!isRecord(value)) return false;
  const itemCount = Number(value.itemCount);
  const itemSubtotal = Number(value.itemSubtotal);
  const shippingFeeAmount = Number(value.shippingFeeAmount);
  const shippingFeeCharged = Number(value.shippingFeeCharged);
  return (
    isUuid(value.businessId) &&
    typeof value.businessName === "string" &&
    Number.isSafeInteger(itemCount) &&
    itemCount >= 1 &&
    Number.isSafeInteger(itemSubtotal) &&
    itemSubtotal >= 0 &&
    (value.earliestDueAt === null ||
      (typeof value.earliestDueAt === "string" &&
        Number.isFinite(Date.parse(value.earliestDueAt)))) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        isUuid(item.productId) &&
        typeof item.title === "string" &&
        Number.isSafeInteger(Number(item.amount)) &&
        Number(item.amount) >= 0 &&
        (item.dueAt === null ||
          (typeof item.dueAt === "string" &&
            Number.isFinite(Date.parse(item.dueAt)))),
    ) &&
    typeof value.hasStoredItems === "boolean" &&
    Number.isSafeInteger(shippingFeeAmount) &&
    shippingFeeAmount >= 0 &&
    Number.isSafeInteger(shippingFeeCharged) &&
    shippingFeeCharged >= 0
  );
}

function isAuctionPaymentQuote(value: unknown): value is AuctionPaymentQuote {
  if (!isRecord(value)) return false;
  const itemSubtotal = Number(value.itemSubtotal);
  const shippingFeeTotal = Number(value.shippingFeeTotal);
  const expectedTotal = Number(value.expectedTotal);
  return (
    Array.isArray(value.groups) &&
    value.groups.every(isQuoteGroup) &&
    Number.isSafeInteger(itemSubtotal) &&
    itemSubtotal >= 0 &&
    Number.isSafeInteger(shippingFeeTotal) &&
    shippingFeeTotal >= 0 &&
    Number.isSafeInteger(expectedTotal) &&
    expectedTotal >= 0 &&
    typeof value.serverTime === "string" &&
    Number.isFinite(Date.parse(value.serverTime))
  );
}

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;

  const rpcClient = auth.user as unknown as RpcClient;
  const [overview, legacy, quote] = await Promise.all([
    rpcClient.rpc("get_my_inventory_overview"),
    rpcClient.rpc("get_my_won_products"),
    rpcClient.rpc("get_my_auction_payment_quote"),
  ]);
  const { data, error } = overview;
  if (error || !isInventoryOverview(data)) {
    return inventoryUnavailable(
      error ? `overview_rpc:${error.code ?? "unknown"}` : "overview_shape",
    );
  }
  if (
    legacy.error ||
    !Array.isArray(legacy.data) ||
    !legacy.data.every(isLegacyAuctionWin)
  ) {
    return inventoryUnavailable(
      legacy.error
        ? `legacy_rpc:${legacy.error.code ?? "unknown"}`
        : "legacy_shape",
    );
  }
  if (quote.error || !isAuctionPaymentQuote(quote.data)) {
    return inventoryUnavailable(
      quote.error
        ? `quote_rpc:${quote.error.code ?? "unknown"}`
        : "quote_shape",
    );
  }
  const legacyWins = legacy.data as LegacyAuctionWinRow[];
  const accountResult = await auth.admin
    .from("member_accounts")
    .select("last_depositor_name")
    .eq("member_id", auth.userId)
    .maybeSingle();
  if (accountResult.error) {
    return inventoryUnavailable("member_context");
  }

  const manualTransferIds = legacyWins.flatMap((win) =>
    win.manual_transfer_order_id ? [win.manual_transfer_order_id] : [],
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
    tokenRowsResult,
  ] = await Promise.all([
    data.items.length === 0
      ? Promise.resolve({ data: [], error: null })
      : auth.admin
          .from("customer_inventory_items")
          .select(
            "id, business_id, storage_class_snapshot, storage_duration_days",
          )
          .in(
            "id",
            data.items.map((item) => item.id),
          ),
    legacyWins.length === 0
      ? Promise.resolve({ data: [], error: null })
      : auth.admin
          .from("products")
          .select("id, storage_class")
          .in(
            "id",
            legacyWins.map((win) => win.product_id),
          ),
    legacyWins.length === 0
      ? Promise.resolve({ data: [], error: null })
      : auth.admin
          .from("customer_inventory_items")
          .select("product_id")
          .eq("member_id", auth.userId)
          .in(
            "product_id",
            legacyWins.map((win) => win.product_id),
          ),
    auth.admin
      .from("shipping_fee_waiver_entitlements")
      .select("business_id, businesses(name)")
      .eq("member_id", auth.userId)
      .eq("status", "available"),
  ]);
  if (
    inventoryDetailsResult.error ||
    productDetailsResult.error ||
    inventoryProductIdsResult.error ||
    tokenRowsResult.error
  ) {
    return inventoryUnavailable("inventory_details");
  }
  const centerShippingTokens: CenterShippingToken[] = Object.entries(
    (tokenRowsResult.data ?? []).reduce<Record<string, number>>(
      (counts, row) => {
        const businessId = String(row.business_id);
        counts[businessId] = (counts[businessId] ?? 0) + 1;
        return counts;
      },
      {},
    ),
  ).map(([businessId, availableCount]) => ({
    businessId,
    businessName:
      (tokenRowsResult.data ?? []).find(
        (row) => String(row.business_id) === businessId,
      )?.businesses?.name ?? "센터",
    availableCount,
  }));
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
        businessId: details?.business_id ?? null,
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
            : null) ?? win.payment_due_at,
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
    deadlineEnforcementExempt: false,
    rememberedDepositorName: accountResult.data?.last_depositor_name ?? null,
    auctionPaymentQuote: quote.data,
    centerShippingTokens,
  });
}
