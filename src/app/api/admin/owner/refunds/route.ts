import {
  authenticateOwnerAccessRequest,
  ownerAccessErrorResponse,
  ownerAccessJsonResponse,
  readSmallJsonBody,
} from "@/lib/ownerAccess/server";
import {
  decryptRefundBankAccount,
  RefundEncryptionError,
} from "@/lib/refunds/encryption";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVIEW_ACTIONS = new Set(["approve", "complete", "cancel"]);

interface RpcError {
  code?: string;
}

interface RpcClient {
  rpc(
    functionName: string,
    parameters?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isItemRefund(value: unknown) {
  return isRecord(value) &&
    isUuid(value.id) &&
    isUuid(value.inventoryItemId) &&
    isUuid(value.memberId) &&
    isUuid(value.productId) &&
    typeof value.title === "string" &&
    (value.originStoreId === null || isUuid(value.originStoreId)) &&
    isNullableText(value.originStoreName) &&
    typeof value.status === "string" &&
    Number.isSafeInteger(value.amount) &&
    Number(value.amount) > 0 &&
    isNullableText(value.maskedAccountNumber) &&
    isNullableText(value.accountSubmittedAt) &&
    isNullableText(value.accountExpiresAt) &&
    isNullableText(value.approvedAt) &&
    isNullableText(value.completedAt) &&
    isNullableText(value.externalReference) &&
    Number.isSafeInteger(value.version) &&
    Number(value.version) >= 0;
}

function isShippingFeeRefund(value: unknown) {
  return isRecord(value) &&
    value.refundKind === "shipping_fee" &&
    isUuid(value.id) &&
    isUuid(value.shipmentId) &&
    isUuid(value.paymentId) &&
    isUuid(value.memberId) &&
    isUuid(value.businessId) &&
    typeof value.status === "string" &&
    Number.isSafeInteger(value.amount) &&
    Number(value.amount) > 0 &&
    isNullableText(value.maskedAccountNumber) &&
    isNullableText(value.accountSubmittedAt) &&
    isNullableText(value.accountExpiresAt) &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    isNullableText(value.externalReference) &&
    Number.isSafeInteger(value.version) &&
    Number(value.version) >= 0;
}

function normalizedOptionalText(value: unknown, maximum: number) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 &&
      normalized.length <= maximum &&
      !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : undefined;
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") {
    return ownerAccessJsonResponse(
      { error: "refund_forbidden", message: "환불 처리 권한이 없습니다." },
      403,
    );
  }
  if (error.code === "P0002") {
    return ownerAccessJsonResponse(
      { error: "refund_not_found", message: "환불 요청을 찾지 못했습니다." },
      404,
    );
  }
  if (["PT409", "23505", "40001"].includes(error.code ?? "")) {
    return ownerAccessJsonResponse(
      { error: "refund_conflict", message: "환불 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." },
      409,
    );
  }
  if (error.code === "55000") {
    return ownerAccessJsonResponse(
      { error: "refund_not_ready", message: "현재 환불 상태에서는 이 작업을 진행할 수 없습니다." },
      422,
    );
  }
  if (["22023", "22003", "23514"].includes(error.code ?? "")) {
    return ownerAccessJsonResponse(
      { error: "invalid_refund_request", message: "환불 처리 내용을 확인해 주세요." },
      422,
    );
  }
  return ownerAccessJsonResponse({ error: "refund_unavailable" }, 503);
}

