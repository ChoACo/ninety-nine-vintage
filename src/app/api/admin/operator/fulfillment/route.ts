import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["release_store_items", "release_paid_items", "center_receive", "center_store"]);

interface RpcError { code?: string; }
type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError | null }>;
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

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function isStoreItem(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, [
    "inventoryItemId", "productId", "title", "imageUrl", "lineStatus", "physicalStatus", "fulfillmentVersion", "isBlocked",
  ]) && isUuid(value.inventoryItemId) && isUuid(value.productId) &&
    typeof value.title === "string" && typeof value.imageUrl === "string" &&
    typeof value.lineStatus === "string" && typeof value.physicalStatus === "string" &&
    nonNegativeInteger(value.fulfillmentVersion) && typeof value.isBlocked === "boolean";
}

function isStoreWork(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, [
    "id", "shipmentId", "storeId", "storeName", "businessId", "centerId", "centerName", "status", "version", "requestedAt",
    "itemCount", "readyCount", "heldCount", "items",
  ]) && isUuid(value.id) && isUuid(value.shipmentId) && isUuid(value.storeId) &&
    typeof value.storeName === "string" && isUuid(value.businessId) && isUuid(value.centerId) &&
    typeof value.centerName === "string" && typeof value.status === "string" && nonNegativeInteger(value.version) &&
    isTimestamp(value.requestedAt) && nonNegativeInteger(value.itemCount) && nonNegativeInteger(value.readyCount) &&
    nonNegativeInteger(value.heldCount) && Array.isArray(value.items) && value.items.every(isStoreItem);
}

function isCenterItem(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, [
    "inventoryItemId", "productId", "title", "imageUrl", "memberId", "businessId", "centerId", "centerName", "originStoreId", "originStoreName", "handoffMode",
    "physicalStatus", "locationKind", "storageLocationCode", "version", "isBlocked", "workDueDate",
  ]) && isUuid(value.inventoryItemId) && isUuid(value.productId) && typeof value.title === "string" &&
    typeof value.imageUrl === "string" && isUuid(value.memberId) && isUuid(value.businessId) &&
    isUuid(value.centerId) && typeof value.centerName === "string" && isUuid(value.originStoreId) &&
    typeof value.originStoreName === "string" && typeof value.handoffMode === "string" &&
    typeof value.physicalStatus === "string" && typeof value.locationKind === "string" &&
    isNullableText(value.storageLocationCode) && nonNegativeInteger(value.version) &&
    typeof value.isBlocked === "boolean" && isTimestamp(value.workDueDate);
}

function isStoreQueue(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, ["works"]) && Array.isArray(value.works) && value.works.every(isStoreWork);
}

function isCenterQueue(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, ["items"]) && Array.isArray(value.items) && value.items.every(isCenterItem);
}

function isPaidStoreGroup(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, [
    "storeId", "storeName", "businessId", "centerId", "centerName", "items",
  ]) && isUuid(value.storeId) && typeof value.storeName === "string" &&
    isUuid(value.businessId) && isUuid(value.centerId) && typeof value.centerName === "string" &&
    Array.isArray(value.items) && value.items.every(isCenterItem);
}

function isPaidStoreQueue(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, ["stores"]) &&
    Array.isArray(value.stores) && value.stores.every(isPaidStoreGroup);
}

function isReleaseResult(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, ["id", "version", "status", "idempotent_replay"]) &&
    isUuid(value.id) && nonNegativeInteger(value.version) && typeof value.status === "string" &&
    typeof value.idempotent_replay === "boolean";
}

function isCenterResult(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, ["id", "version", "status", "items", "idempotent_replay"]) &&
    isUuid(value.id) && nonNegativeInteger(value.version) && typeof value.status === "string" &&
    Array.isArray(value.items) && value.items.every((item) => isRecord(item) && hasExactKeys(item, ["id", "version", "status"]) && isUuid(item.id) && nonNegativeInteger(item.version) && typeof item.status === "string") &&
    typeof value.idempotent_replay === "boolean";
}

function optionalText(value: unknown, maximum: number) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum ? normalized : undefined;
}

