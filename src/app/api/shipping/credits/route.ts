import { authenticateMemberCommerceRequest, commerceJson } from "@/lib/commerce/server";
import { syncManualTransferSettings } from "@/lib/manualTransferConfig";

export async function GET(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request);
  if (!auth.ok) return auth.response;
  const [{ data: account, error: accountError }, { data: ledger, error: ledgerError }] = await Promise.all([
    auth.admin.from("member_accounts").select("shipping_credit_count").eq("member_id", auth.userId).maybeSingle(),
    auth.admin.from("shipping_credit_ledger").select("*").eq("member_id", auth.userId).order("created_at", { ascending: false }),
  ]);
  if (accountError || ledgerError) return commerceJson({ error: "shipping_credit_unavailable" }, 503);
  return commerceJson({ credits: account?.shipping_credit_count ?? 0, ledger: ledger ?? [] });
}

export async function POST(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { shippingRequestId?: string; idempotencyKey?: string } | null;
  const idempotencyKey = body?.idempotencyKey?.trim();
  if (!idempotencyKey || idempotencyKey.length > 128) return commerceJson({ error: "배송비 요청 키가 올바르지 않습니다." }, 400);
  const amount = Number(process.env.SHIPPING_FEE_AMOUNT ?? "3500");
  if (!Number.isSafeInteger(amount) || amount <= 0) return commerceJson({ error: "배송비 설정이 없습니다." }, 503);
  let account;
  try { account = await syncManualTransferSettings(auth.admin); } catch { return commerceJson({ error: "manual_transfer_unavailable" }, 503); }
  const { data: existingPayment } = await auth.admin
    .from("shipping_fee_payments")
    .select("*")
    .eq("member_id", auth.userId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingPayment) return commerceJson({ payment: existingPayment }, 200);
  const { data: payment, error } = await auth.admin
    .from("shipping_fee_payments")
    .insert({
      member_id: auth.userId,
      shipping_request_id: body?.shippingRequestId ?? null,
      expected_amount: amount,
      bank_name_snapshot: account.bankName,
      account_number_snapshot: account.accountNumber,
      idempotency_key: idempotencyKey,
    })
    .select("*")
    .single();
  if (error) {
    const { data: retryPayment } = await auth.admin
      .from("shipping_fee_payments")
      .select("*")
      .eq("member_id", auth.userId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (!retryPayment) return commerceJson({ error: "shipping_fee_unavailable" }, 503);
    return commerceJson({ payment: retryPayment }, 200);
  }
  return commerceJson({ payment }, 201);
}
