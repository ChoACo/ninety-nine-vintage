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
    const ledgerId = canonicalizeManualTransferText(body.ledgerId, 80);
    const reason = canonicalizeManualTransferText(
      body.reason,
      MANUAL_TRANSFER_MEMO_MAX_LENGTH,
    );
    if (!ledgerId || !reason) return commerceJson({ error: "invalid_manual_transfer_reversal" }, 400);
    const kind = body.kind === "shipping" ? "shipping" : "order";
    const { data, error } = kind === "shipping"
      ? await auth.user.rpc("reverse_shipping_fee_payment", { p_ledger_id: ledgerId, p_reason: reason })
      : await auth.user.rpc("reverse_manual_transfer_payment", { p_ledger_id: ledgerId, p_reason: reason });
    if (error) return commerceJson({ error: error.message || "manual_transfer_reversal_failed" }, 409);
    return commerceJson({ result: data });
  }

  return commerceJson({ error: "invalid_request" }, 400);
}
