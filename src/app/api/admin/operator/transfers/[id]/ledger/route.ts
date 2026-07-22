import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";
import {
  canonicalizeManualTransferText,
  MANUAL_TRANSFER_DEPOSITOR_NAME_MAX_LENGTH,
  MANUAL_TRANSFER_MEMO_MAX_LENGTH,
} from "@/lib/manualTransferReceipt";

function asIdempotencyKey(value: unknown) {
  if (typeof value !== "string") return "";
  const key = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key)
    ? key
    : "";
}

function asUuid(value: unknown) {
  if (typeof value !== "string") return "";
  const id = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
    ? id
    : "";
}

function asManualTransferRecordResult(
  value: unknown,
  expectedKind: "auction" | "commerce" | "shipping",
  expectedId: string,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (
    result.transfer_kind !== expectedKind ||
    result.transfer_id !== expectedId ||
    typeof result.ledger_id !== "string" ||
    !result.ledger_id ||
    typeof result.received_amount !== "number" ||
    !Number.isSafeInteger(result.received_amount) ||
    result.received_amount < 0 ||
    typeof result.remaining_amount !== "number" ||
    !Number.isSafeInteger(result.remaining_amount) ||
    result.remaining_amount < 0 ||
    typeof result.status !== "string" ||
    !result.status ||
    typeof result.idempotent_replay !== "boolean" ||
    typeof result.ledger_entry_count !== "number" ||
    !Number.isSafeInteger(result.ledger_entry_count) ||
    result.ledger_entry_count < 1
  ) {
    return null;
  }
  return result as Record<string, unknown> & {
    idempotent_replay: boolean;
  };
}

