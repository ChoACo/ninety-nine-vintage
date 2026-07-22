import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";
import {
  encryptRefundBankAccount,
  RefundEncryptionError,
} from "@/lib/refunds/encryption";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RpcError {
  code?: string;
  message?: string;
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

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") {
    return commerceJson(
      { error: "refund_forbidden", message: "이 환불 계좌를 등록할 권한이 없습니다." },
      403,
    );
  }
  if (error.code === "P0002") {
    return commerceJson(
      { error: "refund_not_found", message: "환불 요청을 찾지 못했습니다." },
      404,
    );
  }
  if (["PT409", "23505", "40001"].includes(error.code ?? "")) {
    return commerceJson(
      { error: "refund_conflict", message: "환불 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." },
      409,
    );
  }
  if (error.code === "55000") {
    return commerceJson(
      { error: "refund_not_ready", message: "현재 환불 상태에서는 계좌를 등록할 수 없습니다." },
      422,
    );
  }
  if (["22023", "22003", "23514"].includes(error.code ?? "")) {
    return commerceJson(
      { error: "invalid_refund_account", message: "환불 계좌 정보를 확인해 주세요." },
      422,
    );
  }
  return commerceJson({ error: "refund_unavailable" }, 503);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 8_192) {
    return commerceJson({ error: "request_too_large" }, 413);
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null) as unknown;
  if (
    !isUuid(id) ||
    !isRecord(body) ||
    !hasOnlyKeys(body, [
      "refundKind",
      "bankName",
      "accountNumber",
      "accountHolder",
      "idempotencyKey",
    ]) ||
    !["item", "shipping_fee"].includes(String(body.refundKind)) ||
    typeof body.bankName !== "string" ||
    typeof body.accountNumber !== "string" ||
    typeof body.accountHolder !== "string" ||
    !isUuid(body.idempotencyKey)
  ) {
    return commerceJson(
      { error: "invalid_refund_account", message: "환불 계좌 정보를 확인해 주세요." },
      422,
    );
  }

  let encrypted;
  try {
    encrypted = encryptRefundBankAccount({
      bankName: body.bankName,
      accountNumber: body.accountNumber,
      accountHolder: body.accountHolder,
    }, id, body.refundKind as "item" | "shipping_fee");
  } catch (error) {
    if (
      error instanceof RefundEncryptionError &&
      error.message === "invalid_refund_account"
    ) {
      return commerceJson(
        { error: "invalid_refund_account", message: "환불 계좌 정보를 확인해 주세요." },
        422,
      );
    }
    return commerceJson(
      { error: "refund_encryption_unavailable", message: "환불 계좌를 안전하게 저장할 수 없습니다. 잠시 후 다시 시도해 주세요." },
      503,
    );
  }

  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    body.refundKind === "shipping_fee"
      ? "submit_shipping_fee_refund_account"
      : "submit_manual_refund_account",
    {
      p_refund_id: id,
      p_ciphertext: encrypted.ciphertext,
      p_initialization_vector: encrypted.initializationVector,
      p_authentication_tag: encrypted.authenticationTag,
      p_key_version: encrypted.keyVersion,
      p_fingerprint: encrypted.fingerprint,
      p_masked_account_number: encrypted.maskedAccountNumber,
      p_idempotency_key: body.idempotencyKey,
    },
  );
  if (error) return rpcFailure(error);
  if (
    !isRecord(data) ||
    !isUuid(data.refund_id) ||
    typeof data.status !== "string" ||
    !Number.isSafeInteger(data.version) ||
    typeof data.account_expires_at !== "string" ||
    typeof data.idempotent_replay !== "boolean"
  ) {
    return commerceJson({ error: "refund_unavailable" }, 503);
  }

  return commerceJson({
    refund: {
      id: data.refund_id,
      refundKind: body.refundKind,
      status: data.status,
      version: data.version,
      accountExpiresAt: data.account_expires_at,
      accountSubmitted: true,
    },
  });
}
