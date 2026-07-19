import { authenticateMemberCommerceRequest, commerceJson, normalizeIds } from "@/lib/commerce/server";

export async function POST(request: Request) {
  const auth = await authenticateMemberCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null) as { productIds?: unknown; idempotencyKey?: string } | null;
  const productIds = normalizeIds(body?.productIds);
  const idempotencyKey = body?.idempotencyKey?.trim();
  if (productIds.length === 0 || !idempotencyKey || idempotencyKey.length > 128) {
    return commerceJson({ error: "상품과 주문 요청 키가 필요합니다." }, 400);
  }

  // Do not create an order that the member cannot actually pay. The current
  // production checkout is manual-transfer only, so missing bank settings
  // must fail before the order RPC can reserve fixed-price products.
  const { data: paymentSetting, error: paymentSettingError } = await auth.admin
    .from("payment_runtime_settings")
    .select("active_mode, bank_name, account_number")
    .eq("singleton", true)
    .maybeSingle();
  if (paymentSettingError || !paymentSetting) {
    return commerceJson({ error: "결제 설정을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요." }, 503);
  }
  if (paymentSetting.active_mode !== "manual_transfer") {
    return commerceJson({ error: "현재 사용 가능한 결제 수단이 없습니다. 운영자에게 문의해 주세요." }, 503);
  }
  if (!paymentSetting.bank_name || !paymentSetting.account_number) {
    return commerceJson({ error: "운영자가 입금 계좌를 설정한 후 주문할 수 있습니다." }, 503);
  }

  const { data, error } = await auth.user.rpc("create_commerce_order", {
    p_product_ids: productIds,
    p_idempotency_key: idempotencyKey,
    p_apply_shipping_credit: false,
  });
  if (error) {
    const status = ["23505", "P0001", "P0002", "22023"].includes(error.code ?? "") ? 409 : 503;
    return commerceJson({ error: error.message || "주문을 만들지 못했습니다." }, status);
  }
  const order = data as { id?: string; total?: number } | null;
  let transfer: Record<string, unknown> | null = null;
  if (order?.id) {
    const { data: existingTransfer } = await auth.admin
      .from("commerce_order_transfers")
      .select("*")
      .eq("order_id", order.id)
      .maybeSingle();
    transfer = existingTransfer;
    if (!transfer) {
      if (typeof order.total === "number") {
        const { data: createdTransfer, error: transferError } = await auth.admin
          .from("commerce_order_transfers")
          .insert({
            order_id: order.id,
            member_id: auth.userId,
            expected_amount: order.total,
            bank_name_snapshot: paymentSetting.bank_name,
            account_number_snapshot: paymentSetting.account_number,
          })
          .select("*")
          .maybeSingle();
        transfer = createdTransfer;
        if (!transfer && transferError) {
          const { data: racedTransfer } = await auth.admin
            .from("commerce_order_transfers")
            .select("*")
            .eq("order_id", order.id)
            .maybeSingle();
          transfer = racedTransfer;
        }
      }
    }
  }
  return commerceJson({ order: data, transfer }, 201);
}
