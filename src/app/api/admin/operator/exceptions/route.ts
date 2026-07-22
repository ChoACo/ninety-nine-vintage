import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXCEPTION_KINDS = new Set([
  "inspection_required",
  "missing",
  "offline_sold",
  "additional_wait",
  "refund_required",
]);
const RESOLUTIONS = new Set(["resume", "exclude_for_later", "refund"]);

interface RpcError { code?: string; message?: string; }
interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError | null }>;
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
function isTextOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}
function optionalText(value: unknown, maximum: number): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : undefined;
}
function parseDueAt(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}
function parsePage(request: Request) {
  const params = new URL(request.url).searchParams;
  const keys = ["includeResolved", "limit", "offset"];
  if ([...params.keys()].some((key) => !keys.includes(key)) || keys.some((key) => params.getAll(key).length > 1)) return null;
  const includeResolved = params.get("includeResolved") ?? "false";
  const limit = params.has("limit") ? Number(params.get("limit")) : 50;
  const offset = params.has("offset") ? Number(params.get("offset")) : 0;
  return ["true", "false"].includes(includeResolved) && Number.isSafeInteger(limit) && limit >= 1 && limit <= 100 && Number.isSafeInteger(offset) && offset >= 0 && offset <= 10_000
    ? { includeResolved: includeResolved === "true", limit, offset }
    : null;
}
function isCandidate(value: unknown): value is Record<string, unknown> {
  const keys = ["inventoryItemId", "productId", "title", "imageUrl", "memberId", "businessId", "originStoreId", "originStoreName", "activeShipmentId", "physicalStatus", "locationKind", "isBlocked", "blockReason", "version"];
  return isRecord(value) && hasExactKeys(value, keys) && isUuid(value.inventoryItemId) && isUuid(value.productId) && typeof value.title === "string" && isTextOrNull(value.imageUrl) && isUuid(value.memberId) && isUuid(value.businessId) && isUuid(value.originStoreId) && typeof value.originStoreName === "string" && isTextOrNull(value.activeShipmentId) && typeof value.physicalStatus === "string" && typeof value.locationKind === "string" && typeof value.isBlocked === "boolean" && isTextOrNull(value.blockReason) && isNonNegativeInteger(value.version);
}
function isExceptionCase(value: unknown): value is Record<string, unknown> {
  const keys = ["id", "inventoryItemId", "productId", "title", "imageUrl", "memberId", "businessId", "originStoreId", "originStoreName", "shipmentId", "kind", "status", "resolution", "publicReason", "internalNote", "dueAt", "version", "createdAt", "evidencePaths"];
  return isRecord(value) && hasExactKeys(value, keys) && isUuid(value.id) && isUuid(value.inventoryItemId) && isUuid(value.productId) && typeof value.title === "string" && isTextOrNull(value.imageUrl) && isUuid(value.memberId) && isUuid(value.businessId) && isUuid(value.originStoreId) && typeof value.originStoreName === "string" && isTextOrNull(value.shipmentId) && typeof value.kind === "string" && typeof value.status === "string" && isTextOrNull(value.resolution) && typeof value.publicReason === "string" && isTextOrNull(value.internalNote) && isTextOrNull(value.dueAt) && isNonNegativeInteger(value.version) && typeof value.createdAt === "string" && Array.isArray(value.evidencePaths) && value.evidencePaths.every((path) => typeof path === "string");
}
function isCandidates(value: unknown): value is { items: Record<string, unknown>[] } {
  return isRecord(value) && hasExactKeys(value, ["items"]) && Array.isArray(value.items) && value.items.every(isCandidate);
}
function isCases(value: unknown): value is { cases: Record<string, unknown>[] } {
  return isRecord(value) && hasExactKeys(value, ["cases"]) && Array.isArray(value.cases) && value.cases.every(isExceptionCase);
}
function isOpenResult(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, ["id", "version", "status", "idempotent_replay"]) && isUuid(value.id) && isNonNegativeInteger(value.version) && value.status === "open" && typeof value.idempotent_replay === "boolean";
}
function isResolveResult(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, ["id", "version", "status", "resolution", "refundId", "idempotent_replay"]) && isUuid(value.id) && isNonNegativeInteger(value.version) && value.status === "resolved" && typeof value.resolution === "string" && isTextOrNull(value.refundId) && typeof value.idempotent_replay === "boolean";
}
function rpcFailure(error: RpcError) {
  if (error.code === "42501") return commerceJson({ error: "exception_forbidden", message: "상품 예외 작업 권한이 없습니다." }, 403);
  if (error.code === "P0002") return commerceJson({ error: "exception_not_found", message: "상품 또는 예외 건을 찾을 수 없습니다." }, 404);
  if (["PT409", "23505", "40001"].includes(error.code ?? "")) return commerceJson({ error: "exception_conflict", message: "예외 건 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, 409);
  if (error.code === "55000") return commerceJson({ error: "exception_not_ready", message: "현재 상품 상태에서는 예외 작업을 진행할 수 없습니다." }, 422);
  if (["22023", "22003", "23514"].includes(error.code ?? "")) return commerceJson({ error: "invalid_exception_request", message: "상품 예외 입력 내용을 확인해 주세요." }, 422);
  return commerceJson({ error: "exception_unavailable", message: "상품 예외 작업을 처리하지 못했습니다." }, 503);
}

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  const page = parsePage(request);
  if (!page) return commerceJson({ error: "invalid_exception_query", message: "조회 범위를 확인해 주세요." }, 422);
  const rpc = auth.user as unknown as RpcClient;
  const [candidateResult, caseResult] = await Promise.all([
    rpc.rpc("get_inventory_exception_candidates", { p_limit: page.limit, p_offset: page.offset }),
    rpc.rpc("get_inventory_exception_queue", { p_include_resolved: page.includeResolved, p_limit: page.limit, p_offset: page.offset }),
  ]);
  if (candidateResult.error) return rpcFailure(candidateResult.error);
  if (caseResult.error) return rpcFailure(caseResult.error);
  if (!isCandidates(candidateResult.data) || !isCases(caseResult.data)) return commerceJson({ error: "exception_unavailable", message: "상품 예외 목록을 검증하지 못했습니다." }, 503);
  return commerceJson({ candidates: candidateResult.data.items, cases: caseResult.data.cases });
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as unknown;
  if (!isRecord(body) || typeof body.action !== "string") return commerceJson({ error: "invalid_exception_request", message: "상품 예외 작업을 확인해 주세요." }, 422);
  const rpc = auth.user as unknown as RpcClient;

  if (body.action === "open") {
    const keys = ["action", "inventoryItemId", "kind", "publicReason", "internalNote", "dueAt", "idempotencyKey"];
    const publicReason = optionalText(body.publicReason, 1_000);
    const internalNote = optionalText(body.internalNote, 2_000);
    const dueAt = parseDueAt(body.dueAt);
    if (!hasExactKeys(body, keys) || !isUuid(body.inventoryItemId) || typeof body.kind !== "string" || !EXCEPTION_KINDS.has(body.kind) || !publicReason || internalNote === undefined || dueAt === undefined || !isUuid(body.idempotencyKey)) return commerceJson({ error: "invalid_exception_request", message: "상품 예외 입력 내용을 확인해 주세요." }, 422);
    const { data, error } = await rpc.rpc("open_inventory_exception", {
      p_inventory_item_id: body.inventoryItemId,
      p_kind: body.kind,
      p_public_reason: publicReason,
      p_internal_note: internalNote,
      p_due_at: dueAt,
      p_idempotency_key: body.idempotencyKey,
    });
    if (error) return rpcFailure(error);
    if (!isOpenResult(data)) return commerceJson({ error: "exception_unavailable", message: "예외 등록 결과를 검증하지 못했습니다." }, 503);
    return commerceJson({ exception: data });
  }

  if (body.action === "resolve") {
    const keys = ["action", "caseId", "expectedVersion", "resolution", "publicReason", "internalNote", "idempotencyKey"];
    const publicReason = optionalText(body.publicReason, 1_000);
    const internalNote = optionalText(body.internalNote, 2_000);
    if (!hasExactKeys(body, keys) || !isUuid(body.caseId) || !isNonNegativeInteger(body.expectedVersion) || typeof body.resolution !== "string" || !RESOLUTIONS.has(body.resolution) || !publicReason || internalNote === undefined || !isUuid(body.idempotencyKey)) return commerceJson({ error: "invalid_exception_request", message: "예외 해결 내용을 확인해 주세요." }, 422);
    const { data, error } = await rpc.rpc("resolve_inventory_exception", {
      p_case_id: body.caseId,
      p_expected_version: body.expectedVersion,
      p_resolution: body.resolution,
      p_public_reason: publicReason,
      p_internal_note: internalNote,
      p_idempotency_key: body.idempotencyKey,
    });
    if (error) return rpcFailure(error);
    if (!isResolveResult(data)) return commerceJson({ error: "exception_unavailable", message: "예외 해결 결과를 검증하지 못했습니다." }, 503);
    return commerceJson({ exception: data });
  }
  return commerceJson({ error: "invalid_exception_request", message: "상품 예외 작업을 확인해 주세요." }, 422);
}
