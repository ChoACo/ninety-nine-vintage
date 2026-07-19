import { authenticateCommerceRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request) {
  const auth = await authenticateCommerceRequest(request);
  if (!auth.ok) return auth.response;
  const [{ data: account, error: accountError }, { data: ledger, error: ledgerError }] = await Promise.all([
    auth.admin.from("member_accounts").select("shipping_credit_count").eq("member_id", auth.userId).maybeSingle(),
    auth.admin.from("shipping_credit_ledger").select("*").eq("member_id", auth.userId).order("created_at", { ascending: false }),
  ]);
  if (accountError || ledgerError) return commerceJson({ error: "shipping_credit_unavailable" }, 503);
  return commerceJson({ credits: account?.shipping_credit_count ?? 0, ledger: ledger ?? [] });
}

export async function POST(request: Request) {
  const auth = await authenticateCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { shippingRequestId?: string } | null;
  const amount = Number(process.env.SHIPPING_FEE_AMOUNT ?? "3500");
  if (!Number.isSafeInteger(amount) || amount <= 0) return commerceJson({ error: "배송비 설정이 없습니다." }, 503);
  const { data: setting } = await auth.admin
    .from("payment_runtime_settings")
    .select("active_mode, bank_name, account_number")
    .eq("singleton", true)
    .maybeSingle();
  if (setting?.active_mode !== "manual_transfer" || !setting.bank_name || !setting.account_number) return commerceJson({ error: "manual_transfer_unavailable" }, 503);
  const { data: payment, error } = await auth.admin
    .from("shipping_fee_payments")
    .insert({
      member_id: auth.userId,
      shipping_request_id: body?.shippingRequestId ?? null,
      expected_amount: amount,
      bank_name_snapshot: setting.bank_name,
      account_number_snapshot: setting.account_number,
    })
    .select("*")
    .single();
  if (error) return commerceJson({ error: "shipping_fee_unavailable" }, 503);
  return commerceJson({ payment }, 201);
}
