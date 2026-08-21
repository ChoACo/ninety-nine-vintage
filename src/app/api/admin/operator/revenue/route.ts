import { authenticateOperatorStoreRequest, commerceJson } from "@/lib/commerce/server";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RpcClient {
  rpc(
    functionName: string,
    parameters: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
}

interface InventoryDetailRow {
  id: string;
  member_id: string;
  product_id: string;
}

interface RevenueEntry {
  id: string;
  entryKind: "item_payment" | "item_refund" | "payment_reversal";
  amount: number;
  occurredAt: string;
  inventoryItemId: string | null;
  manualRefundId: string | null;
}

interface SettlementEntryRow {
  source_id: string;
  eligible_at: string;
  settlement_batch_id: string | null;
}

interface SettlementBatchRow {
  id: string;
  status: string;
  settlement_date: string;
  paid_at: string | null;
}

interface RevenueStore {
  storeId: string;
  storeName: string;
  grossSales: number;
  refunds: number;
  netSales: number;
  paidItemCount: number;
  refundedItemCount: number;
  entries: RevenueEntry[];
}

interface RevenueReport {
  stores: RevenueStore[];
  centralShippingFees: number;
  serverTime: string;
}

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

function isNullableUuid(value: unknown): value is string | null {
  return value === null || isUuid(value);
}

function isMoney(value: unknown): value is number {
  return Number.isSafeInteger(value);
}

function isEntry(value: unknown): value is RevenueEntry {
  return isRecord(value) && hasExactKeys(value, [
    "id", "entryKind", "amount", "occurredAt", "inventoryItemId", "manualRefundId",
  ]) && isUuid(value.id) && typeof value.entryKind === "string" &&
    ["item_payment", "item_refund", "payment_reversal"].includes(value.entryKind) &&
    isMoney(value.amount) && typeof value.occurredAt === "string" &&
    Number.isFinite(Date.parse(value.occurredAt)) &&
    isNullableUuid(value.inventoryItemId) && isNullableUuid(value.manualRefundId);
}

function isStore(value: unknown): value is RevenueStore {
  return isRecord(value) && hasExactKeys(value, [
    "storeId", "storeName", "grossSales", "refunds", "netSales",
    "paidItemCount", "refundedItemCount", "entries",
  ]) && isUuid(value.storeId) && typeof value.storeName === "string" &&
    isMoney(value.grossSales) && Number(value.grossSales) >= 0 &&
    isMoney(value.refunds) && Number(value.refunds) >= 0 &&
    isMoney(value.netSales) &&
    Number.isSafeInteger(value.paidItemCount) && Number(value.paidItemCount) >= 0 &&
    Number.isSafeInteger(value.refundedItemCount) && Number(value.refundedItemCount) >= 0 &&
    Array.isArray(value.entries) && value.entries.every(isEntry);
}

function isReport(value: unknown): value is RevenueReport {
  return isRecord(value) && hasExactKeys(value, ["stores", "centralShippingFees", "serverTime"]) &&
    Array.isArray(value.stores) && value.stores.every(isStore) &&
    isMoney(value.centralShippingFees) &&
    typeof value.serverTime === "string" && Number.isFinite(Date.parse(value.serverTime));
}

function validDate(value: string | null): value is string {
  if (!value || !DATE_PATTERN.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export async function GET(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request);
  if (!auth.ok) return auth.response;

  const query = new URL(request.url).searchParams;
  if (
    [...query.keys()].some((key) => key !== "from" && key !== "to") ||
    query.getAll("from").length !== 1 ||
    query.getAll("to").length !== 1 ||
    !validDate(query.get("from")) ||
    !validDate(query.get("to"))
  ) {
    return commerceJson(
      { error: "invalid_revenue_query", message: "매출 조회 기간을 확인해 주세요." },
      422,
    );
  }

  const from = query.get("from") as string;
  const to = query.get("to") as string;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days < 0 || days > 365) {
    return commerceJson(
      { error: "invalid_revenue_query", message: "매출 조회 기간은 최대 366일까지 선택할 수 있습니다." },
      422,
    );
  }

  const rpc = auth.user as unknown as RpcClient;
  const [{ data, error }, platformResult] = await Promise.all([
    rpc.rpc("get_store_financial_report", { p_from: from, p_to: to }),
    rpc.rpc("get_operator_store_platform_management", {}),
  ]);
  if (error?.code === "42501") {
    return commerceJson({ error: "revenue_forbidden", message: "매출 조회 권한이 없습니다." }, 403);
  }
  if (error || !isReport(data)) {
    return commerceJson({ error: "revenue_unavailable", message: "매장별 매출을 불러오지 못했습니다." }, 503);
  }

  const selectedStore = data.stores.find((store) => store.storeId === auth.selectedStoreId);
  if (!selectedStore || data.stores.some((store) => store.storeId !== auth.selectedStoreId)) {
    return commerceJson({ error: "revenue_scope_mismatch", message: "선택한 매장의 매출 범위를 확인하지 못했습니다." }, 503);
  }

  const inventoryIds = selectedStore.entries
    .map((entry) => entry.inventoryItemId)
    .filter((id): id is string => typeof id === "string");
  const { data: inventoryRows, error: inventoryError } = inventoryIds.length
    ? await auth.admin
      .from("customer_inventory_items")
      .select("id,member_id,product_id")
      .in("id", inventoryIds)
      .eq("origin_store_id", auth.selectedStoreId)
    : { data: [], error: null };
  if (inventoryError) {
    return commerceJson({ error: "revenue_detail_unavailable", message: "매출 상품 정보를 불러오지 못했습니다." }, 503);
  }

  const details = (inventoryRows ?? []) as InventoryDetailRow[];
  const productIds = [...new Set(details.map((row) => row.product_id))];
  const memberIds = [...new Set(details.map((row) => row.member_id))];
  const [{ data: products, error: productError }, { data: profiles, error: profileError }, settlementResult] = await Promise.all([
    productIds.length
      ? auth.admin.from("products").select("id,title,thumbnail_urls,image_urls").in("id", productIds).eq("store_id", auth.selectedStoreId)
      : Promise.resolve({ data: [], error: null }),
    memberIds.length
      ? auth.admin.from("profiles").select("id,display_name").in("id", memberIds)
      : Promise.resolve({ data: [], error: null }),
    inventoryIds.length
      ? auth.admin
        .from("store_settlement_entries")
        .select("source_id,eligible_at,settlement_batch_id")
        .eq("store_id", auth.selectedStoreId)
        .eq("source_kind", "inventory_item")
        .eq("entry_kind", "item_sale")
        .in("source_id", inventoryIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (productError || profileError || settlementResult.error) {
    return commerceJson({ error: "revenue_detail_unavailable", message: "매출 상세 정보를 불러오지 못했습니다." }, 503);
  }

  const settlementRows = (settlementResult.data ?? []) as SettlementEntryRow[];
  const batchIds = [...new Set(settlementRows
    .map((row) => row.settlement_batch_id)
    .filter((id): id is string => typeof id === "string"))];
  const { data: batchRows, error: batchError } = batchIds.length
    ? await auth.admin
      .from("store_settlement_batches")
      .select("id,status,settlement_date,paid_at")
      .eq("store_id", auth.selectedStoreId)
      .in("id", batchIds)
    : { data: [], error: null };
  if (batchError) {
    return commerceJson({ error: "revenue_detail_unavailable", message: "정산 상태를 불러오지 못했습니다." }, 503);
  }

  const inventoryById = new Map(details.map((row) => [row.id, row]));
  const productById = new Map((products ?? []).map((product) => [product.id, product]));
  const memberById = new Map((profiles ?? []).map((profile) => [profile.id, profile.display_name]));
  const settlementByInventoryId = new Map(settlementRows.map((row) => [row.source_id, row]));
  const batchById = new Map(((batchRows ?? []) as SettlementBatchRow[]).map((row) => [row.id, row]));
  const entries = selectedStore.entries.map((entry) => {
    const inventory = entry.inventoryItemId ? inventoryById.get(entry.inventoryItemId) : null;
    const product = inventory ? productById.get(inventory.product_id) : null;
    const settlement = entry.inventoryItemId ? settlementByInventoryId.get(entry.inventoryItemId) : null;
    const batch = settlement?.settlement_batch_id ? batchById.get(settlement.settlement_batch_id) : null;
    return {
      ...entry,
      buyerName: inventory ? memberById.get(inventory.member_id) ?? "구매자" : null,
      productId: inventory?.product_id ?? null,
      productTitle: product?.title ?? null,
      productImageUrl: product?.thumbnail_urls?.[0] ?? product?.image_urls?.[0] ?? null,
      settlementStatus: batch?.status === "paid" ? "paid" : settlement ? "pending" : null,
      settlementEligibleAt: settlement?.eligible_at ?? null,
      settlementDate: batch?.settlement_date ?? null,
      settledAt: batch?.paid_at ?? null,
    };
  });

  const platformStores = isRecord(platformResult.data) && Array.isArray(platformResult.data.stores)
    ? platformResult.data.stores.filter(isRecord)
    : [];
  const platformStore = platformStores.find((store) => store.id === auth.selectedStoreId);
  const safeMetric = (key: string) => {
    const value = platformStore?.[key];
    return Number.isSafeInteger(value) ? Number(value) : 0;
  };

  return commerceJson({
    stores: [{ ...selectedStore, entries }],
    centralShippingFees: 0,
    serverTime: data.serverTime,
    settlementSummary: {
      totalSettlementSales: safeMetric("totalSettlementSales"),
      weeklySales: safeMetric("weeklySales"),
      nextSettlementEstimate: safeMetric("nextSettlementEstimate"),
      paidTotal: safeMetric("paidTotal"),
    },
  });
}
