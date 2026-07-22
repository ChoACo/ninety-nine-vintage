import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHIPMENT_ACTIONS = new Set(["pack", "ship"]);

interface RpcError {
  code?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function optionalText(value: unknown, maximum: number): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : undefined;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isShipmentResult(value: unknown): value is Record<string, unknown> {
  return isRecord(value) &&
    isUuid(value.shipment_id) &&
    typeof value.status === "string" &&
    nonNegativeInteger(value.version) &&
    typeof value.idempotent_replay === "boolean";
}

function isShipmentQueueItem(value: unknown): value is Record<string, unknown> {
  return isRecord(value) &&
    isUuid(value.orderId) &&
    isUuid(value.orderItemId) &&
    isUuid(value.productId) &&
    isUuid(value.storeId) &&
    typeof value.title === "string" &&
    typeof value.stage === "string" &&
    typeof value.locationKind === "string" &&
    (value.storageLocationCode === null || typeof value.storageLocationCode === "string") &&
    typeof value.isBlocked === "boolean" &&
    (value.blockReason === null || typeof value.blockReason === "string") &&
    nonNegativeInteger(value.fulfillmentVersion);
}

function isShipmentQueueRow(value: unknown): value is Record<string, unknown> {
  return isRecord(value) &&
    isUuid(value.shipment_id) &&
    isUuid(value.shipping_request_id) &&
    isUuid(value.member_id) &&
    isUuid(value.business_id) &&
    isUuid(value.fulfillment_center_id) &&
    Array.isArray(value.order_ids) && value.order_ids.every(isUuid) &&
    isRecord(value.address_snapshot) &&
    typeof value.status === "string" &&
    typeof value.readiness_status === "string" &&
    (value.block_reason === null || typeof value.block_reason === "string") &&
    typeof value.settlement_method === "string" &&
    nonNegativeInteger(value.version) &&
    nonNegativeInteger(value.item_count) &&
    nonNegativeInteger(value.center_stored_count) &&
    nonNegativeInteger(value.packed_item_count) &&
    (value.courier === null || typeof value.courier === "string") &&
    (value.tracking_number === null || typeof value.tracking_number === "string") &&
    typeof value.requested_at === "string" &&
    (value.packed_at === null || typeof value.packed_at === "string") &&
    (value.shipped_at === null || typeof value.shipped_at === "string") &&
    Array.isArray(value.items) && value.items.every(isShipmentQueueItem);
}

function rpcFailure(error: RpcError) {
  if (error.code === "22023") {
    return commerceJson({ error: "invalid_shipment_request", message: "배송 작업 내용을 확인해 주세요." }, 400);
  }
  if (error.code === "42501") {
    return commerceJson({ error: "shipment_forbidden", message: "배송 작업 권한이 없습니다." }, 403);
  }
  if (error.code === "P0002") {
    return commerceJson({ error: "shipment_not_found", message: "정식 배송을 찾지 못했습니다." }, 404);
  }
  if (error.code === "22000" || error.code === "23505" || error.code === "55000") {
    return commerceJson({ error: "shipment_conflict", message: "배송 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, 409);
  }
  return commerceJson({ error: "shipment_unavailable" }, 503);
}

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "includeShipped") || params.getAll("includeShipped").length > 1) {
    return commerceJson({ error: "invalid_shipment_query" }, 400);
  }
  const includeShipped = params.get("includeShipped") === "true";
  if (params.has("includeShipped") && !["true", "false"].includes(params.get("includeShipped") ?? "")) {
    return commerceJson({ error: "invalid_shipment_query" }, 400);
  }

  const { data, error } = await auth.user.rpc(
    "get_commerce_shipment_queue",
    { p_include_shipped: includeShipped, p_limit: 100, p_offset: 0 },
  );
  if (error) return rpcFailure(error);
  if (!Array.isArray(data) || data.some((row) => !isShipmentQueueRow(row))) {
    return commerceJson({ error: "shipment_unavailable" }, 503);
  }
  return commerceJson({ requests: data, roleCode: auth.roleCode });
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as unknown;
  if (!isRecord(body) || !hasOnlyKeys(body, [
    "shipmentId",
    "expectedVersion",
    "action",
    "courier",
    "trackingNumber",
    "idempotencyKey",
    "note",
  ])) {
    return commerceJson({ error: "invalid_shipment_request", message: "배송 작업 내용을 확인해 주세요." }, 400);
  }

  const action = typeof body.action === "string" ? body.action : "";
  const courier = optionalText(body.courier, 80);
  const trackingNumber = optionalText(body.trackingNumber, 120);
  const note = optionalText(body.note, 500);
  if (
    !isUuid(body.shipmentId) ||
    !nonNegativeInteger(body.expectedVersion) ||
    !SHIPMENT_ACTIONS.has(action) ||
    !isUuid(body.idempotencyKey) ||
    courier === undefined ||
    trackingNumber === undefined ||
    note === undefined ||
    (action === "pack" && (courier !== null || trackingNumber !== null)) ||
    (action === "ship" && (!courier || !trackingNumber))
  ) {
    return commerceJson({ error: "invalid_shipment_request", message: "배송 작업 내용을 확인해 주세요." }, 400);
  }

  const result = action === "pack"
    ? await auth.user.rpc("pack_commerce_shipment", {
      p_shipment_id: body.shipmentId,
      p_expected_version: body.expectedVersion,
      p_idempotency_key: body.idempotencyKey,
      p_note: note,
    })
    : courier && trackingNumber
      ? await auth.user.rpc("ship_commerce_shipment", {
        p_shipment_id: body.shipmentId,
        p_expected_version: body.expectedVersion,
        p_courier: courier,
        p_tracking_number: trackingNumber,
        p_idempotency_key: body.idempotencyKey,
        p_note: note,
      })
      : null;
  if (!result) {
    return commerceJson({ error: "invalid_shipment_request", message: "택배사와 운송장 번호를 확인해 주세요." }, 400);
  }
  if (result.error) return rpcFailure(result.error);
  if (!isShipmentResult(result.data)) {
    return commerceJson({ error: "shipment_unavailable" }, 503);
  }
  return commerceJson({ shipment: result.data });
}
