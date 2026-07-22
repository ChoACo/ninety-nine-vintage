import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RpcError {
  code?: string;
  message?: string;
  details?: string;
}

interface RpcClient {
  rpc(
    functionName: string,
    parameters: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function optionalText(value: unknown, maximum: number): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : undefined;
}

function parsePage(request: Request) {
  const params = new URL(request.url).searchParams;
  const allowed = ["includeShipped", "limit", "offset"];
  if (
    [...params.keys()].some((key) => !allowed.includes(key)) ||
    allowed.some((key) => params.getAll(key).length > 1)
  ) return null;
  const includeShipped = params.get("includeShipped") ?? "false";
  const limit = params.has("limit") ? Number(params.get("limit")) : 50;
  const offset = params.has("offset") ? Number(params.get("offset")) : 0;
  if (
    !["true", "false"].includes(includeShipped) ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
    !Number.isSafeInteger(offset) || offset < 0 || offset > 10_000
  ) return null;
  return { includeShipped: includeShipped === "true", limit, offset };
}

function isStoreWork(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const fields = ["id", "storeId", "storeName", "status", "version"];
  return Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field)) &&
    isUuid(value.id) && isUuid(value.storeId) && typeof value.storeName === "string" &&
    typeof value.status === "string" && isNonNegativeInteger(value.version);
}

function isAddressSnapshot(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const fields = ["label", "recipientName", "phone", "postalCode", "address"];
  return Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field)) &&
    typeof value.label === "string" && typeof value.recipientName === "string" &&
    typeof value.phone === "string" && isNullableText(value.postalCode) &&
    typeof value.address === "string";
}

function isShipmentItem(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const fields = [
    "inventoryItemId", "productId", "title", "imageUrl", "lineStatus", "physicalStatus",
    "originStoreName", "isBlocked",
  ];
  return Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field)) &&
    isUuid(value.inventoryItemId) && isUuid(value.productId) && typeof value.title === "string" &&
    isNullableText(value.imageUrl) && typeof value.lineStatus === "string" &&
    typeof value.physicalStatus === "string" && typeof value.originStoreName === "string" &&
    typeof value.isBlocked === "boolean";
}

function isShipment(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const fields = [
    "id", "memberId", "businessId", "centerId", "status", "version", "settlementMethod",
    "shippingFeeStatus", "requestedAt", "packedAt", "shippedAt", "courier", "trackingNumber",
    "addressSnapshot", "itemCount", "activeItemCount", "storedItemCount", "heldItemCount", "storeWorks", "items",
  ];
  return Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field)) &&
    isUuid(value.id) && isUuid(value.memberId) && isUuid(value.businessId) && isUuid(value.centerId) &&
    typeof value.status === "string" && isNonNegativeInteger(value.version) &&
    typeof value.settlementMethod === "string" && typeof value.shippingFeeStatus === "string" &&
    typeof value.requestedAt === "string" && isNullableText(value.packedAt) && isNullableText(value.shippedAt) &&
    isNullableText(value.courier) && isNullableText(value.trackingNumber) &&
    isAddressSnapshot(value.addressSnapshot) &&
    isNonNegativeInteger(value.itemCount) && isNonNegativeInteger(value.activeItemCount) &&
    isNonNegativeInteger(value.storedItemCount) && isNonNegativeInteger(value.heldItemCount) &&
    Array.isArray(value.storeWorks) && value.storeWorks.every(isStoreWork) &&
    Array.isArray(value.items) && value.items.every(isShipmentItem);
}

function isQueue(value: unknown): value is { shipments: Record<string, unknown>[] } {
  return isRecord(value) && Object.keys(value).length === 1 &&
    Array.isArray(value.shipments) && value.shipments.every(isShipment);
}

