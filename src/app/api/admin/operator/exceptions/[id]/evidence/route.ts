import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const BUCKET = "inventory-exception-evidence";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MIME_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RpcError { code?: string; message?: string; }
interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError | null }>;
}
interface AuthorizedCase {
  id: string;
  businessId: string;
  status: string;
  evidencePaths: string[];
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
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}
function isAuthorizedCase(value: unknown): value is AuthorizedCase {
  return isRecord(value) && isUuid(value.id) && isUuid(value.businessId) && typeof value.status === "string" && Array.isArray(value.evidencePaths) && value.evidencePaths.every((path) => typeof path === "string");
}
function rpcFailure(error: RpcError) {
  if (error.code === "42501") return commerceJson({ error: "evidence_forbidden", message: "증빙 파일 작업 권한이 없습니다." }, 403);
  if (error.code === "P0002") return commerceJson({ error: "exception_not_found", message: "예외 건을 찾을 수 없습니다." }, 404);
  if (["PT409", "23505", "40001"].includes(error.code ?? "")) return commerceJson({ error: "evidence_conflict", message: "증빙 또는 예외 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, 409);
  if (error.code === "55000") return commerceJson({ error: "evidence_not_ready", message: "현재 예외 상태에서는 증빙을 등록할 수 없습니다." }, 422);
  if (["22023", "22003", "23514"].includes(error.code ?? "")) return commerceJson({ error: "invalid_evidence_request", message: "증빙 파일을 확인해 주세요." }, 422);
  return commerceJson({ error: "evidence_unavailable", message: "증빙 파일을 처리하지 못했습니다." }, 503);
}

async function findAuthorizedCase(client: RpcClient, caseId: string) {
  for (let offset = 0; offset <= 10_000; offset += 500) {
    const { data, error } = await client.rpc("get_inventory_exception_queue", {
      p_include_resolved: true,
      p_limit: 500,
      p_offset: offset,
    });
    if (error) return { error, exceptionCase: null };
    if (!isRecord(data) || !Array.isArray(data.cases)) return { error: null, exceptionCase: null };
    const cases = data.cases.filter(isAuthorizedCase);
    const exceptionCase = cases.find((candidate) => candidate.id === caseId) ?? null;
    if (exceptionCase || data.cases.length < 500) return { error: null, exceptionCase };
  }
  return { error: null, exceptionCase: null };
}

async function ensurePrivateBucket(admin: SupabaseClient<Database>) {
  const settings = {
    public: false,
    fileSizeLimit: MAX_FILE_SIZE,
    allowedMimeTypes: [...MIME_EXTENSIONS.keys()],
  };
  const existing = await admin.storage.getBucket(BUCKET);
  if (existing.error) {
    const created = await admin.storage.createBucket(BUCKET, settings);
    if (created.error) {
      const afterRace = await admin.storage.getBucket(BUCKET);
      if (afterRace.error) return false;
    }
  }
  const updated = await admin.storage.updateBucket(BUCKET, settings);
  return !updated.error;
}

function storagePath(fullPath: string) {
  const prefix = `${BUCKET}/`;
  return fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : null;
}

async function signedEvidence(admin: SupabaseClient<Database>, exceptionCase: AuthorizedCase) {
  const casePrefix = `${exceptionCase.businessId}/${exceptionCase.id}/`;
  const paths = exceptionCase.evidencePaths
    .map(storagePath)
    .filter((path): path is string => path !== null && path.startsWith(casePrefix));
  const signed = await Promise.all(paths.map(async (path) => {
    const result = await admin.storage.from(BUCKET).createSignedUrl(path, 300);
    return result.data?.signedUrl ?? null;
  }));
  return signed.filter((url): url is string => Boolean(url));
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return commerceJson({ error: "invalid_evidence_request", message: "예외 건을 확인해 주세요." }, 422);
  const authorized = await findAuthorizedCase(auth.user as unknown as RpcClient, id);
  if (authorized.error) return rpcFailure(authorized.error);
  if (!authorized.exceptionCase) return commerceJson({ error: "exception_not_found", message: "예외 건을 찾을 수 없습니다." }, 404);
  const evidence = await signedEvidence(auth.admin, authorized.exceptionCase);
  return commerceJson({ evidence: evidence.map((signedUrl) => ({ signedUrl, expiresInSeconds: 300 })) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return commerceJson({ error: "invalid_evidence_request", message: "예외 건을 확인해 주세요." }, 422);
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE + 512 * 1024) {
    return commerceJson({ error: "evidence_too_large", message: "증빙 파일은 5MiB 이하여야 합니다." }, 413);
  }
  const form = await request.formData().catch(() => null);
  if (!form || [...form.keys()].some((key) => key !== "file" && key !== "idempotencyKey") || form.getAll("file").length !== 1 || form.getAll("idempotencyKey").length !== 1) {
    return commerceJson({ error: "invalid_evidence_request", message: "증빙 파일과 요청 키를 확인해 주세요." }, 422);
  }
  const file = form.get("file");
  const idempotencyKey = form.get("idempotencyKey");
  if (!(file instanceof File) || !isUuid(idempotencyKey) || !MIME_EXTENSIONS.has(file.type) || file.size < 1 || file.size > MAX_FILE_SIZE) {
    return commerceJson({ error: "invalid_evidence_request", message: "5MiB 이하 JPG, PNG, WEBP 또는 PDF 파일만 올릴 수 있습니다." }, 422);
  }
  const authorized = await findAuthorizedCase(auth.user as unknown as RpcClient, id);
  if (authorized.error) return rpcFailure(authorized.error);
  if (!authorized.exceptionCase) return commerceJson({ error: "exception_not_found", message: "예외 건을 찾을 수 없습니다." }, 404);
  if (authorized.exceptionCase.status !== "open") return commerceJson({ error: "evidence_conflict", message: "열린 예외 건에만 증빙을 등록할 수 있습니다." }, 409);
  if (!await ensurePrivateBucket(auth.admin)) return commerceJson({ error: "evidence_unavailable", message: "비공개 증빙 저장소를 준비하지 못했습니다." }, 503);

  const extension = MIME_EXTENSIONS.get(file.type);
  if (!extension) return commerceJson({ error: "invalid_evidence_request", message: "증빙 파일 형식을 확인해 주세요." }, 422);
  const objectPath = `${authorized.exceptionCase.businessId}/${id}/${idempotencyKey}.${extension}`;
  const fullPath = `${BUCKET}/${objectPath}`;
  const storage = auth.admin.storage.from(BUCKET);
  const uploaded = await storage.upload(objectPath, file, {
    upsert: false,
    contentType: file.type,
  });
  const uploadedNow = !uploaded.error;
  if (uploaded.error) {
    // A lost HTTP response may be retried with the same deterministic path and
    // idempotency key. Only continue when that exact private object exists.
    const existing = await storage.download(objectPath);
    if (existing.error || !existing.data) {
      return commerceJson({ error: "evidence_upload_failed", message: "증빙 파일을 업로드하지 못했습니다." }, 503);
    }
  }

  const appended = await (auth.user as unknown as RpcClient).rpc("append_inventory_exception_evidence", {
    p_case_id: id,
    p_object_path: fullPath,
    p_idempotency_key: idempotencyKey,
  });
  if (appended.error) {
    if (uploadedNow) await storage.remove([objectPath]);
    return rpcFailure(appended.error);
  }
  if (!isRecord(appended.data) || !hasExactEvidenceResult(appended.data, id)) {
    if (uploadedNow) await storage.remove([objectPath]);
    return commerceJson({ error: "evidence_unavailable", message: "증빙 등록 결과를 검증하지 못했습니다." }, 503);
  }
  const signed = await storage.createSignedUrl(objectPath, 300);
  if (!signed.data?.signedUrl) return commerceJson({ error: "evidence_unavailable", message: "증빙 링크를 만들지 못했습니다." }, 503);
  return commerceJson({ evidence: { signedUrl: signed.data.signedUrl, expiresInSeconds: 300 } }, appended.data.idempotent_replay ? 200 : 201);
}

function hasExactEvidenceResult(value: Record<string, unknown>, caseId: string) {
  const keys = ["case_id", "id", "version", "status", "idempotent_replay"];
  return hasExactKeys(value, keys) && value.case_id === caseId && value.id === caseId &&
    isNonNegativeInteger(value.version) && value.status === "open" && typeof value.idempotent_replay === "boolean";
}
