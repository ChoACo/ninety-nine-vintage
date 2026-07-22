import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_KINDS = new Set(["commerce", "auction", "shipping_fee"]);

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

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parsePage(request: Request) {
  const params = new URL(request.url).searchParams;
  const allowed = ["includeHistory", "limit", "offset"];
  if (
    [...params.keys()].some((key) => !allowed.includes(key)) ||
    allowed.some((key) => params.getAll(key).length > 1)
  ) {
    return null;
  }
  const includeHistory = params.get("includeHistory") ?? "false";
  const limit = params.has("limit") ? Number(params.get("limit")) : 50;
  const offset = params.has("offset") ? Number(params.get("offset")) : 0;
  if (
    !["true", "false"].includes(includeHistory) ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
    !Number.isSafeInteger(offset) || offset < 0 || offset > 10_000
  ) {
    return null;
  }
  return { includeHistory: includeHistory === "true", limit, offset };
}

function isQueuePayment(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const fields = [
    "paymentKind",
    "paymentId",
    "businessId",
    "memberId",
    "reference",
    "expectedAmount",
    "receivedAmount",
    "remainingAmount",
    "ledgerEntryCount",
    "version",
    "status",
    "bankNameSnapshot",
    "accountNumberSnapshot",
    "requestedAt",
    "confirmedAt",
    "confirmedBy",
    "lastDepositorName",
  ];
  return Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field)) &&
    typeof value.paymentKind === "string" && PAYMENT_KINDS.has(value.paymentKind) &&
    isUuid(value.paymentId) &&
    isUuid(value.businessId) &&
    isUuid(value.memberId) &&
    typeof value.reference === "string" &&
    isNonNegativeInteger(value.expectedAmount) &&
    isSafeInteger(value.receivedAmount) &&
    isSafeInteger(value.remainingAmount) &&
    isNonNegativeInteger(value.ledgerEntryCount) &&
    isNonNegativeInteger(value.version) &&
    typeof value.status === "string" &&
    isNullableText(value.bankNameSnapshot) &&
    isNullableText(value.accountNumberSnapshot) &&
    typeof value.requestedAt === "string" &&
    isNullableText(value.confirmedAt) &&
    isNullableText(value.confirmedBy) &&
    isNullableText(value.lastDepositorName);
}

function isQueueResponse(value: unknown): value is { payments: Record<string, unknown>[]; serverTime: string } {
  if (!isRecord(value) || Object.keys(value).length !== 2) return false;
  return Array.isArray(value.payments) && value.payments.every(isQueuePayment) &&
    typeof value.serverTime === "string";
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") {
    return commerceJson({ error: "payment_forbidden", message: "입금 확인 권한이 없습니다." }, 403);
  }
  if (error.code === "P0002") {
    return commerceJson({ error: "payment_not_found", message: "입금 요청을 찾을 수 없습니다." }, 404);
  }
  if (["PT409", "23505", "40001"].includes(error.code ?? "")) {
    return commerceJson({ error: "payment_conflict", message: "입금 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요." }, 409);
  }
  if (error.code === "55000") {
    return commerceJson({ error: "payment_not_ready", message: "현재 입금 상태에서는 이 작업을 진행할 수 없습니다." }, 422);
  }
  if (["22023", "22003", "23514"].includes(error.code ?? "")) {
    return commerceJson({ error: "invalid_payment_request", message: "입금 확인 내용을 확인해 주세요." }, 422);
  }
  return commerceJson({ error: "payment_queue_unavailable", message: "입금 대기열을 처리하지 못했습니다." }, 503);
}

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;

  const page = parsePage(request);
  if (!page) {
    return commerceJson({ error: "invalid_payment_query", message: "조회 범위를 확인해 주세요." }, 422);
  }

  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "get_unified_manual_payment_queue",
    {
      p_include_history: page.includeHistory,
      p_limit: page.limit,
      p_offset: page.offset,
    },
  );
  if (error) return rpcFailure(error);
  if (!isQueueResponse(data)) {
    return commerceJson({ error: "payment_queue_unavailable", message: "입금 대기열을 확인하지 못했습니다." }, 503);
  }
  return commerceJson(data);
}
