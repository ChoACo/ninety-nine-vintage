import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RpcClient {
  rpc(
    functionName: string,
    parameters: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
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

function isEntry(value: unknown) {
  return isRecord(value) && hasExactKeys(value, [
    "id", "entryKind", "amount", "occurredAt", "inventoryItemId", "manualRefundId",
  ]) && isUuid(value.id) && typeof value.entryKind === "string" &&
    ["item_payment", "item_refund", "payment_reversal"].includes(value.entryKind) &&
    isMoney(value.amount) && typeof value.occurredAt === "string" &&
    Number.isFinite(Date.parse(value.occurredAt)) &&
    isNullableUuid(value.inventoryItemId) && isNullableUuid(value.manualRefundId);
}

function isStore(value: unknown) {
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

function isReport(value: unknown) {
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
  const auth = await authenticateStaffRequest(request);
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

  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "get_store_financial_report",
    { p_from: from, p_to: to },
  );
  if (error?.code === "42501") {
    return commerceJson({ error: "revenue_forbidden", message: "매출 조회 권한이 없습니다." }, 403);
  }
  if (error || !isReport(data)) {
    return commerceJson({ error: "revenue_unavailable", message: "매장별 매출을 불러오지 못했습니다." }, 503);
  }
  return commerceJson(data);
}
