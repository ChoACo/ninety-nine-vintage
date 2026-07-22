import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";
import {
  canonicalizeManualTransferText,
  MANUAL_TRANSFER_DEPOSITOR_NAME_MAX_LENGTH,
} from "@/lib/manualTransferReceipt";

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

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  return Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key));
}

function isConfirmationResult(
  value: unknown,
  paymentKind: string,
  paymentId: string,
) {
  const fields = [
    "payment_kind",
    "payment_id",
    "status",
    "received_amount",
    "remaining_amount",
    "ledger_entry_count",
    "version",
    "idempotent_replay",
  ];
  return isRecord(value) && hasExactKeys(value, fields) &&
    value.payment_kind === paymentKind &&
    value.payment_id === paymentId &&
    typeof value.status === "string" &&
    isNonNegativeInteger(value.received_amount) &&
    isNonNegativeInteger(value.remaining_amount) &&
    isNonNegativeInteger(value.ledger_entry_count) &&
    isNonNegativeInteger(value.version) &&
    typeof value.idempotent_replay === "boolean";
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
    return commerceJson({ error: "payment_not_ready", message: "현재 입금 상태에서는 확인을 진행할 수 없습니다." }, 422);
  }
  if (["22023", "22003", "23514"].includes(error.code ?? "")) {
    return commerceJson({ error: "invalid_payment_request", message: "입금 확인 내용을 확인해 주세요." }, 422);
  }
  return commerceJson({ error: "payment_confirmation_unavailable", message: "입금 확인을 처리하지 못했습니다." }, 503);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ kind: string; id: string }> },
) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 8_192) {
    return commerceJson({ error: "request_too_large" }, 413);
  }

  const { kind, id } = await context.params;
  const body = await request.json().catch(() => null) as unknown;
  const fields = [
    "depositorName",
    "observedReceivedAmount",
    "observedLedgerEntryCount",
    "expectedVersion",
    "idempotencyKey",
  ];
  if (!PAYMENT_KINDS.has(kind) || !isUuid(id) || !isRecord(body) || !hasExactKeys(body, fields)) {
    return commerceJson({ error: "invalid_payment_request", message: "입금 확인 내용을 확인해 주세요." }, 422);
  }

  const depositorName = canonicalizeManualTransferText(
    body.depositorName,
    MANUAL_TRANSFER_DEPOSITOR_NAME_MAX_LENGTH,
  );
  if (
    !depositorName ||
    !isNonNegativeInteger(body.observedReceivedAmount) ||
    !isNonNegativeInteger(body.observedLedgerEntryCount) ||
    !isNonNegativeInteger(body.expectedVersion) ||
    !isUuid(body.idempotencyKey)
  ) {
    return commerceJson({ error: "invalid_payment_request", message: "입금 확인 내용을 확인해 주세요." }, 422);
  }

  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "confirm_unified_manual_payment_v2",
    {
      p_payment_kind: kind,
      p_payment_id: id,
      p_depositor_name: depositorName,
      p_observed_received_amount: body.observedReceivedAmount,
      p_observed_ledger_entry_count: body.observedLedgerEntryCount,
      p_expected_version: body.expectedVersion,
      p_idempotency_key: body.idempotencyKey,
    },
  );
  if (error) return rpcFailure(error);
  if (!isConfirmationResult(data, kind, id)) {
    return commerceJson({ error: "payment_confirmation_unavailable", message: "입금 확인 결과를 검증하지 못했습니다." }, 503);
  }
  return commerceJson({ payment: data });
}
