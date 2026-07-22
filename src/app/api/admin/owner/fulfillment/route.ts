import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
  readSmallJsonBody,
} from "@/lib/ownerAccess/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CENTER_ACTIONS = new Set([
  "receive",
  "store",
  "report_issue",
  "resolve_issue",
]);

interface RpcError {
  code?: string;
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

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isQueueItem(value: unknown) {
  if (!isRecord(value)) return false;
  return isUuid(value.orderItemId) &&
    isUuid(value.productId) &&
    typeof value.title === "string" &&
    isNullableText(value.imageUrl) &&
    typeof value.paymentStatus === "string" &&
    typeof value.stage === "string" &&
    typeof value.locationKind === "string" &&
    isNullableText(value.storageLocationCode) &&
    typeof value.isBlocked === "boolean" &&
    isNullableText(value.blockReason) &&
    nonNegativeInteger(value.version) &&
    typeof value.updatedAt === "string";
}

function isCenterWork(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.items)) return false;
  return isUuid(value.work_id) &&
    isUuid(value.order_id) &&
    isUuid(value.store_id) &&
    typeof value.store_name === "string" &&
    isUuid(value.business_id) &&
    typeof value.work_status === "string" &&
    nonNegativeInteger(value.work_version) &&
    typeof value.order_status === "string" &&
    typeof value.order_created_at === "string" &&
    isUuid(value.center_id) &&
    typeof value.center_name === "string" &&
    typeof value.center_status === "string" &&
    nonNegativeInteger(value.active_item_count) &&
    nonNegativeInteger(value.received_item_count) &&
    nonNegativeInteger(value.stored_item_count) &&
    nonNegativeInteger(value.blocked_item_count) &&
    value.items.every(isQueueItem);
}

function isCenter(value: unknown) {
  if (!isRecord(value)) return false;
  return isUuid(value.id) &&
    isUuid(value.business_id) &&
    typeof value.code === "string" &&
    typeof value.name === "string" &&
    typeof value.status === "string" &&
    typeof value.is_default === "boolean" &&
    isNullableText(value.postal_code) &&
    isNullableText(value.address_line1) &&
    isNullableText(value.address_line2) &&
    isNullableText(value.contact_name) &&
    isNullableText(value.contact_phone) &&
    nonNegativeInteger(value.version) &&
    typeof value.updated_at === "string";
}

function normalizedText(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= minimum &&
      normalized.length <= maximum &&
      !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : null;
}

function optionalText(value: unknown, maximum: number) {
  if (value === undefined || value === null || value === "") return null;
  return normalizedText(value, 1, maximum) ?? undefined;
}

function parsePage(request: Request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "limit" && key !== "offset")) return null;
  if (params.getAll("limit").length > 1 || params.getAll("offset").length > 1) return null;
  const limit = params.has("limit") ? Number(params.get("limit")) : 100;
  const offset = params.has("offset") ? Number(params.get("offset")) : 0;
  if (
    !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
    !Number.isSafeInteger(offset) || offset < 0 || offset > 10_000
  ) {
    return null;
  }
  return { limit, offset };
}

function rpcFailure(error: RpcError, fallback: string) {
  if (error.code === "42501") {
    return ownerAccessJsonResponse(
      { error: "fulfillment_forbidden", message: "중앙 물류 작업 권한이 없습니다." },
      403,
    );
  }
  if (error.code === "P0002") {
    return ownerAccessJsonResponse(
      { error: "fulfillment_not_found", message: "물류 대상을 찾을 수 없습니다." },
      404,
    );
  }
  if (error.code === "55000") {
    return ownerAccessJsonResponse(
      {
        error: "fulfillment_conflict",
        message: "작업 내용이 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
      },
      409,
    );
  }
  if (
    error.code === "22000" ||
    error.code === "22023" ||
    error.code === "23514"
  ) {
    return ownerAccessJsonResponse(
      { error: "invalid_fulfillment_request", message: "입력 내용을 확인해 주세요." },
      400,
    );
  }
  return ownerAccessJsonResponse({ error: fallback }, 503);
}

