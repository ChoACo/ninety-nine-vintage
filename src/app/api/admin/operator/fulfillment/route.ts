import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORE_ACTIONS = new Set(["mark_ready", "hand_over"]);

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

function optionalText(value: unknown, maximum: number) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum
    ? normalized
    : undefined;
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

function isStoreWork(value: unknown) {
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
    isNullableText(value.center_postal_code) &&
    isNullableText(value.center_address_line1) &&
    isNullableText(value.center_address_line2) &&
    isNullableText(value.center_contact_name) &&
    isNullableText(value.center_contact_phone) &&
    nonNegativeInteger(value.active_item_count) &&
    nonNegativeInteger(value.blocked_item_count) &&
    value.items.every(isQueueItem);
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") {
    return commerceJson(
      { error: "fulfillment_forbidden", message: "이 매장의 상품 준비 권한이 없습니다." },
      403,
    );
  }
  if (error.code === "P0002") {
    return commerceJson(
      { error: "fulfillment_not_found", message: "물류 작업을 찾을 수 없습니다." },
      404,
    );
  }
  if (error.code === "55000") {
    return commerceJson(
      {
        error: "fulfillment_conflict",
        message: "작업 내용이 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
      },
      409,
    );
  }
  if (error.code === "22000" || error.code === "22023") {
    return commerceJson(
      { error: "invalid_fulfillment_request", message: "요청 내용을 확인해 주세요." },
      400,
    );
  }
  return commerceJson(
    { error: "operator_fulfillment_unavailable", message: "매장 물류 작업을 처리하지 못했습니다." },
    503,
  );
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

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;

  const page = parsePage(request);
  if (!page) {
    return commerceJson(
      { error: "invalid_fulfillment_query", message: "조회 범위를 확인해 주세요." },
      400,
    );
  }

  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "get_store_fulfillment_queue",
    { p_limit: page.limit, p_offset: page.offset },
  );
  if (error) return rpcFailure(error);
  if (!Array.isArray(data) || data.some((row) => !isStoreWork(row))) {
    return commerceJson(
      { error: "operator_fulfillment_unavailable", message: "매장 물류 목록을 불러오지 못했습니다." },
      503,
    );
  }

  return commerceJson({ works: data });
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as unknown;
  if (!isRecord(body) || !hasOnlyKeys(body, [
    "workId",
    "expectedVersion",
    "action",
    "idempotencyKey",
    "note",
  ])) {
    return commerceJson(
      { error: "invalid_fulfillment_request", message: "요청 내용을 확인해 주세요." },
      400,
    );
  }

  const note = optionalText(body.note, 1_000);
  if (
    !isUuid(body.workId) ||
    !nonNegativeInteger(body.expectedVersion) ||
    typeof body.action !== "string" ||
    !STORE_ACTIONS.has(body.action) ||
    !isUuid(body.idempotencyKey) ||
    note === undefined
  ) {
    return commerceJson(
      { error: "invalid_fulfillment_request", message: "요청 내용을 확인해 주세요." },
      400,
    );
  }

  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "advance_store_fulfillment_work",
    {
      p_work_id: body.workId,
      p_expected_version: body.expectedVersion,
      p_action: body.action,
      p_idempotency_key: body.idempotencyKey,
      p_note: note,
    },
  );
  if (error) return rpcFailure(error);
  if (!isRecord(data) || !isUuid(data.work_id) || !nonNegativeInteger(data.version)) {
    return commerceJson(
      { error: "operator_fulfillment_unavailable", message: "매장 물류 작업을 확인하지 못했습니다." },
      503,
    );
  }

  return commerceJson({ work: data });
}