export async function GET(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const params = new URL(request.url).searchParams;
    if (
      [...params.keys()].some((key) => key !== "includeCompleted") ||
      params.getAll("includeCompleted").length > 1 ||
      (params.has("includeCompleted") &&
        !["true", "false"].includes(params.get("includeCompleted") ?? ""))
    ) {
      return ownerAccessJsonResponse({ error: "invalid_refund_query", message: "조회 범위를 확인해 주세요." }, 422);
    }

    const rpc = access.userClient as unknown as RpcClient;
    const [itemResult, shippingFeeResult] = await Promise.all([
      rpc.rpc("get_manual_refund_queue", {
        p_include_completed: params.get("includeCompleted") === "true",
        p_limit: 100,
        p_offset: 0,
      }),
      rpc.rpc("get_shipping_fee_refund_queue", {
        p_include_completed: params.get("includeCompleted") === "true",
        p_limit: 100,
        p_offset: 0,
      }),
    ]);
    if (itemResult.error) return rpcFailure(itemResult.error);
    if (shippingFeeResult.error) return rpcFailure(shippingFeeResult.error);
    if (
      !isRecord(itemResult.data) ||
      !Array.isArray(itemResult.data.refunds) ||
      itemResult.data.refunds.some((refund) => !isItemRefund(refund)) ||
      !isRecord(shippingFeeResult.data) ||
      !Array.isArray(shippingFeeResult.data.refunds) ||
      shippingFeeResult.data.refunds.some((refund) => !isShippingFeeRefund(refund))
    ) {
      return ownerAccessJsonResponse({ error: "refund_unavailable" }, 503);
    }
    return ownerAccessJsonResponse({
      refunds: [
        ...shippingFeeResult.data.refunds,
        ...itemResult.data.refunds.map((refund) => ({
          ...(refund as Record<string, unknown>),
          refundKind: "item",
        })),
      ],
    });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const access = await authenticateOwnerAccessRequest(request);
    const body = await readSmallJsonBody(request, 8_192);
    const allowedKeys = [
      "action",
      "refundKind",
      "refundId",
      "expectedVersion",
      "externalReference",
      "note",
      "reason",
      "idempotencyKey",
    ];
    if (Object.keys(body).some((key) => !allowedKeys.includes(key))) {
      return ownerAccessJsonResponse({ error: "invalid_refund_request" }, 422);
    }

    const action = typeof body.action === "string" ? body.action : "";
    const refundKind = body.refundKind === "item" || body.refundKind === "shipping_fee"
      ? body.refundKind
      : null;
    const externalReference = normalizedOptionalText(body.externalReference, 160);
    const note = normalizedOptionalText(body.note, 1_000);
    const reason = normalizedOptionalText(body.reason, 500);
    if (
      !isUuid(body.refundId) ||
      !refundKind ||
      !isUuid(body.idempotencyKey) ||
      externalReference === undefined ||
      note === undefined ||
      reason === undefined
    ) {
      return ownerAccessJsonResponse(
        { error: "invalid_refund_request", message: "환불 처리 내용을 확인해 주세요." },
        422,
      );
    }

    if (action === "reveal_account") {
      if (!reason) {
        return ownerAccessJsonResponse(
          { error: "invalid_refund_request", message: "계좌 열람 사유를 입력해 주세요." },
          422,
        );
      }
      const auditResult = await (access.userClient as unknown as RpcClient).rpc(
        refundKind === "shipping_fee"
          ? "record_shipping_fee_refund_account_access"
          : "record_manual_refund_account_access",
        {
          p_refund_id: body.refundId,
          p_reason: reason,
          p_idempotency_key: body.idempotencyKey,
        },
      );
      if (auditResult.error) return rpcFailure(auditResult.error);

      const accountQuery = refundKind === "shipping_fee"
        ? access.admin
            .from("shipping_fee_refund_accounts")
            .select("shipping_fee_refund_id,account_ciphertext,account_initialization_vector,account_authentication_tag,account_key_version,account_expires_at")
            .eq("shipping_fee_refund_id", body.refundId)
        : access.admin
            .from("manual_refund_accounts")
            .select("refund_id,account_ciphertext,account_initialization_vector,account_authentication_tag,account_key_version,account_expires_at,cleared_at")
            .eq("refund_id", body.refundId);
      const { data: refund, error } = await accountQuery.maybeSingle();
      if (error) {
        return ownerAccessJsonResponse({ error: "refund_unavailable" }, 503);
      }
      if (
        !refund ||
        ("cleared_at" in refund && refund.cleared_at !== null) ||
        typeof refund.account_ciphertext !== "string" ||
        typeof refund.account_initialization_vector !== "string" ||
        typeof refund.account_authentication_tag !== "string" ||
        !Number.isSafeInteger(refund.account_key_version) ||
        typeof refund.account_expires_at !== "string" ||
        Date.parse(refund.account_expires_at) <= Date.now()
      ) {
        return ownerAccessJsonResponse(
          { error: "refund_account_unavailable", message: "환불 계좌가 없거나 다시 입력해야 합니다." },
          409,
        );
      }
      try {
        const account = decryptRefundBankAccount({
          ciphertext: refund.account_ciphertext,
          initializationVector: refund.account_initialization_vector,
          authenticationTag: refund.account_authentication_tag,
          keyVersion: refund.account_key_version,
        }, body.refundId, refundKind);
        return ownerAccessJsonResponse({ refundId: body.refundId, refundKind, account });
      } catch (error) {
        if (error instanceof RefundEncryptionError) {
          return ownerAccessJsonResponse(
            { error: "refund_encryption_unavailable" },
            503,
          );
        }
        throw error;
      }
    }

    if (
      !REVIEW_ACTIONS.has(action) ||
      (refundKind === "shipping_fee" && (action === "approve" || action === "cancel")) ||
      !Number.isSafeInteger(body.expectedVersion) ||
      Number(body.expectedVersion) < 0 ||
      reason !== null ||
      (action === "complete" && !externalReference) ||
      (action !== "complete" && externalReference !== null)
    ) {
      return ownerAccessJsonResponse(
        { error: "invalid_refund_request", message: "환불 처리 내용을 확인해 주세요." },
        422,
      );
    }

    const { data, error } = await (access.userClient as unknown as RpcClient).rpc(
      refundKind === "shipping_fee"
        ? "review_shipping_fee_refund"
        : "review_manual_refund",
      refundKind === "shipping_fee" ? {
        p_refund_id: body.refundId,
        p_expected_version: body.expectedVersion,
        p_action: action,
        p_external_reference: externalReference,
        p_idempotency_key: body.idempotencyKey,
      } : {
        p_refund_id: body.refundId,
        p_expected_version: body.expectedVersion,
        p_action: action,
        p_external_reference: externalReference,
        p_note: note,
        p_idempotency_key: body.idempotencyKey,
      },
    );
    if (error) return rpcFailure(error);
    if (
      !isRecord(data) ||
      !isUuid(data.id) ||
      typeof data.status !== "string" ||
      !Number.isSafeInteger(data.version) ||
      typeof data.idempotent_replay !== "boolean"
    ) {
      return ownerAccessJsonResponse({ error: "refund_unavailable" }, 503);
    }
    return ownerAccessJsonResponse({ refund: { ...data, refundKind } });
  } catch (error) {
    return ownerAccessErrorResponse(error);
  }
}