function pageFrom(request: Request) {
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some((key) => key !== "limit" && key !== "offset") || query.getAll("limit").length > 1 || query.getAll("offset").length > 1) return null;
  const limit = query.has("limit") ? Number(query.get("limit")) : 100;
  const offset = query.has("offset") ? Number(query.get("offset")) : 0;
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= 100 && Number.isSafeInteger(offset) && offset >= 0 && offset <= 10_000
    ? { limit, offset }
    : null;
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return commerceJson({ error: "fulfillment_forbidden", message: "이 물류 작업을 처리할 권한이 없습니다." }, 403);
  if (error.code === "P0002") return commerceJson({ error: "fulfillment_not_found", message: "물류 작업 또는 상품을 찾을 수 없습니다." }, 404);
  if (["PT409", "23505", "40001"].includes(error.code ?? "")) return commerceJson({ error: "fulfillment_conflict", message: "상품 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, 409);
  if (error.code === "55000") return commerceJson({ error: "fulfillment_not_ready", message: "현재 상품 상태에서는 이 물류 작업을 진행할 수 없습니다." }, 422);
  if (["22000", "22023", "23514"].includes(error.code ?? "")) return commerceJson({ error: "invalid_fulfillment_request", message: "처리할 상품과 입력 내용을 확인해 주세요." }, 422);
  return commerceJson({ error: "operator_fulfillment_unavailable", message: "물류 작업을 처리하지 못했습니다." }, 503);
}

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  const page = pageFrom(request);
  if (!page) return commerceJson({ error: "invalid_fulfillment_query", message: "조회 범위를 확인해 주세요." }, 422);

  const rpc = auth.user as unknown as RpcClient;
  const [storeResult, paidStoreResult, centerResult] = await Promise.all([
    rpc.rpc("get_inventory_store_work_queue", { p_limit: page.limit, p_offset: page.offset }),
    rpc.rpc("get_paid_inventory_store_queue", { p_limit: page.limit, p_offset: page.offset }),
    rpc.rpc("get_inventory_center_queue", { p_limit: page.limit, p_offset: page.offset }),
  ]);
  if (storeResult.error) return rpcFailure(storeResult.error);
  if (paidStoreResult.error) return rpcFailure(paidStoreResult.error);
  if (centerResult.error) return rpcFailure(centerResult.error);
  if (!isStoreQueue(storeResult.data) || !isPaidStoreQueue(paidStoreResult.data) || !isCenterQueue(centerResult.data)) return commerceJson({ error: "operator_fulfillment_unavailable" }, 503);
  return commerceJson({
    storeWorks: storeResult.data.works,
    paidStoreGroups: paidStoreResult.data.stores,
    centerItems: centerResult.data.items,
  });
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  if (!isRecord(body) || typeof body.action !== "string" || !ACTIONS.has(body.action)) return commerceJson({ error: "invalid_fulfillment_request", message: "처리할 작업을 확인해 주세요." }, 422);

  const inventoryItemIds = body.inventoryItemIds;
  const commonValid = Array.isArray(inventoryItemIds) && inventoryItemIds.length >= 1 && inventoryItemIds.length <= 100 && inventoryItemIds.every(isUuid) && new Set(inventoryItemIds).size === inventoryItemIds.length && isUuid(body.idempotencyKey);
  const note = optionalText(body.note, 1_000);
  if (!commonValid || note === undefined) return commerceJson({ error: "invalid_fulfillment_request", message: "처리할 상품과 입력 내용을 확인해 주세요." }, 422);

  const rpc = auth.user as unknown as RpcClient;
  if (body.action === "release_store_items") {
    if (!hasExactKeys(body, ["action", "workId", "inventoryItemIds", "expectedWorkVersion", "idempotencyKey", "note"]) || !isUuid(body.workId) || !nonNegativeInteger(body.expectedWorkVersion)) return commerceJson({ error: "invalid_fulfillment_request", message: "매장 출고 작업을 확인해 주세요." }, 422);
    const { data, error } = await rpc.rpc("release_inventory_shipment_items", {
      p_work_id: body.workId,
      p_inventory_item_ids: inventoryItemIds,
      p_expected_work_version: body.expectedWorkVersion,
      p_idempotency_key: body.idempotencyKey,
      p_note: note,
    });
    if (error) return rpcFailure(error);
    if (!isReleaseResult(data)) return commerceJson({ error: "operator_fulfillment_unavailable" }, 503);
    return commerceJson({ storeWork: data });
  }

  if (body.action === "release_paid_items") {
    if (
      !hasExactKeys(body, ["action", "inventoryItemIds", "expectedVersions", "idempotencyKey", "note"]) ||
      !Array.isArray(body.expectedVersions) ||
      body.expectedVersions.length !== inventoryItemIds.length ||
      !body.expectedVersions.every(nonNegativeInteger)
    ) {
      return commerceJson({ error: "invalid_fulfillment_request", message: "결제 완료 보관 상품의 버전을 확인해 주세요." }, 422);
    }
    const expectedVersions = body.expectedVersions as number[];
    const orderedItems = inventoryItemIds
      .map((id, index) => ({ id, version: expectedVersions[index] }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const { data, error } = await rpc.rpc("release_paid_inventory_items", {
      p_inventory_item_ids: orderedItems.map((item) => item.id),
      p_expected_versions: orderedItems.map((item) => item.version),
      p_idempotency_key: body.idempotencyKey,
      p_note: note,
    });
    if (error) return rpcFailure(error);
    if (!isCenterResult(data)) return commerceJson({ error: "operator_fulfillment_unavailable" }, 503);
    return commerceJson({ paidItems: data });
  }

  if (!hasExactKeys(body, ["action", "inventoryItemIds", "expectedVersions", "storageLocationCode", "idempotencyKey", "note"]) || !Array.isArray(body.expectedVersions) || body.expectedVersions.length !== inventoryItemIds.length || !body.expectedVersions.every(nonNegativeInteger)) return commerceJson({ error: "invalid_fulfillment_request", message: "센터 처리 버전을 확인해 주세요." }, 422);
  const storageLocationCode = optionalText(body.storageLocationCode, 120);
  if (storageLocationCode === undefined || (body.action === "center_store" && !storageLocationCode)) return commerceJson({ error: "invalid_fulfillment_request", message: "보관 위치를 확인해 주세요." }, 422);
  const centerExpectedVersions = body.expectedVersions as number[];
  const orderedCenterItems = inventoryItemIds
    .map((id, index) => ({ id, version: centerExpectedVersions[index] }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const { data, error } = await rpc.rpc("record_inventory_center_items", {
    p_action: body.action === "center_receive" ? "receive" : "store",
    p_inventory_item_ids: orderedCenterItems.map((item) => item.id),
    p_expected_versions: orderedCenterItems.map((item) => item.version),
    p_storage_location_code: storageLocationCode,
    p_idempotency_key: body.idempotencyKey,
    p_note: note,
  });
  if (error) return rpcFailure(error);
  if (!isCenterResult(data)) return commerceJson({ error: "operator_fulfillment_unavailable" }, 503);
  return commerceJson({ centerItems: data });
}