function isShipmentResult(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const fields = ["id", "version", "status", "idempotent_replay"];
  return Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field)) &&
    isUuid(value.id) && isNonNegativeInteger(value.version) && typeof value.status === "string" &&
    typeof value.idempotent_replay === "boolean";
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") {
    return commerceJson({ error: "shipment_forbidden", message: "택배 발송 권한이 없습니다." }, 403);
  }
  if (error.code === "P0002") {
    return commerceJson({ error: "shipment_not_found", message: "배송 요청을 찾을 수 없습니다." }, 404);
  }
  if (error.code === "55000" && error.message === "미 출고된 상품이 존재합니다") {
    let blockedItemIds: string[] = [];
    try {
      const details = JSON.parse(error.details ?? "null") as unknown;
      if (
        isRecord(details) &&
        Array.isArray(details.blockedItemIds) &&
        details.blockedItemIds.every(isUuid)
      ) {
        blockedItemIds = details.blockedItemIds;
      }
    } catch {
      // PostgreSQL detail is optional; the stable code and message remain usable.
    }
    return commerceJson({
      error: "UNRELEASED_ITEMS",
      code: "UNRELEASED_ITEMS",
      message: "미 출고된 상품이 존재합니다",
      blockedItemIds,
    }, 422);
  }
  if (["PT409", "23505", "40001"].includes(error.code ?? "")) {
    return commerceJson({ error: "shipment_conflict", message: "배송 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, 409);
  }
  if (error.code === "55000") {
    return commerceJson({ error: "shipment_not_ready", message: "현재 배송 상태에서는 이 작업을 진행할 수 없습니다." }, 422);
  }
  if (["22023", "22003", "23514"].includes(error.code ?? "")) {
    return commerceJson({ error: "invalid_shipment_request", message: "배송 작업 내용을 확인해 주세요." }, 422);
  }
  return commerceJson({ error: "shipment_unavailable", message: "배송 작업을 처리하지 못했습니다." }, 503);
}

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  const page = parsePage(request);
  if (!page) return commerceJson({ error: "invalid_shipment_query", message: "조회 범위를 확인해 주세요." }, 422);

  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "get_inventory_shipment_queue",
    {
      p_include_shipped: page.includeShipped,
      p_limit: page.limit,
      p_offset: page.offset,
    },
  );
  if (error) return rpcFailure(error);
  if (!isQueue(data)) return commerceJson({ error: "shipment_unavailable", message: "배송 대기열을 확인하지 못했습니다." }, 503);
  return commerceJson(data);
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as unknown;
  if (!isRecord(body)) return commerceJson({ error: "invalid_shipment_request", message: "배송 작업 내용을 확인해 주세요." }, 422);

  const action = typeof body.action === "string" ? body.action : "";
  const allowed = action === "pack"
    ? ["shipmentId", "expectedVersion", "action", "idempotencyKey", "note"]
    : action === "ship"
      ? ["shipmentId", "expectedVersion", "action", "courier", "trackingNumber", "idempotencyKey", "note"]
      : [];
  const courier = optionalText(body.courier, 80);
  const trackingNumber = optionalText(body.trackingNumber, 120);
  const note = optionalText(body.note, 500);
  if (
    allowed.length === 0 || !hasOnlyKeys(body, allowed) ||
    !isUuid(body.shipmentId) || !isNonNegativeInteger(body.expectedVersion) ||
    !isUuid(body.idempotencyKey) || courier === undefined || trackingNumber === undefined || note === undefined ||
    (action === "pack" && (courier !== null || trackingNumber !== null)) ||
    (action === "ship" && (!courier || !trackingNumber))
  ) {
    return commerceJson({ error: "invalid_shipment_request", message: "배송 작업 내용을 확인해 주세요." }, 422);
  }

  const result = action === "pack"
    ? await (auth.user as unknown as RpcClient).rpc("pack_inventory_shipment", {
      p_shipment_id: body.shipmentId,
      p_expected_version: body.expectedVersion,
      p_idempotency_key: body.idempotencyKey,
      p_note: note,
    })
    : await (auth.user as unknown as RpcClient).rpc("ship_inventory_shipment", {
      p_shipment_id: body.shipmentId,
      p_expected_version: body.expectedVersion,
      p_courier: courier,
      p_tracking_number: trackingNumber,
      p_idempotency_key: body.idempotencyKey,
      p_note: note,
    });
  if (result.error) return rpcFailure(result.error);
  if (!isShipmentResult(result.data)) return commerceJson({ error: "shipment_unavailable", message: "배송 처리 결과를 검증하지 못했습니다." }, 503);
  return commerceJson({ shipment: result.data });
}
