import { authenticateMemberCommerceRequest, commerceJson, normalizeIds } from "@/lib/commerce/server";

export async function POST(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { productIds?: unknown; addressId?: string; applyShippingCredit?: boolean; idempotencyKey?: string } | null;
  const productIds = normalizeIds(body?.productIds);
  const idempotencyKey = body?.idempotencyKey?.trim();
  if (productIds.length === 0 || !body?.addressId || !idempotencyKey || idempotencyKey.length > 128) {
    return commerceJson({ error: "배송 상품과 배송지를 선택해 주세요." }, 400);
  }
  const { data, error } = await auth.user.rpc("request_product_shipping", {
    p_address_id: body.addressId,
    p_product_ids: productIds,
    p_apply_shipping_credit: Boolean(body.applyShippingCredit),
    p_idempotency_key: idempotencyKey,
  });
  if (error) return commerceJson({ error: error.message || "배송 요청을 만들지 못했습니다." }, 409);
  if (!body.applyShippingCredit) {
    const amount = Number(process.env.SHIPPING_FEE_AMOUNT ?? "3500");
    if (!Number.isSafeInteger(amount) || amount <= 0) return commerceJson({ error: "배송비 설정이 없습니다." }, 503);
    const { data: setting } = await auth.admin
      .from("payment_runtime_settings")
      .select("active_mode, bank_name, account_number")
      .eq("singleton", true)
      .maybeSingle();
    if (setting?.active_mode !== "manual_transfer" || !setting.bank_name || !setting.account_number) return commerceJson({ error: "manual_transfer_unavailable" }, 503);
    const { data: existingPayment } = await auth.admin
      .from("shipping_fee_payments")
      .select("id")
      .eq("member_id", auth.userId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingPayment) return commerceJson({ request: { id: data } }, 200);
    const { error: paymentError } = await auth.admin.from("shipping_fee_payments").insert({
      member_id: auth.userId,
      shipping_request_id: data,
      expected_amount: amount,
      bank_name_snapshot: setting.bank_name,
      account_number_snapshot: setting.account_number,
      idempotency_key: idempotencyKey,
    });
    if (paymentError) {
      const { data: retryPayment } = await auth.admin
        .from("shipping_fee_payments")
        .select("id")
        .eq("member_id", auth.userId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (!retryPayment) return commerceJson({ error: "배송비 결제 안내를 만들지 못했습니다." }, 503);
    }
  }
  return commerceJson({ request: { id: data } }, 201);
}