function asManualTransferReversalResult(
  value: unknown,
  expectedKind: "auction" | "commerce" | "shipping",
  expectedId: string,
  expectedLedgerId: string,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const expectedFields = [
    "transfer_kind",
    "transfer_id",
    "ledger_id",
    "reversal_of",
    "received_amount",
    "remaining_amount",
    "status",
    "idempotent_replay",
    "ledger_entry_count",
  ];
  if (
    Object.keys(result).length !== expectedFields.length ||
    !expectedFields.every((field) => Object.hasOwn(result, field)) ||
    result.transfer_kind !== expectedKind ||
    result.transfer_id !== expectedId ||
    !asUuid(result.ledger_id) ||
    result.ledger_id === expectedLedgerId ||
    result.reversal_of !== expectedLedgerId ||
    typeof result.received_amount !== "number" ||
    !Number.isSafeInteger(result.received_amount) ||
    result.received_amount < 0 ||
    typeof result.remaining_amount !== "number" ||
    !Number.isSafeInteger(result.remaining_amount) ||
    result.remaining_amount < 0 ||
    typeof result.status !== "string" ||
    !result.status ||
    typeof result.idempotent_replay !== "boolean" ||
    typeof result.ledger_entry_count !== "number" ||
    !Number.isSafeInteger(result.ledger_entry_count) ||
    result.ledger_entry_count < 1
  ) {
    return null;
  }
  return result as Record<string, unknown> & {
    idempotent_replay: boolean;
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner" && auth.roleCode !== "operator") {
    return commerceJson({ error: "forbidden" }, 403);
  }
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return commerceJson({ error: "invalid_request" }, 400);

  if (body.action === "record") {
    const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
    const depositorName = canonicalizeManualTransferText(
      body.depositorName,
      MANUAL_TRANSFER_DEPOSITOR_NAME_MAX_LENGTH,
    );
    const memo = canonicalizeManualTransferText(
      body.memo,
      MANUAL_TRANSFER_MEMO_MAX_LENGTH,
    );
    if (body.kind !== "auction" && body.kind !== "commerce" && body.kind !== "shipping") {
      return commerceJson({ error: "invalid_manual_transfer_receipt", outcome: "rejected" }, 400);
    }
    const kind = body.kind;
    const idempotencyKey = asIdempotencyKey(body.idempotencyKey);
    const expectedReceivedAmount = typeof body.expectedReceivedAmount === "number"
      ? body.expectedReceivedAmount
      : Number(body.expectedReceivedAmount);
    const expectedLedgerEntryCount = typeof body.expectedLedgerEntryCount === "number"
      ? body.expectedLedgerEntryCount
      : Number(body.expectedLedgerEntryCount);
    if (
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      !Number.isSafeInteger(expectedReceivedAmount) ||
      expectedReceivedAmount < 0 ||
      !Number.isSafeInteger(expectedLedgerEntryCount) ||
      expectedLedgerEntryCount < 0 ||
      !depositorName ||
      !idempotencyKey
    ) {
      return commerceJson({ error: "invalid_manual_transfer_receipt", outcome: "rejected" }, 400);
    }
    const { data, error, status } = kind === "shipping"
      ? await auth.user.rpc("record_shipping_fee_payment", {
        p_payment_id: id,
        p_amount: amount,
        p_depositor_name: depositorName,
        p_expected_received_amount: expectedReceivedAmount,
        p_expected_ledger_entry_count: expectedLedgerEntryCount,
        p_idempotency_key: idempotencyKey,
        p_memo: memo,
      })
      : await auth.user.rpc("record_manual_transfer_payment", {
        p_transfer_kind: kind,
        p_transfer_id: id,
        p_amount: amount,
        p_depositor_name: depositorName,
        p_expected_received_amount: expectedReceivedAmount,
        p_expected_ledger_entry_count: expectedLedgerEntryCount,
        p_idempotency_key: idempotencyKey,
        p_memo: memo,
      });
    if (error) {
      const outcome = status >= 400 && status < 500 ? "rejected" : "unknown";
      return commerceJson(
        { error: error.message || "manual_transfer_record_failed", outcome },
        outcome === "rejected" ? 409 : 503,
      );
    }
    const result = asManualTransferRecordResult(data, kind, id);
    if (!result) {
      return commerceJson(
        { error: "manual_transfer_record_result_unknown", outcome: "unknown" },
        503,
      );
    }
    return commerceJson({ result }, result.idempotent_replay ? 200 : 201);
  }

  if (body.action === "reverse") {
    const targetId = asUuid(id);
    const ledgerId = asUuid(body.ledgerId);
    const reason = canonicalizeManualTransferText(
      body.reason,
      MANUAL_TRANSFER_MEMO_MAX_LENGTH,
    );
    const kind = body.kind;
    const idempotencyKey = asIdempotencyKey(body.idempotencyKey);
    const expectedReceivedAmount = typeof body.expectedReceivedAmount === "number"
      ? body.expectedReceivedAmount
      : Number(body.expectedReceivedAmount);
    const expectedLedgerEntryCount = typeof body.expectedLedgerEntryCount === "number"
      ? body.expectedLedgerEntryCount
      : Number(body.expectedLedgerEntryCount);
    if (
      (kind !== "auction" && kind !== "commerce" && kind !== "shipping") ||
      !targetId ||
      !ledgerId ||
      !reason ||
      !idempotencyKey ||
      !Number.isSafeInteger(expectedReceivedAmount) ||
      expectedReceivedAmount < 0 ||
      !Number.isSafeInteger(expectedLedgerEntryCount) ||
      expectedLedgerEntryCount < 1
    ) {
      return commerceJson({ error: "invalid_manual_transfer_reversal", outcome: "rejected" }, 400);
    }
    const rpcArgs = {
      p_expected_transfer_kind: kind,
      p_expected_transfer_id: targetId,
      p_ledger_id: ledgerId,
      p_expected_received_amount: expectedReceivedAmount,
      p_expected_ledger_entry_count: expectedLedgerEntryCount,
      p_idempotency_key: idempotencyKey,
      p_reason: reason,
    };
    const { data, error, status } = kind === "shipping"
      ? await auth.user.rpc("reverse_shipping_fee_payment", rpcArgs)
      : await auth.user.rpc("reverse_manual_transfer_payment", rpcArgs);
    if (error) {
      const outcome = status >= 400 && status < 500 ? "rejected" : "unknown";
      return commerceJson(
        { error: error.message || "manual_transfer_reversal_failed", outcome },
        outcome === "rejected" ? 409 : 503,
      );
    }
    const result = asManualTransferReversalResult(data, kind, targetId, ledgerId);
    if (!result) {
      return commerceJson(
        { error: "manual_transfer_reversal_result_unknown", outcome: "unknown" },
        503,
      );
    }
    return commerceJson({ result }, result.idempotent_replay ? 200 : 201);
  }

  return commerceJson({ error: "invalid_request" }, 400);
}
