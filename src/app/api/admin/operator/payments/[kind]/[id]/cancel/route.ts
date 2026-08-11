import { authenticateOwnerPaymentRequest, commerceJson } from "@/lib/commerce/server";
import { canonicalizeManualTransferText, MANUAL_TRANSFER_MEMO_MAX_LENGTH } from "@/lib/manualTransferReceipt";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isUuid(value: unknown, pattern = UUID_PATTERN): value is string {
  return typeof value === "string" && pattern.test(value);
}

function isCancellationResult(value: unknown, paymentId: string) {
  if (!isRecord(value)) return false;
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
  return fields.every((field) => Object.hasOwn(value, field)) &&
    value.payment_kind === "commerce" &&
    value.payment_id === paymentId &&
    value.status === "cancelled" &&
    isNonNegativeInteger(value.received_amount) &&
    isNonNegativeInteger(value.remaining_amount) &&
    isNonNegativeInteger(value.ledger_entry_count) &&
    isNonNegativeInteger(value.version) &&
    typeof value.idempotent_replay === "boolean";
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") {
    return commerceJson({ error: "payment_forbidden", message: "입금 요청 취소 권한이 없습니다." }, 403);
  }
  if (error.code === "P0002") {
    return commerceJson({ error: "payment_not_found", message: "입금 요청을 찾을 수 없습니다." }, 404);
  }
  if (["PT409", "23505", "40001"].includes(error.code ?? "")) {
    return commerceJson({ error: "payment_conflict", message: "입금 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요." }, 409);
  }
  if (error.code === "55000") {
    return commerceJson({ error: "payment_not_cancellable", message: "입금액이 없고 결제 대기 중인 주문만 취소할 수 있습니다." }, 422);
  }
  if (error.code === "22023") {
    return commerceJson({ error: "invalid_payment_cancellation", message: "입금 요청 취소 내용을 확인해 주세요." }, 422);
  }
  return commerceJson({ error: "payment_cancellation_unavailable", message: "입금 요청을 취소하지 못했습니다." }, 503);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ kind: string; id: string }> },
) {
  const auth = await authenticateOwnerPaymentRequest(request, true);
  if (!auth.ok) return auth.response;

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 8_192) {
    return commerceJson({ error: "request_too_large" }, 413);
  }

  const { kind, id } = await context.params;
  const body = await request.json().catch(() => null) as unknown;
  const fields = [
    "expectedVersion",
    "observedReceivedAmount",
    "observedLedgerEntryCount",
    "idempotencyKey",
    "reason",
  ];
  if (
    kind !== "commerce" ||
    !isUuid(id) ||
    !isRecord(body) ||
    Object.keys(body).length !== fields.length ||
    !fields.every((field) => Object.hasOwn(body, field))
  ) {
    return commerceJson({ error: "invalid_payment_cancellation", message: "상품 결제 입금 요청만 취소할 수 있습니다." }, 422);
  }

  const reason = canonicalizeManualTransferText(body.reason, MANUAL_TRANSFER_MEMO_MAX_LENGTH);
  if (
    !reason ||
    !isNonNegativeInteger(body.expectedVersion) ||
    body.observedReceivedAmount !== 0 ||
    body.observedLedgerEntryCount !== 0 ||
    !isUuid(body.idempotencyKey, UUID_V4_PATTERN)
  ) {
    return commerceJson({ error: "invalid_payment_cancellation", message: "입금액이 없는 결제 대기 취소 사유와 상태를 확인해 주세요." }, 422);
  }

  const { data, error } = await (auth.user as unknown as RpcClient).rpc(
    "cancel_owner_pending_manual_payment",
    {
      p_payment_kind: "commerce",
      p_payment_id: id,
      p_expected_version: body.expectedVersion,
      p_expected_received_amount: 0,
      p_expected_ledger_entry_count: 0,
      p_idempotency_key: body.idempotencyKey,
      p_reason: reason,
    },
  );
  if (error) return rpcFailure(error);
  if (!isCancellationResult(data, id)) {
    return commerceJson({ error: "payment_cancellation_result_unknown", message: "입금 요청 취소 결과를 검증하지 못했습니다." }, 503);
  }
  return commerceJson({ payment: data });
}
