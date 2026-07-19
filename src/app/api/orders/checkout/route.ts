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
  // production checkout is manual-transfer only, so the member-safe RPC
  // checks configuration before the order RPC can reserve fixed-price items.
  const { data: paymentRows, error: paymentStatusError } = await auth.user.rpc("get_commerce_payment_status");
  const paymentStatus = Array.isArray(paymentRows) ? paymentRows[0] : paymentRows;
  if (paymentStatusError || !paymentStatus) {
    return commerceJson({ error: "결제 설정을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요." }, 503);
  }
  if (paymentStatus.active_mode !== "manual_transfer") {
    return commerceJson({ error: "현재 사용 가능한 결제 수단이 없습니다. 운영자에게 문의해 주세요." }, 503);
  }
  if (!paymentStatus.configured) {
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
    const { data: createdTransfer, error: transferError } = await auth.user.rpc("create_commerce_order_transfer", { p_order_id: order.id });
    if (transferError || !createdTransfer) {
      return commerceJson({ error: transferError?.message || "입금 안내를 만들지 못했습니다. 잠시 후 다시 시도해 주세요." }, 503);
    }
    transfer = createdTransfer as Record<string, unknown>;
  }
  return commerceJson({ order: data, transfer }, 201);
}
