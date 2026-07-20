import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

function asTrimmedText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return commerceJson({ error: "invalid_request" }, 400);

  if (body.action === "record") {
    const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
    const depositorName = asTrimmedText(body.depositorName, 80);
    const memo = asTrimmedText(body.memo, 500);
    const kind = body.kind === "auction" ? "auction" : body.kind === "shipping" ? "shipping" : "commerce";
    if (!Number.isSafeInteger(amount) || amount < 1 || !depositorName) {
      return commerceJson({ error: "invalid_manual_transfer_receipt" }, 400);
    }
    const { data, error } = kind === "shipping"
      ? await auth.user.rpc("record_shipping_fee_payment", {
        p_payment_id: id,
        p_amount: amount,
        p_depositor_name: depositorName,
        p_memo: memo,
      })
      : await auth.user.rpc("record_manual_transfer_payment", {
        p_transfer_kind: kind,
        p_transfer_id: id,
        p_amount: amount,
        p_depositor_name: depositorName,
        p_memo: memo,
      });
    if (error) return commerceJson({ error: error.message || "manual_transfer_record_failed" }, 409);
    return commerceJson({ result: data }, 201);
  }

  if (body.action === "reverse") {
    const ledgerId = asTrimmedText(body.ledgerId, 80);
    const reason = asTrimmedText(body.reason, 500);
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