export async function GET(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const page = parsePage(request);
    if (!page) {
      return ownerAccessJsonResponse(
        { error: "invalid_fulfillment_query", message: "조회 범위를 확인해 주세요." },
        400,
      );
    }

    const [queueResult, centerResult] = await Promise.all([
      (access.userClient as unknown as RpcClient).rpc(
        "get_center_fulfillment_queue",
        { p_limit: page.limit, p_offset: page.offset },
      ),
      access.userClient
        .from("fulfillment_centers")
        .select(
          "id,business_id,code,name,status,is_default,postal_code,address_line1,address_line2,contact_name,contact_phone,version,updated_at",
        )
        .order("is_default", { ascending: false })
        .order("name", { ascending: true }),
    ]);

    if (queueResult.error) return rpcFailure(queueResult.error, "owner_fulfillment_unavailable");
    if (centerResult.error) {
      return ownerAccessJsonResponse({ error: "owner_fulfillment_unavailable" }, 503);
    }
    if (
      !Array.isArray(queueResult.data) ||
      queueResult.data.some((row) => !isCenterWork(row)) ||
      !Array.isArray(centerResult.data) ||
      centerResult.data.some((center) => !isCenter(center))
    ) {
      return ownerAccessJsonResponse({ error: "owner_fulfillment_unavailable" }, 503);
    }

    return ownerAccessJsonResponse({
      centers: centerResult.data,
      works: queueResult.data,
    });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request);
    if (!hasOnlyKeys(body, [
      "centerId",
      "expectedVersion",
      "postalCode",
      "addressLine1",
      "addressLine2",
      "contactName",
      "contactPhone",
      "idempotencyKey",
    ])) {
      return ownerAccessJsonResponse(
        { error: "invalid_fulfillment_request", message: "입력 내용을 확인해 주세요." },
        400,
      );
    }

    const postalCode = normalizedText(body.postalCode, 5, 5);
    const addressLine1 = normalizedText(body.addressLine1, 5, 500);
    const addressLine2 = optionalText(body.addressLine2, 500);
    const contactName = normalizedText(body.contactName, 1, 80);
    const contactPhone = normalizedText(body.contactPhone, 7, 30);
    if (
      !isUuid(body.centerId) ||
      !nonNegativeInteger(body.expectedVersion) ||
      !postalCode || !/^[0-9]{5}$/.test(postalCode) ||
      !addressLine1 ||
      addressLine2 === undefined ||
      !contactName ||
      !contactPhone ||
      !isUuid(body.idempotencyKey)
    ) {
      return ownerAccessJsonResponse(
        { error: "invalid_fulfillment_request", message: "센터 주소와 연락처를 확인해 주세요." },
        400,
      );
    }

    const { data, error } = await (access.userClient as unknown as RpcClient).rpc(
      "configure_fulfillment_center",
      {
        p_center_id: body.centerId,
        p_expected_version: body.expectedVersion,
        p_postal_code: postalCode,
        p_address_line1: addressLine1,
        p_address_line2: addressLine2,
        p_contact_name: contactName,
        p_contact_phone: contactPhone,
        p_idempotency_key: body.idempotencyKey,
      },
    );
    if (error) return rpcFailure(error, "center_configuration_unavailable");
    if (!isRecord(data) || !isUuid(data.center_id) || !nonNegativeInteger(data.version)) {
      return ownerAccessJsonResponse({ error: "center_configuration_unavailable" }, 503);
    }
    return ownerAccessJsonResponse({ center: data });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request);
    if (!hasOnlyKeys(body, [
      "orderItemId",
      "expectedVersion",
      "action",
      "idempotencyKey",
      "storageLocationCode",
      "reasonCode",
      "note",
    ])) {
      return ownerAccessJsonResponse(
        { error: "invalid_fulfillment_request", message: "입력 내용을 확인해 주세요." },
        400,
      );
    }

    const storageLocationCode = optionalText(body.storageLocationCode, 120);
    const reasonCode = optionalText(body.reasonCode, 80);
    const note = optionalText(body.note, 1_000);
    const action = typeof body.action === "string" ? body.action : "";
    const needsStorage = action === "store";
    const needsIssueDetails = action === "report_issue" || action === "resolve_issue";
    if (
      !isUuid(body.orderItemId) ||
      !nonNegativeInteger(body.expectedVersion) ||
      !CENTER_ACTIONS.has(action) ||
      !isUuid(body.idempotencyKey) ||
      storageLocationCode === undefined ||
      reasonCode === undefined ||
      note === undefined ||
      (needsStorage && !storageLocationCode) ||
      (!needsStorage && storageLocationCode !== null) ||
      (needsIssueDetails && (!reasonCode || !note)) ||
      (!needsIssueDetails && reasonCode !== null)
    ) {
      return ownerAccessJsonResponse(
        { error: "invalid_fulfillment_request", message: "작업 내용과 사유를 확인해 주세요." },
        400,
      );
    }

    const { data, error } = await (access.userClient as unknown as RpcClient).rpc(
      "record_center_item_action",
      {
        p_order_item_id: body.orderItemId,
        p_expected_version: body.expectedVersion,
        p_action: action,
        p_idempotency_key: body.idempotencyKey,
        p_storage_location_code: storageLocationCode,
        p_reason_code: reasonCode,
        p_note: note,
      },
    );
    if (error) return rpcFailure(error, "center_item_action_unavailable");
    if (!isRecord(data) || !isUuid(data.order_item_id) || !nonNegativeInteger(data.version)) {
      return ownerAccessJsonResponse({ error: "center_item_action_unavailable" }, 503);
    }
    return ownerAccessJsonResponse({ item: data });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
